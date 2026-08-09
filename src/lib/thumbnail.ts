import type { Template } from "../types";
import {
  drawImageCover,
  drawImageCoverZoomed,
  drawProgressFill,
  drawWaveformProgress,
  drawDurationLayer,
  drawTextLayers,
  roundRectPath,
  isSlotActiveAt,
  parseDurationSec,
  initialTextValues,
  type DrawableImageSource,
} from "./render";
import {
  drawLiquidGlassCard,
  resolveLiquidGlassRectPx,
  DEFAULT_LIQUID_GLASS_SETTINGS,
} from "./liquidGlass";
import { fetchCoverImagesOnce } from "./coverImages";

/** Loader gambar berbasis Promise (beda dari ImageCache yang berbasis
 *  callback di render loop React) — pas dipakai buat render sekali jalan
 *  kayak gini, lebih gampang tinggal `await` semuanya bareng-bareng. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal load gambar: ${src}`));
    img.src = src;
  });
}

/** Peaks palsu buat mode waveform di thumbnail statis — bukan flat rata
 *  kayak FALLBACK_PEAKS di Editor (itu sengaja polos karena representasi
 *  "belum ada audio"), di sini sengaja dibikin naik-turun (gelombang sinus
 *  + sedikit variasi) biar potongan thumbnail-nya kelihatan seperti
 *  waveform beneran, bukan garis rata membosankan. Nilainya deterministik
 *  (bukan Math.random()) biar thumbnail yang di-cache konsisten tiap reload
 *  & tidak "berkedip" beda pola tiap kali komponen re-render.
 */
function fakeWaveformPeaks(count = 200): number[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 0.35 + 0.3 * Math.sin(i * 0.35) + 0.18 * Math.sin(i * 0.9 + 1.3);
    const wobble = 0.12 * Math.sin(i * 2.7);
    return Math.min(1, Math.max(0.12, base + wobble));
  });
}

/** Render SATU frame template (di detik `atSec`) ke canvas baru yang
 *  BERDIRI SENDIRI (bukan canvas Editor yang lagi kepake user), lalu
 *  balikin sebagai data URL JPEG — dipakai buat thumbnail kartu galeri
 *  (TemplateGallery), supaya thumbnail-nya beneran "jepretan" dari hasil
 *  render animasi template (background, card player, foto sampul contoh,
 *  progress bar & teks default), sama persis kayak yang bakal muncul pas
 *  export — bukan lagi gambar preview.jpg statis yang di-upload manual.
 *
 *  Pakai sampleSrc slot (foto contoh bawaan template) & defaultText
 *  textLayers, karena thumbnail galeri digambar SEBELUM user upload
 *  apa pun.
 *
 *  `progressStyle` menentukan gaya progress yang di-screenshot: "bar"
 *  (track abu-abu + isian putih polos, default, sama seperti sebelumnya)
 *  atau "waveform" (bar equalizer "berjalan", dipakai buat potongan bawah
 *  thumbnail kolase "2 Gaya Progress" di TemplateGallery) — supaya kedua
 *  potongan kolase itu adalah hasil jepretan CANVAS SUNGGUHAN, bukan cuma
 *  foto sampul mentah.
 *
 *  `cropYRange` opsional: [start, end] dalam FRAKSI tinggi canvas (0–1),
 *  dipakai buat "zoom-crop" hasil render sebelum di-export jadi JPEG —
 *  cuma ambil jendela vertikal itu terus di-stretch penuh ke ukuran
 *  canvas asli. Dipakai khusus sama thumbnail kolase: progress bar/
 *  waveform template ini letaknya di bagian BAWAH canvas (~67%), jadi
 *  potongan diagonal kolase yang cuma nunjukin ~separuh atas canvas
 *  nggak pernah kebagian elemen progress-nya sama sekali. Dengan crop
 *  ini, jendela yang di-render sengaja digeser turun (misal 6%–75%)
 *  biar cover + teks + progress bar/waveform-nya SAMA-SAMA kelihatan
 *  di kedua potongan kolase, bukan cuma di potongan bawah doang.
 */
