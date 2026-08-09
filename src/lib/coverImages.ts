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

import { ref, onValue, off, update, get, push } from "firebase/database";
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
  "iphone-music-player-glass": [
    {
      id: "adrian-infernus-GLf7bAwCdYg",
      credit: "Adrian Infernus",
      creditUrl: "https://unsplash.com/photos/GLf7bAwCdYg",
      ...unsplashUrls("photo-1554034483-04fda0d3507b"),
    },
    {
      id: "codioful-LeG68PrXA6Y",
      credit: "Codioful",
      creditUrl: "https://unsplash.com/photos/LeG68PrXA6Y",
      ...unsplashUrls("photo-1614849286521-4c58b2f0ff15"),
    },
    {
      id: "plufow-le-studio-aE8Mx8-vQss",
      credit: "Plufow Le Studio",
      creditUrl: "https://unsplash.com/photos/aE8Mx8-vQss",
      ...unsplashUrls("photo-1710162734106-6932b5799f99"),
    },
    {
      id: "luke-chesser-IGtutkXikuc",
      credit: "Luke Chesser",
      creditUrl: "https://unsplash.com/photos/IGtutkXikuc",
      ...unsplashUrls("photo-1557683311-eac922347aa1"),
    },
    {
      id: "pawel-czerwinski-Qiy4hr18aGs",
      credit: "Pawel Czerwinski",
      creditUrl: "https://unsplash.com/photos/Qiy4hr18aGs",
      ...unsplashUrls("photo-1564951434112-64d74cc2a2d7"),
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

  return () => off(listRef, "value", listener);
}

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
