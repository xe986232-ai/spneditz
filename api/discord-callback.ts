import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDiscordConfig } from "./_lib/discord";
import {
  STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  parseCookies,
  buildSetCookie,
  buildClearCookie,
  createSessionCookieValue,
} from "./_lib/session";

type DiscordGuild = { id: string };
type DiscordUser = { id: string; username: string };

// GET /api/discord-callback?code=...&state=... — Discord ngarahin user balik
// ke sini setelah dia login & izinin. Di sini (SERVER, bukan browser) kita:
//  1. Cocokkan "state" (cegah CSRF)
//  2. Tukar "code" jadi access_token (butuh client_secret — makanya harus di
//     server, nggak bisa di kode frontend)
//  3. Pakai access_token itu buat nanya ke Discord: "user ini member server
//     ID sekian nggak?" (endpoint /users/@me/guilds)
//  4. Kalau iya -> kasih cookie sesi (ditandatangani, lihat _lib/session.ts)
//     Kalau enggak -> lempar balik ke halaman utama dengan pesan "join dulu"
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redirectHome = (query: string) => {
    res.writeHead(302, { Location: `/${query}` });
    res.end();
  };

  let config: ReturnType<typeof getDiscordConfig>;
  try {
    config = getDiscordConfig();
  } catch (e) {
    res.status(500).send(
      `Konfigurasi Discord belum lengkap di server: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const error = typeof req.query.error === "string" ? req.query.error : null;

  const cookies = parseCookies(req.headers.cookie);
  // Selalu bersihin state cookie apapun hasilnya, sekali pakai.
  res.setHeader("Set-Cookie", buildClearCookie(STATE_COOKIE));

  if (error) {
    redirectHome("?discord_error=1");
    return;
  }
  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    redirectHome("?discord_error=1");
    return;
  }

  try {
    // 1) Tukar code -> access_token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      redirectHome("?discord_error=1");
      return;
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // 2) Cek member server mana aja yang dia ikutin
    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!guildsRes.ok) {
      redirectHome("?discord_error=1");
      return;
    }
    const guilds = (await guildsRes.json()) as DiscordGuild[];
    const isMember = guilds.some((g) => g.id === config.guildId);

    if (!isMember) {
      redirectHome("?discord_not_member=1");
      return;
    }

    // 3) Ambil identitas user buat disimpan di sesi (bukan buat otorisasi —
    // otorisasinya udah lewat cek member di atas)
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = userRes.ok ? ((await userRes.json()) as DiscordUser) : null;

    const sessionValue = createSessionCookieValue(
      user?.id ?? "unknown",
      user?.username ?? "Member",
    );
    res.setHeader("Set-Cookie", [
      buildClearCookie(STATE_COOKIE),
      buildSetCookie(SESSION_COOKIE, sessionValue, SESSION_MAX_AGE_SEC),
    ]);
    redirectHome("?discord_login=success");
  } catch {
    redirectHome("?discord_error=1");
  }
}
