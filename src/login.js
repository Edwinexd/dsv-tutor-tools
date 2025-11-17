import * as cheerio from 'cheerio';

const CACHE_DURATION = 3600; // 1 hour in seconds

// Helper to extract cookies from Set-Cookie headers
function extractCookies(response) {
  const cookies = {};

  // In Cloudflare Workers, we can iterate over headers
  // Set-Cookie headers appear as separate entries
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') {
      const parts = value.split(';')[0]; // Get only the name=value part
      const [cookieName, ...valueParts] = parts.split('=');
      if (cookieName && valueParts.length > 0) {
        cookies[cookieName.trim()] = valueParts.join('=').trim();
      }
    }
  }

  return cookies;
}

// Helper to build Cookie header from cookie object
function buildCookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export async function handledningLogin(kv, username, password, useCache = true) {
  // Check cache first
  if (useCache) {
    const cacheKey = `cookie:${username}:handledning`;
    const cached = await kv.get(cacheKey, 'json');

    if (cached && cached.cookie) {
      const cachedTime = new Date(cached.timestamp);
      const now = new Date();
      if ((now - cachedTime) < CACHE_DURATION * 1000) {
        return cached.cookie;
      }
    }
  }

  const cookies = {}; // Track cookies across requests

  const baseHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8,sv;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Powered-By': 'dsv-calendar-worker; Contact (edwinsu@dsv.su.se)'
  };

  // 1. Get main page
  let response = await fetch('https://handledning.dsv.su.se/', {
    headers: baseHeaders,
    redirect: 'follow'
  });
  Object.assign(cookies, extractCookies(response));
  let html = await response.text();

  // 2. Find SU login link
  let $ = cheerio.load(html);
  let suLoginLink = null;
  $('a').each((i, elem) => {
    const text = $(elem).text();
    if (text.includes('Stockholm') && (text.toLowerCase().includes('universitet') || text.includes('University'))) {
      suLoginLink = $(elem).attr('href');
      return false; // break
    }
  });

  if (!suLoginLink) {
    throw new Error('Could not find Stockholm University login link');
  }

  if (suLoginLink.startsWith('/')) {
    suLoginLink = 'https://handledning.dsv.su.se' + suLoginLink;
  }

  // 3. Navigate to SU login (follow redirects manually to track cookies)
  let currentUrl = suLoginLink;
  let redirectCount = 0;
  const MAX_REDIRECTS = 10;

  while (redirectCount < MAX_REDIRECTS) {
    const headers1 = { ...baseHeaders };
    if (Object.keys(cookies).length > 0) {
      headers1['Cookie'] = buildCookieHeader(cookies);
    }

    response = await fetch(currentUrl, {
      headers: headers1,
      redirect: 'manual'  // Handle redirects manually
    });

    Object.assign(cookies, extractCookies(response));

    // Check if it's a redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;

      // Make location absolute if needed
      if (location.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
      } else if (location.startsWith('http')) {
        currentUrl = location;
      } else {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}/${location}`;
      }

      redirectCount++;
    } else {
      // Not a redirect, we're done
      break;
    }
  }

  html = await response.text();

  // 4. Parse and submit first form (auto-submit)
  $ = cheerio.load(html);
  const form1 = $('form').first();
  const actionUrl1 = form1.attr('action');

  if (!actionUrl1) {
    // Debug: check if we got redirected or have a different page
    const title = $('title').text();
    const forms = $('form').length;
    throw new Error(`Could not find form action URL. Page title: "${title}", Forms found: ${forms}`);
  }

  const formData1 = {};
  form1.find('input').each((i, elem) => {
    const name = $(elem).attr('name');
    const value = $(elem).attr('value');
    if (name && value) {
      formData1[name] = value;
    }
  });
  formData1['_eventId_proceed'] = '';

  const headers2 = {
    ...baseHeaders,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://idp.it.su.se',
    'Referer': suLoginLink
  };
  if (Object.keys(cookies).length > 0) {
    headers2['Cookie'] = buildCookieHeader(cookies);
  }

  response = await fetch('https://idp.it.su.se' + actionUrl1, {
    method: 'POST',
    headers: headers2,
    body: new URLSearchParams(formData1),
    redirect: 'follow'
  });
  Object.assign(cookies, extractCookies(response));
  html = await response.text();

  // 5. Parse login form and submit credentials
  $ = cheerio.load(html);
  const form2 = $('form').first();
  const actionUrl2 = form2.attr('action');

  if (!actionUrl2) {
    throw new Error('No login form found');
  }

  const formData2 = {};
  form2.find('input').each((i, elem) => {
    const name = $(elem).attr('name');
    const value = $(elem).attr('value') || '';
    if (name) {
      formData2[name] = value;
    }
  });

  formData2['j_username'] = username;
  formData2['j_password'] = password;
  formData2['_eventId_proceed'] = '';
  delete formData2['_eventId_authn/SPNEGO'];
  delete formData2['_eventId_trySPNEGO'];

  const headers3 = {
    ...baseHeaders,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://idp.it.su.se',
    'Referer': response.url
  };
  if (Object.keys(cookies).length > 0) {
    headers3['Cookie'] = buildCookieHeader(cookies);
  }

  response = await fetch('https://idp.it.su.se' + actionUrl2, {
    method: 'POST',
    headers: headers3,
    body: new URLSearchParams(formData2),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }

  Object.assign(cookies, extractCookies(response));
  html = await response.text();

  // 6. Parse and submit SAML response
  $ = cheerio.load(html);
  const form3 = $('form').first();
  const actionUrl3 = form3.attr('action');

  if (!actionUrl3) {
    throw new Error('No SAML response form found');
  }

  const formData3 = {};
  form3.find('input').each((i, elem) => {
    const name = $(elem).attr('name');
    const value = $(elem).attr('value');
    if (name && value) {
      formData3[name] = value;
    }
  });

  let headers4 = {
    ...baseHeaders,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://idp.it.su.se',
    'Referer': response.url
  };
  if (Object.keys(cookies).length > 0) {
    headers4['Cookie'] = buildCookieHeader(cookies);
  }

  // Follow redirects manually to capture cookies at each step
  currentUrl = actionUrl3;
  redirectCount = 0;

  while (redirectCount < MAX_REDIRECTS) {
    response = await fetch(currentUrl, {
      method: redirectCount === 0 ? 'POST' : 'GET',
      headers: headers4,
      body: redirectCount === 0 ? new URLSearchParams(formData3) : undefined,
      redirect: 'manual'
    });

    Object.assign(cookies, extractCookies(response));

    // Check if it's a redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;

      // Make location absolute
      if (location.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
      } else if (location.startsWith('http')) {
        currentUrl = location;
      } else {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}/${location}`;
      }

      // Update headers for subsequent requests (no longer POST)
      headers4 = {
        ...baseHeaders,
        'Cookie': buildCookieHeader(cookies)
      };

      redirectCount++;
    } else {
      // Not a redirect, we're done
      break;
    }
  }

  // Extract JSESSIONID from accumulated cookies
  const jsessionid = cookies['JSESSIONID'];

  if (!jsessionid) {
    throw new Error('Failed to obtain JSESSIONID cookie');
  }

  // Cache the cookie
  if (useCache) {
    const cacheKey = `cookie:${username}:handledning`;
    await kv.put(cacheKey, JSON.stringify({
      cookie: jsessionid,
      timestamp: new Date().toISOString()
    }), { expirationTtl: CACHE_DURATION });
  }

  return jsessionid;
}

