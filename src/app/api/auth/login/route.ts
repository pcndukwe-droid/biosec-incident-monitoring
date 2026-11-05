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
  const username = input.username.trim().toLowerCase();
  const password = input.password;
  const env = await getAuthEnv();
  try {
    const user = await withAuthDb(env, async db => {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const key = "account:" + ip + ":" + username;
      if (!(await throttle(db, key)) || !(await throttle(db, "ip:" + ip, 30))) return null;
      const found = await db.collection<StoredUser>("admin_users").findOne({
        username: username, enabled: true,
      });
      if (!found || !(await verifyPassword(password, found.passwordHash))) return null;
      return found;
    });
    if (!user) return NextResponse.json({ error: "Invalid credentials or login temporarily restricted" }, { status: 401 });
    const token = await issueToken(user, env);
    const response = NextResponse.json({ user: publicUser(user) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    // Never log passwords, JWT tokens or MongoDB connection strings.
    const diagnosticId = crypto.randomUUID();
    const name = error instanceof Error ? error.name : "UnknownError";
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : "unavailable";
    console.error("biosec.auth.login.failed", { diagnosticId, name, code });
    return NextResponse.json(
      { error: "Login service is unavailable", diagnosticId },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
