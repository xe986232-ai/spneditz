// Lapor ke Firebase Realtime Database tiap kali export video BERHASIL —
// cuma buat keperluan liat "berapa orang yang export", nggak ngirim
// file/media apapun, cuma id template + waktu.
//
// Struktur data di Realtime Database:
//   exports/total                     -> jumlah export semua (angka, privat)
//   exports/byDay/{YYYY-MM-DD}         -> jumlah export hari itu (privat)
//   exports/byTemplate/{templateId}    -> jumlah export per template (publik,
//                                          dibaca buat nampilin "X kali
//                                          digunakan" di galeri template)
//
// Liat angka total/per-hari langsung di Firebase Console -> Realtime
// Database -> Data. Angka per-template ditampilin juga di aplikasi.

import { ref, update, increment, onValue, off } from "firebase/database";
import { db } from "./firebase";

function sanitizeTemplateId(templateId: string) {
  return templateId.replace(/[.#$/[\]]/g, "_") || "unknown";
}

export function logExportEvent(templateId: string) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const safeTemplateId = sanitizeTemplateId(templateId);

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

/** Dengerin (real-time) jumlah "X kali digunakan" satu template dari
 *  Realtime Database. Mengembalikan fungsi unsubscribe — WAJIB dipanggil
 *  pas komponen unmount, biar listener-nya nggak nyantol terus. */
export function subscribeTemplateUsage(
  templateId: string,
  callback: (count: number) => void,
): () => void {
  const safeTemplateId = sanitizeTemplateId(templateId);
  const usageRef = ref(db, `exports/byTemplate/${safeTemplateId}`);

  const listener = onValue(
    usageRef,
    (snapshot) => {
      const value = snapshot.val();
      callback(typeof value === "number" ? value : 0);
    },
    () => {
      // rules nolak baca / offline / dll — anggap aja belum ada datanya,
      // jangan sampai bikin galeri template error.
      callback(0);
    },
  );

  return () => off(usageRef, "value", listener);
}
