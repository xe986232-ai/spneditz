// Engine render/export "utama": VideoEncoder + AudioEncoder (WebCodecs API)
// dikawinkan sama Canvas, muxing ke .mp4 pakai pustaka murni JS `mp4-muxer`.
//
// Kenapa ini lebih baik dibanding engine FFmpeg.wasm (lihat export.ts):
// - Render per-frame beneran (bukan "tick" PNG yang di-loop) -> label
//   durasi & progress bar jalan MULUS, tidak pernah loncat/patah.
// - VideoEncoder pakai hardware acceleration browser kalau tersedia ->
//   jauh lebih cepat daripada software x264 encode di WASM.
// - Layer statis (background blur, decor "back", decor "front" + teks
//   custom) di-compose SEKALI di awal jadi ImageBitmap, dipakai ulang
//   tiap frame -> tidak ada kerja "blur ulang" berkali-kali yang bikin
//   lambat/stuck seperti bug lama di FFmpeg engine.
//
// Timeline model: slot foto/video BUKAN layer yang tumpang-tindih
// berdasarkan waktu, tapi SEGMEN berurutan (persis seperti FFmpeg engine
// yang meng-concat seg_0.mp4, seg_1.mp4, dst) — jadi frame loop di bawah
// cukup jalan lurus dari segmen ke segmen, currentSec global terus naik.
//
// Kalau browser tidak dukung WebCodecs (VideoEncoder/AudioEncoder) atau
// config yang dibutuhkan tidak didukung, fungsi ini melempar error —
// pemanggil (lihat engine.ts) WAJIB menangkap dan fallback ke FFmpeg
// engine yang lama.

import type {
  Template,
  TemplateDecorLayer,
} from "../types";
import {
  parseDurationSec,
  drawImageCover,
  roundRectPath,
  drawDurationLayer,
  drawProgressFill,
  drawWaveformProgress,
  drawSpectrumIndicator,
  getAudioDuration,
} from "./render";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { loadImageEl, compositeLayers, ExportCancelledError } from "./export";
import type { ExportProgress } from "./export";
import { loadDrawableSource } from "./exportShared";
import { buildRemappedAudioBuffer, clipsAreTrivial } from "./audioClips";
import type { AudioClipExport } from "./audioClips";

const TARGET_FPS = 25;

/** Cek dukungan browser buat jalur WebCodecs. Dipanggil oleh engine.ts
 *  SEBELUM nyoba exportTemplateVideoWebCodecs — kalau false, langsung
 *  pakai FFmpeg engine tanpa buang waktu nyoba WebCodecs dulu. */
export function isWebCodecsExportSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== "undefined" &&
    typeof (window as unknown as { AudioEncoder?: unknown }).AudioEncoder !== "undefined" &&
    typeof (window as unknown as { VideoFrame?: unknown }).VideoFrame !== "undefined"
  );
}

function pickCanvasEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

async function findSupportedVideoConfig(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig> {
  // Bitrate dinaikkan dari sebelumnya (faktor 0.1, cap 12 Mbps) — buat
  // canvas 1080x1920 @25fps itu cuma ~5.2 Mbps, kurang buat konten yang
  // banyak teks/garis tajam (gampang keliatan blocky/lembek). Sekarang
  // ~9.3 Mbps di resolusi yang sama, cap dinaikkan ke 18 Mbps.
  const bitrate = Math.min(18_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.18)));
  const candidates: VideoEncoderConfig[] = [
    { codec: "avc1.640028", width, height, framerate: fps, bitrate, bitrateMode: "variable", latencyMode: "quality" },
    { codec: "avc1.4d0028", width, height, framerate: fps, bitrate, bitrateMode: "variable", latencyMode: "quality" },
    { codec: "avc1.42001f", width, height, framerate: fps, bitrate, bitrateMode: "variable", latencyMode: "quality" },
  ];
  for (const config of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return support.config ?? config;
    } catch {
      // lanjut coba kandidat berikutnya
    }
  }
  throw new Error("Tidak ada konfigurasi VideoEncoder (H.264) yang didukung browser ini.");
}

