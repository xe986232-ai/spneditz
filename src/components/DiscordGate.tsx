import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, LogOut } from "lucide-react";

// Logo resmi Discord (Clyde mark), dipakai buat tombol login/join —
// sesuai kegunaan yang diizinkan di Discord Brand Guidelines.
function DiscordIcon({ size = 17, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.522 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

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
          <DiscordIcon size={17} />
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
        <DiscordIcon size={17} />
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
          <DiscordIcon size={22} className="text-editor-accent" />
        </div>
        <h1 className="text-lg font-semibold text-paper">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-editor-muted">{body}</p>
        <div className="mt-6 flex flex-col gap-2.5">{children}</div>
      </div>
    </div>
  );
}
