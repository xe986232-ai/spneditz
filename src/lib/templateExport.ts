import type { DraftRecord } from "./drafts";
import { getDraft, importDraftRecord } from "./drafts";
import type { StoredMedia } from "./mediaStorage";

// ============================================================================
// Export/Import "file template" — bungkus SATU draft (project) beserta
// SEMUA isinya (opacity layer, warna teks, setting kaca, animasi lirik,
// gaya progress, DAN foto/video/audio yang dipakai user) jadi SATU file
// ".spnedit" yang bisa disimpan/dibagikan lalu di-IMPORT lagi (baik di HP
// yang sama maupun HP lain, selama app-nya sama-sama punya template
// sumbernya) — muncul sebagai draft baru di tab "Draft Project".
//
// Format file: JSON polos (bukan zip) — semua Blob (gambar/video/audio)
// diubah ke base64 dulu. Lebih besar ~33% daripada Blob mentah, tapi jauh
// lebih sederhana & tidak perlu library zip tambahan, dan tetap 1 file utuh
// yang gampang dibagi (WhatsApp, Drive, dst).
// ============================================================================

const FORMAT_VERSION = 1;
const APP_TAG = "spneditz-draft";
export const TEMPLATE_FILE_EXTENSION = ".spnedit";

type ExportedMedia = {
  mimeType: string;
  /** Base64 TANPA prefix "data:...;base64," */
  data: string;
};

/** Semua field DraftRecord KECUALI id/createdAt/updatedAt (di-generate ulang
 *  pas import) dan slotMedia/customBackground (Blob-nya dipindah ke bagian
 *  `media`, karena Blob tidak bisa langsung masuk JSON). */
type ExportedDraftPayload = Omit<
  DraftRecord,
  "id" | "createdAt" | "updatedAt" | "slotMedia" | "customBackground"
>;

export type TemplateExportFile = {
  formatVersion: number;
  app: typeof APP_TAG;
  exportedAt: number;
  templateId: string;
  templateName: string;
  payload: ExportedDraftPayload;
  media: {
    slotMedia: Record<string, ExportedMedia>;
    customBackground: ExportedMedia | null;
  };
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Buang prefix "data:<mime>;base64," — cuma butuh isi base64-nya.
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Gagal membaca file media untuk export."));
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
  const res = await fetch(`data:${mimeType || "application/octet-stream"};base64,${base64}`);
  return res.blob();
}

async function storedMediaToExported(stored: StoredMedia): Promise<ExportedMedia> {
  return {
    mimeType: stored.mimeType || "application/octet-stream",
    data: await blobToBase64(stored.blob),
  };
}

async function exportedToStoredMedia(exported: ExportedMedia): Promise<StoredMedia> {
  return {
    blob: await base64ToBlob(exported.data, exported.mimeType),
    mimeType: exported.mimeType,
  };
}

function sanitizeFileNamePart(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "template"
  );
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Kasih jeda dikit sebelum revoke, biar sempat kepakai browser buat
  // mulai proses download-nya (terutama Safari/iOS).
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Bikin objek TemplateExportFile lengkap dari 1 draft — dipisah dari
 *  exportDraftToFile() biar bisa dites/dipakai ulang tanpa harus langsung
 *  memicu download di browser. */
export async function buildTemplateExportFile(
  draftId: string,
): Promise<TemplateExportFile> {
  const draft = await getDraft(draftId);
  if (!draft) {
    throw new Error("Draft tidak ditemukan (mungkin sudah dihapus).");
  }

  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, slotMedia, customBackground, ...rest } = draft;

  const slotMediaOut: Record<string, ExportedMedia> = {};
  for (const [slotId, stored] of Object.entries(slotMedia)) {
    slotMediaOut[slotId] = await storedMediaToExported(stored);
  }

  return {
    formatVersion: FORMAT_VERSION,
    app: APP_TAG,
    exportedAt: Date.now(),
    templateId: draft.templateId,
    templateName: draft.templateName,
    payload: rest,
    media: {
      slotMedia: slotMediaOut,
      customBackground: customBackground
        ? await storedMediaToExported(customBackground)
        : null,
    },
  };
}

/** Export 1 draft jadi file ".spnedit" & langsung trigger download di
 *  browser. Dipanggil dari tombol "Export Template" di kartu draft. */
export async function exportDraftToFile(draftId: string): Promise<string> {
  const exportFile = await buildTemplateExportFile(draftId);
  const json = JSON.stringify(exportFile);
  const blob = new Blob([json], { type: "application/json" });

  const stamp = new Date(exportFile.exportedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(
    stamp.getHours(),
  )}${pad(stamp.getMinutes())}`;
  const fileName = `${sanitizeFileNamePart(exportFile.templateName)}-${dateStr}${TEMPLATE_FILE_EXTENSION}`;

  triggerDownload(blob, fileName);
  return fileName;
}

/** Baca & validasi isi file yang dipilih user lewat <input type="file">.
 *  Melempar Error dengan pesan ramah kalau file rusak/bukan format yang
 *  dikenal, biar bisa langsung ditampilkan ke user lewat alert(). */
export async function readTemplateExportFile(file: File): Promise<TemplateExportFile> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("Gagal membaca file. Coba pilih file lain.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File ini bukan file template yang valid (format tidak dikenali).");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).app !== APP_TAG ||
    typeof (parsed as Record<string, unknown>).templateId !== "string" ||
    typeof (parsed as Record<string, unknown>).payload !== "object" ||
    typeof (parsed as Record<string, unknown>).media !== "object"
  ) {
    throw new Error("File ini bukan file template spneditz yang valid.");
  }

  const data = parsed as TemplateExportFile;
  if (data.formatVersion > FORMAT_VERSION) {
    throw new Error(
      "File ini dibuat dari versi aplikasi yang lebih baru dan belum bisa dibuka di sini.",
    );
  }

  return data;
}

/** Ubah TemplateExportFile hasil parse jadi draft baru di IndexedDB (siap
 *  langsung muncul di daftar Draft Project). Pemanggil bertanggung jawab
 *  memastikan dulu `templateId`-nya masih ada/aktif di katalog TEMPLATES
 *  sebelum manggil ini (lib ini sengaja tidak import data/templates biar
 *  tidak sirkular & tetap reusable). */
export async function importTemplateExportFile(
  data: TemplateExportFile,
): Promise<DraftRecord> {
  const slotMedia: Record<string, StoredMedia> = {};
  for (const [slotId, exported] of Object.entries(data.media.slotMedia)) {
    slotMedia[slotId] = await exportedToStoredMedia(exported);
  }
  const customBackground = data.media.customBackground
    ? await exportedToStoredMedia(data.media.customBackground)
    : null;

  return importDraftRecord({
    ...data.payload,
    templateId: data.templateId,
    templateName: data.templateName,
    slotMedia,
    customBackground,
  });
}
