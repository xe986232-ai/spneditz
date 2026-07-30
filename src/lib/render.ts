import type {
  Template,
  TemplateSlot,
  TemplateTextLayer,
  TemplateDurationLayer,
  TemplateProgressLayer,
} from "../types";

/** "0:15" -> 15, "1:05" -> 65 */
export function parseDurationSec(duration: string): number {
  const parts = duration.split(":").map((p) => parseInt(p, 10) || 0);
  if (parts.length === 1) return parts[0];
  const [min, sec] = parts;
  return min * 60 + sec;
}

export type SlotMediaEntry = {
  /** "sample" = masih pakai contoh dari internet, "file" = sudah diganti user */
  kind: "sample" | "file";
  /** URL yang dipakai untuk digambar di canvas (object URL kalau file) */
  url: string;
  file?: File;
};

export type SlotMediaState = Record<string, SlotMediaEntry | undefined>;

/** Isi awal slotMedia dari sampleSrc tiap slot template (kalau ada) */
export function initialSlotMedia(template: Template): SlotMediaState {
  const state: SlotMediaState = {};
  for (const slot of template.slots) {
    if (slot.sampleSrc) {
      state[slot.id] = { kind: "sample", url: slot.sampleSrc };
    }
  }
  return state;
}

export type LayerOpacityState = Record<string, number>;

/** Isi awal opacity tiap decorLayer dari template (default 100 kalau
 *  tidak diisi eksplisit di data template). */
export function initialLayerOpacity(template: Template): LayerOpacityState {
  const state: LayerOpacityState = {};
  for (const layer of template.decorLayers ?? []) {
    state[layer.id] = layer.opacity ?? 100;
  }
  return state;
}

/** Slot mana yang lagi aktif tampil di detik `t` (default selalu aktif kalau
 *  startSec/endSec tidak didefinisikan) */
export function isSlotActiveAt(slot: TemplateSlot, t: number): boolean {
  const start = slot.startSec ?? 0;
  const end = slot.endSec ?? Infinity;
  return t >= start && t < end;
}

/** Gambar rounded-rect path (dipakai buat clip foto di slot) */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Gambar image "cover" (isi penuh kotak tujuan, crop kelebihannya) */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** Sama seperti drawImageCover, tapi gambarnya digambar lebih besar dari
 *  kotak tujuan (di-zoom sejumlah `overscan` piksel di tiap sisi), bukan
 *  pas mepet ke tepi. Dipakai khusus buat background yang mau dikasih
 *  efek blur — soalnya kalau gambarnya mepet PAS ke tepi canvas, ctx
 *  filter blur() nyicip piksel di LUAR canvas (dianggap transparan/
 *  kosong) pas ngeblur area tepi, hasilnya keliatan gradasi warna gelap
 *  di pinggiran. Dengan overscan, tepi gambar yang "beneran" digeser
 *  keluar dari area yang kelihatan, jadi yang ke-sample pas blur tetap
 *  konten foto asli. */
export function drawImageCoverZoomed(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  overscan: number,
) {
  if (overscan <= 0) {
    drawImageCover(ctx, img, dx, dy, dw, dh);
    return;
  }
  drawImageCover(
    ctx,
    img,
    dx - overscan,
    dy - overscan,
    dw + overscan * 2,
    dh + overscan * 2,
  );
}

export type TextValueState = Record<string, string>;

/** Isi awal textValues dari defaultText tiap textLayer template (kalau ada) */
export function initialTextValues(template: Template): TextValueState {
  const state: TextValueState = {};
  for (const layer of template.textLayers ?? []) {
    state[layer.id] = layer.defaultText;
  }
  return state;
}

/** detik -> "0:15" / "1:05" — format menit:detik dua digit, dipakai buat
 *  label durasi berjalan & total. */
export function formatClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Gambar semua textLayers template (judul, artist, nama device, dst) di
 *  atas canvas, pakai nilai user dari `values` (fallback ke defaultText
 *  kalau belum ada/kosong). Dipanggil di render loop preview MAUPUN saat
 *  compositing untuk export, jadi hasilnya konsisten. */
