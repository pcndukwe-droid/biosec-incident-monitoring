import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { requireApiUser, sameOrigin } from "../../../../../lib/server/auth";
import { withMonitoringDb, type StoredMonitor } from "../../../../../lib/server/monitoring-db";
import { performCheck } from "../../../../../lib/monitoring-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid test request" }, { status: 400 });
  }
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || !ObjectId.isValid(id)) {
    return Response.json({ error: "Invalid monitor ID" }, { status: 400 });
  }
  try {
    return await withMonitoringDb(auth.env, async db => {
      // Rate-limit manual probes; never touch the service's schedule,
      // health-check history, incident state, or notification queue.
      const limits = db.collection<{ _id: string; count: number; expiresAt: Date }>("monitor_test_rate_limits");
      await limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      const bucket = Math.floor(Date.now() / 60_000);
      const key = auth.user.id + ":" + bucket;
      const usage = await limits.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 120_000) } },
        { upsert: true, returnDocument: "after" },
      );
      if ((usage?.count ?? 0) > 5) {
        return Response.json({ error: "Manual tests are limited to five per minute. Try again shortly." },
          { status: 429, headers: { "Cache-Control": "no-store" } });
      }
      const monitor = await db.collection<StoredMonitor>("monitored_services")
        .findOne({ _id: new ObjectId(id) });
      if (!monitor) return Response.json({ error: "Monitor not found" }, { status: 404 });
      const result = await performCheck(monitor);
      return Response.json({
        monitorId: id, name: monitor.name,
        method: monitor.method ?? "GET",
        healthy: result.healthy,
        httpStatus: result.httpStatus ?? null,
        expectedStatus: monitor.expectedStatus ?? 200,
        latencyMs: result.latencyMs,
        validation: monitor.responseCheck ?? "status",
        error: result.error ? result.error.slice(0, 200) : null,
        testedAt: new Date().toISOString(),
        persisted: false,
      }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (e) {
    console.error("biosec.monitor.manual_test.failed", {
      category: e instanceof Error ? e.name : "Unknown",
    });
    return Response.json({ error: "Unable to run manual test; review Worker logs" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