async function findSupportedAudioConfig(
  sampleRate: number,
  numberOfChannels: number,
): Promise<AudioEncoderConfig> {
  const candidates: AudioEncoderConfig[] = [
    { codec: "mp4a.40.2", sampleRate, numberOfChannels, bitrate: 128_000 },
  ];
  for (const config of candidates) {
    try {
      const support = await AudioEncoder.isConfigSupported(config);
      if (support.supported) return support.config ?? config;
    } catch {
      // lanjut
    }
  }
  throw new Error("Tidak ada konfigurasi AudioEncoder (AAC) yang didukung browser ini.");
}

/** Wrapper seek video element ke waktu tertentu & tunggu frame itu siap
 *  digambar, dengan timeout supaya nggak hang kalau event "seeked" nggak
 *  fire (kejadian di sebagian browser buat video pendek/rusak). */
function seekVideoTo(video: HTMLVideoElement, t: number, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => done();
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = Math.max(0, Math.min(t, (video.duration || t) - 0.001));
    } catch {
      done();
    }
  });
}

function loadVideoElOnce(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Sama kayak di loadImageEl: jangan pasang crossOrigin buat blob: URL
  // lokal, cuma buat URL remote http(s) — kalau nggak, sebagian
  // browser/WebView bisa gagal load blob-nya.
  if (/^https?:\/\//i.test(src)) {
    video.crossOrigin = "anonymous";
  }
  video.src = src;
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout memuat metadata video")), 8000);
    video.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(timer);
        resolve(video);
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Gagal memuat file video"));
      },
      { once: true },
    );
  });
}

/** Sama strategi 2-lapis kayak loadDrawableSource (lihat exportShared.ts):
 *  coba `url` (blob URL yang dibuat FRESH pas user pilih file) DULUAN —
 *  itu paling stabil — baru fallback ke bikin blob URL baru dari `file`
 *  mentah kalau `url`-nya gagal dimuat. JANGAN dibalik: bikin blob URL baru
 *  dari File duluan itu justru rawan gagal kalau File-nya udah "stale"
 *  (kejadian di Chrome Android setelah beberapa interaksi) — persis bug
 *  yang bikin slot "Foto sampul" gagal walau background (yang pakai `url`
 *  asli) berhasil dimuat. */
