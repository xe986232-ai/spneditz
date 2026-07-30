// Lapor ke Firebase Realtime Database tiap kali export video BERHASIL —
// cuma buat keperluan liat "berapa orang yang export", nggak ngirim
// file/media apapun, cuma id template + waktu.
//
// Struktur data di Realtime Database:
//   exports/total                     -> jumlah export semua (angka)
//   exports/byDay/{YYYY-MM-DD}         -> jumlah export hari itu
//   exports/byTemplate/{templateId}    -> jumlah export per template
//
// Liat angkanya langsung di Firebase Console -> Realtime Database -> Data,
// nggak perlu halaman/backend terpisah lagi.

import { ref, update, increment } from "firebase/database";
import { db } from "./firebase";

export function logExportEvent(templateId: string) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const safeTemplateId = templateId.replace(/[.#$/[\]]/g, "_") || "unknown";

  // fire-and-forget: nggak di-await di pemanggilnya, dan error apapun
  // (offline, rules nolak, dll) sengaja ditelan diam-diam biar sama sekali
  // nggak ganggu pengalaman export user.
  update(ref(db), {
    "exports/total": increment(1),
    [`exports/byDay/${today}`]: increment(1),
    [`exports/byTemplate/${safeTemplateId}`]: increment(1),
  }).catch(() => {
    /* diamkan — ini cuma catetan analytics, bukan fitur inti */
  });
}
