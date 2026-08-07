// Nge-cek & nge-atur status aktif/nonaktif TIAP TEMPLATE dari Firebase
// Realtime Database — beda dari premiumFlags.ts (itu buat fitur "Waveform
// berjalan", ini khusus buat nyala/matiin template di galeri).
//
// Struktur data di Realtime Database:
//   config/templates/{templateId}/enabled -> boolean
//     true / TIDAK ADA (belum pernah di-set) -> template aktif, boleh dipakai
//     false                                  -> template nonaktif, tombol
//                                                "Gunakan" di galeri bakal
//                                                munculin alert, bukan lanjut
//                                                ke editor
//
// Sengaja fail-open (default AKTIF) kalau datanya belum ada atau gagal
// dibaca (offline/rules nolak) — biar template nggak keliatan nonaktif
// gara-gara error jaringan, bukan gara-gara memang sengaja dimatiin admin
// lewat dashboard.

import { ref, onValue, off, update } from "firebase/database";
import { db } from "./firebase";

function sanitizeTemplateId(templateId: string) {
  return templateId.replace(/[.#$/[\]]/g, "_") || "unknown";
}

/** Dengerin (real-time) apakah satu template lagi aktif/boleh dipakai.
 *  Mengembalikan fungsi unsubscribe — panggil pas komponen unmount. */
export function subscribeTemplateEnabled(
  templateId: string,
  callback: (enabled: boolean) => void,
): () => void {
  const safeId = sanitizeTemplateId(templateId);
  const flagRef = ref(db, `config/templates/${safeId}/enabled`);

  const listener = onValue(
    flagRef,
    (snapshot) => {
      const val = snapshot.val();
      // null (belum pernah di-set) dianggap aktif -> cuma `false` eksplisit
      // yang menonaktifkan.
      callback(val !== false);
    },
    () => {
      // rules nolak baca / offline / dll -> fail-open, anggap aktif.
      callback(true);
    },
  );

  return () => off(flagRef, "value", listener);
}

/** Set status aktif/nonaktif satu template. Dipanggil dari dashboard admin. */
export async function setTemplateEnabled(templateId: string, enabled: boolean) {
  const safeId = sanitizeTemplateId(templateId);
  await update(ref(db), {
    [`config/templates/${safeId}/enabled`]: enabled,
  });
}
