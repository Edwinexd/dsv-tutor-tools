import { getPlannedSchedules } from './login';
import { generateICS } from './calendar';
import { decryptCredentials, verifyDigest } from './crypto';
import {
  readCachedICS,
  writeCachedICS,
  acquireRefreshLock,
  releaseRefreshLock
} from './cache';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Root endpoint
    if (path === '/' || path === '') {
      return new Response(JSON.stringify({
        service: 'DSV Calendar Worker',
        version: '2.1.0',
        endpoints: {
          '/calendar.ics': 'Get ICS calendar (requires ?digest=sha256&auth=encrypted)',
          '/': 'This page'
        },
        usage: 'digest=SHA256(SECRET+encrypted_auth), auth=AES-GCM-encrypted(username:password)',
        security: 'Credentials are encrypted with AES-256-GCM. Each user gets a unique digest.',
        caching: 'Calendars are served from cache and refreshed in the background. Add &nocache=true to force a fresh scrape.',
        note: 'Use generate_calendar_url.js to create your encrypted URL'
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Calendar endpoint
    if (path === '/calendar.ics') {
      return await handleCalendar(request, env, ctx);
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function icsResponse(icsContent, extraHeaders = {}) {
  return new Response(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename=dsv-tutoring.ics',
      'Cache-Control': 'private, max-age=900',
      ...extraHeaders
    }
  });
}

async function buildICS(env, username, password, useCookieCache) {
  const schedules = await getPlannedSchedules(env.COOKIE_CACHE, username, password, useCookieCache);
  return { ics: generateICS(schedules), count: schedules.length };
}

async function refreshInBackground(env, username, password) {
  const kv = env.COOKIE_CACHE;

  if (!await acquireRefreshLock(kv, username)) return;

  try {
    const { ics, count } = await buildICS(env, username, password, true);
    await writeCachedICS(kv, username, ics, count);
  } catch (e) {
    // The stale copy stays in KV, so a failed refresh just means the next
    // request serves the same calendar again and retries.
    console.error('Background calendar refresh failed:', e);
  } finally {
    await releaseRefreshLock(kv, username);
  }
}

async function handleCalendar(request, env, ctx) {
  const url = new URL(request.url);
  const digest = url.searchParams.get('digest');
  const auth = url.searchParams.get('auth');

  // Validate parameters
  if (!digest || !auth) {
    return new Response(JSON.stringify({ error: 'Missing digest or auth parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate secrets
  const secret = env.CALENDAR_SECRET;
  const encryptionKey = env.ENCRYPTION_KEY;

  if (!secret || !encryptionKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: missing secrets' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Verify digest
  if (!await verifyDigest(digest, secret, auth)) {
    return new Response(JSON.stringify({ error: 'Invalid digest. Access denied.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Decrypt credentials
  let username, password;
  try {
    const credentials = await decryptCredentials(auth, encryptionKey);
    username = credentials.username;
    password = credentials.password;
  } catch (e) {
    return new Response(JSON.stringify({ error: `Invalid auth parameter: ${e.message}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const nocache = url.searchParams.get('nocache') === 'true';

  // Serve the cached calendar immediately, refreshing behind the response if
  // it has gone stale. This is the path calendar clients normally hit.
  if (!nocache) {
    const cached = await readCachedICS(env.COOKIE_CACHE, username);
    if (cached) {
      if (cached.stale) {
        ctx.waitUntil(refreshInBackground(env, username, password));
      }
      return icsResponse(cached.ics, {
        'X-Cache': cached.stale ? 'STALE' : 'HIT',
        'X-Cache-Age': cached.age.toString(),
        'X-Schedule-Count': cached.scheduleCount.toString()
      });
    }
  }

  // Cold cache, or an explicitly forced refresh: build it inline.
  try {
    const { ics, count } = await buildICS(env, username, password, !nocache);
    ctx.waitUntil(writeCachedICS(env.COOKIE_CACHE, username, ics, count));

    return icsResponse(ics, {
      'X-Cache': nocache ? 'BYPASS' : 'MISS',
      'X-Schedule-Count': count.toString()
    });
  } catch (e) {
    console.error('Calendar fetch error:', e);

    // A failed scrape must not empty out a subscribed calendar - fall back to
    // the last good copy if we have one, however old it is.
    const fallback = await readCachedICS(env.COOKIE_CACHE, username);
    if (fallback) {
      return icsResponse(fallback.ics, {
        'X-Cache': 'STALE-ERROR',
        'X-Cache-Age': fallback.age.toString(),
        'X-Schedule-Count': fallback.scheduleCount.toString()
      });
    }

    return new Response(JSON.stringify({
      error: `Authentication failed: ${e.message}`,
      stack: e.stack
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
