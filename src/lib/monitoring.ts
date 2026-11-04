export type MonitorTarget = {
  id: string;
  name: string;
  url: string;
  expectedStatus?: number;
};

export type CheckResult = {
  id: string;
  name: string;
  status: "up" | "down";
  httpStatus?: number;
  latencyMs: number;
  checkedAt: string;
  error?: string;
};

export type MonitoringEnv = {
  MONITORING_ENABLED?: string;
  MONITOR_TARGETS?: string;
};

function parseTargets(raw?: string): MonitorTarget[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 30) {
    throw new Error("MONITOR_TARGETS must be an array with at most 30 entries");
  }
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid monitor target");
    const target = value as Record<string, unknown>;
    if (typeof target.id !== "string" || typeof target.name !== "string" || typeof target.url !== "string") {
      throw new Error("Each monitor must specify string id, name and url");
    }
    const url = new URL(target.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
      throw new Error("Only approved public HTTPS URLs on port 443 are supported in the initial phase");
    }
    return { id: target.id, name: target.name, url: url.toString(), expectedStatus: typeof target.expectedStatus === "number" ? target.expectedStatus : 200 };
  });
}

async function check(target: MonitorTarget): Promise<CheckResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(target.url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "BiosecIncidentMonitor/0.1" },
    });
    return { id: target.id, name: target.name, status: response.status === (target.expectedStatus ?? 200) ? "up" : "down", httpStatus: response.status, latencyMs: Date.now() - start, checkedAt };
  } catch (error) {
    return { id: target.id, name: target.name, status: "down", latencyMs: Date.now() - start, checkedAt, error: error instanceof Error ? error.message : "Unknown check failure" };
  }
}

export async function runScheduledChecks(env: MonitoringEnv): Promise<void> {
  if (env.MONITORING_ENABLED !== "true") {
    console.info("Biosec monitoring is disabled until initial configuration is complete.");
    return;
  }
  const targets = parseTargets(env.MONITOR_TARGETS);
  if (targets.length === 0) {
    console.warn("Monitoring enabled but no target URLs configured.");
    return;
  }
  // Phase 1 dry-run: results are logs only. MongoDB persistence and alerts
  // must be configured before interpreting these as production incident reports.
  const results = await Promise.all(targets.map(check));
  for (const result of results) console.log(JSON.stringify({ kind: "monitor_check", ...result }));
}
