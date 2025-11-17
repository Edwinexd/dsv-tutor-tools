import { handledningLogin, getPlannedSchedules } from './login';
import { generateICS } from './calendar';
import { decryptCredentials, verifyDigest } from './crypto';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Root endpoint
    if (path === '/' || path === '') {
      return new Response(JSON.stringify({
        service: 'DSV Calendar Worker',
        version: '2.0.0',
        endpoints: {
          '/calendar.ics': 'Get ICS calendar (requires ?digest=sha256&auth=encrypted)',
          '/': 'This page'
        },
        usage: 'digest=SHA256(SECRET+encrypted_auth), auth=AES-GCM-encrypted(username:password)',
        security: 'Credentials are encrypted with AES-256-GCM. Each user gets a unique digest.',
        note: 'Use generate_calendar_url.js to create your encrypted URL'
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Calendar endpoint
    if (path === '/calendar.ics') {
      return await handleCalendar(request, env);
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function handleCalendar(request, env) {
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

  // Fetch schedules
  try {
    // Check for nocache parameter to bypass KV cache
    const nocache = url.searchParams.get('nocache') === 'true';
    const schedules = await getPlannedSchedules(env.COOKIE_CACHE, username, password, !nocache);

    // Generate ICS
    const icsContent = generateICS(schedules);

    // Add debug header if nocache was used
    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename=dsv-tutoring.ics',
      'Cache-Control': 'private, max-age=900'
    };
    if (nocache) {
      headers['X-Cache-Bypassed'] = 'true';
    }
    headers['X-Schedule-Count'] = schedules.length.toString();

    return new Response(icsContent, { headers });
  } catch (e) {
    console.error('Calendar fetch error:', e);
    return new Response(JSON.stringify({
      error: `Authentication failed: ${e.message}`,
      stack: e.stack
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
