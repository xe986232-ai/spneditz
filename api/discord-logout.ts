import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SESSION_COOKIE, buildClearCookie } from "./_lib/session";

// GET /api/discord-logout — hapus cookie sesi, balik ke halaman utama.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Set-Cookie", buildClearCookie(SESSION_COOKIE));
  res.writeHead(302, { Location: "/" });
  res.end();
}
