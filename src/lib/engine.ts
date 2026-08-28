// Titik masuk export TUNGGAL yang dipakai komponen (Editor.tsx).
//
// Engine render sekarang HANYA WebCodecs API (VideoEncoder+AudioEncoder /
// Canvas / mp4-muxer) — lihat webcodecs-export.ts. TIDAK ADA fallback ke
// FFmpeg.wasm lagi (sengaja dicabut): kalau browser tidak dukung WebCodecs,
// atau proses render-nya gagal di titik manapun, kita langsung lempar error
// yang jelas ke pemanggil (Editor.tsx bakal nampilinnya sebagai pesan error
// ke user lewat setExportError), bukan diam-diam ngulang render total pakai
// mesin lain yang jauh lebih berat & lambat.
import type { Template } from "../types";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { ExportCancelledError, type ExportProgress } from "./export";
import { exportTemplateVideoWebCodecs, isWebCodecsExportSupported } from "./webcodecs-export";
import type { AudioClipExport } from "./audioClips";

export type { ExportProgress } from "./export";
export { ExportCancelledError } from "./export";

export type ExportEngine = "webcodecs";

export type ExportResult = {
  blob: Blob;
  /** Cuma ada satu engine sekarang ("webcodecs"), field ini dipertahankan
   *  supaya tipe & pemanggil (Editor.tsx) yang sudah destructure `engine`
   *  tetap jalan tanpa perlu diubah. */
  engine: ExportEngine;
};

export async function exportTemplateVideoAuto(
  template: Template,
  slotMedia: SlotMediaState,
  layerOpacity: LayerOpacityState,
  onProgress: (p: ExportProgress) => void,
  customBackground?: SlotMediaEntry | null,
  backgroundOpacity: number = 100,
  backgroundBlur: number = 0,
  textValues: TextValueState = {},
  signal?: AbortSignal,
  // Hasil potong/geser/trim klip audio dari track "Musik latar".
  audioClips?: AudioClipExport[],
  // Gaya tampilan progress lagu ("bar" standar atau "waveform" equalizer).
  progressStyle: "bar" | "waveform" = "bar",
  // Data amplitude/peaks file audio asli, cuma dipakai kalau
  // progressStyle === "waveform" (lihat drawWaveformProgress di render.ts).
  peaks?: number[],
  // Intensitas efek Glow (bloom) global, 0-100. Default 0 = mati.
  glowIntensity: number = 0,
): Promise<ExportResult> {
  if (!isWebCodecsExportSupported()) {
    // eslint-disable-next-line no-console
    console.error("[export] Browser ini tidak mendukung WebCodecs API — export tidak bisa jalan.");
    throw new Error(
      "Browser kamu tidak mendukung fitur render video (WebCodecs API). Coba buka lewat Chrome/Edge versi terbaru (bukan in-app browser TikTok/Instagram), lalu coba lagi.",
    );
  }

  if (signal?.aborted) throw new ExportCancelledError();

  // eslint-disable-next-line no-console
  console.info("[export] Menggunakan engine WebCodecs…");

  try {
    const blob = await exportTemplateVideoWebCodecs(
      template,
      slotMedia,
      layerOpacity,
      onProgress,
      customBackground,
      backgroundOpacity,
      backgroundBlur,
      textValues,
      signal,
      audioClips,
      progressStyle,
      peaks,
      glowIntensity,
    );
    // eslint-disable-next-line no-console
    console.info("[export] ✅ Berhasil render (VideoEncoder/AudioEncoder + mp4-muxer).");
    return { blob, engine: "webcodecs" };
  } catch (e) {
    if (e instanceof ExportCancelledError) throw e;
    // eslint-disable-next-line no-console
    console.error("[export] ❌ Render gagal:", e instanceof Error ? e.message : e);
    // Lempar apa adanya (atau bungkus jadi Error biasa) supaya Editor.tsx
    // nampilin pesannya ke user lewat setExportError — TIDAK fallback ke
    // engine lain.
    throw e instanceof Error ? e : new Error(String(e));
  }
}