export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  textLayers: TemplateTextLayer[],
  values: TextValueState,
) {
  for (const layer of textLayers) {
    const text = (values[layer.id] ?? layer.defaultText ?? "").trim();
    if (!text) continue;
    const x = (layer.x / 100) * canvasW;
    const y = (layer.y / 100) * canvasH;
    ctx.save();
    ctx.font = `${layer.fontWeight ?? 600} ${layer.fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = layer.color ?? "#FFFFFF";
    ctx.textAlign = layer.align ?? "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Gambar label durasi berjalan (kiri) & total (kanan) — SELALU dari
 *  currentSec/totalSec asli (audio), tidak pernah dari input user. */
export function drawDurationLayer(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  durationLayer: TemplateDurationLayer,
  currentSec: number,
  totalSec: number,
) {
  const color = durationLayer.color ?? "rgba(255,255,255,0.7)";
  const weight = durationLayer.fontWeight ?? 500;
  const font = `${weight} ${durationLayer.fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";

  ctx.textAlign = "left";
  ctx.fillText(
    formatClock(currentSec),
    (durationLayer.currentX / 100) * canvasW,
    (durationLayer.currentY / 100) * canvasH,
  );

  ctx.textAlign = "right";
  ctx.fillText(
    formatClock(totalSec),
    (durationLayer.totalX / 100) * canvasW,
    (durationLayer.totalY / 100) * canvasH,
  );
  ctx.restore();
}

/** Gambar isian putih di atas progressbar.png (track abu-abu statis) —
 *  panjangnya proporsional currentSec/totalSec, capsule/rounded ujungnya
 *  biar nyambung visual sama track aslinya. Kalau currentSec 0, nggak
 *  digambar apa2 (belum ada progress). */
export function drawProgressFill(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  progressLayer: TemplateProgressLayer,
  currentSec: number,
  totalSec: number,
) {
  const ratio = totalSec > 0 ? Math.min(1, Math.max(0, currentSec / totalSec)) : 0;
  if (ratio <= 0) return;

  const x1 = (progressLayer.x1 / 100) * canvasW;
  const x2 = (progressLayer.x2 / 100) * canvasW;
  const y = (progressLayer.y / 100) * canvasH;
  const h = progressLayer.thickness;
  const fullW = x2 - x1;
  // Minimal selebar tinggi-nya sendiri (biar ujung bulatnya kebentuk,
  // nggak kepotong pas progress-nya masih kecil banget).
  const w = Math.max(h, fullW * ratio);

  ctx.save();
  ctx.fillStyle = progressLayer.color ?? "#FFFFFF";
  roundRectPath(ctx, x1, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();
}

/** Mode "waveform berjalan" buat progress — GANTINYA drawProgressFill,
 *  BUKAN tambahan. Alih-alih garis isian polos, gambar deretan bar
 *  equalizer sepanjang track (posisi & lebar x1/x2/y persis sama kayak
 *  progressLayer, jadi reusable buat TEMPLATE MANAPUN yang punya
 *  progressLayer — tidak hardcode ke satu template doang). Bar yang
 *  sudah "dilewatin" playhead digambar terang (progressLayer.color),
 *  sisanya redup — jadi progress-nya "berjalan" menyusuri bentuk lagu
 *  asli, bukan cuma garis lurus.
 *
 *  `peaks` idealnya dari analyzeAudio(file) (lihat lib/waveform.ts) —
 *  kalau belum ada (audio belum diupload/masih dianalisis), boleh kirim
 *  array datar sebagai fallback (lihat FALLBACK_PEAKS di Editor.tsx). */
export function drawWaveformProgress(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  progressLayer: TemplateProgressLayer,
  currentSec: number,
  totalSec: number,
  peaks: number[],
) {
  if (!peaks.length) return;
  const ratio = totalSec > 0 ? Math.min(1, Math.max(0, currentSec / totalSec)) : 0;

  const x1 = (progressLayer.x1 / 100) * canvasW;
  const x2 = (progressLayer.x2 / 100) * canvasW;
  const y = (progressLayer.y / 100) * canvasH;
  const trackThickness = progressLayer.thickness;
  const fullW = x2 - x1;
  if (fullW <= 0) return;

  // Bar tipis & rapat (mirip equalizer), skala mengikuti thickness track
  // aslinya biar tetap proporsional di template manapun.
  const barW = Math.max(2, trackThickness * 0.55);
  const gap = Math.max(1, trackThickness * 0.35);
  const step = barW + gap;
  const barCount = Math.max(1, Math.floor(fullW / step));
  // Amplitudo maksimum bar (di atas & bawah garis tengah) — dibikin
  // beberapa kali lipat tebal track biar kelihatan kayak waveform
  // beneran, bukan cuma garis rata.
  const ampMax = Math.max(trackThickness * 7, canvasH * 0.018);
  const activeColor = progressLayer.color ?? "#FFFFFF";

  ctx.save();
  for (let i = 0; i < barCount; i++) {
    const t = barCount > 1 ? i / (barCount - 1) : 0;
    const peakIdx = Math.min(peaks.length - 1, Math.floor(t * peaks.length));
    const value = peaks[peakIdx] ?? 0.3;
    const barH = Math.max(trackThickness, value * ampMax);
    const x = x1 + i * step;
    const isPlayed = t <= ratio;

    ctx.globalAlpha = isPlayed ? 1 : 0.32;
    ctx.fillStyle = activeColor;
    roundRectPath(ctx, x, y - barH / 2, barW, barH, barW / 2);
    ctx.fill();
  }
  ctx.restore();
}



/** Baca durasi asli file/url audio (detik), dipakai supaya panjang video
 *  bisa otomatis ikut panjang lagu yang diupload user, bukan durasi
 *  template yang di-hardcode.
 *
 *  PENTING: dikasih `timeoutMs` (default 6 detik) karena event
 *  "loadedmetadata"/"error" TIDAK DIJAMIN selalu fire di semua browser
 *  untuk semua kombinasi codec/blob audio — kalau nggak ada timeout,
 *  promise ini bisa hang SELAMANYA dan bikin proses export freeze total
 *  di step ini tanpa pernah reject/resolve. */
export function getAudioDuration(
  source: File | string,
  timeoutMs = 6000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = new Audio();
    const objectUrl = source instanceof File ? URL.createObjectURL(source) : null;
    const srcUrl: string = objectUrl ?? (source as string);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timeout baca durasi audio (metadata tidak kunjung dimuat)"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      if (settled) return;
      settled = true;
      const d = el.duration;
      cleanup();
      if (isFinite(d) && d > 0) resolve(d);
      else reject(new Error("Durasi audio tidak valid"));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Gagal baca metadata audio"));
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("error", onError);
    el.preload = "metadata";
    el.src = srcUrl;
  });
}

/** Simple in-memory image loader + cache, dipakai render loop supaya
 *  nggak reload gambar yang sama tiap frame. */
export class ImageCache {
  private cache = new Map<string, HTMLImageElement>();
  private pending = new Set<string>();

  get(url: string, onLoaded: () => void): HTMLImageElement | null {
    const hit = this.cache.get(url);
    if (hit) return hit;
    if (!this.pending.has(url)) {
      this.pending.add(url);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.cache.set(url, img);
        this.pending.delete(url);
        onLoaded();
      };
      img.onerror = () => {
        this.pending.delete(url);
      };
      img.src = url;
    }
    return null;
  }
}
