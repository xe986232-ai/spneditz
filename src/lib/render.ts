import type {
  Template,
  TemplateSlot,
  TemplateTextLayer,
  TemplateDurationLayer,
  TemplateProgressLayer,
  TemplateSpectrumLayer,
} from "../types";

// --- Default blur background auto-sync (khusus template tertentu) ---
//
// Dipindah ke sini (dari Editor.tsx) supaya bisa dipakai bareng-bareng
// sama renderTemplateThumbnail (lib/thumbnail.ts) — sebelumnya cuma
// hidup di Editor.tsx, jadi thumbnail galeri nggak pernah tahu template
// V4/V5 defaultnya background-nya di-blur penuh, hasilnya thumbnail
// kelihatan tajam padahal isi template aslinya blur.

/** Batas max blur (px, dalam skala canvas asli 1080x1920). */
export const MAX_BACKGROUND_BLUR = 100;

/** Faktor overscan biar tepi gambar yang di-blur nggak kelihatan
 *  pudar/transparan di pinggir canvas (area blur "meluber" keluar). */
export const BACKGROUND_BLUR_OVERSCAN_FACTOR = 2;

/** Blur background default per template (px). Template v4 & v5 (klon v4)
 *  langsung full blur (100px) begitu dibuka/direset, template lain tetap
 *  0 (tajam). */
export function defaultBackgroundBlurFor(templateId: string): number {
  return templateId === "iphone-music-player-v4" ||
    templateId === "iphone-music-player-v5"
    ? 100
    : 0;
}

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

/** Sumber gambar yang bisa digambar ke canvas. ImageBitmap didukung selain
 *  HTMLImageElement supaya foto/video yang berasal dari File user bisa
 *  di-decode LANGSUNG (createImageBitmap(file)) tanpa lewat blob: URL +
 *  <img> — jalur itu kadang gagal sesaat di browser mobile/in-app browser
 *  (lihat loadDrawableSource di webcodecs-export.ts). */
export type DrawableImageSource = HTMLImageElement | ImageBitmap;

function drawableSize(img: DrawableImageSource): { w: number; h: number } {
  if (img instanceof HTMLImageElement) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  }
  return { w: img.width, h: img.height };
}

/** Gambar image "cover" (isi penuh kotak tujuan, crop kelebihannya) */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: DrawableImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const { w: iw, h: ih } = drawableSize(img);
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
  img: DrawableImageSource,
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

// --- Glow ambient di belakang foto sampul (khusus slot yang diflag
// `glowBehind: true`, misal cover di iPhone Music Player V5) ---
//
// Efeknya: foto sampul yang SAMA digambar ulang di belakang foto sampul
// yang tajam, tapi diperbesar sedikit (meleber keluar dari kotak cover
// aslinya) + diblur berat, jadi kelihatan kayak "cahaya"/halo lembut yang
// bocor dari balik cover — bukan shadow beneran, tapi lebih ke ambient
// glow ala Apple Music/Spotify.
const GLOW_EXTEND_RATIO = 0.16;
const GLOW_BLUR_PX = 60;
const GLOW_OPACITY = 0.85;
const GLOW_OVERSCAN_FACTOR = 1.5;

/** Gambar glow ambient blur di belakang sebuah slot foto (dipanggil SEBELUM
 *  foto sampul tajam digambar di atasnya, di posisi & radius yang sama
 *  tapi diperbesar). `img` boleh foto asli resolusi penuh (preview) atau
 *  bitmap yang sudah di-cover-crop ke ukuran slot (export) — dua-duanya
 *  aman dipakai karena drawImageCoverZoomed re-fit ulang otomatis. */
export function drawSlotGlow(
  ctx: CanvasRenderingContext2D,
  img: DrawableImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  radius: number,
) {
  const extendX = dw * GLOW_EXTEND_RATIO;
  const extendY = dh * GLOW_EXTEND_RATIO;
  const gx = dx - extendX;
  const gy = dy - extendY;
  const gw = dw + extendX * 2;
  const gh = dh + extendY * 2;
  const gRadius = radius + Math.min(extendX, extendY) * 0.6;
  const overscan = GLOW_BLUR_PX * GLOW_OVERSCAN_FACTOR;

  ctx.save();
  roundRectPath(ctx, gx, gy, gw, gh, gRadius);
  ctx.clip();
  ctx.filter = `blur(${GLOW_BLUR_PX}px)`;
  ctx.globalAlpha = GLOW_OPACITY;
  drawImageCoverZoomed(ctx, img, gx, gy, gw, gh, overscan);
  ctx.restore();
}

