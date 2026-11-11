# Architecture

AdCast is one Cloudflare Worker that serves both the API and the React dashboard, plus one Durable Object per tenant for realtime messaging. There is no separate backend server and no container.

## Stack

| Concern | Service |
| --- | --- |
| API and dashboard hosting | One Worker (Hono) with Static Assets (React 19, Vite 8, Tailwind 4) |
| Data | D1. Every table carries `tenant_id` and every query filters on it |
| Video files | R2, uploaded in 8 MB multipart chunks through the Worker |
| Realtime TV and dashboard link | One Durable Object per tenant (`TenantHub`), hibernating WebSockets |
| Schedules and offline alerts | Durable Object alarms |
| TV player | `/player`, a web page with offline caching (Cache API + service worker) |

## Layout

```
migrations/          D1 schema
src/shared/          Types shared by Worker, dashboard and player
src/worker/          API (routes/), TenantHub (hub.ts), helpers (lib/)
src/web/             Dashboard pages, player/ and browser-side upload/convert code
scripts/smoke.mjs    End-to-end API test against a running dev server
tests/               Unit tests (schedule math, payment math, prayer times)
```

Request routing is declared in `wrangler.jsonc`: `/api/*` and `/media/*` always run the Worker, everything else falls back to the single-page app.

## How the pieces work

**Pairing.** A TV opens `/player` and shows a 6-character code. An admin types it under Layar, which creates the device and hands the TV a token once. Removing the device revokes the token.

**Sending.** A broadcast becomes a command holding the item list and a `startAt` timestamp on the server clock, a few seconds ahead. Players measure their clock offset over the socket and derive their position from `startAt`, so TVs start together and a TV that joins late lands on the same spot. Pause stores `pausedAt`; resume shifts `startAt` by the pause length.

**Monitoring.** A screen counts as online while its socket answers pings. "Playing" comes from the player's own report, not from what was sent to it.

**Offline.** Players download the files of the current command and replay the last command from local storage when the network or the server is unreachable. YouTube items need a connection.

**Video checks.** The browser must decode a frame before upload starts. Files it cannot play (AVI, some MKV/MOV) are converted to H.264 MP4 in the browser with ffmpeg.wasm, up to 600 MB. The Worker re-checks size and container signature before marking a video ready.

**Schedules.** Start and end times are local to each branch (WIB, WITA, WIT). The tenant's Durable Object sets an alarm for the next event.

## Media, overlays, and statistics

- **Photos**: JPG, PNG, and WebP work alongside videos, uploaded (paid plans, scaled to 1920 px in the browser) or by https link (all plans). Each photo has its own time on screen, 10 seconds by default.
- **Content validity**: media can carry an optional start and end calendar date. Outside that range the item is left out when a playlist is assembled, so a finished promo stops on its own. A schedule uses each branch's local date; a manual broadcast uses the WIB date. If every item is out of range the schedule leaves its screens idle instead of replaying the last item.
- **Running text**: one scrolling line along the bottom of the screen, configured per branch and overridable per broadcast. It travels with the command and the TV draws it in CSS, so no extra file is stored and every plan gets it. The player sizes the bar from the screen, so it also fits a rotated display.
- **Portrait screens**: each screen can be rotated 90° or 270°. The TV rotates its own stage in CSS; files are never re-encoded.
- **Emergency announcement**: one message and background colour per business, stored in the `announcements` table apart from the current command. The hub pushes it to the targeted screens and they cover whatever is playing with large text. Clearing it sends `null` and the TVs rejoin the running timeline where it should be. Available from Pro (and during the trial), but clearing is always allowed in case a plan lapses while the message is up.
- **Prayer pause**: per branch, off by default. Pick a city (or enter coordinates) and how long to pause; TVs in that branch show a prayer notice at each of the five times and resume on their own. Times are computed on the TV with the Kemenag criteria (`src/shared/prayer.ts`), so the pause also happens offline. Friday midday has its own, longer pause.
- **Statistics**: every TV reports its online time and seconds played per item every 10 minutes. `/statistik` summarises all screens, `/layar/:id` shows one screen with daily charts and its content ranking, and both export a play report as CSV. History reaches back 7 days on the free plan, 30 on trial and Pro, 90 on Bisnis.

