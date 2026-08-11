import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SESSION_COOKIE, parseCookies, verifySessionCookieValue } from "./_lib/session.js";

// GET /api/session — dipanggil frontend (lihat DiscordGate.tsx) tiap kali
// app dibuka, buat nanya "user ini masih punya sesi login+member yang valid
// nggak?". Verifikasi tanda tangan cookie dilakukan di server (bukan cuma
// baca isi cookie apa adanya) biar nggak bisa dipalsuin dari browser.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionCookieValue(cookies[SESSION_COOKIE]);

  res.setHeader("Cache-Control", "no-store");
  if (!session) {
    res.status(200).json({ authenticated: false });
    return;
  }
  res.status(200).json({ authenticated: true, username: session.username });
}
