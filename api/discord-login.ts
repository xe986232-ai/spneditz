import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { getDiscordConfig, DISCORD_SCOPES } from "./_lib/discord.js";
import { STATE_COOKIE, buildSetCookie } from "./_lib/session.js";

// GET /api/discord-login — mulai alur OAuth Discord. User diarahkan ke
// halaman login/izin Discord, lalu Discord balikin dia ke
// /api/discord-callback bawa "code" (bukan token — token ditukar di server,
// lihat discord-callback.ts, biar client_secret nggak pernah nyampe browser).
export default function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const { clientId, redirectUri } = getDiscordConfig();

    // State random buat cegah CSRF: disimpan di cookie httpOnly sesaat,
    // lalu dicocokkan lagi pas callback (lihat discord-callback.ts).
    const state = randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", buildSetCookie(STATE_COOKIE, state, 300));

    const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", DISCORD_SCOPES);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");

    res.writeHead(302, { Location: authorizeUrl.toString() });
    res.end();
  } catch (e) {
    res.status(500).send(
      `Konfigurasi Discord login belum lengkap di server: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
