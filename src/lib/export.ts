import type {
  Template,
  TemplateDecorLayer,
  TemplateTextLayer,
  TemplateDurationLayer,
  TemplateProgressLayer,
} from "../types";
import {
  parseDurationSec,
  drawImageCoverZoomed,
  roundRectPath,
  drawTextLayers,
  drawDurationLayer,
  drawProgressFill,
  drawWaveformProgress,
  getAudioDuration,
} from "./render";
import type { SlotMediaState, LayerOpacityState, SlotMediaEntry, TextValueState } from "./render";
import { buildRemappedAudioBuffer, clipsAreTrivial, audioBufferToWavBlob } from "./audioClips";
import type { AudioClipExport } from "./audioClips";

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat asset layer: ${src}`));
    img.src = src;
  });
}

// Baca source (biasanya blob URL) jadi Uint8Array lewat fetchFile, dengan
// retry — jaga-jaga kalau sesekali masih gagal (mis. hiccup sesaat di
// WebView), daripada langsung bikin export gagal total padahal biasanya
// begitu dicoba ulang langsung jalan.
async function fetchFileWithRetry(
  fetchFileFn: (source: File | string | Blob) => Promise<Uint8Array>,
  source: File | string | Blob,
  attempts = 3,
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchFileFn(source);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

// PENTING: `ffmpeg.exec()` dari @ffmpeg/ffmpeg TIDAK melempar (reject) promise
// kalau proses FFmpeg-nya gagal di dalam — dia cuma resolve dengan RETURN CODE
// (0 = sukses, selain itu = gagal). Kalau ini tidak dicek manual, kegagalan
// FFmpeg (mis. concat gagal karena segmen corrupt) akan diam-diam LOLOS, kode
// lanjut jalan seolah sukses, dan error baru muncul beberapa step kemudian di
// tempat yang tidak berhubungan (biasanya sebagai "FS error" generik pas ada
// yang coba baca/pakai file yang sebetulnya tidak pernah berhasil ditulis).
// Semua pemanggilan ffmpeg.exec() di file ini WAJIB lewat helper ini.
async function execChecked(
  ffmpeg: { exec: (args: string[]) => Promise<number> },
  args: string[],
  errorContext: string,
  recentLogs: string[],
): Promise<void> {
  const ret = await ffmpeg.exec(args);
  if (ret !== 0) {
    const logTail = recentLogs.slice(-6).join(" | ");
    throw new Error(
      `${errorContext} (FFmpeg keluar dengan kode error ${ret}).${
        logTail ? ` Log terakhir: ${logTail}` : ""
      }`,
    );
  }
}

// Seberapa banyak background di-zoom (overscan, px per level blur) biar
// pas di-blur nggak ada gradasi hitam di tepian — samain sama Editor.tsx.
const BACKGROUND_BLUR_OVERSCAN_FACTOR = 2;

/** Bikin gambar mask (hitam-putih, PNG) buat rounded-corner: putih di
 *  area rounded-rect (bakal jadi opaque), hitam di luar (bakal jadi
 *  transparan). Dipakai bareng filter `alphamerge` ffmpeg supaya sampul
 *  foto/video di hasil EXPORT punya sudut membulat, konsisten sama
 *  preview di canvas (yang clip-nya pakai roundRectPath + ctx.clip()). */
async function createRoundedMaskBlob(
  w: number,
  h: number,
  radius: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gagal bikin mask rounded-corner");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.fill();
  return canvasToBlob(canvas, "image/png");
}


/** Gabungin baseAssetSrc + sekumpulan decorLayer (dengan opacity masing2)
 *  jadi SATU gambar flat. Dipakai supaya pipeline export (ffmpeg) tetap
 *  simpel — nggak perlu ubah filter graph per layer, tinggal ganti
 *  "bg.jpg" jadi hasil composite ini. `opaque=true` -> hasilnya JPEG
 *  (buat background, nggak butuh alpha). `opaque=false` -> PNG dengan
 *  alpha (buat overlay depan yang area kosongnya harus tetap transparan). */
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

function guessImageExt(file?: File, url?: string): string {
  if (file?.type === "image/png") return "png";
  if (file?.type === "image/webp") return "webp";
  if (file?.type === "image/jpeg") return "jpg";
  if (url) {
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".png")) return "png";
    if (clean.endsWith(".webp")) return "webp";
  }
  return "jpg";
}

function guessAudioExt(file?: File, url?: string): string {
  if (file?.type === "audio/mpeg") return "mp3";
  if (file?.type === "audio/wav") return "wav";
  if (file?.type === "audio/mp4" || file?.type === "audio/m4a") return "m4a";
  if (url) {
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".wav")) return "wav";
    if (clean.endsWith(".m4a")) return "m4a";
  }
  return "mp3";
}

// Bikin dimensi genap (syarat encoder libx264 pixel format yuv420)
function toEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

export async function exportTemplateVideo(
  template: Template,
  slotMedia: SlotMediaState,
  layerOpacity: LayerOpacityState,
  onProgress: (p: ExportProgress) => void,
  // Kalau user pilih "Jadi Background" di salah satu sampul, background
  // yang dipakai buat export adalah isi sampul itu (selalu gambar),
  // gantiin template.baseAssetSrc asli.
  customBackground?: SlotMediaEntry | null,
  // Opacity (0-100) & blur (px) khusus background hasil transfer sampul,
  // ikut diterapkan pas export biar konsisten sama preview.
  backgroundOpacity: number = 100,
  backgroundBlur: number = 0,
  // Isi textLayers (judul/artist/nama device) hasil custom user di editor
  // — dipakai buat gambar teks ke overlay export, konsisten sama preview.
  textValues: TextValueState = {},
  signal?: AbortSignal,
  // Hasil potong/geser/trim klip audio dari track "Musik latar" di
  // editor — lihat komentar sama di webcodecs-export.ts.
  audioClips?: AudioClipExport[],
  // Gaya tampilan progress ("bar" standar / "waveform" equalizer) + peaks
  // file audio asli — lihat komentar sama di engine.ts. Default "bar".
  progressStyle: "bar" | "waveform" = "bar",
  peaks?: number[],
): Promise<Blob> {
  // Sumber buat di-load sebagai <img> (preview compositing) — butuh URL.
  const backgroundImageSrc = customBackground?.url ?? template.baseAssetSrc;
  // Sumber buat ditulis ke filesystem ffmpeg — PAKAI blob URL (string) dulu,
  // BUKAN object File mentah. @ffmpeg/util punya bug: kalau dikasih File
  // langsung, dia baca pakai FileReader.readAsArrayBuffer(), dan handle File
  // dari input picker itu suka jadi stale di Chrome Android (misal abis tab
  // di-background sebentar / memory pressure) -> FileReader gagal dengan
  // pesan persis "File could not be read! Code=-1". Blob URL (string) lewat
  // jalur fetch() yang jauh lebih stabil. JANGAN balik urutan ini lagi.
  const backgroundFileSrc: File | string | undefined =
    customBackground?.url ?? customBackground?.file ?? template.baseAssetSrc;

  if (!backgroundImageSrc || !backgroundFileSrc) {
    throw new Error("Template ini belum punya base asset untuk di-export.");
  }
  // Kalau background masih pakai baseAssetSrc asli template (bukan hasil
  // transfer sampul), tetap berlaku batasan lama: cuma bertipe image yang
  // didukung. Background hasil transfer sampul selalu berupa gambar, jadi
  // batasan ini tidak relevan buat kasus itu.
  if (!customBackground && template.baseAssetType !== "image") {
    throw new Error(
      "Export baseAssetSrc bertipe video belum didukung di versi ini.",
    );
  }

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  onProgress({
    stage: "loading-engine",
    percent: 5,
    label: "Memuat mesin render (FFmpeg.wasm)…",
  });

  const ffmpeg = new FFmpeg();
  // Simpan beberapa baris log FFmpeg terakhir — dipakai buat memperkaya
  // pesan error di bawah (mis. saat readFile gagal dengan "FS error" yang
  // generik), supaya kelihatan error FFmpeg SEBENARNYA yang mendahuluinya
  // (biasanya lebih spesifik daripada "FS error" itu sendiri).
  const recentLogs: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    recentLogs.push(message);
    if (recentLogs.length > 20) recentLogs.shift();
    // eslint-disable-next-line no-console
    console.log("[ffmpeg]", message);
  });

  // Coba beberapa sumber berurutan: file lokal (kalau ada di /public/ffmpeg),
  // lalu beberapa CDN sebagai cadangan. Ini supaya export tetap jalan walau
  // salah satu CDN diblokir/down (sering kejadian di in-app browser seperti
  // TikTok/Instagram, atau jaringan seluler tertentu).
  // PENTING: pakai build ESM (bukan UMD). @ffmpeg/ffmpeg membuat Worker
  // dengan { type: "module" }, jadi `importScripts` tidak tersedia di
  // dalamnya dan dia fallback ke `import()` dinamis yang butuh
  // `export default` — hanya ada di build ESM, bukan UMD.
  const coreSources = [
    "/ffmpeg", // self-hosted, taruh ffmpeg-core.js & ffmpeg-core.wasm (build esm) di public/ffmpeg/
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
    "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
  ];

  let loaded = false;
  let lastError: unknown = null;
  for (const coreBase of coreSources) {
    try {
      const coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm");
      await ffmpeg.load({ coreURL, wasmURL });
      loaded = true;
      break;
    } catch (e) {
      lastError = e;
      // eslint-disable-next-line no-console
      console.warn(`[ffmpeg] gagal load dari ${coreBase}, coba sumber berikutnya…`, e);
    }
  }

  if (!loaded) {
    throw new Error(
      `Gagal memuat mesin render FFmpeg dari semua sumber (lokal & CDN). Cek koneksi internet, coba buka lewat browser biasa (bukan in-app browser TikTok/Instagram), lalu coba lagi. (${
        lastError instanceof Error ? lastError.message : String(lastError)
      })`,
    );
  }

  onProgress({ stage: "loading-engine", percent: 15, label: "Menyiapkan asset…" });

  const canvasW = template.canvasWidth ?? 1080;
  const canvasH = template.canvasHeight ?? 1920;

  // decorLayers "back" (misal: Card Player) di-flatten LANGSUNG ke bg.jpg
  // (bareng opacity yang user atur), biar filter graph ffmpeg di bawah
  // nggak perlu berubah — tetap cuma "bg.jpg" + 1 foreground per segmen.
  // decorLayers "front" (ikon, progress bar, info&kontrol) di-flatten ke
  // satu PNG transparan terpisah ("front.png") & di-overlay PALING akhir
  // tiap segmen, supaya selalu di atas foto sampul.
  const backDecorLayers = (template.decorLayers ?? []).filter((l) => l.order === "back");
  // Kalau progressStyle "waveform", skip decorLayer track statis
  // (progressbar.png) — waveform gambar bar-nya dari nol, jadi track lama
  // harus disembunyikan biar gak dobel/numpuk (samain sama preview).
  const frontDecorLayers = (template.decorLayers ?? []).filter(
    (l) => l.order === "front" && !(progressStyle === "waveform" && l.hideInWaveformMode),
  );
  let hasFrontComposite = false;
  // Kalau template punya durationLayer, front overlay HARUS beda tiap
  // segmen (waktu berjalan berubah tiap foto) -> dibuat per-segmen di
  // loop bawah, bukan sekali di awal (lihat blok try di bawah).
  const needsPerSegmentFront = Boolean(template.durationLayer || template.progressLayer);

  try {
    // Kalau ada decorLayer "back", ATAU background-nya diberi opacity/blur
    // custom (hasil transfer sampul yang diatur user), background nggak
    // bisa lagi ditulis langsung apa adanya — harus lewat compositing dulu
    // biar filter blur & alpha-nya kepakai di bg.jpg yang dipakai ffmpeg.
    const needsBackgroundComposite =
      backDecorLayers.length > 0 || backgroundOpacity < 100 || backgroundBlur > 0;

    if (needsBackgroundComposite) {
      const bgBlob = await compositeLayers(
        canvasW,
        canvasH,
        backgroundImageSrc,
        backDecorLayers,
        layerOpacity,
        true,
        backgroundOpacity,
        backgroundBlur,
      );
      await ffmpeg.writeFile("bg.jpg", await fetchFile(bgBlob));
    } else {
      await ffmpeg.writeFile("bg.jpg", await fetchFileWithRetry(fetchFile, backgroundFileSrc));
    }

    // Kalau ada textLayers TAPI TIDAK ada durationLayer, teks (judul/artist/
    // device) tetap statis sepanjang video -> cukup di-flatten sekali ke
    // front.png bareng decorLayers, sama seperti sebelumnya. Kalau
    // needsPerSegmentFront true, front.png di sini TIDAK dibuat (dibuat
    // belakangan per-segmen di loop bawah).
    if (frontDecorLayers.length > 0 || (template.textLayers?.length && !needsPerSegmentFront)) {
      if (!needsPerSegmentFront) {
        const frontBlob = await compositeLayers(
          canvasW,
          canvasH,
          null,
          frontDecorLayers,
          layerOpacity,
          false,
          100,
          0,
          template.textLayers,
          textValues,
        );
        await ffmpeg.writeFile("front.png", await fetchFile(frontBlob));
        hasFrontComposite = true;
      }
    }
  } catch (e) {
    throw new Error(
      `Gagal menyiapkan background/layer template (cek koneksi / asset). (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }

  const audioSlot = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlot ? slotMedia[audioSlot.id] : undefined;

  // Kalau ada audio yang diupload, panjang video mengikuti panjang audio
  // itu (bukan durasi template yang di-hardcode) — semua slot foto/video
  // di-scale proporsional biar timing-nya tetap konsisten relatif.
  const referenceDuration = Math.max(0.1, parseDurationSec(template.duration));
  let totalDurationForMux = referenceDuration;
  let timeScale = 1;
  // Kalau ada, dan user udah motong/geser/trim track audio-nya di editor,
  // ini bakal diisi Blob WAV hasil remap (silence + potongan yang
  // ditempel ulang) — dipakai GANTI file audio asli pas muxing di bawah.
  let remappedAudioBlob: Blob | null = null;
  if (audioMedia) {
    try {
      const audioDuration = await getAudioDuration(audioMedia.url ?? audioMedia.file);
      totalDurationForMux = audioDuration;
      timeScale = audioDuration / referenceDuration;
    } catch {
      // Gagal baca durasi audio (mis. browser lama) -> tetap pakai durasi
      // template sebagai fallback, export tetap jalan.
    }

    if (audioClips && !clipsAreTrivial(audioClips, totalDurationForMux)) {
      try {
        const audioCtx = new AudioContext();
        // `url` selalu ada (blob URL) — pakai itu langsung, lebih stabil di
        // Chrome Android daripada baca ulang object File mentah.
        const arrayBuffer = await (await fetch(audioMedia.url)).arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        const remapped = buildRemappedAudioBuffer(audioCtx, decoded, audioClips);
        remappedAudioBlob = audioBufferToWavBlob(remapped);
        totalDurationForMux = remapped.duration;
        timeScale = remapped.duration / referenceDuration;
        await audioCtx.close();
      } catch (e) {
        // Gagal decode/remap (mis. browser aneh) -> lanjut pakai audio
        // ASLI utuh (tanpa potongan) daripada export gagal total.
        // eslint-disable-next-line no-console
        console.warn("[export] gagal remap audio hasil potong, pakai audio asli.", e);
        remappedAudioBlob = null;
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

  const segFiles: string[] = [];
  const totalStages = imageSlots.length + 1; // segments + concat

  for (let i = 0; i < imageSlots.length; i++) {
    if (signal?.aborted) throw new ExportCancelledError();
    const slot = imageSlots[i];
    const duration = Math.max(
      0.2,
      (slot.endSec ?? 0) - (slot.startSec ?? 0),
    );
    const media = slotMedia[slot.id];
    const segName = `seg_${i}.mp4`;
    segFiles.push(segName);

    onProgress({
      stage: "rendering-segment",
      percent: 15 + Math.round((i / totalStages) * 60),
      label: `Merender ${slot.label} (${i + 1}/${imageSlots.length})…`,
    });

    const bgFilter = `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[bg]`;

    // Slot foto (atau slot kosong) isinya SAMA PERSIS sepanjang durasi —
    // tidak ada gerakan sama sekali. Kalau durasinya jadi panjang (ikut
    // audio yang panjang), nge-encode ribuan frame identik lewat FFmpeg.wasm
    // itu lambat banget (bisa bermenit-menit). Jadi buat kasus statis:
    // render klip PENDEK aja (maks ~1.2 detik), lalu "perpanjang" ke durasi
    // asli pakai stream copy (-c copy, tanpa re-encode) yang nyaris instan.
    // Slot video (ada footage aslinya) tetap di-render penuh apa adanya.
    const isStatic = slot.type !== "video" || !media;
    const renderDuration = isStatic ? Math.min(duration, 1.2) : duration;
    const needsExtend = renderDuration < duration;
    // Kalau butuh overlay dinamis, base JANGAN langsung ditulis ke segName
    // — nanti dibaca lagi buat di-tempel front animasi & ditulis ulang ke
    // segName di pass terakhir, jadi harus pakai nama file sementara dulu.
    const baseName =
      needsExtend || needsPerSegmentFront ? `seg_${i}_base.mp4` : segName;

    // Front overlay STATIS (ikon/progress bar track/teks custom TANPA
    // durationLayer/progressLayer) tetap dipakai apa adanya — "front.png"
    // yang sudah dibuat sekali di awal, dibakar langsung ke klip pendek lalu
    // ikut di-loop bareng base (aman, karena isinya sama terus).
    const frontFileName = "front.png";

    try {
      // Susun input & filter_complex secara generik: bg -> (overlay foto
      // sampul kalau ada) -> (overlay front.png statis kalau ada & template
      // TIDAK butuh durationLayer/progressLayer). Input index & label
      // "current" jalan terus ngikutin tahapan yang benar-benar dipakai.
      const inputArgs: string[] = ["-loop", "1", "-t", `${renderDuration}`, "-i", "bg.jpg"];
      const filters: string[] = [bgFilter];
      let currentLabel = "bg";
      let nextInputIndex = 1;

      // Daftar file intermediate yang perlu dihapus setelah segmen ini
      // selesai — ffmpeg.wasm pakai FS berbasis memori yang terbatas,
      // file yang menumpuk antar-segmen bisa sebabkan FS error.
      const intermediateFiles: string[] = [];

      if (media) {
        const ext = guessImageExt(media.file, media.url);
        const fgName = `slot_${i}.${ext}`;
        // Blob URL dulu, BUKAN File mentah — lihat catatan di backgroundFileSrc
        // di atas soal bug "File could not be read! Code=-1" di Chrome Android.
        const source = media.url ?? media.file;
        await ffmpeg.writeFile(fgName, await fetchFileWithRetry(fetchFile, source));
        intermediateFiles.push(fgName);

        const sw = toEven(((slot.width ?? 100) / 100) * canvasW);
        const sh = toEven(((slot.height ?? 100) / 100) * canvasH);
        const sx = toEven(((slot.x ?? 0) / 100) * canvasW);
        const sy = toEven(((slot.y ?? 0) / 100) * canvasH);
        // Radius sudut membulat, sama seperti dipakai di preview canvas
        // (roundRectPath) — default 16px kalau slot tidak set eksplisit.
        const radius = slot.radius ?? 16;

        inputArgs.push("-loop", "1", "-t", `${renderDuration}`, "-i", fgName);
        const fgIdx = nextInputIndex;
        nextInputIndex++;

        filters.push(
          `[${fgIdx}:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},setsar=1[fgraw${i}]`,
        );

        let fgLabel = `fgraw${i}`;
        if (radius > 0) {
          // Mask rounded-rect ukuran SAMA PERSIS kayak fg yang udah
          // di-scale+crop (sw x sh), dipakai buat "ngukir" sudut membulat
          // lewat alphamerge (luma mask jadi alpha channel fg).
          const maskName = `mask_${i}.png`;
          const maskBlob = await createRoundedMaskBlob(sw, sh, radius);
          await ffmpeg.writeFile(maskName, await fetchFile(maskBlob));
          intermediateFiles.push(maskName);
          inputArgs.push("-loop", "1", "-t", `${renderDuration}`, "-i", maskName);
          const maskIdx = nextInputIndex;
          nextInputIndex++;

          filters.push(`[${maskIdx}:v]format=gray[fgmask${i}]`);
          filters.push(`[${fgLabel}][fgmask${i}]alphamerge[fground${i}]`);
          fgLabel = `fground${i}`;
        }

        filters.push(`[${currentLabel}][${fgLabel}]overlay=${sx}:${sy}:format=auto[ov1]`);
        currentLabel = "ov1";
      }

      // Kalau template PUNYA durationLayer/progressLayer, front overlay
      // JANGAN dibakar di sini — bakal ditempel belakangan (lihat blok
      // needsPerSegmentFront di bawah) supaya animasinya bisa nyampe
      // durasi PENUH, bukan ikut ke-loop tiap ${renderDuration} detik.
      if (hasFrontComposite && !needsPerSegmentFront) {
        inputArgs.push("-loop", "1", "-t", `${renderDuration}`, "-i", frontFileName);
        filters.push(`[${currentLabel}][${nextInputIndex}:v]overlay=0:0:format=auto[ov2]`);
        currentLabel = "ov2";
        nextInputIndex++;
      }

      await execChecked(
        ffmpeg,
        [
          ...inputArgs,
          "-filter_complex", filters.join(";"),
          "-map", `[${currentLabel}]`,
          "-r", "25",
          "-pix_fmt", "yuv420p",
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-t", `${renderDuration}`,
          baseName,
        ],
        `Gagal merender base segmen "${slot.label}".`,
        recentLogs,
      );

      // Slot image / mask sudah tidak dibutuhkan setelah encode base selesai
      // — hapus segera supaya FS tidak penuh.
      for (const f of intermediateFiles) {
        try { await ffmpeg.deleteFile(f); } catch { /* abaikan kalau sudah tidak ada */ }
      }

      // Nama file dasar (bg+foto[+front statis]) yang sudah meng-cover
      // durasi PENUH slot ini — didapat langsung (renderDuration===duration)
      // atau lewat extend stream-copy di bawah.
      let baseFullName = baseName;

      if (needsExtend) {
        // Sambung/ulang klip pendek tadi jadi durasi asli tanpa re-encode
        // (stream copy) — ini bagian yang bikin render nggak lagi "setaun".
        const extendedName = needsPerSegmentFront ? `seg_${i}_full.mp4` : segName;
        await execChecked(
          ffmpeg,
          [
            "-stream_loop", "-1",
            "-i", baseName,
            "-c", "copy",
            "-t", `${duration}`,
            extendedName,
          ],
          `Gagal memperpanjang segmen "${slot.label}".`,
          recentLogs,
        );
        // base (klip pendek) sudah tidak dipakai, hapus.
        try { await ffmpeg.deleteFile(baseName); } catch { /* abaikan */ }
        baseFullName = extendedName;
      }

      // Overlay ANIMASI (judul/artist/device teks + label durasi) — dipecah
      // jadi beberapa "tick" PNG yang nyebar di sepanjang durasi PENUH slot
      // ini, di-concat jadi satu stream video (masih transparan/RGBA lewat
      // filter, BUKAN lewat encode mp4 dulu yang bakal buang alpha-nya),
      // baru ditempel di atas base yang udah full durasi. Ini yang bikin
      // angka durasi beneran JALAN di hasil ekspor, bukan cuma freeze di
      // detik awal segmen.
      //
      // CATATAN progress bar: isian progress bar SENGAJA TIDAK digambar di
      // sini lagi. Kalau isian progress bar ikut di-render sebagai bagian
      // dari tick PNG statis ini, dia cuma bisa "loncat" posisi tiap
      // pergantian tick (patah2, nggak ngalir) — sama kayak label durasi
      // teks (yang memang wajar begitu, karena cuma angka detik bulat).
      // Supaya progress bar-nya BENERAN mulus & tidak tergantung jumlah
      // tick/fps, dia digambar terpisah pakai filter native ffmpeg
      // `drawbox` dengan ekspresi berbasis waktu (`t`) — dihitung ULANG
      // oleh ffmpeg di SETIAP frame output, bukan dari gambar statis yang
      // di-hold. Lihat blok `progressLayer` setelah overlay di bawah.
      if (needsPerSegmentFront) {
        // Tick di sini dipakai untuk DUA hal yang sama-sama berubah tiap
        // waktu: label durasi teks DAN isian progress bar (progressLayer
        // sekarang digambar di canvas bareng durationLayer — lihat
        // compositeLayers di bawah — BUKAN lagi lewat filter drawbox
        // ffmpeg, karena drawbox tidak punya variabel waktu; huruf `t` di
        // ekspresinya adalah opsi thickness milik drawbox sendiri, bukan
        // detik berjalan, jadi hasilnya selalu diam/patah di satu nilai).
        // Kalau template tidak punya durationLayer maupun progressLayer,
        // tidak ada apa pun di overlay ini yang berubah seiring waktu,
        // jadi cukup SATU frame statis.
        //
        // Target 1 tick per detik supaya angka durasi jalan urut
        // (0,1,2,3,...) tanpa loncat, dan progress bar ikut update tiap
        // detik (jauh lebih mulus dibanding sebelumnya yang cuma maks 5
        // tick sepanjang durasi). Dibatasi maks 30 tick per segmen supaya
        // tetap aman untuk memori WASM FS (tiap tick PNG di canvas ini
        // ±1-2MB) — kalau durasi segmen lebih dari 30 detik, update-nya
        // jadi tiap ~(duration/30) detik (masih jauh lebih halus daripada
        // tiap ~(duration/5) detik seperti sebelumnya).
        const needsAnimatedOverlay = Boolean(
          template.durationLayer || template.progressLayer,
        );
        const numTicks = needsAnimatedOverlay
          ? Math.max(1, Math.min(30, Math.ceil(duration)))
          : 1;
        const tickDur = duration / numTicks;

        const tickInputArgs: string[] = [];
        const tickLabels: string[] = [];
        const tickFileNames: string[] = [];
        for (let j = 0; j < numTicks; j++) {
          const tickFileName = `fronttick_${i}_${j}.png`;
          tickFileNames.push(tickFileName);
          const tickCurrentSec = (slot.startSec ?? 0) + j * tickDur;
          const tickBlob = await compositeLayers(
            canvasW,
            canvasH,
            null,
            frontDecorLayers,
            layerOpacity,
            false,
            100,
            0,
            template.textLayers,
            textValues,
            {
              durationLayer: template.durationLayer,
              progressLayer: template.progressLayer,
              currentSec: tickCurrentSec,
              totalSec: totalDurationForMux,
              progressStyle,
              peaks,
            },
          );
          await ffmpeg.writeFile(tickFileName, await fetchFile(tickBlob));
          tickInputArgs.push("-loop", "1", "-t", `${tickDur}`, "-i", tickFileName);
          tickLabels.push(`[${j}:v]`);
        }

        const animFilters = [`${tickLabels.join("")}concat=n=${numTicks}:v=1:a=0[frontanim]`];
        const baseIdx = numTicks;

        const filterChain = `${animFilters.join(";")};[${baseIdx}:v][frontanim]overlay=0:0:format=auto[ovfinal]`;
        const mapLabel = "ovfinal";

        await execChecked(
          ffmpeg,
          [
            ...tickInputArgs,
            "-i", baseFullName,
            "-filter_complex",
            filterChain,
            "-map", `[${mapLabel}]`,
            "-r", "25",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-t", `${duration}`,
            segName,
          ],
          `Gagal menempel overlay animasi ke segmen "${slot.label}".`,
          recentLogs,
        );

        // Hapus tick PNGs setelah segName selesai dibuat.
        for (const tf of tickFileNames) {
          try { await ffmpeg.deleteFile(tf); } catch { /* abaikan */ }
        }
        // Hapus baseFullName apapun kondisinya (needsExtend atau tidak) —
        // kalau needsExtend=true, baseFullName = seg_i_full.mp4 (sudah
        // berbeda dari segName). Kalau needsExtend=false, baseFullName =
        // baseName = seg_i_base.mp4 yang belum pernah dihapus di blok
        // sebelumnya (hanya masuk ke intermediateFiles cleanup yang sudah
        // terlanjur dipakai oleh baseName encode, bukan baseFullName).
        // Intinya: setelah segName ada, baseFullName tidak dipakai lagi.
        if (baseFullName !== segName) {
          try { await ffmpeg.deleteFile(baseFullName); } catch { /* abaikan */ }
        }
      } else if (needsExtend && baseName !== baseFullName) {
        // needsExtend tapi bukan needsPerSegmentFront: baseName (klip pendek)
        // sudah dihapus di atas, baseFullName = segName jadi tidak perlu hapus.
      }
    } catch (e) {
      throw new Error(
        `Gagal merender segmen "${slot.label}". (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
  }

  onProgress({
    stage: "combining",
    percent: 80,
    label: "Menggabungkan semua segmen…",
  });

  const concatList = segFiles.map((f) => `file '${f}'`).join("\n");
  try {
    await ffmpeg.writeFile("concat.txt", concatList);
    await execChecked(
      ffmpeg,
      [
        "-f", "concat",
        "-safe", "0",
        "-i", "concat.txt",
        "-c", "copy",
        "video_noaudio.mp4",
      ],
      "Gagal menggabungkan segmen video.",
      recentLogs,
    );
  } catch (e) {
    throw new Error(
      `Gagal menggabungkan segmen video. (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }

  // segFiles (seg_0.mp4, seg_1.mp4, dst) sudah ke-mux jadi video_noaudio.mp4
  // dan tidak dipakai lagi — hapus supaya FS ffmpeg.wasm nggak numpuk,
  // apalagi kalau slot-nya banyak (setiap seg_i.mp4 tetap menempati memory
  // MEMFS sampai sekarang, walau cuma dibaca sekali lewat concat.txt).
  for (const f of segFiles) {
    try { await ffmpeg.deleteFile(f); } catch { /* abaikan kalau sudah tidak ada */ }
  }

  let finalName = "video_noaudio.mp4";

  if (audioMedia) {
    onProgress({
      stage: "adding-audio",
      percent: 90,
      label: "Menambahkan musik latar…",
    });
    const ext = remappedAudioBlob ? "wav" : guessAudioExt(audioMedia.file, audioMedia.url);
    const audioName = `audio.${ext}`;
    // Blob URL dulu, File cuma fallback — sama alasannya kayak backgroundFileSrc.
    const source: File | string | Blob = remappedAudioBlob ?? audioMedia.url ?? audioMedia.file;
    try {
      await ffmpeg.writeFile(audioName, await fetchFileWithRetry(fetchFile, source));

      await execChecked(
        ffmpeg,
        [
          "-i", "video_noaudio.mp4",
          "-i", audioName,
          "-map", "0:v",
          "-map", "1:a",
          "-c:v", "copy",
          "-c:a", "aac",
          "-shortest",
          "-t", `${totalDurationForMux}`,
          "final.mp4",
        ],
        "Gagal menambahkan musik latar.",
        recentLogs,
      );
      finalName = "final.mp4";
    } catch (e) {
      throw new Error(
        `Gagal menambahkan musik latar. (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
  }

  onProgress({ stage: "done", percent: 100, label: "Selesai!" });

  let bytes: Uint8Array;
  try {
    bytes = (await ffmpeg.readFile(finalName)) as Uint8Array;
  } catch (e) {
    // Ini titik yang SEBELUMNYA tidak dibungkus try/catch — kalau
    // finalName gagal dibaca dari FS ffmpeg.wasm (mis. penulisan file
    // sebelumnya gagal diam-diam / FS kehabisan memori), errornya lolos
    // sebagai "FS error" mentah tanpa konteks. Sekarang dibungkus supaya
    // pesannya jelas & gampang di-debug.
    const logTail = recentLogs.slice(-5).join(" | ");
    throw new Error(
      `Gagal membaca hasil video akhir dari FFmpeg (kemungkinan FS ffmpeg.wasm kehabisan memori atau file "${finalName}" tidak berhasil ditulis). (${
        e instanceof Error ? e.message : String(e)
      })${logTail ? ` — log terakhir: ${logTail}` : ""}`,
    );
  }
  return new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
}
