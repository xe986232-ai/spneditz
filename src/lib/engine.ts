// Titik masuk export TUNGGAL yang dipakai komponen (Editor.tsx). Strategi
// "Hybrid Dual-Engine":
//   1. Coba WebCodecs API (VideoEncoder+AudioEncoder / Canvas / mp4-muxer)
//      dulu — lebih cepat (hardware-accelerated) & progress-nya presisi
//      per-frame. Lihat webcodecs-export.ts.
//   2. Kalau browser tidak dukung WebCodecs SAMA SEKALI, ATAU proses
//      WebCodecs gagal di tengah jalan (config tidak didukung, encoder
//      error, dsb), otomatis fallback ke engine FFmpeg.wasm yang lama
//      (export.ts) — supaya export tetap berhasil di browser lama/aneh
//      (termasuk in-app browser TikTok/Instagram yang suka aneh-aneh).
import type { Template } from "../types";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { exportTemplateVideo, type ExportProgress } from "./export";
import { exportTemplateVideoWebCodecs, isWebCodecsExportSupported } from "./webcodecs-export";

export type { ExportProgress } from "./export";

export type ExportEngine = "webcodecs" | "ffmpeg";

export type ExportResult = {
  blob: Blob;
  /** Engine mana yang BENERAN dipakai buat menghasilkan video ini —
   *  dipakai UI buat nunjukkin badge, dan berguna banget buat debugging
   *  (misal user lapor "render lambat", tinggal tanya/cek ini duluan). */
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
): Promise<ExportResult> {
  if (isWebCodecsExportSupported()) {
    // eslint-disable-next-line no-console
    console.info("[export] WebCodecs didukung browser ini, mencoba engine WebCodecs…");
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
      );
      // eslint-disable-next-line no-console
      console.info("[export] ✅ Berhasil pakai engine WebCodecs (VideoEncoder/AudioEncoder + mp4-muxer).");
      return { blob, engine: "webcodecs" };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[export] ⚠️ Engine WebCodecs gagal, fallback ke FFmpeg.wasm…",
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.info("[export] Browser ini tidak mendukung WebCodecs API, langsung pakai FFmpeg.wasm.");
  }

  const blob = await exportTemplateVideo(
    template,
    slotMedia,
    layerOpacity,
    onProgress,
    customBackground,
    backgroundOpacity,
    backgroundBlur,
    textValues,
  );
  // eslint-disable-next-line no-console
  console.info("[export] ✅ Berhasil pakai engine FFmpeg.wasm.");
  return { blob, engine: "ffmpeg" };
}
