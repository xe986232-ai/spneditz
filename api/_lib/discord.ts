export function getDiscordConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const guildId = process.env.DISCORD_GUILD_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !guildId || !redirectUri) {
    throw new Error(
      "Env var Discord belum lengkap. Butuh: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_REDIRECT_URI.",
    );
  }

  return { clientId, clientSecret, guildId, redirectUri };
}

export const DISCORD_SCOPES = "identify guilds";
