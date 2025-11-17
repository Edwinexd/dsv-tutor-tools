# DSV Tutor Tools

## About
Two complementary tools for DSV tutors:

### 1. Queue Notification Monitor (`main.py`)
Python script that monitors the DSV handledning system and sends push notifications via Pushover when students request help.

### 2. Calendar Feed Worker (Cloudflare Worker)
Generates an encrypted ICS calendar feed of your scheduled tutoring sessions. Automatically filters to only show sessions where you're actually scheduled (based on "Mina tider" entries), not all active lists.

**Key features:**
- Encrypted authentication using AES-256-GCM
- Automatic session filtering by date+time matching
- Cookie caching with automatic refresh on expiration
- Compatible with any calendar app (Apple Calendar, Google Calendar, etc.)

## Configuration

### Queue Monitor
Environment variables:
- `SU_USERNAME` - Your Stockholm University username
- `SU_PASSWORD` - Your Stockholm University password
- `PUSHOVER_KEY` - Your Pushover application token
- `PUSHOVER_USER` - Your Pushover user key

### Calendar Worker
Deployed as a Cloudflare Worker (see `wrangler.toml`). Requires:
- `CALENDAR_SECRET` - Secret key for digest validation (Cloudflare secret)
- `ENCRYPTION_KEY` - AES-256 key for credential encryption (Cloudflare secret)
- `COOKIE_CACHE` - KV namespace for session cookie caching

Generate calendar URL using the encryption utility (credentials are never stored in plaintext).

## Deployment
```bash
# Deploy calendar worker
npx wrangler deploy
```

## Disclaimer
This project is not affiliated with Stockholm University in any way. It is a personal project and should be used responsibly. Provided as is, no guarantees are made about its functionality or security.
