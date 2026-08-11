// Dulu seluruh app dikunci di belakang login Discord (lihat komponen lama
// DiscordGate.tsx, sekarang dihapus). Sekarang app terbuka bebas — login +
// join server Discord cuma diminta pas user pencet Export dengan gaya
// progress bar "Waveform berjalan". Helper di file ini dipakai bareng oleh
// Editor.tsx (buat micu gate-nya) dan App.tsx (buat mulihin state pas user
// balik dari alur OAuth Discord, yang selalu redirect ke "/").

export type DiscordSessionStatus = "authed" | "unauthed";

/** Tanya server: cookie sesi Discord yang ada sekarang masih valid + user-nya
 *  masih member server nggak? (verifikasi tanda tangan cookie dilakukan di
 *  /api/session, bukan di sini). */
export async function fetchDiscordSession(): Promise<DiscordSessionStatus> {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (!res.ok) return "unauthed";
    const data = (await res.json()) as { authenticated: boolean };
    return data.authenticated ? "authed" : "unauthed";
  } catch {
    return "unauthed";
  }
}

/** Baca satu query param dari URL sekalian bersihin dari address bar (biar
 *  gak numpuk/ke-refresh berkali-kali kalau user reload). Return null kalau
 *  param-nya gak ada. */
export function readAndCleanQueryParam(name: string): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  if (value !== null) {
    params.delete(name);
    const rest = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (rest ? `?${rest}` : ""),
    );
  }
  return value;
}

const PENDING_KEY = "spneditz:pendingWaveformExport";

export type PendingWaveformExport = { templateId: string };

/** Dipanggil pas user (yang lagi milih gaya "Waveform berjalan" & pencet
 *  Export) diarahkan ke /api/discord-login. Nyimpen template mana yang lagi
 *  dibuka, karena OAuth Discord selalu redirect balik ke "/" (App.tsx butuh
 *  ini buat mulihin ke Editor + gaya waveform lagi, bukan balik ke galeri). */
export function savePendingWaveformExport(templateId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ templateId }));
  } catch {
    /* storage penuh/diblokir — gak fatal, cuma berarti pas balik nanti gak
       otomatis kebuka lagi. */
  }
}

/** Dipanggil sekali di App.tsx pas mount. Baca lalu langsung hapus, biar gak
 *  ke-trigger ulang di reload berikutnya. */
export function readAndClearPendingWaveformExport(): PendingWaveformExport | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingWaveformExport>;
    if (typeof parsed.templateId !== "string") return null;
    return { templateId: parsed.templateId };
  } catch {
    return null;
  }
}