export async function renderTemplateThumbnail(
  template: Template,
  atSec?: number,
  progressStyle: "bar" | "waveform" = "bar",
  cropYRange?: [number, number],
): Promise<string> {
  const canvasW = template.canvasWidth ?? 1080;
  const canvasH = template.canvasHeight ?? 1920;
  const DURATION = parseDurationSec(template.duration);
  // Default: ambil frame di ~40% durasi — bukan detik 0 (kondisi "kosong"/
  // belum jalan) & bukan juga paling akhir, biar progress bar & posisi
  // waveform kelihatan "lagi jalan", mirip satu frame tengah animasi.
  const currentSec = atSec ?? DURATION * 0.4;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context tidak tersedia");

  // Slot foto sampul template ini (kalau ada) — foto yang dipakai di sini
  // HARUS sama sumbernya dengan yang bakal user lihat pas beneran buka
  // Editor: random dari Firebase/Unsplash (config/coverImages/{id}),
  // fallback ke sampleSrc lokal cuma kalau daftar itu kosong/gagal
  // diambil. Satu foto yang sama dipakai buat DUA tempat (background &
  // slot sampul), sama seperti auto-sync customBackground di Editor.tsx,
  // biar thumbnail galeri gak "beda sistem" sama isi timeline aslinya.
  const coverSlot = template.slots.find((s) => s.type === "image");
  let coverImageSrc: string | undefined = coverSlot?.sampleSrc;
  if (coverSlot) {
    try {
      const covers = await fetchCoverImagesOnce(template.id);
      if (covers.length > 0) {
        const picked = covers[Math.floor(Math.random() * covers.length)];
        coverImageSrc = picked.url;
      }
    } catch {
      // Gagal ambil daftar Firebase/Unsplash — tetap lanjut pakai
      // sampleSrc lokal (sudah di-assign di atas) sebagai fallback.
    }
  }

  // Kumpulin semua src gambar yang perlu di-load: background/cover,
  // decorLayer (yang bukan liquidGlass live), & sampleSrc slot LAIN
  // (kalau ada slot foto/video selain slot sampul).
  const decorLayers = template.decorLayers ?? [];
  const staticDecorSrcs = decorLayers
    .filter((l) => !l.liquidGlass)
    .map((l) => l.assetSrc);
  const otherSlotSampleSrcs = template.slots
    .filter((s) => s.type !== "audio" && s.id !== coverSlot?.id && s.sampleSrc)
    .map((s) => s.sampleSrc!);
  const allSrcs = Array.from(
    new Set(
      [
        template.baseAssetSrc,
        coverImageSrc,
        ...staticDecorSrcs,
        ...otherSlotSampleSrcs,
      ].filter((s): s is string => Boolean(s)),
    ),
  );
  const loaded = await Promise.all(allSrcs.map((src) => loadImage(src)));
  const imageBySrc = new Map<string, DrawableImageSource>();
  allSrcs.forEach((src, i) => imageBySrc.set(src, loaded[i]));

  ctx.clearRect(0, 0, canvasW, canvasH);

  // 1) Background — SAMA kayak default state Editor.tsx: begitu template
  // punya slot foto sampul, foto itu (sekarang random dari Firebase/
  // Unsplash, sama seperti di atas) OTOMATIS jadi background juga (lihat
  // `customBackground` di Editor.tsx, di-init dari initialSlotMedia).
  // Jadi thumbnail nggak pakai baseAssetSrc/bg.jpg statis.
  const backgroundSrc = coverImageSrc ?? template.baseAssetSrc;
  if (backgroundSrc) {
    const bg = imageBySrc.get(backgroundSrc);
    if (bg) drawImageCoverZoomed(ctx, bg, 0, 0, canvasW, canvasH, 0);
  }

  // 2) decorLayers "back" (Card Player, termasuk versi liquid glass live)
  for (const layer of decorLayers.filter((l) => l.order === "back")) {
    const opacity = (layer.opacity ?? 100) / 100;
    if (opacity <= 0) continue;
    if (layer.liquidGlass) {
      const rect = resolveLiquidGlassRectPx(layer.liquidGlass, canvasW, canvasH);
      drawLiquidGlassCard(
        ctx,
        canvas,
        rect,
        `glass-thumb-${template.id}-${layer.id}`,
        { ...DEFAULT_LIQUID_GLASS_SETTINGS, ...layer.liquidGlass.settings },
        opacity,
      );
      continue;
    }
    const img = imageBySrc.get(layer.assetSrc);
    if (!img) continue;
    ctx.save();
    ctx.globalAlpha = opacity;
    drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  // 3) Slot foto/video — slot sampul pakai coverImageSrc (random Firebase/
  // Unsplash, sama kayak background di atas), slot lain (kalau ada) pakai
  // sampleSrc masing-masing.
  for (const slot of template.slots) {
    if (slot.type === "audio") continue;
    if (slot.x == null || slot.y == null || slot.width == null || slot.height == null)
      continue;
    if (!isSlotActiveAt(slot, currentSec)) continue;
    const src = slot.id === coverSlot?.id ? coverImageSrc : slot.sampleSrc;
    if (!src) continue;
    const img = imageBySrc.get(src);
    if (!img) continue;
    const dx = (slot.x / 100) * canvasW;
    const dy = (slot.y / 100) * canvasH;
    const dw = (slot.width / 100) * canvasW;
    const dh = (slot.height / 100) * canvasH;
    ctx.save();
    roundRectPath(ctx, dx, dy, dw, dh, slot.radius ?? 16);
    ctx.clip();
    drawImageCover(ctx, img, dx, dy, dw, dh);
    ctx.restore();
  }

  // 4) decorLayers "front" (ikon, progress bar track, kontrol) — track
  // progressbar.png statis disembunyikan di mode "waveform" (sama seperti
  // di Editor.tsx), karena drawWaveformProgress gambar bar-nya dari nol,
  // bukan cuma isian di atas track itu.
  for (const layer of decorLayers.filter(
    (l) => l.order === "front" && !(progressStyle === "waveform" && l.hideInWaveformMode),
  )) {
    const img = imageBySrc.get(layer.assetSrc);
    if (!img) continue;
    const opacity = (layer.opacity ?? 100) / 100;
    if (opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = opacity;
    drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  // 5) Teks default (judul/artist/device)
  if (template.textLayers?.length) {
    drawTextLayers(ctx, canvasW, canvasH, template.textLayers, initialTextValues(template));
  }

  // 6) Label durasi & isian progress bar, di detik `currentSec`
  if (template.durationLayer) {
    drawDurationLayer(ctx, canvasW, canvasH, template.durationLayer, currentSec, DURATION);
  }
  if (template.progressLayer) {
    if (progressStyle === "waveform") {
      drawWaveformProgress(
        ctx,
        canvasW,
        canvasH,
        template.progressLayer,
        currentSec,
        DURATION,
        fakeWaveformPeaks(),
      );
    } else {
      drawProgressFill(ctx, canvasW, canvasH, template.progressLayer, currentSec, DURATION);
    }
  }

  // Tanpa cropYRange: langsung export full canvas kayak sebelumnya.
  if (!cropYRange) {
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  // Dengan cropYRange: ambil jendela vertikal itu dari canvas full-res di
  // atas, lalu "stretch" ke canvas baru berukuran sama (canvasW x canvasH)
  // — hasilnya versi zoom-in yang cover + progress bar/waveform-nya
  // kepotong pas di frame, bukan ketinggalan di luar area yang di-crop.
  const [cropStart, cropEnd] = cropYRange;
  const sy = Math.max(0, cropStart) * canvasH;
  const sh = Math.max(1, (Math.min(1, cropEnd) - Math.max(0, cropStart)) * canvasH);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = canvasW;
  cropCanvas.height = canvasH;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) throw new Error("Canvas 2D context tidak tersedia (crop)");
  cropCtx.drawImage(canvas, 0, sy, canvasW, sh, 0, 0, canvasW, canvasH);

  return cropCanvas.toDataURL("image/jpeg", 0.9);
}
