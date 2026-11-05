import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { hashPassword, requireApiUser, sameOrigin, validPassword, validUsername, withAuthDb, type Role, type StoredUser } from "../../../../lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  try {
    return await withAuthDb(auth.env, async db => {
      const users = await db.collection<StoredUser>("admin_users")
        .find({}, { projection: { username: 1, role: 1, enabled: 1, createdAt: 1 } })
        .sort({ username: 1 }).limit(100).toArray();
      return Response.json({ users: users.map(u => ({
        id: u._id.toHexString(), username: u.username, role: u.role,
        enabled: u.enabled, createdAt: u.createdAt,
      })) }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch { return Response.json({ error: "Unable to load accounts" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid payload" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!validUsername(input.username) || !validPassword(input.password) ||
      !["admin", "operator", "viewer"].includes(String(input.role))) {
    return Response.json({ error: "Username, role or password is invalid. Password must contain at least 12 characters." }, { status: 400 });
  }
  const passwordHash = await hashPassword(input.password);
  try {
    await withAuthDb(auth.env, async db => {
      const users = db.collection<StoredUser>("admin_users");
      await users.createIndex({ username: 1 }, { unique: true });
      await users.insertOne({
        username: input.username as string, passwordHash,
        role: input.role as Role, enabled: true, sessionVersion: 1,
        createdAt: new Date(), updatedAt: new Date(),
      } as StoredUser);
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000)
      return Response.json({ error: "Username already exists" }, { status: 409 });
    return Response.json({ error: "Unable to create user" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid payload" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.id !== "string" || !ObjectId.isValid(input.id)) return Response.json({ error: "Invalid user" }, { status: 400 });
  const fields: { enabled?: boolean; role?: Role; passwordHash?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof input.enabled === "boolean") fields.enabled = input.enabled;
  if (typeof input.role === "string" && ["admin", "operator", "viewer"].includes(input.role)) fields.role = input.role as Role;
  if (input.password !== undefined) {
    if (!validPassword(input.password)) return Response.json({ error: "Password must contain 12–128 characters" }, { status: 400 });
    fields.passwordHash = await hashPassword(input.password);
  }
  if (Object.keys(fields).length === 1) return Response.json({ error: "Nothing to update" }, { status: 400 });
  if (input.id === auth.user.id && (fields.enabled === false || fields.role && fields.role !== "admin"))
    return Response.json({ error: "You cannot disable or demote your current administrator account" }, { status: 400 });
  try {
    const status = await withAuthDb(auth.env, async db => {
      const users = db.collection<StoredUser>("admin_users");
      const target = await users.findOne({ _id: new ObjectId(input.id as string) });
      if (!target) return "NOT_FOUND";
      if (target.enabled && target.role === "admin" && (fields.enabled === false || fields.role && fields.role !== "admin")) {
        const admins = await users.countDocuments({ role: "admin", enabled: true });
        if (admins <= 1) return "LAST_ADMIN";
      }
      await users.updateOne({ _id: target._id }, { $set: fields, $inc: { sessionVersion: 1 } });
      return "OK";
    });
    if (status !== "OK") return Response.json({ error: status === "LAST_ADMIN" ? "Cannot disable the last active administrator" : "User not found" }, { status: 400 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Unable to update account" }, { status: 503 }); }
}
