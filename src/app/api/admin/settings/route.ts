import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { readSettings, normalizeSettings, withMonitoringDb, type MonitoringEnv, type MonitoringSettings } from "../../../../lib/server/monitoring-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminEnv = MonitoringEnv & { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

async function authorize(request: NextRequest): Promise<AdminEnv | Response> {
  const { env } = await getCloudflareContext({ async: true });
  const bindings = env as unknown as AdminEnv;
  if (!bindings.ACCESS_TEAM_DOMAIN || !bindings.ACCESS_AUD) {
    return Response.json({ error: "Administrative access is not configured" }, { status: 503 });
  }
  const teamDomain = bindings.ACCESS_TEAM_DOMAIN.trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    return Response.json({ error: "Invalid Access domain configuration" }, { status: 503 });
  }
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const jwks = createRemoteJWKSet(new URL(teamDomain + "/cdn-cgi/access/certs"));
    await jwtVerify(assertion, jwks, { issuer: teamDomain, audience: bindings.ACCESS_AUD });
    return bindings;
  } catch {
    return Response.json({ error: "Invalid authentication" }, { status: 401 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  try {
    const settings = await withMonitoringDb(auth, readSettings);
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to read monitoring settings" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const json: unknown = await request.json().catch(() => null);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return Response.json({ error: "Expected settings object" }, { status: 400 });
  }
  const input = json as Record<string, unknown>;
  const numbers = ["defaultIntervalMinutes", "failureThreshold", "recoveryThreshold", "reminderMinutes"] as const;
  const limits: Record<string, [number, number]> = {
    defaultIntervalMinutes: [1,60], failureThreshold: [1,20],
    recoveryThreshold: [1,20], reminderMinutes: [5,1440],
  };
  for (const key of numbers) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < limits[key][0] || value > limits[key][1]) {
      return Response.json({ error: "Invalid " + key }, { status: 400 });
    }
  }
  if (typeof input.monitoringEnabled !== "boolean" || typeof input.emailEnabled !== "boolean") {
    return Response.json({ error: "Invalid enable flags" }, { status: 400 });
  }
  if (!Array.isArray(input.alertRecipients) || input.alertRecipients.length > 10 ||
    input.alertRecipients.some(v => typeof v !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    return Response.json({ error: "Provide up to ten valid email addresses" }, { status: 400 });
  }
  try {
    const settings = normalizeSettings(input as Partial<MonitoringSettings>);
    settings.updatedAt = new Date();
    await withMonitoringDb(auth, async db => {
      const { _id, ...mutableSettings } = settings;
      await db.collection<MonitoringSettings>("monitoring_settings").updateOne(
        { _id: "global" },
        { $set: mutableSettings },
        { upsert: true },
      );
    });
    return Response.json({ settings });
  } catch {
    return Response.json({ error: "Unable to save settings" }, { status: 503 });
  }
}
