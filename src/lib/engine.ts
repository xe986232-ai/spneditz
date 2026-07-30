// Titik masuk export TUNGGAL yang dipakai komponen (Editor.tsx). Strategi
// "Hybrid Dual-Engine":
//   1. Coba WebCodecs API (VideoEncoder+AudioEncoder / Canvas / mp4-muxer)
//      dulu — lebih cepat (hardware-accelerated) & progress-nya presisi
//      per-frame. Lihat webcodecs-export.ts.
//   2. Kalau browser tidak dukung WebCodecs SAMA SEKALI, ATAU proses
//      WebCodecs gagal SEBELUM sempet mulai encode frame (config codec
//      gak didukung, dsb — lihat FALLBACK_PROGRESS_CEILING di bawah),
//      otomatis fallback ke engine FFmpeg.wasm yang lama (export.ts) —
//      supaya export tetap berhasil di browser lama/aneh (termasuk
//      in-app browser TikTok/Instagram yang suka aneh-aneh).
//   3. TAPI kalau WebCodecs sempet mulai encode frame beneran (progress
//      udah lewat tahap persiapan) terus baru gagal di tengah jalan,
//      kita SENGAJA TIDAK auto-fallback lagi. Alasannya: fallback di
//      titik itu berarti buang semua kerja yang udah dilakuin lalu
//      ngulang total pakai FFmpeg yang jauh lebih lambat — dari sisi
//      user kerasa kayak export "stuck"/lama padahal sebenarnya lagi
//      render ulang dari nol diam-diam. Mending export gagal jelas &
//      user coba lagi, daripada nunggu lama tanpa tau kenapa.
import type { Template } from "../types";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { exportTemplateVideo, ExportCancelledError, type ExportProgress } from "./export";
import { exportTemplateVideoWebCodecs, isWebCodecsExportSupported } from "./webcodecs-export";
import type { AudioClipExport } from "./audioClips";

export type { ExportProgress } from "./export";
export { ExportCancelledError } from "./export";

export type ExportEngine = "webcodecs" | "ffmpeg";

export type ExportResult = {
  blob: Blob;
  /** Engine mana yang BENERAN dipakai buat menghasilkan video ini —
   *  dipakai UI buat nunjukkin badge, dan berguna banget buat debugging
   *  (misal user lapor "render lambat", tinggal tanya/cek ini duluan). */
  engine: ExportEngine;
};

// Batas persen progress WebCodecs yang MASIH BOLEH silent-fallback ke
// FFmpeg kalau gagal. Lihat webcodecs-export.ts: tahap persiapan (load
// asset, cek config encoder lewat isConfigSupported, dst) berhenti di
// 20% — encode frame beneran baru mulai SETELAH itu. Jadi kegagalan di
// <=20% dijamin belum ada kerja berat yang kebuang percuma.
const FALLBACK_PROGRESS_CEILING = 20;

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
  // Hasil potong/geser/trim klip audio dari track "Musik latar" —
  // diteruskan ke kedua engine biar hasil export konsisten sama preview.
  audioClips?: AudioClipExport[],
  // Gaya tampilan progress lagu ("bar" standar atau "waveform" equalizer
  // ngikutin bentuk lagu) — pilihan user di editor, berlaku untuk
  // TEMPLATE MANAPUN yang punya progressLayer (bukan hardcode 1 template).
  progressStyle: "bar" | "waveform" = "bar",
  // Data amplitude/peaks file audio asli, cuma dipakai kalau
  // progressStyle === "waveform" (lihat drawWaveformProgress di render.ts).
  peaks?: number[],
): Promise<ExportResult> {
  if (isWebCodecsExportSupported()) {
    // eslint-disable-next-line no-console
    console.info("[export] WebCodecs didukung browser ini, mencoba engine WebCodecs…");

    // Nyimpen progress TERAKHIR yang dilaporin WebCodecs, dipakai buat
    // mutusin boleh silent-fallback atau enggak kalau dia gagal.
    let lastPercent = 0;
    const trackedOnProgress = (p: ExportProgress) => {
      lastPercent = p.percent;
      onProgress(p);
    };

    try {
      const blob = await exportTemplateVideoWebCodecs(
        template,
        slotMedia,
        layerOpacity,
        trackedOnProgress,
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
      // Kalau user yang membatalkan, jangan fallback ke FFmpeg — langsung
      // lempar ke pemanggil supaya export beneran berhenti.
      if (e instanceof ExportCancelledError) throw e;

      if (lastPercent > FALLBACK_PROGRESS_CEILING) {
        // Udah sempet mulai encode frame beneran — jangan diam-diam
        // ngulang total pakai FFmpeg (bakal kerasa "stuck" lama banget).
        // Gagal jelas aja, user tau harus coba lagi.
        // eslint-disable-next-line no-console
        console.error(
          "[export] ❌ Engine WebCodecs gagal di tengah proses render (setelah encode dimulai) — TIDAK fallback ke FFmpeg biar gak dobel lama.",
          e instanceof Error ? e.message : e,
        );
        throw new Error(
          "Render gagal di tengah proses (WebCodecs). Coba ekspor ulang — kalau berulang kali gagal di titik yang sama, coba buka lewat browser lain.",
        );
      }

      // Masih di tahap persiapan (belum ada frame yang di-encode) —
      // aman buat pindah diam-diam ke FFmpeg, gak ada kerja yang kebuang.
      // eslint-disable-next-line no-console
      console.warn(
        "[export] ⚠️ Engine WebCodecs gagal sebelum encode dimulai, fallback ke FFmpeg.wasm…",
        e instanceof Error ? e.message : e,
      );
      onProgress({
        stage: "switching-engine",
        percent: 5,
        label: "Metode render utama gak didukung, mencoba metode lain…",
      });
    }
  } else {
    // eslint-disable-next-line no-console
    console.info("[export] Browser ini tidak mendukung WebCodecs API, langsung pakai FFmpeg.wasm.");
  }

  if (signal?.aborted) throw new ExportCancelledError();

  const blob = await exportTemplateVideo(
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
  console.info("[export] ✅ Berhasil pakai engine FFmpeg.wasm.");
  return { blob, engine: "ffmpeg" };
}
