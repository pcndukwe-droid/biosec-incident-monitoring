# Biosec Incident Monitoring

Biosec-owned infrastructure and application health monitoring platform.

One Next.js application deployed as a single Cloudflare Worker with HTTP requests and a scheduled Cron handler. MongoDB Atlas and support email integration will be configured through Cloudflare secrets.

## Deployment

- Worker name: `biosec-incident-monitoring`
- Cloudflare build command: `npm run build:worker`
- Cloudflare deploy command: `npx wrangler deploy`
- GitHub branch: `main`
- `keep_vars: true` preserves dashboard-managed variables.

**Security:** Register only authorized Biosec hosts. Never commit credentials or internal infrastructure inventories. The monitoring scheduler remains inert until MONITOR_TARGETS is configured.

## Cloudflare build configuration

The Cloudflare Git integration uses `npm run build:worker` to produce the OpenNext output and `npx wrangler deploy` to publish the unified Worker. Production deployment is triggered by pushes to `main`; Cloudflare dashboard variables are retained by Wrangler `keep_vars: true`.

## Configurable monitoring and notifications (implementation in progress)

The Worker uses a one-minute Cron wake-up, but **does not** execute every monitor on every wake-up. The application reads `biosec_monitoring.monitoring_settings` and each service's `nextCheckAt`, then atomically reserves only due monitors. The default interval (10 minutes, configurable from 1-60 minutes) and recipient email addresses are stored in MongoDB. One Worker handles both the Next.js dashboard and the monitoring engine.

Protected UI: `/login` (JWT username/password), `/settings` (admin-only). The browser session is an 8-hour HttpOnly Secure SameSite=Lax cookie; inactive users and password changes revoke sessions.

Required production Worker bindings:
- `MONGODB_URI` — MongoDB connection string; **Secret**, not committed.
- `JWT_SECRET` — **Secret**, at least 32 random bytes (for example, generate with `openssl rand -hex 32`).
- `MONITORING_ENABLED` — master runtime kill switch; set to `true` **only after approved targets, secure settings, network access, alert delivery, and test checks have been verified**.

Optional Gmail API bindings (all credentials must be Cloudflare secrets):
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER`

The monitoring_settings document must have `monitoringEnabled: true` in addition to the master switch. Email delivery requires `emailEnabled: true`, valid alert recipients, and Gmail OAuth credentials.

**Security and operational readiness:** This is not yet production-ready. The dashboard uses internal JWT authentication; validate administrator login and user management in production before enabling monitoring. Monitor registration and public TCP checks are not yet implemented. MongoDB Atlas connectivity and mail sending have not been tested from the production Worker. Rotate credentials exposed in screenshots or chat. Never add secrets to GitHub. The monitoring engine currently supports only approved HTTPS checks; raw TCP checks require a separately reviewed implementation.

Incident documents are retained; health checks expire after 90 days. Every confirmed outage gets an OPENED alert; recovery gets a RECOVERED alert; configured interval reminders are emitted while the incident is open. New defaults: 10-minute routine checks, 1-minute checks after the first failure and throughout an incident, 3 failures to open an incident, 2 successes to recover, and 5-minute reminders. All are editable in Settings.

The default check interval is **10 minutes (6 checks/hour)**. This is a default for newly configured monitors, not the Cloudflare Cron interval (which remains a 1-minute wake-up). Critical monitors can use shorter per-monitor intervals. After the first failure detected on a routine check, 1-minute confirmation checks typically confirm three consecutive failures about two minutes later (subject to scheduler/processing delays). The initial failure may still go undetected until the next routine check.

## Administrator login and user management

The one-time public administrator bootstrap flow has been retired now that the initial Biosec administrator has been created. The public `/login` page contains only username/password sign-in, and `/api/auth/bootstrap` is removed. New accounts are created only by an authenticated administrator in **Settings → User accounts and permissions**.

Cloudflare production secrets: `MONGODB_URI` and `JWT_SECRET`. Remove the no-longer-needed `AUTH_BOOTSTRAP_TOKEN` secret from the Cloudflare dashboard after verifying an existing admin account works. Keep `JWT_SECRET`: removing or replacing it invalidates login sessions.

The session cookie is signed with HS256, expires after eight hours, and stores no password. Logout clears it; any account update increments `sessionVersion` to invalidate existing tokens. The login endpoint throttles repeated attempts using MongoDB.

**Do not add a username/password as Cloudflare plaintext variables.** Usernames and salted password hashes live in MongoDB; only the JWT signing key and MongoDB connection URI live in Cloudflare Secrets. No shared default credentials exist.

Monitor execution remains disabled until `MONITORING_ENABLED=true` and the database setting `monitoringEnabled=true` have both been explicitly enabled. Confirm alert delivery and test an approved endpoint first.
