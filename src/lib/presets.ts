import type { Template } from "../types";
import type { LayerOpacityState, SlotMediaEntry, SlotMediaState, TextValueState } from "./render";
import {
  ensurePersistentStorage,
  readEntryAsBlob,
  storedMediaToEntry,
  type StoredMedia,
} from "./mediaStorage";

// ============================================================================
// Preset = "jepretan" semua pengaturan project (opacity layer, blur/opacity
// background, gaya progress bar, isi teks, DAN foto/video/background yang
// dipakai) — disimpan lokal di HP lewat IndexedDB (bukan localStorage, karena
// foto/video bisa gede & localStorage limitnya cuma ~5-10MB per origin).
// IndexedDB bisa nyimpen Blob langsung tanpa perlu diubah ke base64 dulu,
// jadi lebih hemat & lebih cepat.
//
// Logic baca/tulis Blob-nya sendiri (ensurePersistentStorage, readEntryAsBlob,
// storedMediaToEntry) sudah dipindah ke lib/mediaStorage.ts biar bisa dipakai
// bareng sama lib/drafts.ts (auto-save draft) tanpa duplikasi kode. Preset di
// sini tetap fitur TERPISAH dari draft: preset = disimpan manual oleh user
// dengan nama sendiri & jumlahnya tidak dibatasi, draft = auto-save diam-diam
// maksimal 3 slot (lihat lib/drafts.ts).
// ============================================================================

export { ensurePersistentStorage, storedMediaToEntry };

const DB_NAME = "spneditz-presets";
const DB_VERSION = 1;
const STORE_NAME = "presets";

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
  /** Intensitas efek Glow (bloom) global, 0-100. Preset lama (sebelum
   *  fitur ini ada) tidak punya field ini — dibaca undefined, di-fallback
   *  ke 0 di sisi pemanggil (Editor.tsx). */
  glowIntensity: number;
  textValues: TextValueState;
  /** Warna custom tiap textLayer (override dari layer.color default
   *  template). Preset lama (sebelum fitur ini ada) tidak punya field
   *  ini — dibaca undefined, di-fallback ke {} di sisi pemanggil. */
  textColors?: Record<string, string>;
  slotMedia: Record<string, StoredMedia>;
  customBackground: StoredMedia | null;
};

// Ringkasan buat ditampilin di daftar preset (tanpa Blob-nya) — dipakai UI
// biar gak perlu narik semua Blob cuma buat nampilin nama/tanggal.
export type PresetSummary = Pick<
  PresetRecord,
  "id" | "name" | "createdAt" | "templateId" | "templateName"
> & { hasMedia: boolean };

export async function savePreset(params: {
  name: string;
  template: Template;
  layerOpacity: LayerOpacityState;
  backgroundOpacity: number;
  backgroundBlur: number;
  progressStyle: "bar" | "waveform";
  glowIntensity: number;
  textValues: TextValueState;
  textColors?: Record<string, string>;
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
    glowIntensity: params.glowIntensity,
    textValues: { ...params.textValues },
    textColors: { ...(params.textColors ?? {}) },
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

