import type { Template } from "../types";
import {
  drawImageCover,
  drawImageCoverZoomed,
  drawProgressFill,
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
 */
export async function renderTemplateThumbnail(
  template: Template,
  atSec?: number,
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

  // 4) decorLayers "front" (ikon, progress bar track, kontrol)
  for (const layer of decorLayers.filter((l) => l.order === "front")) {
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
    drawProgressFill(ctx, canvasW, canvasH, template.progressLayer, currentSec, DURATION);
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}
