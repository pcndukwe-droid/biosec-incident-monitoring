import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { requireApiUser, sameOrigin } from "../../../../../lib/server/auth";
import { withMonitoringDb } from "../../../../../lib/server/monitoring-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Deletion is administrative and limited to finalized delivery history.
// In-flight attempts remain untouched to avoid corrupting delivery tracking.
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const params = body as Record<string, unknown>;
  const finalized = { status: { $in: ["SENT", "FAILED", "CONFIGURATION_REQUIRED"] } };
  try {
    const count = await withMonitoringDb(auth.env, async db => {
      const collection = db.collection("alert_notifications");
      if (params.scope === "one" && typeof params.id === "string" && /^[0-9a-f]{24}$/i.test(params.id)) {
        const result = await collection.deleteOne({ _id: new ObjectId(params.id), ...finalized });
        return result.deletedCount;
      }
      if (params.scope === "all" && Object.keys(params).length === 1) {
        const result = await collection.deleteMany(finalized);
        return result.deletedCount;
      }
      return null;
    });
    if (count === null) return Response.json({ error: "Invalid deletion request" }, { status: 400 });
    return Response.json({ deleted: count }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to delete notification history" }, { status: 503 });
  }
}

const PAGE_SIZE = 20;
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Server-side search and pagination: never truncate history to the first 100.
export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if (auth instanceof Response) return auth;
  const params = request.nextUrl.searchParams;
  const pageRaw = Number(params.get("page") || "1");
  if (!Number.isSafeInteger(pageRaw) || pageRaw < 1 || pageRaw > 1000000)
    return Response.json({ error: "Invalid page" }, { status: 400 });
  const search = (params.get("search") || "").trim().slice(0, 100);
  const regex = search ? new RegExp(escapeRegex(search), "i") : null;
  const filter = regex ? {
    $or: [
      { kind: regex }, { status: regex },
      { recipients: regex }, { error: regex },
    ],
  } : {};
  try {
    const result = await withMonitoringDb(auth.env, async db => {
      const collection = db.collection("alert_notifications");
      const total = await collection.countDocuments(filter);
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(pageRaw, pageCount);
      const data = await collection.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray();
      return {
        page, pageSize: PAGE_SIZE, total, pageCount,
        rows: data.map(row => ({
          id: String(row._id),
          kind: String(row.kind || ""),
          status: String(row.status || ""),
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
          recipients: Array.isArray(row.recipients) ? row.recipients.filter((v: unknown) => typeof v === "string") : [],
          error: typeof row.error === "string" ? row.error.slice(0, 200) : "",
        })),
      };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Unable to load notification history" }, { status: 503 });
  }
}
