// One Cloudflare Worker serves Next.js requests and runs scheduled checks.
// Generated during the OpenNext build; not available before compilation.
// @ts-ignore Generated entrypoint
import handler from "./.open-next/worker.js";
import { runScheduledChecks } from "./src/lib/monitoring";

type MonitoringEnv = { MONITORING_ENABLED?: string; MONITOR_TARGETS?: string };

export default {
  fetch: handler.fetch,
  async scheduled(_event: ScheduledController, env: MonitoringEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledChecks(env));
  },
};
