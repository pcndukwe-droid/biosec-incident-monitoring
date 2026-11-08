import { NextRequest } from "next/server";
import { requireApiUser } from "../../../../../lib/server/auth";
import { withMonitoringDb } from "../../../../../lib/server/monitoring-db";
import type { Filter, Document } from "mongodb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 20;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Only scheduled checks are written to health_checks; manually initiated tests
// use separate lastManualTest data and cannot affect this history.
export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if (auth instanceof Response) return auth;

  const pageText = request.nextUrl.searchParams.get("page") || "1";
  const requestedPage = Number(pageText);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 1000000) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }
  const search = (request.nextUrl.searchParams.get("search") || "").trim().slice(0, 100);

  try {
    const result = await withMonitoringDb(auth.env, async db => {
      const services = await db.collection("monitored_services")
        .find({}).project({ name: 1 }).toArray();
      const names = new Map(services.map(item => [String(item._id), String(item.name || "Unnamed endpoint")]));
      let filter: Filter<Document> = {};

      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), "i");
        const matches = services.filter(service => searchRegex.test(String(service.name || "")))
          .map(service => service._id);
        const alternatives: Filter<Document>[] = [
          { error: searchRegex },
          { monitorId: { $in: matches } },
        ];
        const numericHttp = Number(search);
        if (/^\d{3}$/.test(search) && Number.isSafeInteger(numericHttp)) {
          alternatives.push({ httpStatus: numericHttp });
        }
        if (/^(pass|passed|success|successful|healthy)$/i.test(search)) {
          alternatives.push({ healthy: true });
        } else if (/^(fail|failed|failure|unhealthy)$/i.test(search)) {
          alternatives.push({ healthy: false });
        }
        filter = { $or: alternatives };
      }

      const checks = db.collection("health_checks");
      const total = await checks.countDocuments(filter);
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(requestedPage, pageCount);
      const records = await checks.find(filter)
        .sort({ checkedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray();

      return {
        page, pageSize: PAGE_SIZE, pageCount, total,
        rows: records.map(check => ({
          id: String(check._id),
          service: names.get(String(check.monitorId)) || "Deleted monitor",
          checkedAt: check.checkedAt instanceof Date ? check.checkedAt.toISOString() : null,
          healthy: check.healthy === true,
          httpStatus: typeof check.httpStatus === "number" ? check.httpStatus : null,
          latencyMs: typeof check.latencyMs === "number" ? check.latencyMs : null,
          error: typeof check.error === "string" ? check.error.slice(0, 200) : null,
        })),
      };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Unable to load scheduled checks" }, { status: 503 });
  }
}
