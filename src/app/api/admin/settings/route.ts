import { NextRequest } from "next/server";
import { requireApiUser, sameOrigin } from "../../../../lib/server/auth";
import { readSettings, normalizeSettings, withMonitoringDb, type MonitoringSettings } from "../../../../lib/server/monitoring-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  try {
    const settings = await withMonitoringDb(auth.env, readSettings);
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to read monitoring settings" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const json: unknown = await request.json().catch(() => null);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return Response.json({ error: "Expected settings object" }, { status: 400 });
  }
  const input = json as Record<string, unknown>;
  const numbers = ["defaultIntervalMinutes", "failureRecheckMinutes", "failureThreshold", "recoveryThreshold", "reminderMinutes"] as const;
  const limits: Record<string, [number, number]> = {
    defaultIntervalMinutes: [1,60], failureRecheckMinutes: [1,10], failureThreshold: [1,20],
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
    await withMonitoringDb(auth.env, async db => {
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
