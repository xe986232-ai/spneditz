import type { Template } from "../types";
import type { LayerOpacityState, SlotMediaEntry, SlotMediaState, TextValueState } from "./render";
import type { LiquidGlassSettings } from "../types";
import {
  ensurePersistentStorage,
  readEntryAsBlob,
  storedMediaToEntry,
  type StoredMedia,
} from "./mediaStorage";

// ============================================================================
// Draft = "project yang lagi dikerjain", di-AUTO-SAVE diam-diam tiap kali
// ada perubahan (bukan disimpan manual pakai nama kayak Preset) — cuma
// nyimpen state PALING TERAKHIR per draft (bukan riwayat versi), maksimal
// MAX_DRAFTS draft bersamaan. Kalau mau bikin draft baru pas slot udah
// penuh, draft yang paling lama TIDAK disentuh (updatedAt paling kecil)
// otomatis kehapus diam-diam biar user gak perlu ngurus sendiri.
//
// Sama kayak Preset, disimpan di IndexedDB (bukan localStorage) karena bisa
// nyimpen Blob foto/video/audio user langsung tanpa base64, dan quota-nya
// jauh lebih besar daripada localStorage (~5-10MB per origin) — draft video
// editor gampang lebih gede dari itu begitu ada 1-2 file media kesimpen.
// ============================================================================

export const MAX_DRAFTS = 3;

const DB_NAME = "spneditz-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser ini tidak mendukung penyimpanan draft."));
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
      reject(req.error ?? new Error("Gagal membuka penyimpanan draft."));
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
          reject(req.error ?? new Error("Operasi draft gagal."));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      }),
  );
}

export type DraftRecord = {
  id: string;
  createdAt: number;
  /** Kapan terakhir kali auto-save nulis ke draft ini — dipakai buat
   *  sorting daftar draft (terbaru duluan) DAN buat nentuin draft mana
   *  yang paling "nganggur" pas harus di-evict karena udah MAX_DRAFTS. */
  updatedAt: number;
  templateId: string;
  templateName: string;
  /** Jepretan kecil canvas Editor pas terakhir auto-save (JPEG data URL,
   *  kualitas rendah) — buat thumbnail di daftar draft, biar user gampang
   *  kenalin draft mana isinya apa tanpa harus buka dulu. */
  thumbnail: string | null;
  layerOpacity: LayerOpacityState;
  glassSettings: Record<string, Partial<LiquidGlassSettings>>;
  backgroundOpacity: number;
  backgroundBlur: number;
  progressStyle: "bar" | "waveform";
  textValues: TextValueState;
  slotMedia: Record<string, StoredMedia>;
  customBackground: StoredMedia | null;
  /** Klip-klip potongan track audio (offset/trim) — biar posisi motong
   *  audio ikut ke-restore, bukan cuma file audionya doang. */
  audioClips: { id: string; trimStart: number; trimEnd: number; offset: number }[];
  /** Id elemen (slot/decorLayer) yang lagi disembunyikan (mata dicoret). */
  hiddenElements: string[];
  /** Posisi playhead terakhir (detik) — biar pas dibuka lagi user gak mulai
   *  dari 0:00. */
  currentSec: number;
};

export type DraftSummary = Pick<
  DraftRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "templateId"
  | "templateName"
  | "thumbnail"
>;

async function saveMediaMap(
  slotMedia: SlotMediaState,
): Promise<Record<string, StoredMedia>> {
  const out: Record<string, StoredMedia> = {};
  for (const [slotId, media] of Object.entries(slotMedia)) {
    if (media?.kind === "file") {
      out[slotId] = await readEntryAsBlob(media);
    }
  }
  return out;
}

/** Simpan/update draft. `id` null = draft baru (id di-generate di sini);
 *  `id` terisi = timpa draft yang sama (dipanggil berulang tiap auto-save
 *  jalan, "ambil perubahan paling akhir aja" — bukan nyimpen riwayat). */
export async function saveDraft(
  id: string | null,
  params: {
    template: Template;
    layerOpacity: LayerOpacityState;
    glassSettings: Record<string, Partial<LiquidGlassSettings>>;
    backgroundOpacity: number;
    backgroundBlur: number;
    progressStyle: "bar" | "waveform";
    textValues: TextValueState;
    slotMedia: SlotMediaState;
    customBackground: SlotMediaEntry | null;
    audioClips: { id: string; trimStart: number; trimEnd: number; offset: number }[];
    hiddenElements: Set<string> | string[];
    currentSec: number;
    thumbnail: string | null;
  },
): Promise<DraftRecord> {
  void ensurePersistentStorage();

  const now = Date.now();
  const existing = id ? await getDraft(id) : undefined;

  const slotMediaOut = await saveMediaMap(params.slotMedia);
  const customBackgroundOut =
    params.customBackground?.kind === "file"
      ? await readEntryAsBlob(params.customBackground)
      : null;

  const record: DraftRecord = {
    id: existing?.id ?? id ?? `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    templateId: params.template.id,
    templateName: params.template.name,
    thumbnail: params.thumbnail ?? existing?.thumbnail ?? null,
    layerOpacity: { ...params.layerOpacity },
    glassSettings: { ...params.glassSettings },
    backgroundOpacity: params.backgroundOpacity,
    backgroundBlur: params.backgroundBlur,
    progressStyle: params.progressStyle,
    textValues: { ...params.textValues },
    slotMedia: slotMediaOut,
    customBackground: customBackgroundOut,
    audioClips: params.audioClips.map((c) => ({ ...c })),
    hiddenElements: Array.from(params.hiddenElements),
    currentSec: params.currentSec,
  };

  await withStore("readwrite", (store) => store.put(record));
  await evictOldestBeyondLimit(record.id);

  return record;
}

/** Kalau jumlah draft sudah lebih dari MAX_DRAFTS, hapus yang paling lama
 *  TIDAK diutak-atik (updatedAt terkecil), kecuali draft yang baru saja
 *  ditulis (`keepId`) — biar draft yang lagi aktif dikerjain gak pernah
 *  ke-evict oleh dirinya sendiri. */
async function evictOldestBeyondLimit(keepId: string): Promise<void> {
  const all = await withStore<DraftRecord[]>("readonly", (store) => store.getAll());
  if (all.length <= MAX_DRAFTS) return;

  const sortedOldestFirst = all
    .filter((d) => d.id !== keepId)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  const excess = all.length - MAX_DRAFTS;
  const toDelete = sortedOldestFirst.slice(0, excess);
  for (const d of toDelete) {
    await withStore("readwrite", (store) => store.delete(d.id));
  }
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const all = await withStore<DraftRecord[]>("readonly", (store) => store.getAll());
  return all
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      templateId: d.templateId,
      templateName: d.templateName,
      thumbnail: d.thumbnail,
    }));
}

export async function getDraft(id: string): Promise<DraftRecord | undefined> {
  return withStore<DraftRecord | undefined>("readonly", (store) => store.get(id));
}

export async function deleteDraft(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function countDrafts(): Promise<number> {
  const all = await withStore<DraftRecord[]>("readonly", (store) => store.getAll());
  return all.length;
}

export { storedMediaToEntry };
