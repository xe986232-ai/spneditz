// Helper bersama buat sesi login Discord (dipakai discord-callback, session,
// discord-logout). Nggak pakai database — sesi disimpan di cookie yang
// DITANDATANGANI (HMAC-SHA256) pakai SESSION_SECRET (env var, server-only),
// jadi user nggak bisa palsuin isinya (misal ngaku udah join server padahal
// belum) walau dia edit cookie di browser sendiri.
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "spneditz_session";
export const STATE_COOKIE = "spneditz_oauth_state";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 hari

type SessionPayload = {
  uid: string;
  username: string;
  exp: number; // unix seconds
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET belum diset di Environment Variables Vercel.",
    );
  }
  return secret;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
}

/** Bikin nilai cookie sesi (belum termasuk atribut Set-Cookie lainnya). */
export function createSessionCookieValue(uid: string, username: string): string {
  const payload: SessionPayload = {
    uid,
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Verifikasi & decode cookie sesi. Return null kalau invalid/expired/rusak. */
export function verifySessionCookieValue(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null;
  }

  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.uid) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Parse header `Cookie: a=1; b=2` jadi object sederhana. */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSec: number,
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join("; ");
}

export function buildClearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export { SESSION_MAX_AGE_SEC };