export async function getPlannedSchedules(kv, username, password, useCache = true) {
  let jsessionid = await handledningLogin(kv, username, password, useCache);

  let response = await fetch('https://handledning.dsv.su.se/teacher/?onlyown=yes', {
    headers: {
      'Cookie': `JSESSIONID=${jsessionid}`,
      'X-Powered-By': 'dsv-calendar-worker; Contact (edwinsu@dsv.su.se)'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schedules: ${response.status}`);
  }

  let html = await response.text();

  // Check if we got redirected to login page (cookie expired)
  if (html.includes('Stockholm University') && html.includes('login')) {
    // Cookie is invalid, force re-login
    jsessionid = await handledningLogin(kv, username, password, false);

    response = await fetch('https://handledning.dsv.su.se/teacher/?onlyown=yes', {
      headers: {
        'Cookie': `JSESSIONID=${jsessionid}`,
        'X-Powered-By': 'dsv-calendar-worker; Contact (edwinsu@dsv.su.se)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedules after re-login: ${response.status}`);
    }

    html = await response.text();
  }
  const $ = cheerio.load(html);
  const schedules = [];

  // First, find all "Mina tider" time ranges (sessions where you're actually scheduled)
  const minaTiderKeys = new Set();
  $('td[colspan]').each((i, elem) => {
    const cellText = $(elem).text();
    if (cellText.includes('Mina tider')) {
      // Find the date from the previous row (Mina tider appears in a row below the schedule row)
      const currentRow = $(elem).parent('tr');
      const previousRow = currentRow.prev('tr');

      if (previousRow.length > 0) {
        const cells = previousRow.find('td');
        if (cells.length >= 3) {
          const dateStr = $(cells[1]).text().trim();

          // Only extract times AFTER "Mina tider:" text
          const afterMinaTider = cellText.split('Mina tider')[1];
          if (afterMinaTider) {
            const timeMatches = afterMinaTider.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g);
            for (const match of timeMatches) {
              // Store as "date:time" key
              const key = `${dateStr}:${match[1]}:${match[2]}-${match[3]}:${match[4]}`;
              minaTiderKeys.add(key);
            }
          }
        }
      }
    }
  });

  // Find table with schedule data
  $('table').each((i, table) => {
    const $table = $(table);
    const rows = $table.find('tr');

    // Check if this is the schedule table
    const headerText = rows.first().text();
    if (!headerText.includes('Datum') || !headerText.includes('Tid')) {
      return; // continue to next table
    }

    // Parse data rows
    rows.slice(1).each((j, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      try {
        const listType = $(cells[0]).text().trim();
        const dateStr = $(cells[1]).text().trim();
        const timeStr = $(cells[2]).text().trim();
        const coursesStr = $(cells[3]).text().trim();
        const comments = cells.length > 4 ? $(cells[4]).text().trim() : '';

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;

        // Parse time range
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!timeMatch) return;

        // Extract course codes
        const courseCodes = [];
        const courseMatches = coursesStr.matchAll(/\[\s*([^\]]+?)\s*\]/g);
        for (const match of courseMatches) {
          courseCodes.push(match[1]);
        }
        const courseName = courseCodes.length > 0 ? courseCodes.join(', ') : listType;

        // Build datetime objects
        const [year, month, day] = dateStr.split('-').map(Number);
        const startHour = parseInt(timeMatch[1]);
        const startMin = parseInt(timeMatch[2]);
        const endHour = parseInt(timeMatch[3]);
        const endMin = parseInt(timeMatch[4]);

        const startTime = new Date(year, month - 1, day, startHour, startMin);
        const endTime = new Date(year, month - 1, day, endHour, endMin);

        // Only include if this date+time matches a "Mina tider" entry
        const key = `${dateStr}:${timeMatch[1]}:${timeMatch[2]}-${timeMatch[3]}:${timeMatch[4]}`;
        if (!minaTiderKeys.has(key)) {
          return; // Skip this schedule - not in "Mina tider"
        }

        // Find list ID from links
        let listId = null;
        $(row).find('a').each((k, link) => {
          const href = $(link).attr('href');
          if (href && href.includes('listid=')) {
            const match = href.match(/listid=(\d+)/);
            if (match) {
              listId = match[1];
              return false; // break
            }
          }
        });

        schedules.push({
          course: courseName,
          start_time: startTime,
          end_time: endTime,
          location: comments,
          list_id: listId,
          list_type: listType
        });
      } catch (e) {
        // Skip rows that fail to parse
      }
    });
  });

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const schedule of schedules) {
    const key = `${schedule.list_id}-${schedule.start_time.getTime()}-${schedule.end_time.getTime()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(schedule);
    }
  }

  return unique;
}
