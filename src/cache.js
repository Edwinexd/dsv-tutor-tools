// Stale-while-revalidate cache for the generated ICS document.
//
// Building a calendar means walking the whole SAML login chain plus a scrape,
// which is far slower than calendar clients are willing to wait. So we serve
// whatever we produced last and refresh in the background instead.

const FRESH_TTL = 900;        // seconds a cached calendar is served without revalidating
const CACHE_TTL = 604800;     // 7 days: how long a stale calendar stays usable in KV
const REFRESH_LOCK_TTL = 120; // seconds a background refresh holds the stampede lock

const icsKey = (username) => `ics:${username}`;
const lockKey = (username) => `ics-refresh:${username}`;

export async function readCachedICS(kv, username) {
  const cached = await kv.get(icsKey(username), 'json');
  if (!cached || !cached.ics) return null;

  const age = Math.max(0, Math.round((Date.now() - new Date(cached.timestamp).getTime()) / 1000));

  return {
    ics: cached.ics,
    scheduleCount: cached.scheduleCount ?? 0,
    age,
    stale: age >= FRESH_TTL
  };
}

export async function writeCachedICS(kv, username, ics, scheduleCount) {
  await kv.put(icsKey(username), JSON.stringify({
    ics,
    scheduleCount,
    timestamp: new Date().toISOString()
  }), { expirationTtl: CACHE_TTL });
}

// Best-effort single-flight lock, so a burst of requests queues one refresh
// rather than one login chain per request.
export async function acquireRefreshLock(kv, username) {
  if (await kv.get(lockKey(username))) return false;
  await kv.put(lockKey(username), '1', { expirationTtl: REFRESH_LOCK_TTL });
  return true;
}

export async function releaseRefreshLock(kv, username) {
  await kv.delete(lockKey(username));
}
