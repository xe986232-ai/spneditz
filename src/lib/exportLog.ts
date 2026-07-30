// Lapor ke backend counter tiap kali export video BERHASIL — cuma buat
// keperluan liat "berapa orang yang export", nggak ngirim file/media apapun,
// cuma id template + waktu. Kalau VITE_EXPORT_LOG_URL belum di-set (misal
// waktu dev lokal belum deploy backend-nya), fungsi ini diam aja, nggak
// bikin error di aplikasi.

const EXPORT_LOG_URL = import.meta.env.VITE_EXPORT_LOG_URL as
  | string
  | undefined;

export function logExportEvent(templateId: string) {
  if (!EXPORT_LOG_URL) return;

  // fire-and-forget: nggak di-await di pemanggilnya, dan error apapun
  // (network down, backend belum jalan, dll) sengaja ditelan diam-diam
  // biar sama sekali nggak ganggu pengalaman export user.
  fetch(EXPORT_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId }),
    keepalive: true,
  }).catch(() => {
    /* diamkan — ini cuma catetan analytics, bukan fitur inti */
  });
}
