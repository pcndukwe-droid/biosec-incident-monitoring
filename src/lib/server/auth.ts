import { getCloudflareContext } from "@opennextjs/cloudflare";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "biosec_session";
const ISSUER = "biosec-incident-monitoring";
const AUDIENCE = "biosec-admin";
const SESSION_SECONDS = 60 * 60 * 8;
const ROUNDS = 210_000;

export type Role = "admin" | "operator" | "viewer";
export type StoredUser = {
  _id: ObjectId; username: string; passwordHash: string; role: Role;
  enabled: boolean; sessionVersion: number; createdAt: Date; updatedAt: Date;
};
export type PublicUser = { id: string; username: string; role: Role; enabled: boolean };

export type AuthEnv = {
  MONGODB_URI?: string;
  JWT_SECRET?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
};

export async function getAuthEnv(): Promise<AuthEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as AuthEnv;
}

export async function withAuthDb<T>(env: AuthEnv, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 3 });
  try { await client.connect(); return await fn(client.db("biosec_monitoring")); }
  finally { await client.close(); }
}

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9._-]{2,39}$/.test(value);
}
export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export function publicUser(user: StoredUser): PublicUser {
  return { id: user._id.toHexString(), username: user.username, role: user.role, enabled: user.enabled };
}
function hex(value: Uint8Array): string { return Array.from(value, b => b.toString(16).padStart(2, "0")).join(""); }
function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid password hash");
  return Uint8Array.from(value.match(/.{2}/g)!, v => parseInt(v, 16));
}
async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new Uint8Array(salt), iterations: ROUNDS, hash: "SHA-256" }, key, 256);
  return new Uint8Array(derived);
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error("Password must contain 12–128 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return "pbkdf2-sha256$" + ROUNDS + "$" + hex(salt) + "$" + hex(await derive(password, salt));
}
export async function verifyPassword(password: string, saved: string): Promise<boolean> {
  const parts = saved.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || parts[1] !== String(ROUNDS)) return false;
  try {
    const salt = fromHex(parts[2]);
    const expected = fromHex(parts[3]);
    const actual = await derive(password, salt);
    if (actual.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i];
    return mismatch === 0;
  } catch { return false; }
}

function signingKey(env: AuthEnv): Uint8Array {
  if (!env.JWT_SECRET || new TextEncoder().encode(env.JWT_SECRET).length < 32) throw new Error("JWT_SECRET must be at least 32 bytes");
  return new TextEncoder().encode(env.JWT_SECRET);
}
export async function issueToken(user: StoredUser, env: AuthEnv): Promise<string> {
  return new SignJWT({ ver: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user._id.toHexString())
    .setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(SESSION_SECONDS + "s")
    .sign(signingKey(env));
}
export const sessionCookieOptions = {
  httpOnly: true, secure: true, sameSite: "lax" as const,
  path: "/", maxAge: SESSION_SECONDS,
};
export async function findSession(
  token: string | undefined, env: AuthEnv
): Promise<PublicUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(env), { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== "string" || !ObjectId.isValid(payload.sub) || typeof payload.ver !== "number") return null;
    return withAuthDb(env, async db => {
      const user = await db.collection<StoredUser>("admin_users").findOne({ _id: new ObjectId(payload.sub) });
      if (!user || !user.enabled || user.sessionVersion !== payload.ver) return null;
      return publicUser(user);
    });
  } catch { return null; }
}
export async function currentUser(): Promise<PublicUser | null> {
  const env = await getAuthEnv();
  const jar = await cookies();
  return findSession(jar.get(SESSION_COOKIE)?.value, env);
}
export async function requireApiUser(request: NextRequest, role?: Role): Promise<{ env: AuthEnv; user: PublicUser } | Response> {
  const env = await getAuthEnv();
  const user = await findSession(request.cookies.get(SESSION_COOKIE)?.value, env);
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (role && user.role !== role) return Response.json({ error: "Administrator access required" }, { status: 403 });
  return { env, user };
}
// Deny cross-site state-changing requests even when a browser sends a session cookie.
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
export async function throttle(db: Db, key: string, maxAttempts = 8): Promise<boolean> {
  const collection = db.collection<{ _id: string; count: number; expiresAt: Date }>("auth_rate_limits");
  const bucket = Math.floor(Date.now() / (15 * 60_000));
  const _id = key + ":" + bucket;
  const item = await collection.findOneAndUpdate(
    { _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 30 * 60_000) } },
    { upsert: true, returnDocument: "after" }
  );
  return Number(item?.count ?? 0) <= maxAttempts;
}
