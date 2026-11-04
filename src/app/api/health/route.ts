export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { service: "biosec-incident-monitoring", status: "ok", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
