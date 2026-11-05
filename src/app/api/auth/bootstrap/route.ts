import { NextRequest, NextResponse } from "next/server";
import { MongoServerError } from "mongodb";
import { getAuthEnv, hashPassword, issueToken, publicUser, sameOrigin, sessionCookieOptions, SESSION_COOKIE, validPassword, validUsername, withAuthDb, type StoredUser } from "../../../../lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const env = await getAuthEnv();
  if (!env.AUTH_BOOTSTRAP_TOKEN || env.AUTH_BOOTSTRAP_TOKEN.length < 32) {
    return NextResponse.json({ error: "Initial administrator setup is not enabled" }, { status: 503 });
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    return NextResponse.json({ error: "JWT signing key is not configured" }, { status: 503 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!validUsername(input.username) || !validPassword(input.password) || typeof input.setupToken !== "string") {
    return NextResponse.json({ error: "Invalid setup credentials (password must be at least 12 characters)" }, { status: 400 });
  }
  // Constant-time comparison of the setup token; no public defaults.
  const a = new TextEncoder().encode(input.setupToken);
  const b = new TextEncoder().encode(env.AUTH_BOOTSTRAP_TOKEN);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (mismatch) return NextResponse.json({ error: "Invalid setup credentials" }, { status: 403 });
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await withAuthDb(env, async db => {
      const adminUsers = db.collection<StoredUser>("admin_users");
      await adminUsers.createIndex({ username: 1 }, { unique: true });
      const count = await adminUsers.estimatedDocumentCount();
      if (count !== 0) throw new Error("SETUP_COMPLETE");
      // Only one initializer can claim the singleton id, even if requests race.
      await db.collection<{ _id: string; at: Date }>("auth_bootstrap").insertOne({ _id: "initial", at: new Date() });
      const now = new Date();
      const result = await adminUsers.insertOne({
        username: input.username as string, passwordHash, role: "admin", enabled: true,
        sessionVersion: 1, createdAt: now, updatedAt: now,
      } as StoredUser);
      const created = await adminUsers.findOne({ _id: result.insertedId });
      if (!created) throw new Error("Initial administrator creation failed");
      return created;
    });
    const token = await issueToken(user, env);
    const response = NextResponse.json({ user: publicUser(user) }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000 || error instanceof Error && error.message === "SETUP_COMPLETE") {
      return NextResponse.json({ error: "Initial administrator already created" }, { status: 409 });
    }
    return NextResponse.json({ error: "Initial setup failed; review database logs" }, { status: 503 });
  }
}
