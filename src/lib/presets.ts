import type { Template } from "../types";
import type { LayerOpacityState, SlotMediaEntry, SlotMediaState, TextValueState } from "./render";

// ============================================================================
// Preset = "jepretan" semua pengaturan project (opacity layer, blur/opacity
// background, gaya progress bar, isi teks, DAN foto/video/background yang
// dipakai) — disimpan lokal di HP lewat IndexedDB (bukan localStorage, karena
// foto/video bisa gede & localStorage limitnya cuma ~5-10MB per origin).
// IndexedDB bisa nyimpen Blob langsung tanpa perlu diubah ke base64 dulu,
// jadi lebih hemat & lebih cepat.
// ============================================================================

const DB_NAME = "spneditz-presets";
const DB_VERSION = 1;
const STORE_NAME = "presets";

// Minta browser JANGAN otomatis hapus storage situs ini pas low-storage
// (Chrome suka "evict" IndexedDB/localStorage situs yang jarang dibuka /
// belum "persistent" kalau HP kehabisan ruang). Ini best-effort — browser
// boleh nolak, tapi kalau dikabulin, resiko preset "ilang sendiri" jauh
// berkurang. Dipanggil sekali tiap kali modul ini dipakai.
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser ini tidak mendukung penyimpanan preset."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Gagal membuka penyimpanan preset."));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error("Operasi preset gagal."));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      }),
  );
}

/** Media tersimpan dalam preset — cuma yang kind "file" (upload user) yang
 *  beneran nyimpen Blob-nya; kind "sample" tidak disimpan (biar tidak nyoba
 *  restore path sample dari template lain yang beda). */
type StoredMedia = {
  blob: Blob;
  mimeType: string;
};

export type PresetRecord = {
  id: string;
  name: string;
  createdAt: number;
  templateId: string;
  templateName: string;
  layerOpacity: LayerOpacityState;
  backgroundOpacity: number;
  backgroundBlur: number;
  progressStyle: "bar" | "waveform";
  textValues: TextValueState;
  slotMedia: Record<string, StoredMedia>;
  customBackground: StoredMedia | null;
};

// Ringkasan buat ditampilin di daftar preset (tanpa Blob-nya) — dipakai UI
// biar gak perlu narik semua Blob cuma buat nampilin nama/tanggal.
export type PresetSummary = Pick<
  PresetRecord,
  "id" | "name" | "createdAt" | "templateId" | "templateName"
> & { hasMedia: boolean };

// Blob URL (media.url) dicoba duluan buat baca isi file — biasanya lebih
// stabil daripada baca object File langsung (lihat catatan sama di
// src/lib/export.ts soal bug File jadi stale di Chrome Android). TAPI kalau
// fetch ke blob URL itu sendiri yang gagal (misal "Failed to fetch" — bisa
// kejadian juga di beberapa WebView/Android build), fallback ke baca
// File-nya langsung sebelum benar-benar nyerah.
async function readEntryAsBlob(entry: SlotMediaEntry): Promise<StoredMedia> {
  let blob: Blob | null = null;
  let lastErr: unknown;

  // Coba fetch blob URL sampai 3x (kadang gagal sesaat doang, misal proses
  // network internal Chrome lagi restart — umum kejadian intermiten di
  // Android) sebelum nyerah & fallback ke File langsung.
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
      `Gagal membaca file untuk disimpan ke preset. (${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      })`,
    );
  }

  return {
    blob,
    mimeType: entry.file?.type || blob.type || "application/octet-stream",
  };
}

export async function savePreset(params: {
  name: string;
  template: Template;
  layerOpacity: LayerOpacityState;
  backgroundOpacity: number;
  backgroundBlur: number;
  progressStyle: "bar" | "waveform";
  textValues: TextValueState;
  slotMedia: SlotMediaState;
  customBackground: SlotMediaEntry | null;
}): Promise<PresetRecord> {
  const slotMediaOut: Record<string, StoredMedia> = {};
  for (const [slotId, media] of Object.entries(params.slotMedia)) {
    if (media?.kind === "file") {
      slotMediaOut[slotId] = await readEntryAsBlob(media);
    }
  }

  const customBackgroundOut =
    params.customBackground?.kind === "file"
      ? await readEntryAsBlob(params.customBackground)
      : null;

  const record: PresetRecord = {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: params.name.trim() || "Preset tanpa nama",
    createdAt: Date.now(),
    templateId: params.template.id,
    templateName: params.template.name,
    layerOpacity: { ...params.layerOpacity },
    backgroundOpacity: params.backgroundOpacity,
    backgroundBlur: params.backgroundBlur,
    progressStyle: params.progressStyle,
    textValues: { ...params.textValues },
    slotMedia: slotMediaOut,
    customBackground: customBackgroundOut,
  };

  await withStore("readwrite", (store) => store.put(record));

  // Verifikasi beneran ke-simpen (baca ulang), bukan cuma asumsi put()
  // gak nge-throw — biar kalau ada eviction/quota issue senyap, ketauan
  // di sini juga (lempar error) daripada baru ketauan pas refresh.
  const check = await withStore<PresetRecord | undefined>("readonly", (store) =>
    store.get(record.id),
  );
  if (!check) {
    throw new Error(
      "Preset kelihatannya tersimpan tapi tidak ketemu lagi pas dicek ulang " +
        "(kemungkinan storage browser penuh / dibatasi oleh sistem).",
    );
  }

  return record;
}

export async function listPresets(): Promise<PresetSummary[]> {
  const all = await withStore<PresetRecord[]>("readonly", (store) => store.getAll());
  return all
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      templateId: p.templateId,
      templateName: p.templateName,
      hasMedia: Object.keys(p.slotMedia).length > 0 || !!p.customBackground,
    }));
}

export async function getPreset(id: string): Promise<PresetRecord | undefined> {
  return withStore<PresetRecord | undefined>("readonly", (store) => store.get(id));
}

export async function deletePreset(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/** Ubah StoredMedia jadi SlotMediaEntry siap-pakai (bikin object URL +
 *  File baru dari Blob yang disimpan). */
export function storedMediaToEntry(stored: StoredMedia, fileName: string): SlotMediaEntry {
  const file = new File([stored.blob], fileName, { type: stored.mimeType });
  const url = URL.createObjectURL(stored.blob);
  return { kind: "file", url, file };
}