## Tenancy and access

- Every table has `tenant_id`; every query filters on the tenant from the session, never from the request body.
- Sessions are signed cookies. Passwords use PBKDF2 with 100k iterations; two-factor authentication uses TOTP.
- Device tokens are issued once at pairing and stored hashed; removing a screen revokes them.
- Roles gate the API with `requirePerm` and the dashboard hides what a role cannot use.
- Platform operators are the emails listed in `ADMIN_EMAILS`. They are the only ones who can open `/pembayaran`; everyone else gets a 404.

## Plans and limits

`src/shared/plans.ts` is the single place that defines plans, prices, and billing periods.

| | Gratis | Pro | Bisnis |
|---|---|---|---|
| Price per 30 days | Rp 0 | Rp 99.000 | Rp 299.000 |
| Screens | 2 | 10 | 50 |
| Branches | 1 | 5 | 25 |
| Users | 2 | 10 | 50 |
| Videos | 10 | 200 | 1.000 |
| Playlists | 2 | unlimited | unlimited |
| Schedules | 1 | unlimited | unlimited |
| Uploaded video storage | none | 20 GB | 100 GB |
| Own logo and colour | no | yes | yes |
| Statistics history | 7 days | 30 days | 90 days |

Every new business starts with a 7-day trial (`trial` in `plans.ts`): Pro limits, but only 1 GB of uploads, so trials that never convert leave little in storage. When the trial ends the business drops to the free plan on its own.

The free plan stores nothing in R2: videos come from YouTube or from an https link straight to an MP4/WebM file, which TVs stream from that address. Uploads and cloud imports need a paid plan. Twelve months are charged as ten.

When a trial or paid plan ends the tenant falls back to free limits. Uploaded files stay in the library but are left out of broadcasts and schedules, and screens beyond the free limit (the newest ones) stop receiving broadcasts; anything already playing on them is stopped within five minutes.

Uploaded files are deleted 30 days after the plan ended without renewal (`PURGE_AFTER_DAYS`). A daily cron (`triggers.crons` in `wrangler.jsonc`, 02:00 WIB) runs `purgeLapsedUploads`; the library entries remain, marked as removed, and the tenant gets a notification.

### What a tenant costs to run

Rates from Cloudflare's pricing pages (November 2026):

- R2 storage is $0.015 per GB-month with free egress, so a full Pro quota (20 GB) costs about $0.30 a month and a full Bisnis quota (100 GB) about $1.50.
- Durable Object storage writes are $1 per million rows. A TV reports its status every 20 seconds, so the hub saves a report only when it changes or every 5 minutes; saving every report would cost about $0.13 per TV per month.
- The Workers Paid plan is a flat $5 a month, needed once usage outgrows the free tier.

## Payment (static QRIS, confirmed by hand)

1. A tenant picks a plan on `/paket`. The order total is the price plus a unique code of 1 to 999, and no two open orders share a total.
2. The page shows the merchant QRIS from the `QRIS_PAYLOAD` secret with that total embedded, so the payer's app fills it in.
3. The tenant presses "Saya sudah bayar". Unclaimed orders expire after 24 hours.
4. An operator whose email is listed in `ADMIN_EMAILS` opens `/pembayaran`, matches the total against the QRIS statement, and confirms or rejects. Confirming activates the plan and extends it from the current end date.

`QRIS_PAYLOAD` is a secret, never a var: it carries the merchant's national merchant id, so it must not be committed. Without it `/paket` disables the buy button and `POST /api/billing/orders` returns 400.

## Free-tier limits to watch

100k Worker requests per day, 10 GB R2 storage, 5 GB D1, and 10 ms CPU per request. Password hashing (PBKDF2, 100k iterations) is the heaviest request; if logins fail with error 1102 on the free plan, move to the paid Workers plan.
