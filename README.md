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

Protected settings UI: `/settings` (disabled until Cloudflare Access is configured).

Required production Worker bindings:
- `MONGODB_URI` — MongoDB connection string; **Secret**, not committed.
- `ACCESS_TEAM_DOMAIN` — your Cloudflare Access team domain (for example `https://yourteam.cloudflareaccess.com`).
- `ACCESS_AUD` — the Access application's audience tag.
- `MONITORING_ENABLED` — master runtime kill switch; set to `true` **only after approved targets, secure settings, network access, alert delivery, and test checks have been verified**.

Optional Gmail API bindings (all credentials must be Cloudflare secrets):
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER`

The monitoring_settings document must have `monitoringEnabled: true` in addition to the master switch. Email delivery requires `emailEnabled: true`, valid alert recipients, and Gmail OAuth credentials.

**Security and operational readiness:** This is not yet production-ready. The dashboard must be protected behind Cloudflare Access; monitor registration and public TCP checks are not yet implemented. MongoDB Atlas connectivity and mail sending have not been tested from the production Worker. Rotate credentials exposed in screenshots or chat. Never add secrets to GitHub. The monitoring engine currently supports only approved HTTPS checks; raw TCP checks require a separately reviewed implementation.

Incident documents are retained; health checks expire after 90 days. Every confirmed outage gets an OPENED alert; recovery gets a RECOVERED alert; configured interval reminders are emitted while the incident is open.

The default check interval is **10 minutes (6 checks/hour)**. This is a default for newly configured monitors, not the Cloudflare Cron interval (which remains a 1-minute wake-up). Critical monitors can use shorter per-monitor intervals. With three consecutive failures, detection at the default frequency may take approximately 20–30 minutes; configure shorter intervals or a lower threshold when faster alerts are required.
