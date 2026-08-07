// Titik masuk export TUNGGAL yang dipakai komponen (Editor.tsx).
//
// Dulu di sini ada strategi "Hybrid Dual-Engine": coba WebCodecs dulu,
// kalau gagal diam-diam fallback ke FFmpeg.wasm. Itu DIHAPUS — soalnya
// perilakunya nggak konsisten (kadang render pakai WebCodecs yang cepat,
// kadang tanpa disadari jatuh ke FFmpeg yang jauh lebih lambat, dan user
// cuma lihat "loading lama" tanpa tahu kenapa).
//
// Sekarang: HANYA WebCodecs API (VideoEncoder + AudioEncoder + Canvas +
// mp4-muxer, lihat webcodecs-export.ts). Kalau browser tidak mendukung,
// atau proses render gagal di tengah jalan, export langsung gagal dengan
// pesan yang jelas — dilempar ke UI (lihat exportError di Editor.tsx)
// supaya user bisa retry atau pindah browser, alih-alih diam-diam
// menunggu engine lain yang lebih lambat jalan di belakang layar.
import type { Template } from "../types";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { ExportCancelledError, type ExportProgress } from "./exportShared";
import { exportTemplateVideoWebCodecs, isWebCodecsExportSupported } from "./webcodecs-export";
import type { AudioClipExport } from "./audioClips";

export type { ExportProgress } from "./exportShared";
export { ExportCancelledError } from "./exportShared";

export type ExportEngine = "webcodecs";

export type ExportResult = {
  blob: Blob;
  /** Selalu "webcodecs" sekarang — field ini dipertahankan (bukan dihapus
   *  langsung) supaya UI (badge di Editor.tsx) & pemanggil lain yang
   *  mungkin masih mengecek nilainya tidak perlu berubah drastis. */
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
  // Gaya tampilan progress lagu ("bar" standar atau "waveform" equalizer
  // ngikutin bentuk lagu) — pilihan user di editor, berlaku untuk
  // TEMPLATE MANAPUN yang punya progressLayer (bukan hardcode 1 template).
  progressStyle: "bar" | "waveform" = "bar",
  // Data amplitude/peaks file audio asli, cuma dipakai kalau
  // progressStyle === "waveform" (lihat drawWaveformProgress di render.ts).
  peaks?: number[],
): Promise<ExportResult> {
  if (!isWebCodecsExportSupported()) {
    // eslint-disable-next-line no-console
    console.error("[export] Browser ini tidak mendukung WebCodecs API (VideoEncoder/AudioEncoder/VideoFrame).");
    throw new Error(
      "Browser/perangkat ini belum mendukung mesin render WebCodecs, jadi export tidak bisa dijalankan di sini. Coba pakai browser lain yang lebih baru (mis. Chrome/Edge terbaru), atau buka di luar in-app browser TikTok/Instagram.",
    );
  }

  if (signal?.aborted) throw new ExportCancelledError();

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
    );
    // eslint-disable-next-line no-console
    console.info("[export] ✅ Berhasil pakai engine WebCodecs (VideoEncoder/AudioEncoder + mp4-muxer).");
    return { blob, engine: "webcodecs" };
  } catch (e) {
    if (e instanceof ExportCancelledError) throw e;
    // eslint-disable-next-line no-console
    console.error("[export] ❌ Engine WebCodecs gagal render.", e instanceof Error ? e.message : e);
    // Tidak ada fallback lagi — lempar apa adanya (dengan pesan yang
    // sudah cukup jelas dari webcodecs-export.ts) supaya UI nampilin
    // alert & user bisa langsung retry.
    throw e;
  }
}
