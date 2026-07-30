// Nge-cek status fitur premium dari Firebase Realtime Database — buat
// sekarang cuma satu: gaya progress "Waveform berjalan".
//
// Struktur data di Realtime Database:
//   config/waveformEnabled -> boolean (true = semua orang boleh pakai,
//                              false/kosong = terkunci, badge "Premium")
//
// Nyalain/matiin fiturnya cukup lewat Firebase Console -> Realtime
// Database -> Data -> ubah nilai config/waveformEnabled jadi true/false.
// Nggak ada tombol di aplikasi buat ngubah ini (sengaja — biar cuma kamu
// yang bisa toggle lewat Console).

import { ref, onValue, off } from "firebase/database";
import { db } from "./firebase";

/** Dengerin (real-time) apakah fitur "Waveform berjalan" lagi aktif.
 *  Mengembalikan fungsi unsubscribe — panggil pas komponen unmount. */
export function subscribeWaveformEnabled(
  callback: (enabled: boolean) => void,
): () => void {
  const flagRef = ref(db, "config/waveformEnabled");

  const listener = onValue(
    flagRef,
    (snapshot) => {
      callback(snapshot.val() === true);
    },
    () => {
      // rules nolak baca / offline / dll -> anggap terkunci (fail-safe),
      // daripada malah kebuka gara-gara error.
      callback(false);
    },
  );

  return () => off(flagRef, "value", listener);
}
