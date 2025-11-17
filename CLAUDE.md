# Project Instructions for Claude

## Cloudflare Worker Deployment

After making changes to any files in the `src/` directory (especially `index.js`, `login.js`, `calendar.js`, or `crypto.js`), you MUST redeploy the Cloudflare Worker for changes to take effect.

**Deployment command:**
```bash
npx wrangler deploy
```

This deploys the worker defined in `wrangler.toml` to Cloudflare's edge network.

## Architecture Notes

- **Worker Entry Point**: `src/index.js`
- **Login/Scraping Logic**: `src/login.js`
- **Calendar Generation**: `src/calendar.js`
- **Encryption/Auth**: `src/crypto.js`
- **KV Store**: Used for caching session cookies (binding: `COOKIE_CACHE`)

## Important Filtering Logic

The calendar worker filters schedules to only show sessions where the user is actually scheduled (not all active lists). This is done by:
1. Extracting "Mina tider" entries from the handledning page (these appear as rows below schedule entries)
2. Associating each "Mina tider" with its date by looking at the previous table row
3. Only including schedules that match BOTH the date AND time from "Mina tider" entries
   - **Critical:** Must match date+time, not just time, since different lists on different days can have the same time slot

## Automatic Cookie Refresh

The worker includes automatic cookie expiration detection:
- If a cached cookie is expired (redirects to login page), it automatically re-authenticates
- Add `&nocache=true` to calendar URL to force fresh login (useful for debugging)
