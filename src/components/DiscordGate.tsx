import { useEffect, useState } from "react";
import { Loader2, MessageCircleMore, RefreshCcw, LogOut } from "lucide-react";

// Server Discord yang WAJIB diikuti buat bisa pakai web ini. Link invite-nya
// ditampilin ke user yang login tapi belum join. Cek member ASLI-nya
// dilakukan di server (api/discord-callback.ts) — link ini cuma buat
// ditampilin, bukan sumber kebenaran akses.
const DISCORD_INVITE_URL = "https://discord.gg/zwwGAyUBq";

type GateState = "loading" | "authed" | "unauthed" | "not_member" | "error";

function readAndCleanQueryFlag(name: string): boolean {
  const params = new URLSearchParams(window.location.search);
  const has = params.has(name);
  if (has) {
    params.delete(name);
    const rest = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (rest ? `?${rest}` : ""),
    );
  }
  return has;
}

export default function DiscordGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const notMember = readAndCleanQueryFlag("discord_not_member");
    const hadError = readAndCleanQueryFlag("discord_error");
    readAndCleanQueryFlag("discord_login");

    fetch("/api/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { authenticated: boolean; username?: string }) => {
        if (data.authenticated) {
          setUsername(data.username ?? null);
          setState("authed");
        } else if (notMember) {
          setState("not_member");
        } else if (hadError) {
          setState("error");
        } else {
          setState("unauthed");
        }
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-editor-bg">
        <Loader2 className="animate-spin text-editor-accent" size={28} />
      </div>
    );
  }

  if (state === "authed") {
    return (
      <>
        {children}
        {username && (
          <a
            href="/api/discord-logout"
            className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border border-white/10 bg-editor-track/90 px-3 py-1.5 text-[11px] font-medium text-editor-muted backdrop-blur transition hover:border-white/20 hover:text-paper"
            title="Keluar dari akun Discord"
          >
            <LogOut size={12} />
            {username}
          </a>
        )}
      </>
    );
  }

  if (state === "not_member") {
    return (
      <GateShell
        heading="Satu langkah lagi"
        body="Kamu sudah login, tapi editor ini cuma buat member server Discord kami. Gabung dulu, terus balik ke sini."
      >
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
        >
          <MessageCircleMore size={17} />
          Gabung server Discord
        </a>
        <a
          href="/api/discord-login"
          className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-paper transition hover:bg-white/5 active:scale-[0.98]"
        >
          <RefreshCcw size={15} />
          Sudah gabung, cek ulang
        </a>
      </GateShell>
    );
  }

  return (
    <GateShell
      heading="Masuk buat mulai"
      body={
        state === "error"
          ? "Ada gangguan pas verifikasi Discord kamu. Coba login ulang."
          : "Editor ini eksklusif buat member server Discord kami. Login pakai akun Discord buat lanjut."
      }
    >
      <a
        href="/api/discord-login"
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
      >
        <MessageCircleMore size={17} />
        Login dengan Discord
      </a>
    </GateShell>
  );
}

function GateShell({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-editor-bg px-4">
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.15] blur-[100px]"
        style={{ background: "#7c6cff" }}
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-editor-track/80 p-7 text-center shadow-2xl backdrop-blur">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-editor-accent/15">
          <MessageCircleMore size={22} className="text-editor-accent" />
        </div>
        <h1 className="text-lg font-semibold text-paper">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-editor-muted">{body}</p>
        <div className="mt-6 flex flex-col gap-2.5">{children}</div>
      </div>
    </div>
  );
}
