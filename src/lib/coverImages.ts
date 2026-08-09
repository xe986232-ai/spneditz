// Foto default (sample) buat slot sampul tiap template — dulu statis dari
// /public/templates/.../sample-cover.jpg, sekarang di-load dari Firebase
// Realtime Database (jadi bisa diganti kapan aja dari Dashboard, gak perlu
// re-deploy). Sumber fotonya Unsplash (bebas dipakai komersil, atribusi
// gak wajib tapi kita simpen nama fotografernya buat kredit).
//
// Struktur data di Realtime Database:
//   config/coverImages/{templateId}/{entryId} -> { url, thumbUrl, credit,
//                                                   creditUrl }
//
// Sengaja fail-open: kalau Firebase kosong/belum ke-seed/offline/rules
// nolak baca, dipakai DEFAULT_COVER_IMAGES di bawah (hardcode di kode) —
// biar slot sampul TETAP ada isinya, bukan malah kosong gara-gara error
// jaringan.

import { ref, onValue, off, update, get, push, set } from "firebase/database";
import { db } from "./firebase";

export type CoverImageEntry = {
  id: string;
  /** Dipakai buat render (background + slot sampul) — ukuran gede. */
  url: string;
  /** Dipakai buat thumbnail kecil (Dashboard admin). */
  thumbUrl: string;
  /** Nama fotografer aslinya di Unsplash, buat kredit (opsional). */
  credit?: string;
  /** Link ke foto/profil aslinya di Unsplash (opsional). */
  creditUrl?: string;
};

