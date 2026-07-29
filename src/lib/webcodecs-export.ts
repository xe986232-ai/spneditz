import type {
  Template,
  TemplateDecorLayer,
  TemplateSlot,
} from "../types";
import {
  parseDurationSec,
  drawImageCover,
  drawImageCoverZoomed,
  roundRectPath,
  drawTextLayers,
  drawDurationLayer,
  drawProgressFill,
  isSlotActiveAt,
} from "./render";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import type { ExportProgress } from "./export";

/** Dilempar kalau browser ini tidak mendukung WebCodecs (atau konfigurasi
 *  encoder yang dibutuhkan tidak didukung) — sinyal ke pemanggil supaya
 *  fallback ke engine FFmpeg.wasm, BUKAN dianggap error export yang
 *  sebenarnya. */
export class WebCodecsUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebCodecsUnsupportedError";
  }
}

const FPS = 30;
// Titik target encodeQueueSize sebelum kita nunggu (backpressure) — cegah
// numpuk ratusan VideoFrame belum ke-encode yang bisa bikin memori jebol.
const MAX_QUEUE_SIZE = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat asset: ${src}`));
    img.src = src;
  });
}

function toEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

async function fetchArrayBuffer(source: File | string): Promise<ArrayBuffer> {
  if (source instanceof File) return source.arrayBuffer();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Gagal mengambil audio (${res.status})`);
  return res.arrayBuffer();
}

/** Background OFF-SCREEN sekali render (base image dgn opacity/blur +
 *  decorLayers "back") — persis behaviour compositeLayers(...opaque=true)
 *  versi lama, tapi hasilnya dipakai langsung sebagai bitmap per-frame,
 *  bukan ditulis ke file lalu di-loop lewat ffmpeg. */
async function buildBackgroundCanvas(
  canvasW: number,
  canvasH: number,
  backgroundImageSrc: string,
  backDecorLayers: TemplateDecorLayer[],
  layerOpacity: LayerOpacityState,
  backgroundOpacity: number,
  backgroundBlur: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Gagal membuat canvas background");

  const bgImg = await loadImageEl(backgroundImageSrc);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(100, backgroundOpacity)) / 100;
  let overscan = 0;
  if (backgroundBlur > 0) {
    ctx.filter = `blur(${backgroundBlur}px)`;
    overscan = backgroundBlur * 2;
  } else {
    ctx.filter = "none";
  }
  drawImageCoverZoomed(ctx, bgImg, 0, 0, canvasW, canvasH, overscan);
  ctx.restore();

  for (const layer of backDecorLayers) {
    const img = await loadImageEl(layer.assetSrc);
    const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
    if (op <= 0) continue;
    ctx.save();
    ctx.globalAlpha = op;
    drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  return canvas;
}

/** Overlay depan yang KONSTAN sepanjang durasi (ikon/track progress bar +
 *  teks judul/artist/dsb) — dirender SEKALI ke canvas transparan, dipakai
 *  ulang tiap frame. Yang berubah tiap frame (angka durasi & isian
 *  progress bar) TIDAK ikut di sini, digambar langsung tiap frame di
 *  canvas utama supaya benar-benar mengikuti waktu asli, bukan gambar
 *  statis yang di-hold. */
