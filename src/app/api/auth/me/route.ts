import { NextRequest } from "next/server";
import { requireApiUser } from "../../../../lib/server/auth";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const result = await requireApiUser(request);
  if (result instanceof Response) return result;
  return Response.json({ user: result.user }, { headers: { "Cache-Control": "no-store" } });
}