function sanitizeTemplateId(templateId: string) {
  return templateId.replace(/[.#$/[\]]/g, "_") || "unknown";
}

/** Bikin URL Unsplash ukuran render (portrait, muat buat background
 *  1080x1920) & ukuran thumbnail dari satu photo id Unsplash. */
function unsplashUrls(photoId: string) {
  return {
    url: `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1080&h=1920&q=80`,
    thumbUrl: `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=200&h=200&q=60`,
  };
}

/** Bikin URL Picsum Photos (https://picsum.photos) dari satu "seed" string.
 *  BEDA sama unsplashUrls di atas: Picsum generate gambar dari hash seed-nya
 *  sendiri, BUKAN nunjuk ke satu foto spesifik yang bisa dihapus si
 *  fotografer/Unsplash. Jadi URL ini nggak akan pernah 404 atau balik jadi
 *  placeholder gradient kayak yang kejadian ke foto Unsplash lama (per
 *  Agustus 2026, beberapa photo id di bawah udah mati/ilang). Dipakai buat
 *  template "iphone-music-player-glass". */
function picsumUrls(seed: string) {
  return {
    url: `https://picsum.photos/seed/${seed}/1080/1920`,
    thumbUrl: `https://picsum.photos/seed/${seed}/200/200`,
  };
}

/** 5 pilihan foto Unsplash per template, dipakai sebagai fallback selama
 *  Firebase belum ke-seed (lihat ensureCoverImagesSeeded) ATAU kalau
 *  Firebase lagi gak bisa diakses. Vibe foto disesuain sama nuansa tiap
 *  template (gelap/moody buat solid card, pastel buat glass, warna-warni
 *  buat cover yang fotonya dominan). */
export const DEFAULT_COVER_IMAGES: Record<string, CoverImageEntry[]> = {
  "iphone-music-player": [
    {
      id: "karsten-wurth-7BjhtdogU3A",
      credit: "Karsten Würth",
      creditUrl: "https://unsplash.com/photos/7BjhtdogU3A",
      ...unsplashUrls("photo-1475070929565-c985b496cb9f"),
    },
    {
      id: "jeremy-bishop-G9i_plbfDgk",
      credit: "Jeremy Bishop",
      creditUrl: "https://unsplash.com/photos/G9i_plbfDgk",
      ...unsplashUrls("photo-1478760329108-5c3ed9d495a0"),
    },
    {
      id: "stormseeker-rX12B5uX7QM",
      credit: "Stormseeker",
      creditUrl: "https://unsplash.com/photos/rX12B5uX7QM",
      ...unsplashUrls("photo-1500099817043-86d46000d58f"),
    },
    {
      id: "nathan-dumlao-ciO5L8pin8A",
      credit: "Nathan Dumlao",
      creditUrl: "https://unsplash.com/photos/ciO5L8pin8A",
      ...unsplashUrls("photo-1518156677180-95a2893f3e9f"),
    },
    {
      id: "peter-lloyd-rRWyOn9gat4",
      credit: "Peter Lloyd",
      creditUrl: "https://unsplash.com/photos/rRWyOn9gat4",
      ...unsplashUrls("photo-1527348857765-589fb3b5d6f6"),
    },
  ],
  // "iphone-music-player-glass" — dulu pakai ulang set foto Unsplash yang
  // sama kayak "iphone-music-player" di atas, TAPI foto-foto Unsplash itu
  // sekarang udah mati/dihapus (photo id-nya balik jadi placeholder
  // gradient polos, bukan foto asli lagi). Diganti total ke Picsum Photos
  // (seed-based, lihat picsumUrls di atas) biar nggak ngalamin masalah
  // yang sama lagi ke depannya. Admin tetap bisa nambah/ganti foto khusus
  // template ini kapan aja lewat Dashboard (config/coverImages/
  // iphone-music-player-glass di Firebase), tanpa perlu deploy ulang.
  "iphone-music-player-glass": [
    {
      id: "picsum-glass-01",
      credit: "Picsum Photos",
      creditUrl: "https://picsum.photos/",
      ...picsumUrls("spneditz-glass-01"),
    },
    {
      id: "picsum-glass-02",
      credit: "Picsum Photos",
      creditUrl: "https://picsum.photos/",
      ...picsumUrls("spneditz-glass-02"),
    },
    {
      id: "picsum-glass-03",
      credit: "Picsum Photos",
      creditUrl: "https://picsum.photos/",
      ...picsumUrls("spneditz-glass-03"),
    },
    {
      id: "picsum-glass-04",
      credit: "Picsum Photos",
      creditUrl: "https://picsum.photos/",
      ...picsumUrls("spneditz-glass-04"),
    },
    {
      id: "picsum-glass-05",
      credit: "Picsum Photos",
      creditUrl: "https://picsum.photos/",
      ...picsumUrls("spneditz-glass-05"),
    },
  ],
};

/** Sekali panggil pas app start — kalau Firebase belum punya data
 *  config/coverImages sama sekali (fresh project), tulis
 *  DEFAULT_COVER_IMAGES ke sana. Kalau udah ada isinya (baik dari seed
 *  sebelumnya atau udah diedit admin), TIDAK ditimpa — biar perubahan
 *  admin lewat Dashboard gak keganti balik ke default tiap kali app
 *  dibuka. Aman dipanggil berkali-kali (no-op kalau udah pernah ke-seed). */
export async function ensureCoverImagesSeeded() {
  try {
    const snapshot = await get(ref(db, "config/coverImages"));
    if (snapshot.exists()) return;
    const seed: Record<string, Record<string, CoverImageEntry>> = {};
    for (const [templateId, entries] of Object.entries(DEFAULT_COVER_IMAGES)) {
      const safeId = sanitizeTemplateId(templateId);
      seed[safeId] = {};
      for (const entry of entries) {
        seed[safeId][entry.id] = entry;
      }
    }
    await update(ref(db, "config/coverImages"), seed);
  } catch {
    // Offline / rules nolak tulis / dll — gak fatal, DEFAULT_COVER_IMAGES
    // di kode tetap jalan sebagai fallback lewat subscribeCoverImages.
  }
}

/** Sekali panggil (bukan langganan real-time) — dipakai buat konteks yang
 *  cuma butuh SATU snapshot daftar foto (misalnya render thumbnail
 *  galeri), bukan komponen React yang perlu terus update live. Sama
 *  seperti subscribeCoverImages: fail-open ke DEFAULT_COVER_IMAGES kalau
 *  Firebase kosong/offline/gagal dibaca. */
export async function fetchCoverImagesOnce(
  templateId: string,
): Promise<CoverImageEntry[]> {
  const safeId = sanitizeTemplateId(templateId);
  const fallback = DEFAULT_COVER_IMAGES[templateId] ?? [];
  // Tunggu migrasi (lihat ensureGlassCoverImagesMigrated di bawah) kelar
  // dulu — biar gak sempat baca data Firebase yang masih versi lama
  // (sebelum ke-timpa) & ke-cache selamanya di pemanggilnya (misalnya
  // thumbnailCache di TemplateThumbnail.tsx).
  await ensureGlassCoverImagesMigrated();
  try {
    const snapshot = await get(ref(db, `config/coverImages/${safeId}`));
    const val = snapshot.val() as Record<string, CoverImageEntry> | null;
    if (!val || Object.keys(val).length === 0) return fallback;
    return Object.entries(val).map(([id, entry]) => ({ ...entry, id }));
  } catch {
    return fallback;
  }
}

/** Dengerin (real-time) daftar foto default satu template dari Firebase.
 *  Fallback ke DEFAULT_COVER_IMAGES kalau datanya kosong/gagal dibaca.
 *  Mengembalikan fungsi unsubscribe — panggil pas komponen unmount. */
export function subscribeCoverImages(
  templateId: string,
  callback: (entries: CoverImageEntry[]) => void,
): () => void {
  const safeId = sanitizeTemplateId(templateId);
  const listRef = ref(db, `config/coverImages/${safeId}`);
  const fallback = DEFAULT_COVER_IMAGES[templateId] ?? [];

  let unsubscribed = false;
  let detachListener: (() => void) | null = null;

  // Tunggu migrasi (lihat ensureGlassCoverImagesMigrated) kelar dulu
  // sebelum attach listener real-time — alasan sama kayak
  // fetchCoverImagesOnce di atas, biar snapshot pertama yang kebaca udah
  // pasti versi yang sudah dibenerin, bukan versi lama yang masih
  // Unsplash mati.
  ensureGlassCoverImagesMigrated().then(() => {
    if (unsubscribed) return;
    const listener = onValue(
      listRef,
      (snapshot) => {
        const val = snapshot.val() as Record<string, CoverImageEntry> | null;
        if (!val || Object.keys(val).length === 0) {
          callback(fallback);
          return;
        }
        callback(Object.entries(val).map(([id, entry]) => ({ ...entry, id })));
      },
      () => callback(fallback),
    );
    detachListener = () => off(listRef, "value", listener);
  });

  return () => {
    unsubscribed = true;
    detachListener?.();
  };
}

/** Sekali panggil pas app start — khusus migrasi bug foto Unsplash mati di
 *  template "iphone-music-player-glass" (lihat komentar DEFAULT_COVER_IMAGES
 *  di atas). ensureCoverImagesSeeded() TIDAK bisa benerin ini karena dia
 *  cuma seed kalau config/coverImages KOSONG TOTAL — sedangkan node glass
 *  ini udah ada isinya (isinya Unsplash yang mati). Jadi di sini kita paksa
 *  timpa NODE INI DOANG (template lain & foto yang udah ditambah admin
 *  lewat Dashboard buat template lain tetap aman, gak disentuh), ditandai
 *  lewat flag config/coverImagesMigrations/unsplashDeadLinksFixV1 biar
 *  cuma jalan SEKALI & gak nimpa balik kalau admin udah edit ulang foto
 *  glass-nya sendiri lewat Dashboard setelah migrasi ini jalan.
 *
 *  PENTING soal race condition: dipanggil juga secara EAGER di bawah
 *  (`migrationPromise`) begitu modul ini di-import, BUKAN nunggu App.tsx
 *  mount. Kenapa: thumbnail galeri (TemplateThumbnail -> fetchCoverImagesOnce)
 *  dulu sempat baca Firebase LEBIH DULU daripada migrasi ini selesai nulis
 *  data baru — hasilnya thumbnail ke-cache selamanya (module-level Map)
 *  pakai data lama yang masih Unsplash mati, padahal Editor (yang baru
 *  dibuka belakangan, migrasi udah kelar) udah bener. fetchCoverImagesOnce
 *  & subscribeCoverImages di bawah sengaja NUNGGU migrationPromise ini
 *  kelar dulu sebelum baca, biar keduanya selalu liat data yang udah fix. */
let migrationPromise: Promise<void> | null = null;
export function ensureGlassCoverImagesMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const FLAG_PATH = "config/coverImagesMigrations/unsplashDeadLinksFixV1";
      try {
        const flagSnap = await get(ref(db, FLAG_PATH));
        if (flagSnap.exists()) return;
        const safeId = sanitizeTemplateId("iphone-music-player-glass");
        const seed: Record<string, CoverImageEntry> = {};
        for (const entry of DEFAULT_COVER_IMAGES["iphone-music-player-glass"]) {
          seed[entry.id] = entry;
        }
        // Set (bukan update/merge) node-nya biar entry Unsplash mati yang
        // lama beneran ilang, ganti total sama set Picsum yang baru.
        await set(ref(db, `config/coverImages/${safeId}`), seed);
        await set(ref(db, FLAG_PATH), true);
      } catch {
        // Offline / rules nolak tulis — gak fatal, coba lagi pas app
        // dibuka lagi nanti (flag belum ke-set kalau gagal di tengah
        // jalan, migrationPromise juga di-reset biar dicoba ulang).
        migrationPromise = null;
      }
    })();
  }
  return migrationPromise;
}
// Jalanin dari sekarang (begitu modul ini pertama kali di-import), JANGAN
// nunggu komponen React mount — ini yang mempersempit jendela race di atas.
void ensureGlassCoverImagesMigrated();

/** Tambah satu foto ke daftar default satu template. Dipanggil dari
 *  Dashboard admin. */
export async function addCoverImage(
  templateId: string,
  entry: Omit<CoverImageEntry, "id">,
) {
  const safeId = sanitizeTemplateId(templateId);
  const listRef = ref(db, `config/coverImages/${safeId}`);
  const newRef = push(listRef);
  await update(newRef, entry);
}

/** Hapus satu foto dari daftar default satu template. Dipanggil dari
 *  Dashboard admin. */
export async function removeCoverImage(templateId: string, entryId: string) {
  const safeId = sanitizeTemplateId(templateId);
  await update(ref(db), {
    [`config/coverImages/${safeId}/${entryId}`]: null,
  });
}
