import { compare } from "bcryptjs";
import { cookies } from "next/headers";

const SESSION_COOKIE = "ttaa_admin_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

type SessionPayload = {
  email: string;
  exp: number;
};

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET is missing or too short.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createToken(payload: SessionPayload) {
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyToken(token: string): Promise<SessionPayload | null> {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionPayload;
    if (!payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.email.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authenticateAdmin(email: string, password: string) {
  const expectedEmail = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedEmail || !passwordHash) throw new Error("Admin credentials are not configured.");
  if (email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return false;
  return compare(password, passwordHash);
}

export async function startAdminSession(email: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const token = await createToken({ email: email.toLowerCase(), exp });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function endAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? verifyToken(token) : null;
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