// --- Efek Glow (bloom) GLOBAL — beda dari drawSlotGlow di atas (yang
// cuma ambient di belakang satu foto sampul). Ini nempel di SELURUH isi
// canvas: background, foto/video slot, teks, decor layer, semuanya —
// makanya dipanggil PALING TERAKHIR, setelah semua layer lain selesai
// digambar (preview: akhir render loop Editor.tsx; export: tiap frame
// sebelum di-encode di webcodecs-export.ts). ---

/** Ambil "jepretan" isi canvas SEJAUH INI, lalu tempel ulang versi
 *  blur+terang di atasnya pakai blend "lighter" (additive) — area yang
 *  udah terang jadi "meleber" bercahaya, mirip efek bloom kamera/game,
 *  tanpa perlu tau apa isi tiap layer (murni post-process piksel). */
export function applyGlowBloom(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  intensity: number, // 0-100, 0 = mati (skip total, gratis)
) {
  if (intensity <= 0) return;
  const amount = Math.max(0, Math.min(100, intensity)) / 100;

  const snapshot = document.createElement("canvas");
  snapshot.width = canvasW;
  snapshot.height = canvasH;
  const sctx = snapshot.getContext("2d");
  if (!sctx) return;
  sctx.drawImage(ctx.canvas, 0, 0, canvasW, canvasH);

  ctx.save();
  // Blur & brightness naik seiring intensity — makin tinggi, cahaya
  // makin "meleber" lebar dan makin terang cahayanya.
  ctx.filter = `blur(${6 + amount * 22}px) brightness(${1.25 + amount * 1.35}) saturate(${1.05 + amount * 0.35})`;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22 + amount * 0.5;
  ctx.drawImage(snapshot, 0, 0, canvasW, canvasH);
  ctx.restore();
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

/** Gambar label durasi berjalan (kiri) & total/sisa (kanan) — SELALU dari
 *  currentSec/totalSec asli (audio), tidak pernah dari input user.
 *
 *  Teks kanan defaultnya nampilin TOTAL durasi (diam/statis, gak ikut
 *  gerak playhead). Kalau durationLayer.countdown = true, teks kanan
 *  diganti jadi SISA waktu (mundur turun tiap detik, format "-M:SS",
 *  nyampe "-0:00" pas lagu abis) — mirip gaya Apple Music/Spotify,
 *  bukan angka mati. */
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
  // currentWhole = detik BULAT yang lagi ditampilin kiri (formatClock
  // internal-nya juga Math.floor, disamain di sini biar konsisten satu
  // sumber angka yang sama).
  const currentWhole = Math.floor(Math.max(0, currentSec));
  ctx.fillText(
    formatClock(currentSec),
    (durationLayer.currentX / 100) * canvasW,
    (durationLayer.currentY / 100) * canvasH,
  );

  // PENTING soal sinkronisasi: sisa waktu DIHITUNG DARI SELISIH DUA
  // BILANGAN BULAT DETIK (totalWhole - currentWhole), BUKAN dari
  // Math.floor(totalSec - currentSec) langsung. totalSec biasanya
  // desimal (mis. 74.357, bukan pas 74.000) — kalau langsung
  // dikurangin lalu di-floor, titik "loncat" angka kanan jadi geser
  // beberapa ratus milidetik dari titik loncat angka kiri (yang
  // floor-nya dari currentSec doang), jadi kelihatan gak barengan pas
  // ganti detik. Dengan currentWhole yang SAMA PERSIS dipakai buat kiri
  // & kanan, keduanya dijamin ganti di momen yang sama persis.
  const totalWhole = Math.floor(Math.max(0, totalSec));
  const remaining = Math.max(0, totalWhole - currentWhole);
  const rightText = durationLayer.countdown
    ? `-${formatClock(remaining)}`
    : formatClock(totalSec);

  ctx.textAlign = "right";
  ctx.fillText(
    rightText,
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
 *  BUKAN tambahan. Bukan bentuk statis satu lagu penuh, tapi "JENDELA"
 *  beberapa detik di sekitar posisi lagu SEKARANG yang terus GESER ke
 *  kiri seiring currentSec naik (mirip tampilan waveform karaoke/DJ) —
 *  makanya kelihatan "berjalan"/mengalir terus, bukan diam. Posisi &
 *  lebar (x1/x2/y/thickness) persis sama kayak progressLayer, jadi
 *  reusable buat TEMPLATE MANAPUN yang punya progressLayer.
 *
 *  Digambar sebagai FUNGSI MURNI dari currentSec (bukan dari waktu asli/
 *  Date.now() atau state animasi terpisah) — supaya PERSIS SAMA hasilnya
 *  baik di preview (browser, tiap rAF) maupun export (di-render ulang
 *  frame-by-frame/tick-by-tick oleh kedua engine export). Kalau dipakai
 *  Date.now(), preview & hasil export bisa beda posisi bar-nya.
 *
 *  Bar di sisi KIRI dari titik tengah = sudah "kelewatan" (terang),
 *  sisi KANAN = belum diputar (redup) — playhead-nya selalu di TENGAH
 *  jendela (persis kayak DJ waveform bergerak, bukan playhead yang gerak
 *  di atas gambar diam).
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
  // Berapa detik "konteks" yang kelihatan melintang di jendela (setengah
  // di kiri/sudah lewat, setengah di kanan/belum) — makin kecil, makin
  // "zoom in" & makin cepat kelihatan geser-nya. Default 5 detik.
  windowSpanSec = 5,
) {
  if (!peaks.length || totalSec <= 0) return;

  const x1 = (progressLayer.x1 / 100) * canvasW;
  const x2 = (progressLayer.x2 / 100) * canvasW;
  const fullW = x2 - x1;
  if (fullW <= 0) return;

  // Ukuran visual bar waveform (lebar, jarak antar-bar, amplitudo) SENGAJA
  // TIDAK ikut skala dari progressLayer.thickness aslinya. thickness itu
  // dipakai buat mode "Standar" (track polos) biar pas sama tinggi asset
  // progressbar.png tiap template (beda2 per template: 10 di Template 1,
  // 19 di Template 2 & 3 biar nggak keliatan kurus). Tapi kalau dipakai
  // juga buat ngitung waveform, hasilnya jadi beda ukuran antar-template
  // (waveform di Template 2/3 jadi hampir 2x lebih gede/kasar daripada
  // Template 1) padahal lebar track-nya (x1..x2) mirip. Makanya di sini
  // dipakai SATU acuan tetap (REF_THICKNESS, disamain ke thickness
  // Template 1) supaya gaya waveform konsisten di template manapun,
  // nggak peduli berapa thickness track "Standar"-nya.
  const REF_THICKNESS = 10;

  // Bar tipis & rapat (mirip equalizer), skala dari acuan tetap di atas.
  const barW = Math.max(2, REF_THICKNESS * 0.55);
  const gap = Math.max(1, REF_THICKNESS * 0.35);
  const step = barW + gap;
  const barCount = Math.max(1, Math.floor(fullW / step));
  // Amplitudo maksimum bar (di atas & bawah garis tengah) — dibikin
  // beberapa kali lipat tebal track biar kelihatan kayak waveform
  // beneran, bukan cuma garis rata.
  const ampMax = Math.max(REF_THICKNESS * 7, canvasH * 0.018);
  // progressLayer.y itu posisi track TIPIS standar (mode "Standar") —
  // kalau dipakai apa adanya buat waveform, bar-nya jadi nyembul ke ATAS
  // *dan* ke BAWAH dari titik itu, jadi ujung bawahnya nabrak
  // durationLayer (label waktu) yang emang sengaja ditaruh tepat di
  // bawah track tipis itu. Makanya di mode waveform, titik tengahnya
  // digeser NAIK dikit (bukan penuh setengah amplitudo — itu kegedean,
  // jadi ketinggian & nabrak sampul) — cukup buat kasih jarak aman dari
  // durationLayer di bawahnya, sisanya biar tetap "di sela-sela" antara
  // sampul & label waktu, bukan nempel ke salah satunya.
  const y = (progressLayer.y / 100) * canvasH - ampMax * 0.35;
  const activeColor = progressLayer.color ?? "#FFFFFF";

  // Titik "sekarang" di dalam array peaks (peaks dianggap terbentang
  // rata di 0..totalSec, sama seperti asumsi drawProgressFill).
  const idxPerSec = peaks.length / totalSec;
  const centerIdx = currentSec * idxPerSec;
  const idxSpanVisible = windowSpanSec * idxPerSec;
  const idxStep = idxSpanVisible / barCount;

  ctx.save();
  for (let i = 0; i < barCount; i++) {
    // barTimeOffset < 0 -> di kiri titik tengah (sudah lewat/played),
    // > 0 -> di kanan (belum diputar). Playhead selalu persis di tengah.
    const barTimeOffset = (i - barCount / 2) * (windowSpanSec / barCount);
    // Rentang index sumber (peaks) yang "diwakili" bar visual ke-i ini —
    // BUKAN cuma satu titik yang di-Math.round() kayak sebelumnya (itu
    // yang bikin banyak bar tetangga kebagian nilai identik/patah2 kalau
    // datanya lebih jarang dari jumlah bar visual). Sekarang tiap bar
    // sample RENTANG-nya sendiri lewat sampleWaveformValue di bawah.
    //
    // PENTING: rentang di-CLAMP ke batas array (bukan di-skip ke nilai
    // flat 0.05 kayak sebelumnya) — soalnya pas lagu baru mulai/mau abis
    // (currentSec deket 0 atau deket totalSec), separuh jendela otomatis
    // "nunjuk" ke luar array. Kalau nunjuk ke luar dipaksa flat 0.05,
    // separuh bar jadi rata/pendek semua (kayak gaya "Standar") sementara
    // separuhnya lagi masih waveform beneran — keliatan kayak GABUNGAN 2
    // gaya (dobel). Dengan di-clamp ke ujung array terdekat, semua bar
    // tetap konsisten satu gaya waveform dari awal sampai akhir lagu.
    const idxStart = centerIdx - idxSpanVisible / 2 + i * idxStep;
    const idxEnd = idxStart + idxStep;
    const clampedStart = Math.max(0, Math.min(peaks.length - 1, idxStart));
    const clampedEnd = Math.max(clampedStart + 0.001, Math.min(peaks.length, idxEnd));
    const value = sampleWaveformValue(peaks, clampedStart, clampedEnd);
    const barH = Math.max(REF_THICKNESS, value * ampMax);
    const x = x1 + i * step;
    const isPlayed = barTimeOffset <= 0;

    ctx.globalAlpha = isPlayed ? 1 : 0.32;
    ctx.fillStyle = activeColor;
    roundRectPath(ctx, x, y - barH / 2, barW, barH, barW / 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Ambil nilai satu bar visual dari array data (peaks/bassPeaks) yang
 *  mewakili rentang index pecahan [idxStart, idxEnd) — dipakai
 *  drawWaveformProgress supaya HALUS di kedua arah:
 *
 *  - Kalau data LEBIH RAPAT dari kebutuhan bar (rentang < 1 index, kasus
 *    umum sekarang berkat BASS_POINTS_PER_SEC di waveform.ts): interpolasi
 *    linear antara 2 titik data terdekat di TENGAH rentang, jadi tiap bar
 *    tetangga dapat nilai yang beda dikit2 (ngalir), bukan sama persis
 *    lalu tiba2 loncat kayak Math.round() sebelumnya.
 *  - Kalau data LEBIH JARANG dari kebutuhan bar (rentang > 1 index, misal
 *    lagu sangat panjang / window di-zoom jauh): ambil nilai MAKSIMUM di
 *    rentang itu (bukan rata-rata) supaya transient/kick pendek tetap
 *    kebaca jelas, nggak "ketelen" jadi rata & lembek. */
function sampleWaveformValue(
  peaks: number[],
  idxStart: number,
  idxEnd: number,
): number {
  const span = Math.max(idxEnd - idxStart, 0.0001);

  if (span <= 1) {
    const mid = (idxStart + idxEnd) / 2;
    const lo = Math.floor(mid);
    const hi = lo + 1;
    const frac = mid - lo;
    const vLo = lo >= 0 && lo < peaks.length ? (peaks[lo] ?? 0) : 0;
    const vHi = hi >= 0 && hi < peaks.length ? (peaks[hi] ?? 0) : 0;
    return vLo + (vHi - vLo) * frac;
  }

  let maxVal = 0;
  const start = Math.max(0, Math.floor(idxStart));
  const end = Math.min(peaks.length - 1, Math.ceil(idxEnd));
  for (let idx = start; idx <= end; idx++) {
    const v = peaks[idx] ?? 0;
    if (v > maxVal) maxVal = v;
  }
  return maxVal;
}

/** Ikon spectrum/equalizer kecil (indikator "lagu lagi diputar", biasanya
 *  ditaruh nempel di sebelah judul) — beberapa batang pendek yang
 *  tingginya ngikutin energi audio ASLI (bassPeaks) di SEKITAR
 *  currentSec. BEDA dari drawWaveformProgress: itu representasi
 *  rentang/jendela lagu di sepanjang track progress, ini cuma indikator
 *  kecil di posisi sendiri (independen dari progressLayer) yang SELALU
 *  jalan otomatis, terlepas dari gaya progress "Standar"/"Waveform
 *  berjalan" dipilih atau tidak.
 *
 *  Tiap batang sengaja "mengintip" titik waktu yang beda-beda dikit
 *  (phase offset kecil, lihat PHASE_OFFSETS_SEC) supaya gerakannya
 *  kelihatan kayak beberapa band frekuensi independen (mirip equalizer
 *  asli/Now Playing indicator iOS), bukan cuma satu nilai energi yang
 *  digandakan rata ke semua batang.
 *
 *  Fungsi MURNI dari currentSec (bukan Date.now()) — sama prinsipnya
 *  kayak drawWaveformProgress — supaya preview & hasil export identik
 *  frame demi frame, bukan random/berbeda tiap render. */
export function drawSpectrumIndicator(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  spectrumLayer: TemplateSpectrumLayer,
  currentSec: number,
  totalSec: number,
  peaks: number[],
) {
  if (!peaks.length || totalSec <= 0) return;

  const barCount = Math.max(1, spectrumLayer.barCount ?? 4);
  const barW = spectrumLayer.barWidth ?? 6;
  const gap = spectrumLayer.gap ?? 5;
  const maxH = spectrumLayer.maxHeight ?? 26;
  const minH = spectrumLayer.minHeight ?? 6;
  const color = spectrumLayer.color ?? "#FFFFFF";

  const cx = (spectrumLayer.x / 100) * canvasW;
  const cy = (spectrumLayer.y / 100) * canvasH;
  const totalW = barCount * barW + (barCount - 1) * gap;
  const startX = cx - totalW / 2;

  const idxPerSec = peaks.length / totalSec;

  // Phase offset kecil per-batang (detik) — tiap batang "mengintip" titik
  // waktu yang beda dikit di sekitar currentSec, jadi gerakannya gak
  // sinkron sempurna (tiap "band" punya dinamika sendiri) — bukan cuma
  // satu nilai energi yang digandakan ke semua batang. Dipilih manual
  // (tidak simetris/berpola jelas) biar variasinya terasa natural.
  const PHASE_OFFSETS_SEC = [-0.09, 0.05, -0.02, 0.11, -0.14, 0.08];
  // "Bobot" tiap batang — nyimulasiin band frekuensi beda sensitivitas
  // (biar nggak semua batang naik-turun sama persis/monoton).
  const WEIGHTS = [0.75, 1, 0.85, 0.6, 0.9, 0.7];

  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < barCount; i++) {
    const phase = PHASE_OFFSETS_SEC[i % PHASE_OFFSETS_SEC.length];
    const weight = WEIGHTS[i % WEIGHTS.length];
    const sampleSec = Math.max(0, Math.min(totalSec, currentSec + phase));
    const idx = sampleSec * idxPerSec;
    const idxStart = Math.max(0, idx - idxPerSec * 0.05);
    const idxEnd = Math.min(peaks.length, idx + idxPerSec * 0.05);
    const value = sampleWaveformValue(
      peaks,
      idxStart,
      Math.max(idxStart + 0.001, idxEnd),
    );
    const barH = minH + Math.min(1, value * weight) * (maxH - minH);
    const x = startX + i * (barW + gap);
    roundRectPath(ctx, x, cy - barH / 2, barW, barH, barW / 2);
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
      if (/^https?:\/\//i.test(url)) {
        img.crossOrigin = "anonymous";
      }
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
