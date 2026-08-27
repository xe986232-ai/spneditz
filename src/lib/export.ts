import type {
  TemplateDecorLayer,
  TemplateTextLayer,
  TemplateDurationLayer,
  TemplateProgressLayer,
  TemplateSpectrumLayer,
} from "../types";
import {
  drawImageCoverZoomed,
  drawTextLayers,
  drawDurationLayer,
  drawProgressFill,
  drawWaveformProgress,
  drawSpectrumIndicator,
} from "./render";
import type { LayerOpacityState, TextValueState } from "./render";

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat asset layer: ${src}`));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob gagal"))),
      type,
      quality,
    );
  });
}

// Seberapa banyak background di-zoom (overscan, px per level blur) biar
// pas di-blur nggak ada gradasi hitam di tepian — samain sama Editor.tsx.
const BACKGROUND_BLUR_OVERSCAN_FACTOR = 2;

/** Gabungin baseAssetSrc + sekumpulan decorLayer (dengan opacity masing2)
 *  jadi SATU gambar flat. `opaque=true` -> hasilnya JPEG (buat background,
 *  nggak butuh alpha). `opaque=false` -> PNG dengan alpha (buat overlay
 *  depan yang area kosongnya harus tetap transparan). */
export async function compositeLayers(
  canvasW: number,
  canvasH: number,
  baseSrc: string | null,
  layers: TemplateDecorLayer[],
  layerOpacity: LayerOpacityState,
  opaque: boolean,
  baseOpacity: number = 100,
  baseBlur: number = 0,
  // Teks custom (judul/artist/nama device) — digambar SETELAH semua decor
  // layer, sama seperti urutan di preview canvas (Editor.tsx).
  textLayers?: TemplateTextLayer[],
  textValues?: TextValueState,
  // Kalau diisi, label durasi berjalan/total ikut digambar di overlay ini
  // dengan nilai currentSec/totalSec yang diberikan (dipakai per-segmen,
  // lihat exportTemplateVideo — beda dari textLayers yang statis).
  durationOverride?: {
    durationLayer?: TemplateDurationLayer;
    // Progress bar (isian putih) — opsional, dipakai bareng durationLayer
    // karena sama2 butuh currentSec/totalSec per-segmen.
    progressLayer?: TemplateProgressLayer;
    currentSec: number;
    totalSec: number;
    // Gaya tampilan progress ("bar" standar / "waveform" equalizer) +
    // data peaks-nya — opsional, default ke drawProgressFill kalau tidak
    // diisi (backward-compatible, reusable untuk template manapun).
    progressStyle?: "bar" | "waveform";
    peaks?: number[];
    // Ikon spectrum/equalizer kecil di dekat judul — SELALU digambar
    // (tidak ikut progressStyle) kalau template-nya punya spectrumLayer
    // dan ada data peaks (bassPeaks ideal, sama seperti waveform).
    spectrumLayer?: TemplateSpectrumLayer;
  },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gagal bikin canvas compositing");

  if (baseSrc) {
    const bgImg = await loadImageEl(baseSrc);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(100, baseOpacity)) / 100;
    let overscan = 0;
    if (baseBlur > 0) {
      ctx.filter = `blur(${baseBlur}px)`;
      overscan = baseBlur * BACKGROUND_BLUR_OVERSCAN_FACTOR;
    } else {
      ctx.filter = "none";
    }
    // drawImageCoverZoomed (bukan drawImage stretch polos) supaya: (1)
    // foto sampul yang rasio-nya beda dari canvas tetap di-crop proporsional
    // kayak preview, bukan gepeng/stretch, dan (2) kalau ada blur, tepiannya
    // di-zoom dikit dulu biar nggak ada gradasi hitam pas di-blur.
    drawImageCoverZoomed(ctx, bgImg, 0, 0, canvasW, canvasH, overscan);
    ctx.restore();
  }

  for (const layer of layers) {
    const img = await loadImageEl(layer.assetSrc);
    const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
    if (op <= 0) continue;
    ctx.save();
    ctx.globalAlpha = op;
    ctx.drawImage(img, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  if (textLayers?.length) {
    drawTextLayers(ctx, canvasW, canvasH, textLayers, textValues ?? {});
  }
  if (durationOverride?.durationLayer) {
    drawDurationLayer(
      ctx,
      canvasW,
      canvasH,
      durationOverride.durationLayer,
      durationOverride.currentSec,
      durationOverride.totalSec,
    );
  }
  if (durationOverride?.progressLayer) {
    if (durationOverride.progressStyle === "waveform" && durationOverride.peaks?.length) {
      drawWaveformProgress(
        ctx,
        canvasW,
        canvasH,
        durationOverride.progressLayer,
        durationOverride.currentSec,
        durationOverride.totalSec,
        durationOverride.peaks,
      );
    } else {
      drawProgressFill(
        ctx,
        canvasW,
        canvasH,
        durationOverride.progressLayer,
        durationOverride.currentSec,
        durationOverride.totalSec,
      );
    }
  }
  if (durationOverride?.spectrumLayer && durationOverride.peaks?.length) {
    drawSpectrumIndicator(
      ctx,
      canvasW,
      canvasH,
      durationOverride.spectrumLayer,
      durationOverride.currentSec,
      durationOverride.totalSec,
      durationOverride.peaks,
    );
  }

  return canvasToBlob(canvas, opaque ? "image/jpeg" : "image/png", opaque ? 0.92 : undefined);
}

export type ExportStage =
  | "loading-engine"
  | "switching-engine"
  | "rendering-segment"
  | "combining"
  | "adding-audio"
  | "done";

export type ExportProgress = {
  stage: ExportStage;
  percent: number; // 0-100
  label: string;
};

export class ExportCancelledError extends Error {
  constructor() {
    super("Export dibatalkan oleh user.");
    this.name = "ExportCancelledError";
  }
}


