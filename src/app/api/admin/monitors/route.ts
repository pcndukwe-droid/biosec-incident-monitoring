import { ObjectId, type Document } from "mongodb";
import { NextRequest } from "next/server";
import { requireApiUser, sameOrigin } from "../../../../lib/server/auth";
import { withMonitoringDb } from "../../../../lib/server/monitoring-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MonitorInput = {
  name: string; url: string; expectedStatus: number;
  intervalMinutes?: number; enabled: boolean;
};
const reject = (error: string, status = 400) => Response.json({ error }, { status });

function parseMonitor(value: unknown): MonitorInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid monitor details");
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || input.name.trim().length < 3 || input.name.trim().length > 100)
    throw Error("Monitor name must be 3–100 characters");
  if (typeof input.url !== "string" || input.url.length > 2048) throw Error("Enter a valid HTTPS URL");
  let url: URL;
  try { url = new URL(input.url); } catch { throw Error("Enter a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash)
    throw Error("Only HTTPS endpoints on port 443 without credentials or fragments are supported");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || host.endsWith(".onion") ||
      host === "metadata.google.internal" || host === "169.254.169.254" ||
      host.includes(":") || isIpv4 || !host.includes("."))
    throw Error("Use an approved public HTTPS hostname; direct IP and private network checks are not enabled yet");
  if (input.expectedStatus !== undefined && (!Number.isInteger(input.expectedStatus) ||
      Number(input.expectedStatus) < 200 || Number(input.expectedStatus) > 399))
    throw Error("Expected HTTP status must be between 200 and 399");
  const interval = input.intervalMinutes;
  if (interval !== undefined && interval !== null && (!Number.isInteger(interval) ||
      Number(interval) < 1 || Number(interval) > 60))
    throw Error("Check interval must be between 1 and 60 minutes");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw Error("Invalid enabled value");
  url.hostname = host;
  url.hash = "";
  return {
    name: input.name.trim(), url: url.toString(),
    expectedStatus: Number(input.expectedStatus ?? 200),
    ...(interval === undefined || interval === null ? {} : { intervalMinutes: Number(interval) }),
    enabled: input.enabled === true,
  };
}

function present(m: Document) {
  return {
    id: String(m._id), name: m.name, type: m.type, url: m.url,
    expectedStatus: m.expectedStatus ?? 200, enabled: m.enabled === true,
    intervalMinutes: m.intervalMinutes ?? null, status: m.status ?? "unknown",
    lastCheckedAt: m.lastCheckedAt ?? null, lastHttpStatus: m.lastHttpStatus ?? null,
    lastLatencyMs: m.lastLatencyMs ?? null, lastError: m.lastError ?? null,
    nextCheckAt: m.nextCheckAt ?? null, createdAt: m.createdAt ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if (auth instanceof Response) return auth;
  try {
    return await withMonitoringDb(auth.env, async db => {
      const monitors = await db.collection("monitored_services").find({})
        .sort({ createdAt: -1 }).limit(200).toArray();
      return Response.json({ monitors: monitors.map(present) }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch { return reject("Unable to load monitors", 503); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reject("Invalid request origin", 403);
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  let value: MonitorInput;
  try { value = parseMonitor(await request.json()); }
  catch (e) { return reject(e instanceof Error ? e.message : "Invalid monitor"); }
  try {
    return await withMonitoringDb(auth.env, async db => {
      const collection = db.collection("monitored_services");
      await collection.createIndex({ url: 1 }, { unique: true });
      const now = new Date();
      const result = await collection.insertOne({
        ...value, type: "https", status: "unknown", consecutiveFailures: 0,
        consecutiveSuccesses: 0, nextCheckAt: now, createdAt: now, updatedAt: now,
      });
      const created = await collection.findOne({ _id: result.insertedId });
      return Response.json({ monitor: present(created!) }, { status: 201 });
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === 11000) return reject("This endpoint is already registered", 409);
    return reject("Unable to save monitor", 503);
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return reject("Invalid request origin", 403);
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject("Invalid monitor update");
  const input = body as Record<string, unknown>;
  if (typeof input.id !== "string" || !ObjectId.isValid(input.id)) return reject("Invalid monitor ID");
  let changes: MonitorInput;
  try { changes = parseMonitor(input); }
  catch (e) { return reject(e instanceof Error ? e.message : "Invalid monitor"); }
  try {
    return await withMonitoringDb(auth.env, async db => {
      const collection = db.collection("monitored_services");
      const id = new ObjectId(input.id as string);
      const existing = await collection.findOne({ _id: id });
      if (!existing) return reject("Monitor not found", 404);
      // Reset counters and schedule on changed endpoint, preventing stale outage state.
      const reset = existing.url !== changes.url;
      if (reset) {
        const openIncident = await db.collection("incidents").findOne({ monitorId: id, status: "OPEN" });
        if (openIncident) return reject("Resolve or disable the existing monitor before changing its URL", 409);
      }
      const update = {
        ...changes, updatedAt: new Date(),
        ...(!changes.enabled ? { leaseUntil: null } : {}),
        ...(reset ? { status: "unknown", consecutiveFailures: 0, consecutiveSuccesses: 0,
          nextCheckAt: new Date(), lastCheckedAt: null, lastError: null } : {}),
        ...(!existing.enabled && changes.enabled ? { nextCheckAt: new Date() } : {}),
      };
      await collection.updateOne({ _id: id }, {
        $set: update,
        ...(input.intervalMinutes === null ? { $unset: { intervalMinutes: "" } } : {}),
      });
      const updated = await collection.findOne({ _id: id });
      return Response.json({ monitor: present(updated!) });
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === 11000) return reject("This endpoint is already registered", 409);
    return reject("Unable to update monitor", 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reject("Invalid request origin", 403);
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject("Invalid request");
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || !ObjectId.isValid(id)) return reject("Invalid monitor ID");
  try {
    return await withMonitoringDb(auth.env, async db => {
      const monitorId = new ObjectId(id);
      if (await db.collection("incidents").findOne({ monitorId, status: "OPEN" }))
        return reject("This monitor has an open incident. Disable it instead to preserve incident history.", 409);
      const deleted = await db.collection("monitored_services").deleteOne({ _id: monitorId });
      return deleted.deletedCount ? Response.json({ ok: true }) : reject("Monitor not found", 404);
    });
  } catch { return reject("Unable to delete monitor", 503); }
}