async function buildFrontStaticCanvas(
  canvasW: number,
  canvasH: number,
  frontDecorLayers: TemplateDecorLayer[],
  layerOpacity: LayerOpacityState,
  template: Template,
  textValues: TextValueState,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gagal membuat canvas overlay depan");

  for (const layer of frontDecorLayers) {
    const img = await loadImageEl(layer.assetSrc);
    const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
    if (op <= 0) continue;
    ctx.save();
    ctx.globalAlpha = op;
    drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  if (template.textLayers?.length) {
    drawTextLayers(ctx, canvasW, canvasH, template.textLayers, textValues);
  }

  return canvas;
}

async function preloadSlotMediaImages(
  slots: TemplateSlot[],
  slotMedia: SlotMediaState,
): Promise<Map<string, HTMLImageElement>> {
  const entries = new Map<string, HTMLImageElement>();
  await Promise.all(
    slots.map(async (slot) => {
      const media = slotMedia[slot.id];
      if (!media) return;
      // Sama seperti preview (Editor.tsx): media slot (foto ATAU video)
      // digambar sebagai gambar diam via elemen <img> — konsisten dengan
      // perilaku preview yang sudah ada, jadi hasil export = preview.
      const img = await loadImageEl(media.url);
      entries.set(slot.id, img);
    }),
  );
  return entries;
}

function computeVideoBitrate(w: number, h: number, fps: number): number {
  const raw = w * h * fps * 0.07;
  return Math.round(Math.min(10_000_000, Math.max(2_000_000, raw)));
}

export async function exportTemplateVideoWebCodecs(
  template: Template,
  slotMedia: SlotMediaState,
  layerOpacity: LayerOpacityState,
  onProgress: (p: ExportProgress) => void,
  customBackground?: SlotMediaEntry | null,
  backgroundOpacity: number = 100,
  backgroundBlur: number = 0,
  textValues: TextValueState = {},
): Promise<Blob> {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoFrame === "undefined" ||
    typeof AudioEncoder === "undefined" ||
    typeof AudioData === "undefined"
  ) {
    throw new WebCodecsUnsupportedError(
      "Browser ini belum mendukung WebCodecs (VideoEncoder/AudioEncoder).",
    );
  }

  const backgroundImageSrc = customBackground?.url ?? template.baseAssetSrc;
  if (!backgroundImageSrc) {
    throw new Error("Template ini belum punya base asset untuk di-export.");
  }
  if (!customBackground && template.baseAssetType !== "image") {
    throw new Error("Export baseAssetSrc bertipe video belum didukung di versi ini.");
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  onProgress({
    stage: "loading-engine",
    percent: 5,
    label: "Menyiapkan mesin render (WebCodecs)…",
  });

  const canvasW = toEven(template.canvasWidth ?? 1080);
  const canvasH = toEven(template.canvasHeight ?? 1920);

  const backDecorLayers = (template.decorLayers ?? []).filter((l) => l.order === "back");
  const frontDecorLayers = (template.decorLayers ?? []).filter((l) => l.order === "front");

  const audioSlot = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlot ? slotMedia[audioSlot.id] : undefined;

  onProgress({ stage: "loading-engine", percent: 12, label: "Menyiapkan asset…" });

  // ---- Decode audio (kalau ada) LEBIH DULU, karena durasi total video
  // ikut durasi audio asli (bukan metadata perkiraan). ----
  let audioBuffer: AudioBuffer | null = null;
  let audioCtx: AudioContext | null = null;
  if (audioMedia) {
    const source = audioMedia.file ?? audioMedia.url;
    const arrayBuf = await fetchArrayBuffer(source);
    audioCtx = new AudioContext();
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    } catch (e) {
      throw new Error(
        `Gagal decode audio (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  const referenceDuration = Math.max(0.1, parseDurationSec(template.duration));
  const totalDurationForMux = audioBuffer ? audioBuffer.duration : referenceDuration;
  const timeScale = audioBuffer ? audioBuffer.duration / referenceDuration : 1;

  const imageSlots = template.slots
    .filter((s) => s.type === "image" || s.type === "video")
    .map((s) => ({
      ...s,
      startSec: (s.startSec ?? 0) * timeScale,
      endSec: (s.endSec ?? referenceDuration) * timeScale,
    }));

  // ---- Siapkan semua bitmap yang statis (nggak berubah per-frame) ----
  const [bgCanvas, frontStaticCanvas, slotImages] = await Promise.all([
    buildBackgroundCanvas(
      canvasW,
      canvasH,
      backgroundImageSrc,
      backDecorLayers,
      layerOpacity,
      backgroundOpacity,
      backgroundBlur,
    ),
    buildFrontStaticCanvas(canvasW, canvasH, frontDecorLayers, layerOpacity, template, textValues),
    preloadSlotMediaImages(imageSlots, slotMedia),
  ]);

  // ---- Setup muxer + encoders ----
  const videoBitrate = computeVideoBitrate(canvasW, canvasH, FPS);
  const videoConfig: VideoEncoderConfig = {
    codec: "avc1.42001f",
    width: canvasW,
    height: canvasH,
    bitrate: videoBitrate,
    framerate: FPS,
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "quality",
  };
  const videoSupport = await VideoEncoder.isConfigSupported(videoConfig);
  if (!videoSupport.supported) {
    throw new WebCodecsUnsupportedError(
      "Konfigurasi VideoEncoder (H.264) tidak didukung di browser ini.",
    );
  }

  let audioConfig: AudioEncoderConfig | null = null;
  if (audioBuffer) {
    audioConfig = {
      codec: "mp4a.40.2",
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate: 128_000,
    };
    const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
    if (!audioSupport.supported) {
      throw new WebCodecsUnsupportedError(
        "Konfigurasi AudioEncoder (AAC) tidak didukung di browser ini.",
      );
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: canvasW, height: canvasH },
    audio: audioConfig
      ? { codec: "aac", sampleRate: audioConfig.sampleRate, numberOfChannels: audioConfig.numberOfChannels }
      : undefined,
    fastStart: "in-memory",
  });

  let encodeError: unknown = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  videoEncoder.configure(videoConfig);

  let audioEncoder: AudioEncoder | null = null;
  if (audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        encodeError = e;
      },
    });
    audioEncoder.configure(audioConfig);
  }

  // ---- Render + encode tiap frame, waktu SEBENARNYA (bukan tick) ----
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Gagal membuat canvas render utama");

  const totalFrames = Math.max(1, Math.round(totalDurationForMux * FPS));
  const frameDurationUs = Math.round(1_000_000 / FPS);

  for (let frame = 0; frame < totalFrames; frame++) {
    if (encodeError) break;
    const t = Math.min(totalDurationForMux, frame / FPS);

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(bgCanvas, 0, 0);

    for (const slot of imageSlots) {
      if (
        slot.x == null ||
        slot.y == null ||
        slot.width == null ||
        slot.height == null
      )
        continue;
      if (!isSlotActiveAt(slot, t)) continue;
      const img = slotImages.get(slot.id);
      if (!img) continue;

      const dx = (slot.x / 100) * canvasW;
      const dy = (slot.y / 100) * canvasH;
      const dw = (slot.width / 100) * canvasW;
      const dh = (slot.height / 100) * canvasH;
      const radius = slot.radius ?? 16;

      ctx.save();
      roundRectPath(ctx, dx, dy, dw, dh, radius);
      ctx.clip();
      drawImageCover(ctx, img, dx, dy, dw, dh);
      ctx.restore();
    }

    ctx.drawImage(frontStaticCanvas, 0, 0);

    // Angka durasi & progress bar dihitung ULANG dari `t` asli tiap frame
    // — inilah yang bikin animasinya jalan mulus & tidak pernah loncat,
    // karena memang tidak ada lagi konsep "tick" yang di-hold.
    if (template.durationLayer) {
      drawDurationLayer(ctx, canvasW, canvasH, template.durationLayer, t, totalDurationForMux);
    }
    if (template.progressLayer) {
      drawProgressFill(ctx, canvasW, canvasH, template.progressLayer, t, totalDurationForMux);
    }

    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round(t * 1_000_000),
      duration: frameDurationUs,
    });
    videoEncoder.encode(videoFrame, { keyFrame: frame % (FPS * 2) === 0 });
    videoFrame.close();

    while (videoEncoder.encodeQueueSize > MAX_QUEUE_SIZE) {
      await sleep(0);
    }

    onProgress({
      stage: "rendering-segment",
      percent: 15 + Math.round((frame / totalFrames) * 65),
      label: `Merender frame ${frame + 1}/${totalFrames}…`,
    });
  }

  if (encodeError) {
    throw new Error(
      `Gagal encode video (${encodeError instanceof Error ? encodeError.message : String(encodeError)})`,
    );
  }

  onProgress({ stage: "combining", percent: 82, label: "Menyelesaikan trek video…" });
  await videoEncoder.flush();
  videoEncoder.close();

  // ---- Encode audio (kalau ada) ----
  if (audioEncoder && audioBuffer) {
    onProgress({ stage: "adding-audio", percent: 88, label: "Menambahkan musik latar…" });
    const chunkSize = 4096;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      channelData.push(audioBuffer.getChannelData(ch));
    }

    for (let pos = 0; pos < totalSamples; pos += chunkSize) {
      if (encodeError) break;
      const frames = Math.min(chunkSize, totalSamples - pos);
      const data = new Float32Array(frames * numberOfChannels);
      for (let ch = 0; ch < numberOfChannels; ch++) {
        data.set(channelData[ch].subarray(pos, pos + frames), ch * frames);
      }
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: audioBuffer.sampleRate,
        numberOfFrames: frames,
        numberOfChannels,
        timestamp: Math.round((pos / audioBuffer.sampleRate) * 1_000_000),
        data,
      });
      audioEncoder.encode(audioData);
      audioData.close();

      while (audioEncoder.encodeQueueSize > 10) {
        await sleep(0);
      }
    }

    if (encodeError) {
      throw new Error(
        `Gagal encode audio (${encodeError instanceof Error ? encodeError.message : String(encodeError)})`,
      );
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }
  if (audioCtx) {
    try {
      await audioCtx.close();
    } catch {
      /* abaikan */
    }
  }

  onProgress({ stage: "done", percent: 99, label: "Menyusun file MP4…" });
  muxer.finalize();
  const { buffer } = muxer.target as InstanceType<typeof ArrayBufferTarget>;

  onProgress({ stage: "done", percent: 100, label: "Selesai!" });
  return new Blob([buffer], { type: "video/mp4" });
}
