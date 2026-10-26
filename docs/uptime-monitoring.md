# Uptime monitoring — watching Beuk from outside

Beuk cannot watch itself. When the server, Docker, Caddy or the network is
down, nothing on the box can send an alert, and `/status` does not load.
Something on another machine has to ask the server, on a timer, whether it
answers, and tell you when it stops. This page says what to point that
monitor at and lists a few services that do it. **V picks and buys;** nothing
here is set up yet.

## What to point a monitor at

| URL | What a good answer is | What it proves |
|---|---|---|
| `https://beuk.studio/api/health` | HTTP **200** and the body contains `"ok":true` | Caddy, TLS, the app and the database all answered. 503 `{"ok":false,"db":"down"}` when the database does not. Not cached. |
| `https://beuk.studio/api/status/public` | HTTP **200** and the body contains `"ok":true` | The same, plus the public status reading (studio, shelf, Help, server checks, email, backups). 503 when the database is down. Cached 30 s on the server, so polling it often costs one database round trip per half minute. |
| `https://beuk.studio/` | HTTP **200** and the body contains `Start writing` | The landing page is served (Caddy's static files), independently of the app. |
| `https://beuk.studio/studio` | HTTP **200** | The studio file is served. |

A keyword check ("body contains `"ok":true`") is better than a status-code
check alone: a broken proxy can answer 200 with an error page.

`/api/status/public` also carries `"overall"`: `ok`, `attention` (something
needs a look, for example a red backup check) or `down`. A monitor that can
match JSON or keywords can alert on `"overall":"attention"` as a slower,
lower-priority rule.

## Suggested intervals and alert rules [estimate]

These are judgements for a small single-server service, not measurements.

- **`/api/health`: every 1–5 minutes**, alert after **2 failures in a row**
  (one failure is often a blip or a redeploy; `docker compose up -d --build`
  restarts the app for a few seconds).
- **`/` (landing page): every 5 minutes**, alert after 2 failures.
- **`/api/status/public` keyword `"overall":"attention"`: every 15–30 minutes**,
  email only (no phone call): it means "look today", not "wake up".
- **SSL certificate expiry**: if the service offers it, warn 14 days ahead.
  Caddy renews automatically; the warning catches a renewal that failed.
- Send alerts to a channel you actually read. Email is enough to start.
- Expect alerts during deploys. Either pause the monitor while deploying or
  accept one "down / up" pair per deploy.

## Backups have their own alerts

The server itself alerts on backup problems (README "Backup alerts and
retention"): set `ALERT_EMAIL` (needs email set up) and/or
`ALERT_WEBHOOK_URL`. Those alerts come from the server, so they cannot fire
when the server is dead — which is what the outside monitor above is for.

A "dead man's switch" service (Healthchecks.io below, or a heartbeat monitor
in Better Stack / UptimeRobot) expects a ping on a schedule and alerts when
the ping stops. Beuk does **not** send such a ping yet; if you want one
after every successful scheduled backup, it is a small addition (one URL
setting, one request after the backup).

## Options (checked 26 October 2026)

Prices and limits below were read from each provider's own page on
**26 October 2026**. They change; check the page again before you buy.
Where a page did not say something, this file says so instead of guessing.

### UptimeRobot (hosted)

Source: https://uptimerobot.com/pricing/

- **Free: $0**, 50 monitors, 5-minute checks, HTTP and keyword monitoring,
  1 status page, 3 months of data, "only 5 integrations". The page describes
  it as "Good for hobby and non-profit projects" and says nothing either way
  about commercial use. Which alert channels the free plan includes was not
  readable from the pricing page's feature table.
- **Solo:** $12/month billed annually, 10 monitors, 60-second checks.
- **Team:** $39/month billed annually, 100 monitors, 30-second checks,
  webhook alerts listed.
- **Scale:** $79/month billed annually, 15-second checks.
- The page also shows a second price per plan ($13 / $46 / $98); which
  billing period it belongs to was not readable from the page text.
- SMS / voice credits are bought separately on any plan.

### Better Stack (hosted)

Source: https://betterstack.com/pricing

- **Free: $0/month**, "Free for personal projects": **10 monitors &
  heartbeats** (one shared allowance), 1 status page, "Slack & e-mail alerts".
  The free plan's check interval is not stated on the page.
- Paid uptime is sold as add-ons, not a single base price on that page:
  **+10 heartbeats $17/month** billed yearly ($20 monthly); **+50 monitors
  $21/month** billed yearly ($25 monthly). Paid features include checks up to
  every 30 seconds, phone/SMS alerts and multi-location checks.

### Healthchecks.io (hosted, also open source) — for heartbeats

Sources: https://healthchecks.io/pricing/, https://healthchecks.io/docs/,
https://github.com/healthchecks/healthchecks

- It is a dead man's switch, not a website checker: your job pings a URL
  (`https://hc-ping.com/<uuid>`); if the ping does not arrive within the
  period plus a grace time, it alerts. Useful for "the nightly backup ran".
- **Hobbyist: $0**, 20 checks, 100 log entries per check. **Supporter: $5/month**,
  same limits. **Business: $20/month** ($16/month yearly), 100 checks,
  1,000 log entries. **Business Plus: $80/month** ($64/month yearly), 1,000 checks.
- Notification methods listed in its docs include email, chat, SMS /
  WhatsApp / phone calls (paid quotas), Pushover and incident tools; the
  project README lists Slack and Discord among 25+ integrations.
- The software is BSD-3-Clause and can be run yourself (README: Docker
  images, "Running in Production").

### Uptime Kuma (self-hosted, free)

Source: https://github.com/louislam/uptime-kuma

- Open source (MIT), runs in Docker. Monitor types include HTTP(s), HTTP(s)
  keyword, HTTP(s) JSON query, TCP, ping, DNS and push (heartbeat).
  Notifications include email (SMTP), Discord, Slack, Telegram and many more
  ("90+ notification services").
- **It must run somewhere other than the Beuk server** (a home machine, a
  second small VPS), or it goes down together with what it watches. Running
  it costs whatever that other machine costs; there is no licence fee.

## What V decides

1. Which service (or two: one website checker + one heartbeat).
2. Where alerts go (an email address you read; a phone push for "down").
3. Whether Beuk should send a heartbeat ping after each scheduled backup.