async function loadVideoEl(file: File | undefined, url: string | undefined): Promise<HTMLVideoElement> {
  if (url) {
    try {
      return await loadVideoElOnce(url);
    } catch (urlErr) {
      if (!file) throw urlErr;
      // eslint-disable-next-line no-console
      console.warn(
        "[export] loadVideoEl(url) gagal, fallback ke object URL dari file…",
        urlErr instanceof Error ? urlErr.message : urlErr,
      );
    }
  }
  if (!file) throw new Error("Tidak ada sumber video yang valid.");
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadVideoElOnce(objectUrl);
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

type ResolvedSlot = {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  media?: SlotMediaEntry;
  isVideo: boolean;
  videoEl?: HTMLVideoElement;
  imgBitmap?: ImageBitmap;
};

export async function exportTemplateVideoWebCodecs(
  template: Template,
  slotMedia: SlotMediaState,
  layerOpacity: LayerOpacityState,
  onProgress: (p: ExportProgress) => void,
  customBackground?: SlotMediaEntry | null,
  backgroundOpacity: number = 100,
  backgroundBlur: number = 0,
  textValues: TextValueState = {},
  signal?: AbortSignal,
  // Hasil potong/geser/trim klip audio dari track "Musik latar" di
  // editor (lihat Editor.tsx) — kalau ada & bukan klip "utuh" (belum
  // diapa-apain), audio asli di-remap dulu (silence + potongan yang
  // ditempel ulang) sebelum di-encode, biar video final ikut sama
  // persis kayak yang kedengeran di preview.
  audioClips?: AudioClipExport[],
  // Gaya tampilan progress ("bar" standar atau "waveform" equalizer) —
  // lihat komentar sama di engine.ts. Default "bar" biar backward-compatible.
  progressStyle: "bar" | "waveform" = "bar",
  // Peaks/amplitude file audio asli, cuma dipakai kalau progressStyle
  // "waveform" (lihat drawWaveformProgress di render.ts).
  peaks?: number[],
): Promise<Blob> {
  if (!isWebCodecsExportSupported()) {
    throw new Error("Browser ini tidak mendukung WebCodecs API (VideoEncoder/AudioEncoder).");
  }

  const backgroundImageSrc = customBackground?.url ?? template.baseAssetSrc;
  if (!backgroundImageSrc) {
    throw new Error("Template ini belum punya base asset untuk di-export.");
  }
  if (!customBackground && template.baseAssetType !== "image") {
    throw new Error("Export baseAssetSrc bertipe video belum didukung di versi ini.");
  }

  onProgress({ stage: "loading-engine", percent: 5, label: "Menyiapkan mesin render (WebCodecs)…" });

  const canvasW = pickCanvasEven(template.canvasWidth ?? 1080);
  const canvasH = pickCanvasEven(template.canvasHeight ?? 1920);

  const backDecorLayers = (template.decorLayers ?? []).filter((l) => l.order === "back");
  // Kalau progressStyle "waveform", skip decorLayer track statis
  // (progressbar.png) — samain sama preview & export ffmpeg, biar gak
  // dobel/numpuk sama bar waveform yang digambar dari nol.
  const frontDecorLayers = (template.decorLayers ?? []).filter(
    (l) => l.order === "front" && !(progressStyle === "waveform" && l.hideInWaveformMode),
  );

  // --- Layer statis: dirender SEKALI, dipakai ulang tiap frame. ---
  onProgress({ stage: "loading-engine", percent: 10, label: "Menyusun latar & dekorasi…" });

  const needsBackgroundComposite =
    backDecorLayers.length > 0 || backgroundOpacity < 100 || backgroundBlur > 0;

  let staticBgBitmap: ImageBitmap;
  try {
    if (needsBackgroundComposite) {
      const bgBlob = await compositeLayers(
        canvasW,
        canvasH,
        backgroundImageSrc,
        backDecorLayers as TemplateDecorLayer[],
        layerOpacity,
        true,
        backgroundOpacity,
        backgroundBlur,
      );
      staticBgBitmap = await createImageBitmap(bgBlob);
    } else {
      const bgImg = await loadImageEl(backgroundImageSrc);
      const c = document.createElement("canvas");
      c.width = canvasW;
      c.height = canvasH;
      const cctx = c.getContext("2d");
      if (!cctx) throw new Error("Gagal membuat canvas background");
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = "high";
      drawImageCover(cctx, bgImg, 0, 0, canvasW, canvasH);
      staticBgBitmap = await createImageBitmap(c);
    }
  } catch (e) {
    throw new Error(
      `Gagal menyiapkan background. (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  let staticFrontBitmap: ImageBitmap | null = null;
  if (frontDecorLayers.length > 0 || (template.textLayers?.length ?? 0) > 0) {
    try {
      const frontBlob = await compositeLayers(
        canvasW,
        canvasH,
        null,
        frontDecorLayers as TemplateDecorLayer[],
        layerOpacity,
        false,
        100,
        0,
        template.textLayers,
        textValues,
      );
      staticFrontBitmap = await createImageBitmap(frontBlob);
    } catch (e) {
      throw new Error(
        `Gagal menyiapkan layer depan/teks. (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  // --- Durasi total & timeScale (ikut panjang audio kalau ada). ---
  const audioSlot = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlot ? slotMedia[audioSlot.id] : undefined;

  const referenceDuration = Math.max(0.1, parseDurationSec(template.duration));
  let totalDurationForMux = referenceDuration;
  let timeScale = 1;
  let decodedAudioBuffer: AudioBuffer | null = null;

  if (audioMedia) {
    onProgress({ stage: "loading-engine", percent: 13, label: "Membaca audio…" });
    try {
      const audioCtx = new AudioContext();
      const source = audioMedia.file ?? audioMedia.url;
      const arrayBuffer =
        source instanceof File
          ? await source.arrayBuffer()
          : await (await fetch(source)).arrayBuffer();
      decodedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      totalDurationForMux = decodedAudioBuffer.duration;
      timeScale = totalDurationForMux / referenceDuration;
      // Kalau user udah motong/geser/trim track audio-nya di editor
      // (audioClips bukan "utuh"), susun ulang isi buffer sesuai posisi
      // klip-klip itu SEBELUM di-encode — durasi total tetap sama, cuma
      // isinya yang berubah (ada jeda senyap di bagian yang kepotong).
      if (audioClips && !clipsAreTrivial(audioClips, totalDurationForMux)) {
        decodedAudioBuffer = buildRemappedAudioBuffer(
          audioCtx,
          decodedAudioBuffer,
          audioClips,
        );
      }
      await audioCtx.close();
    } catch {
      // Fallback: tetap pakai durasi template kalau audio gagal dibaca/decode.
      // (Coba juga baca durasi cepat lewat <audio> dengan timeout, siapa
      // tau decodeAudioData yang gagal tapi metadata tetap bisa dibaca.)
      try {
        const d = await getAudioDuration(audioMedia.file ?? audioMedia.url);
        totalDurationForMux = d;
        timeScale = d / referenceDuration;
      } catch {
        // beneran nggak bisa dibaca -> lanjut pakai durasi template
      }
    }
  }

  const imageSlots = template.slots
    .filter((s) => s.type === "image" || s.type === "video")
    .map((s) => ({
      ...s,
      startSec: (s.startSec ?? 0) * timeScale,
      endSec: (s.endSec ?? referenceDuration) * timeScale,
    }));

  // --- Siapkan media tiap slot (image -> ImageBitmap, video -> <video> siap-seek). ---
  onProgress({ stage: "loading-engine", percent: 15, label: "Menyiapkan foto & video…" });

  const resolvedSlots: ResolvedSlot[] = [];
  const objectUrlsToRevoke: string[] = [];
  for (const slot of imageSlots) {
    const media = slotMedia[slot.id];
    const duration = Math.max(0.2, (slot.endSec ?? 0) - (slot.startSec ?? 0));
    const resolved: ResolvedSlot = {
      id: slot.id,
      label: slot.label,
      startSec: slot.startSec ?? 0,
      endSec: (slot.startSec ?? 0) + duration,
      x: ((slot.x ?? 0) / 100) * canvasW,
      y: ((slot.y ?? 0) / 100) * canvasH,
      width: ((slot.width ?? 100) / 100) * canvasW,
      height: ((slot.height ?? 100) / 100) * canvasH,
      radius: slot.radius ?? 16,
      media,
      isVideo: slot.type === "video" && Boolean(media),
    };
    if (media) {
      try {
        if (resolved.isVideo) {
          resolved.videoEl = await loadVideoEl(media.file, media.url);
        } else {
          // Prioritaskan `media.url` (blob URL asli, dibuat pas file
          // dipilih) — cuma fallback ke File mentah kalau url-nya gagal.
          // Lihat catatan di loadVideoEl/loadDrawableSource soal kenapa
          // urutan ini penting (File bisa "stale").
          const img = await loadDrawableSource(media.file, media.url);
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(resolved.width));
          c.height = Math.max(1, Math.round(resolved.height));
          const cctx = c.getContext("2d");
          if (!cctx) throw new Error("Gagal membuat canvas slot");
          cctx.imageSmoothingEnabled = true;
          cctx.imageSmoothingQuality = "high";
          drawImageCover(cctx, img, 0, 0, c.width, c.height);
          if (img instanceof ImageBitmap) img.close();
          resolved.imgBitmap = await createImageBitmap(c);
        }
      } catch (e) {
        throw new Error(
          `Gagal menyiapkan media slot "${slot.label}". (${e instanceof Error ? e.message : String(e)})`,
        );
      }
    }
    resolvedSlots.push(resolved);
  }

  // --- Setup muxer + encoder. ---
  onProgress({ stage: "loading-engine", percent: 20, label: "Menyalakan encoder…" });

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  const videoConfig = await findSupportedVideoConfig(canvasW, canvasH, TARGET_FPS);

  let audioConfig: AudioEncoderConfig | null = null;
  if (decodedAudioBuffer) {
    audioConfig = await findSupportedAudioConfig(
      decodedAudioBuffer.sampleRate,
      Math.min(2, decodedAudioBuffer.numberOfChannels),
    );
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: canvasW, height: canvasH, frameRate: TARGET_FPS },
    audio: audioConfig
      ? { codec: "aac", numberOfChannels: audioConfig.numberOfChannels, sampleRate: audioConfig.sampleRate }
      : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let videoEncoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      videoEncoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  videoEncoder.configure(videoConfig);

  let audioEncoderError: Error | null = null;
  let audioEncoder: AudioEncoder | null = null;
  if (audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        audioEncoderError = e instanceof Error ? e : new Error(String(e));
      },
    });
    audioEncoder.configure(audioConfig);
  }

  const checkEncoderErrors = () => {
    if (videoEncoderError) throw videoEncoderError;
    if (audioEncoderError) throw audioEncoderError;
  };

  // Backpressure yang BENAR: nunggu sampai antrian encoder beneran turun,
  // pakai event "dequeue" bawaan WebCodecs — bukan polling setTimeout(0)
  // yang cuma nge-yield satu tick tanpa jaminan antrian udah berkurang.
  // Tanpa ini, kalau kecepatan render frame > kecepatan encode, antrian
  // (dan memori yang menyertainya) numpuk tanpa batas -> renderer OOM ->
  // tab Chrome di-crash paksa (persis kasus export dengan audio panjang).
  function waitForQueueDrain(
    encoder: VideoEncoder | AudioEncoder,
    maxQueueSize: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (encoder.encodeQueueSize <= maxQueueSize) {
        resolve();
        return;
      }
      const onDequeue = () => {
        if (encoder.encodeQueueSize <= maxQueueSize) {
          encoder.removeEventListener("dequeue", onDequeue);
          resolve();
        }
      };
      encoder.addEventListener("dequeue", onDequeue);
    });
  }

  // --- Render loop: per-frame, segmen berurutan. ---
  const totalFrames = Math.max(1, Math.round(totalDurationForMux * TARGET_FPS));
  const frameDurationUs = Math.round(1_000_000 / TARGET_FPS);

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = canvasW;
  frameCanvas.height = canvasH;
  const ctx = frameCanvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Gagal membuat canvas frame render");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let lastReportedPercent = 20;
  let lastVideoSeekSec = -1;

  for (let frame = 0; frame < totalFrames; frame++) {
    if (signal?.aborted) {
      try {
        videoEncoder.close();
      } catch {
        /* abaikan */
      }
      throw new ExportCancelledError();
    }
    checkEncoderErrors();
    const currentSec = frame / TARGET_FPS;

    // Cari slot aktif (berurutan, jadi seharusnya cuma satu, tapi tetap
    // ambil yang match rentang waktunya biar konsisten walau ada gap).
    const activeSlot = resolvedSlots.find(
      (s) => currentSec >= s.startSec && currentSec < s.endSec,
    );

    ctx.drawImage(staticBgBitmap, 0, 0, canvasW, canvasH);

    if (activeSlot) {
      ctx.save();
      roundRectPath(ctx, activeSlot.x, activeSlot.y, activeSlot.width, activeSlot.height, activeSlot.radius);
      ctx.clip();
      if (activeSlot.isVideo && activeSlot.videoEl) {
        const localT = currentSec - activeSlot.startSec;
        // Seek cuma kalau waktunya beda cukup jauh dari frame sebelumnya
        // (hemat, video pendek biasanya nggak butuh seek presisi per-frame).
        if (Math.abs(localT - lastVideoSeekSec) >= 1 / TARGET_FPS) {
          await seekVideoTo(activeSlot.videoEl, localT);
          lastVideoSeekSec = localT;
        }
        drawImageCover(ctx, activeSlot.videoEl as unknown as HTMLImageElement, activeSlot.x, activeSlot.y, activeSlot.width, activeSlot.height);
      } else if (activeSlot.imgBitmap) {
        ctx.drawImage(activeSlot.imgBitmap, activeSlot.x, activeSlot.y);
      }
      ctx.restore();
    }

    if (staticFrontBitmap) {
      ctx.drawImage(staticFrontBitmap, 0, 0, canvasW, canvasH);
    }
    if (template.durationLayer) {
      drawDurationLayer(ctx, canvasW, canvasH, template.durationLayer, currentSec, totalDurationForMux);
    }
    if (template.progressLayer) {
      if (progressStyle === "waveform" && peaks?.length) {
        drawWaveformProgress(
          ctx,
          canvasW,
          canvasH,
          template.progressLayer,
          currentSec,
          totalDurationForMux,
          peaks,
        );
      } else {
        drawProgressFill(ctx, canvasW, canvasH, template.progressLayer, currentSec, totalDurationForMux);
      }
    }
    // Ikon spectrum/equalizer kecil di dekat judul — SELALU digambar
    // (tidak ikut progressStyle "Standar"/"Waveform berjalan") kalau
    // template-nya punya spectrumLayer & ada data peaks audio asli.
    if (template.spectrumLayer && peaks?.length) {
      drawSpectrumIndicator(
        ctx,
        canvasW,
        canvasH,
        template.spectrumLayer,
        currentSec,
        totalDurationForMux,
        peaks,
      );
    }

    const videoFrame = new VideoFrame(frameCanvas, {
      timestamp: frame * frameDurationUs,
      duration: frameDurationUs,
    });
    const isKeyFrame = frame % (TARGET_FPS * 2) === 0; // keyframe tiap ~2 detik
    videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
    videoFrame.close();

    // Backpressure: tunggu antrian beneran turun sebelum lanjut push
    // frame berikutnya, supaya memori nggak meledak di video panjang
    // (mis. durasi export yang di-stretch ikutin audio yang panjang).
    if (videoEncoder.encodeQueueSize > 8) {
      await waitForQueueDrain(videoEncoder, 4);
    }

    const percent = 20 + Math.round((frame / totalFrames) * 55); // 20 -> 75
    if (percent !== lastReportedPercent) {
      lastReportedPercent = percent;
      onProgress({
        stage: "rendering-segment",
        percent,
        label: activeSlot ? `Merender ${activeSlot.label}…` : "Merender frame…",
      });
    }
  }

  onProgress({ stage: "combining", percent: 78, label: "Menyelesaikan video…" });
  await videoEncoder.flush();
  checkEncoderErrors();
  videoEncoder.close();

  for (const url of objectUrlsToRevoke) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* abaikan */
    }
  }

  // --- Encode audio (kalau ada). ---
  if (audioEncoder && decodedAudioBuffer && audioConfig) {
    onProgress({ stage: "adding-audio", percent: 85, label: "Menambahkan musik latar…" });
    const sampleRate = audioConfig.sampleRate;
    const channels = audioConfig.numberOfChannels;
    const totalSamples = Math.floor(decodedAudioBuffer.duration * decodedAudioBuffer.sampleRate);
    const FRAME_SIZE = 1024;

    // Ambil channel data asli (float32), resample kasar kalau sampleRate
    // encoder beda dari buffer asli (jarang terjadi, tapi jaga-jaga).
    const needsResample = decodedAudioBuffer.sampleRate !== sampleRate;
    const getChannelData = (ch: number): Float32Array => {
      const raw = decodedAudioBuffer!.getChannelData(Math.min(ch, decodedAudioBuffer!.numberOfChannels - 1));
      if (!needsResample) return raw;
      const ratio = decodedAudioBuffer!.sampleRate / sampleRate;
      const outLen = Math.floor(raw.length / ratio);
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) out[i] = raw[Math.floor(i * ratio)];
      return out;
    };
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) channelData.push(getChannelData(ch));
    const resampledTotal = needsResample
      ? Math.floor(totalSamples / (decodedAudioBuffer.sampleRate / sampleRate))
      : totalSamples;

    for (let offset = 0; offset < resampledTotal; offset += FRAME_SIZE) {
      if (signal?.aborted) {
        try {
          audioEncoder.close();
        } catch {
          /* abaikan */
        }
        throw new ExportCancelledError();
      }
      checkEncoderErrors();
      const len = Math.min(FRAME_SIZE, resampledTotal - offset);
      const planar = new Float32Array(len * channels);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(channelData[ch].subarray(offset, offset + len), ch * len);
      }
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: len,
        numberOfChannels: channels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      if (audioEncoder.encodeQueueSize > 16) {
        await waitForQueueDrain(audioEncoder, 8);
      }
    }
    await audioEncoder.flush();
    checkEncoderErrors();
    audioEncoder.close();
  }

  onProgress({ stage: "done", percent: 100, label: "Selesai!" });

  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}
