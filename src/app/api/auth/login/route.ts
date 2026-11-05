import { NextRequest, NextResponse } from "next/server";
import { getAuthEnv, issueToken, publicUser, sameOrigin, sessionCookieOptions, SESSION_COOKIE, throttle, verifyPassword, withAuthDb, type StoredUser } from "../../../../lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.username !== "string" || typeof input.password !== "string" ||
    input.username.length > 40 || input.password.length > 128) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const env = await getAuthEnv();
  try {
    const user = await withAuthDb(env, async db => {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const key = "account:" + ip + ":" + input.username.trim().toLowerCase();
      if (!(await throttle(db, key)) || !(await throttle(db, "ip:" + ip, 30))) return null;
      const found = await db.collection<StoredUser>("admin_users").findOne({
        username: input.username.trim().toLowerCase(), enabled: true,
      });
      if (!found || !(await verifyPassword(input.password as string, found.passwordHash))) return null;
      return found;
    });
    if (!user) return NextResponse.json({ error: "Invalid credentials or login temporarily restricted" }, { status: 401 });
    const token = await issueToken(user, env);
    const response = NextResponse.json({ user: publicUser(user) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch {
    return NextResponse.json({ error: "Login service is unavailable" }, { status: 503 });
  }
}
