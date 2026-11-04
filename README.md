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
