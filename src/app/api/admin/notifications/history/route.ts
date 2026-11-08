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
