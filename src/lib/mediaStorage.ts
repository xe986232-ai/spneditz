import type { SlotMediaEntry } from "./render";

// ============================================================================
// Helper bersama buat nyimpen Blob (foto/video/audio user) ke IndexedDB —
// awalnya cuma dipakai presets.ts, sekarang dipisah ke sini biar drafts.ts
// (auto-save) bisa pakai logic BLOB READING yang sama persis, tanpa
// duplikasi kode.
// ============================================================================

export type StoredMedia = {
  blob: Blob;
  mimeType: string;
};

// Minta browser JANGAN otomatis hapus storage situs ini pas low-storage
// (Chrome suka "evict" IndexedDB/localStorage situs yang jarang dibuka /
// belum "persistent" kalau HP kehabisan ruang). Best-effort — browser boleh
// nolak, tapi kalau dikabulin, resiko preset/draft "ilang sendiri" jauh
// berkurang.
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// Blob URL (media.url) dicoba duluan buat baca isi file — biasanya lebih
// stabil daripada baca object File langsung (bug File jadi stale di Chrome
// Android). Kalau fetch ke blob URL itu sendiri yang gagal, fallback ke
// baca File-nya langsung sebelum benar-benar nyerah.
export async function readEntryAsBlob(entry: SlotMediaEntry): Promise<StoredMedia> {
  let blob: Blob | null = null;
  let lastErr: unknown;

  for (let i = 0; i < 3 && !blob; i++) {
    try {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`fetch blob URL gagal (status ${res.status})`);
      blob = await res.blob();
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }

  if (!blob && entry.file) {
    try {
      blob = entry.file;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!blob) {
    throw new Error(
      `Gagal membaca file untuk disimpan. (${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      })`,
    );
  }

  return {
    blob,
    mimeType: entry.file?.type || blob.type || "application/octet-stream",
  };
}

/** Ubah StoredMedia jadi SlotMediaEntry siap-pakai (bikin object URL +
 *  File baru dari Blob yang disimpan). */
export function storedMediaToEntry(stored: StoredMedia, fileName: string): SlotMediaEntry {
  const file = new File([stored.blob], fileName, { type: stored.mimeType });
  const url = URL.createObjectURL(stored.blob);
  return { kind: "file", url, file };
}
