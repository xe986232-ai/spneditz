import type {
  LyricsAnimMode,
  LyricsLoopBehavior,
  LyricsStaggerOrder,
  TemplateLyricsTextLayer,
} from "../types";

// Engine animasi teks "Lyrics" — port 1:1 dari prototype standalone
// "Text Animation Tool Pro" (buildLettersForText/getCalculatedTimeline/
// renderFrame di file HTML referensi), disesuaikan supaya:
//  1) Cocok dipanggil dari canvas (bukan DOM/CSS transform).
//  2) Jadi FUNGSI MURNI dari waktu (currentSec) + index unit — TIDAK ada
//     Math.random()/Date.now() di jalur render, biar preview & hasil
//     export identik frame demi frame (sama seperti drawWaveformProgress
//     & drawSpectrumIndicator di lib/render.ts). Random asli di prototype
//     (staggerOrder "random" & loop "jitter") diganti seededRandom()
//     berbasis index, jadi hasilnya tetap "acak" tapi tetap deterministik.

/** Font yang tersedia untuk layer Lyrics — HARUS sudah di-load sebagai
 *  webfont (lihat <link> Google Fonts di index.html) sebelum dipakai di
 *  canvas, kalau tidak fillText fallback ke font sistem. */
export const LYRICS_FONTS = [
  "Mulish",
  "Poppins",
  "Rubik",
  "Barlow",
  "Archivo Black",
  "Lexend",
] as const;

/* ==========================================================================
   RANDOM DETERMINISTIK (bukan Math.random()) — supaya "acak" tapi tetap
   fungsi murni dari input (index/waktu), stabil tiap kali di-render ulang.
   ========================================================================== */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/* ==========================================================================
   EASING FUNCTIONS — sama persis dengan prototype referensi.
   ========================================================================== */
export const LyricsEasings = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => t * (2 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  backIn: (t: number) => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
  backOut: (t: number) => {
    const s = 1.70158;
    const u = t - 1;
    return u * u * ((s + 1) * u + s) + 1;
  },
  elasticOut: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  bounceOut: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) {
      const u = t - 1.5 / d1;
      return n1 * u * u + 0.75;
    }
    if (t < 2.5 / d1) {
      const u = t - 2.25 / d1;
      return n1 * u * u + 0.9375;
    }
    const u = t - 2.625 / d1;
    return n1 * u * u + 0.984375;
  },
  bounceIn: (t: number) => 1 - LyricsEasings.bounceOut(1 - t),
};

/** Nama preset yang baru ditambahin (dipakai UI buat nampilin label "NEW"
 *  di chip-nya — lihat LyricsChipRow di Editor.tsx). Preset lama TIDAK ada
 *  di sini, jadi gak kebadge. */
export const NEW_LYRICS_PRESET_KEYS = {
  IN: [
    "flipIn", "dropIn", "zoomSpinIn", "diagonalIn", "expandIn",
    "flipX3DIn", "flipY3DIn", "perspectiveIn", "cubeSpinIn", "depthEmergeIn",
  ],
  LOOP: [
    "orbit", "wobble", "flicker", "drift", "heartbeat",
    "tumble3D", "spin3D", "pendulum3D", "floatDepth3D", "rockTilt3D",
  ],
  OUT: [
    "flipOut", "dropOut", "zoomSpinOut", "diagonalOut", "shrinkOut",
    "flipX3DOut", "flipY3DOut", "perspectiveOut", "cubeSpinOut", "depthRecedeOut",
  ],
} as const;

/** Hasil satu preset animasi untuk satu unit huruf/kata di satu momen —
 *  semuanya opsional/additive terhadap transformState default (identity). */
export interface LyricsPresetResult {
  x?: number;
  y?: number;
  scale?: number;
  /** Skala horizontal/vertikal TERPISAH dari `scale` (opsional) — dipakai
   *  buat efek "3D" (card-flip): pas nilainya turun ke 0 lalu naik lagi,
   *  kesannya kayak teks muter di sumbu Y (scaleX) atau sumbu X (scaleY),
   *  meniru rotasi 3D walau canvas 2D beneran cuma nge-scale lebar/tinggi
   *  teksnya. Fallback ke `scale` kalau tidak diisi. */
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  opacity?: number;
  blur?: number;
}

type PresetFn = (progress: number, unitIndex: number) => LyricsPresetResult;

/* ==========================================================================
   ANIMATION PRESETS — sama persis dengan prototype referensi (nama key
   dipakai langsung sebagai inStyle/loopStyle/outStyle di data template).
   LOOP "jitter" diganti seededRandom (bukan Math.random()) biar deterministik.
   ========================================================================== */
export const LyricsAnimationPresets: {
  IN: Record<string, PresetFn>;
  LOOP: Record<string, PresetFn>;
  OUT: Record<string, PresetFn>;
} = {
  IN: {
    none: () => ({}),
    fade: (p) => ({ opacity: p }),
    slideUp: (p) => ({ opacity: p, y: (1 - p) * 60 }),
    slideDown: (p) => ({ opacity: p, y: (1 - p) * -60 }),
    slideLeft: (p) => ({ opacity: p, x: (1 - p) * 80 }),
    slideRight: (p) => ({ opacity: p, x: (1 - p) * -80 }),
    scale: (p) => ({ opacity: p, scale: p }),
    pop: (p) => ({ opacity: p, scale: p }),
    rotate: (p) => ({ opacity: p, rotate: (1 - p) * -90 }),
    blur: (p) => ({ opacity: p, blur: (1 - p) * 20 }),
    bounce: (p) => ({ opacity: p, y: (1 - p) * -80 }),
    flipIn: (p) => ({ opacity: p, rotate: (1 - p) * 180, scale: 0.5 + p * 0.5 }),
    dropIn: (p) => ({ opacity: p, y: (1 - p) * -140 }),
    zoomSpinIn: (p) => ({ opacity: p, scale: 0.3 + p * 0.7, rotate: (1 - p) * -180 }),
    diagonalIn: (p) => ({ opacity: p, x: (1 - p) * 60, y: (1 - p) * 60 }),
    expandIn: (p) => ({ opacity: p, scale: 1.8 - p * 0.8 }),
    flipX3DIn: (p) => {
      const ang = (1 - p) * (Math.PI / 2);
      const sx = Math.cos(ang);
      return { opacity: p, scaleX: sx, blur: (1 - Math.abs(sx)) * 3 };
    },
    flipY3DIn: (p) => {
      const ang = (1 - p) * (Math.PI / 2);
      const sy = Math.cos(ang);
      return { opacity: p, scaleY: sy, blur: (1 - Math.abs(sy)) * 3 };
    },
    perspectiveIn: (p) => ({ opacity: p, y: (1 - p) * 40, scale: 0.6 + p * 0.4, rotate: (1 - p) * 12 }),
    cubeSpinIn: (p) => {
      const ang = (1 - p) * Math.PI;
      return { opacity: p, scaleX: Math.cos(ang), x: (1 - p) * -50 };
    },
    depthEmergeIn: (p) => ({ opacity: p, scale: 0.15 + p * 0.85, blur: (1 - p) * 12, y: (1 - p) * 20 }),
  },
  LOOP: {
    none: () => ({}),
    floating: (p) => ({ y: Math.sin(p * Math.PI * 2) * 12 }),
    pulse: (p) => ({ scale: 1 + Math.sin(p * Math.PI * 2) * 0.1 }),
    breathing: (p) => ({ opacity: 0.6 + (Math.sin(p * Math.PI * 2) + 1) * 0.2 }),
    shake: (p) => ({ x: Math.sin(p * Math.PI * 8) * 6 }),
    sway: (p) => ({ rotate: Math.sin(p * Math.PI * 2) * 10 }),
    bounce: (p) => ({ y: -Math.abs(Math.sin(p * Math.PI * 2)) * 16 }),
    wave: (p, i) => ({ y: Math.sin(p * Math.PI * 2 + i * 0.5) * 10 }),
    zoom: (p) => ({ scale: 0.95 + Math.sin(p * Math.PI * 2) * 0.1 }),
    jitter: (p, i) => {
      // Ganti 20x per siklus (bukan tiap frame) biar kelihatan "jitter"
      // patah-patah kayak aslinya, tapi tetap deterministik (murni dari
      // p & index unit, bukan Math.random()).
      const cell = Math.floor(p * 20);
      return {
        x: (seededRandom(i * 1000 + cell) - 0.5) * 4,
        y: (seededRandom(i * 1000 + cell + 500) - 0.5) * 4,
      };
    },
    glowPulse: (p) => ({ blur: (Math.sin(p * Math.PI * 2) + 1) * 4 }),
    orbit: (p) => ({ x: Math.cos(p * Math.PI * 2) * 8, y: Math.sin(p * Math.PI * 2) * 8 }),
    wobble: (p) => ({ rotate: Math.sin(p * Math.PI * 4) * 5, x: Math.sin(p * Math.PI * 4) * 3 }),
    flicker: (p) => ({ opacity: 0.5 + Math.abs(Math.sin(p * Math.PI * 6)) * 0.5 }),
    drift: (p) => ({ x: Math.sin(p * Math.PI * 2) * 14, y: Math.cos(p * Math.PI * 2) * 6 }),
    heartbeat: (p) => ({ scale: 1 + Math.pow(Math.sin(p * Math.PI * 2), 4) * 0.15 }),
    tumble3D: (p) => ({ scaleY: 1 - Math.abs(Math.sin(p * Math.PI * 2)) * 0.15 }),
    spin3D: (p) => {
      const sx = Math.abs(Math.cos(p * Math.PI * 2));
      return { scaleX: 0.25 + sx * 0.75, blur: (1 - sx) * 2 };
    },
    pendulum3D: (p) => ({
      rotate: Math.sin(p * Math.PI * 2) * 8,
      y: Math.abs(Math.sin(p * Math.PI * 2)) * 4,
      scale: 1 - Math.abs(Math.sin(p * Math.PI * 2)) * 0.03,
    }),
    floatDepth3D: (p) => ({
      scale: 1 + Math.sin(p * Math.PI * 2) * 0.06,
      blur: (Math.sin(p * Math.PI * 2) + 1) * 1.5,
      y: Math.sin(p * Math.PI * 2) * 6,
    }),
    rockTilt3D: (p) => ({
      rotate: Math.sin(p * Math.PI * 2) * 6,
      scaleX: 1 - Math.abs(Math.sin(p * Math.PI * 2)) * 0.08,
    }),
  },
  OUT: {
    none: () => ({}),
    fade: (p) => ({ opacity: 1 - p }),
    slideDown: (p) => ({ opacity: 1 - p, y: p * 60 }),
    slideUp: (p) => ({ opacity: 1 - p, y: p * -60 }),
    slideRight: (p) => ({ opacity: 1 - p, x: p * 80 }),
    slideLeft: (p) => ({ opacity: 1 - p, x: p * -80 }),
    scale: (p) => ({ opacity: 1 - p, scale: 1 - p }),
    pop: (p) => ({ opacity: 1 - p, scale: 1 - p }),
    rotate: (p) => ({ opacity: 1 - p, rotate: p * 90 }),
    blur: (p) => ({ opacity: 1 - p, blur: p * 20 }),
    bounce: (p) => ({ opacity: 1 - p, y: p * 80 }),
    flipOut: (p) => ({ opacity: 1 - p, rotate: p * 180, scale: 1 - p * 0.5 }),
    dropOut: (p) => ({ opacity: 1 - p, y: p * 140 }),
    zoomSpinOut: (p) => ({ opacity: 1 - p, scale: 1 - p * 0.7, rotate: p * 180 }),
    diagonalOut: (p) => ({ opacity: 1 - p, x: p * 60, y: p * 60 }),
    shrinkOut: (p) => ({ opacity: 1 - p, scale: 1 - p * 0.8 }),
    flipX3DOut: (p) => {
      const ang = p * (Math.PI / 2);
      const sx = Math.cos(ang);
      return { opacity: 1 - p, scaleX: sx, blur: (1 - Math.abs(sx)) * 3 };
    },
    flipY3DOut: (p) => {
      const ang = p * (Math.PI / 2);
      const sy = Math.cos(ang);
      return { opacity: 1 - p, scaleY: sy, blur: (1 - Math.abs(sy)) * 3 };
    },
    perspectiveOut: (p) => ({ opacity: 1 - p, y: p * 40, scale: 1 - p * 0.4, rotate: p * 12 }),
    cubeSpinOut: (p) => {
      const ang = p * Math.PI;
      return { opacity: 1 - p, scaleX: Math.cos(ang), x: p * 50 };
    },
    depthRecedeOut: (p) => ({ opacity: 1 - p, scale: 1 - p * 0.85, blur: p * 12, y: p * 20 }),
  },
};

/** Siklus osilasi tetap (detik) untuk preset LOOP — beda dari durasi
 *  SEGMEN loop di timeline (yang derived dari sisa panjang klip, lihat
 *  getLyricsTimeline). Ini cuma "seberapa cepat" animasi loop-nya
 *  berulang (mis. floating naik-turun tiap 2 detik), independen dari
 *  berapa lama klip lirik ini tampil. */
export const LOOP_CYCLE_SEC = 2.0;

/** Batas bawah faktor skala IN/OUT/stagger pas klip dipendekin (lihat
 *  getLyricsTimeline). 0.5 = animasi paling cepat cuma 2x dari kecepatan
 *  normalnya, TIDAK PERNAH lebih cepat dari itu — walau klip di-drag,
 *  di-cut, atau diubah lewat jalur mana pun sampai jauh lebih pendek dari
 *  (inTotal + outTotal) bawaan. Ini SUMBER KEBENARAN TUNGGAL buat batas
 *  ini (dipakai juga di Editor.tsx lewat handleLyricsClipStretchStart &
 *  handleCutLyricsClip) — sebelum ada floor ini, getLyricsTimeline bakal
 *  terus mempercepat animasi TANPA BATAS begitu klip makin pendek (biar
 *  OUT nggak kepotong), jadi klip yang di-mentok-in ke
 *  MIN_LYRICS_CLIP_DURATION bisa bikin teks yang stagger-nya lumayan
 *  (banyak huruf/kata) jadi animasinya super ngebut/kedip doang.
 *  Trade-off: kalau klip SANGAT pendek (di bawah floor ini) DAN caller-nya
 *  gak ikut mengklem panjang klip duluan (lihat comfortableMin di
 *  Editor.tsx), animasi OUT bisa kepotong dikit di ujung — tapi itu jauh
 *  lebih baik daripada animasi yang jadi nggak kelihatan sama sekali
 *  karena keburu instan. */
export const LYRICS_MIN_SPEED_SCALE = 0.5;

/* ==========================================================================
   UNIT SPLITTER — pecah teks jadi huruf/kata/utuh, sama persis dengan
   buildLettersForText di prototype (spasi -> non-breaking space, kata
   diselipkan nbsp di antaranya biar nggak ke-collapse pas diukur).
   ========================================================================== */
export interface LyricsUnit {
  text: string;
  line: "top" | "bottom";
}

export function buildLyricsUnits(
  topText: string,
  bottomText: string,
  animMode: LyricsAnimMode,
): LyricsUnit[] {
  const splitLine = (text: string, line: "top" | "bottom"): LyricsUnit[] => {
    const str = text || " ";
    if (animMode === "whole") {
      return [{ text: str, line }];
    }
    if (animMode === "word") {
      const words = str.split(" ");
      return words.map((w, idx) => ({
        text: w + (idx < words.length - 1 ? "\u00A0" : ""),
        line,
      }));
    }
    // "char"
    return [...str].map((c) => ({ text: c === " " ? "\u00A0" : c, line }));
  };

  return [...splitLine(topText, "top"), ...splitLine(bottomText, "bottom")];
}

/* ==========================================================================
   TIMELINE CALCULATOR — beda dari prototype: loopTotal BUKAN input bebas,
   tapi selalu "sisa" dari clipDurationSec dikurangi inTotal & outTotal
   (lihat catatan di TemplateLyricsTextLayer/types.ts).
   ========================================================================== */
export interface LyricsTimeline {
  totalUnits: number;
  staggerTotal: number;
  inTotal: number;
  loopTotal: number;
  outTotal: number;
  totalDuration: number;
  // Versi EFEKTIF dari inDurationSec/outDurationSec/staggerDelaySec —
  // sama persis dengan nilai layer aslinya SELAMA klip cukup panjang.
  // Tapi kalau klip hasil CUT/trim jadi lebih pendek dari
  // (inTotal + outTotal) bawaan, ketiganya di-skalakan turun bareng-
  // bareng (proporsional) biar IN & OUT tetap MUAT & SELESAI persis di
  // dalam durasi klip yang baru (cuma jadi lebih cepat), bukan kepotong
  // di tengah jalan gara-gara klipnya keburu abis. Dipakai gantiin nilai
  // mentah layer.inDurationSec/outDurationSec/staggerDelaySec pas manggil
  // computeLyricsUnitTransform (lihat lib/render.ts).
  effInDurationSec: number;
  effOutDurationSec: number;
  effStaggerDelaySec: number;
}

export function getLyricsTimeline(
  totalUnits: number,
  staggerDelaySec: number,
  inDurationSec: number,
  outDurationSec: number,
  clipDurationSec: number,
): LyricsTimeline {
  const staggerTotal = Math.max(0, (totalUnits - 1) * staggerDelaySec);
  let inTotal = inDurationSec + staggerTotal;
  let outTotal = outDurationSec + staggerTotal;

  let effStaggerDelaySec = staggerDelaySec;
  let effInDurationSec = inDurationSec;
  let effOutDurationSec = outDurationSec;

  // Klip hasil CUT bisa lebih pendek dari inTotal+outTotal bawaan (mis.
  // dipotong deket ujung). Kalau dibiarkan, OUT animasinya kepotong
  // sebelum sempat selesai (localT abis duluan sebelum outStartTime +
  // outDurationSec tercapai) — teks jadi "ilang mendadak" bukan animasi
  // keluar yang mulus. Fix: skalakan IN, OUT, & stagger dengan faktor
  // yang SAMA biar (inTotal + outTotal) selalu pas <= clipDurationSec,
  // jadi animasi OUT-nya tetap lengkap (mulai -> selesai) walau klipnya
  // pendek, cuma jadi lebih cepat/rapat (loopTotal otomatis jadi 0).
  const totalNeeded = inTotal + outTotal;
  if (totalNeeded > clipDurationSec && totalNeeded > 0) {
    // Floor di LYRICS_MIN_SPEED_SCALE — jangan sampai animasi dipercepat
    // lebih dari itu, walau klipnya kepotong/dipendekin jauh lebih parah
    // dari (inTotal + outTotal). Klip yang masih lebih pendek dari hasil
    // floor ini akan bikin OUT sedikit kepotong di ujung (lihat komentar
    // di LYRICS_MIN_SPEED_SCALE) — tapi itu skenario ekstrem yang
    // seharusnya sudah dicegah duluan di level UI (lihat comfortableMin
    // di Editor.tsx), bukan pola normal.
    const rawScale = Math.max(0, clipDurationSec) / totalNeeded;
    const scale = Math.max(LYRICS_MIN_SPEED_SCALE, rawScale);
    effStaggerDelaySec = staggerDelaySec * scale;
    effInDurationSec = inDurationSec * scale;
    effOutDurationSec = outDurationSec * scale;
    const scaledStaggerTotal = Math.max(0, (totalUnits - 1) * effStaggerDelaySec);
    inTotal = effInDurationSec + scaledStaggerTotal;
    outTotal = effOutDurationSec + scaledStaggerTotal;
  }

  const loopTotal = Math.max(0, clipDurationSec - inTotal - outTotal);
  return {
    totalUnits,
    staggerTotal,
    inTotal,
    loopTotal,
    outTotal,
    totalDuration: clipDurationSec,
    effInDurationSec,
    effOutDurationSec,
    effStaggerDelaySec,
  };
}

/** Hasil transform siap pakai buat 1 unit huruf/kata di 1 momen waktu. */
export interface LyricsUnitTransform {
  x: number;
  y: number;
  scale: number;
  /** Opsional — cuma keisi kalau presetnya eksplisit nyetel scaleX/scaleY
   *  (lihat LyricsPresetResult). Kalau undefined, render.ts fallback ke
   *  `scale` biasa (uniform), jadi preset LAMA yang cuma pakai `scale`
   *  tetep jalan sama persis kayak sebelumnya. */
  scaleX?: number;
  scaleY?: number;
  rotate: number;
  opacity: number;
  blur: number;
}

const IDENTITY_TRANSFORM: LyricsUnitTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0,
  opacity: 1,
  blur: 0,
};

/** Hitung transform 1 unit huruf/kata di waktu LOKAL `localT` (relatif ke
 *  awal klip, 0 = klip baru mulai) — port dari renderFrame() prototype.
 *  Fungsi MURNI: hasilnya cuma dari argumen yang dikasih, tidak ada
 *  Math.random()/Date.now(), jadi preview & export selalu identik. */
export function computeLyricsUnitTransform(
  globalIndex: number,
  totalUnits: number,
  localT: number,
  timeline: LyricsTimeline,
  staggerOrder: LyricsStaggerOrder,
  staggerDelaySec: number,
  loopBehavior: LyricsLoopBehavior,
  inStyle: string,
  inDurationSec: number,
  loopStyle: string,
  outStyle: string,
  outDurationSec: number,
): LyricsUnitTransform {
  let idx = globalIndex;
  if (staggerOrder === "reverse") {
    idx = totalUnits - 1 - globalIndex;
  } else if (staggerOrder === "random") {
    idx = Math.floor(seededRandom(globalIndex) * totalUnits);
  }

  const itemStagger = idx * staggerDelaySec;
  const { inTotal, loopTotal } = timeline;
  const inFn = LyricsAnimationPresets.IN[inStyle] ?? LyricsAnimationPresets.IN.fade;
  const loopFn = LyricsAnimationPresets.LOOP[loopStyle] ?? LyricsAnimationPresets.LOOP.floating;
  const outFn = LyricsAnimationPresets.OUT[outStyle] ?? LyricsAnimationPresets.OUT.fade;

  if (loopBehavior === "continuous") {
    // Loop aktif TERUS dari awal sampai akhir klip, in/out cuma nambahin
    // efek DI ATAS loop yang udah jalan (bukan gantiin), sama seperti
    // prototype.
    const normalizedLoopProgress = (localT % LOOP_CYCLE_SEC) / LOOP_CYCLE_SEC;
    const loopRes = loopFn(normalizedLoopProgress, idx);

    let x = loopRes.x ?? 0;
    let y = loopRes.y ?? 0;
    let scale = loopRes.scale ?? 1;
    let rotate = loopRes.rotate ?? 0;
    let opacity = loopRes.opacity ?? 1;
    let blur = loopRes.blur ?? 0;

    if (localT < inTotal) {
      const localInTime = Math.max(0, localT - itemStagger);
      const rawProgress = Math.min(1, localInTime / Math.max(0.0001, inDurationSec));
      const progress = LyricsEasings.backOut(rawProgress);
      const inRes = inFn(progress, idx);
      x += inRes.x ?? 0;
      y += inRes.y ?? 0;
      scale *= inRes.scale ?? 1;
      rotate += inRes.rotate ?? 0;
      opacity *= inRes.opacity ?? 1;
      blur += inRes.blur ?? 0;
    } else if (localT >= inTotal + loopTotal) {
      const outStartTime = inTotal + loopTotal + itemStagger;
      const localOutTime = Math.max(0, localT - outStartTime);
      const rawProgress = Math.min(1, localOutTime / Math.max(0.0001, outDurationSec));
      const progress = LyricsEasings.backIn(rawProgress);
      const outRes = outFn(progress, idx);
      x += outRes.x ?? 0;
      y += outRes.y ?? 0;
      scale *= outRes.scale ?? 1;
      rotate += outRes.rotate ?? 0;
      opacity *= outRes.opacity ?? 1;
      blur += outRes.blur ?? 0;
    }

    return { x, y, scale, rotate, opacity, blur };
  }

  // loopBehavior === "standard": IN -> LOOP -> OUT berurutan, nggak numpuk.
  if (localT < inTotal) {
    const localInTime = Math.max(0, localT - itemStagger);
    const rawProgress = Math.min(1, localInTime / Math.max(0.0001, inDurationSec));
    const progress = LyricsEasings.backOut(rawProgress);
    return { ...IDENTITY_TRANSFORM, ...inFn(progress, idx) };
  }
  if (localT < inTotal + loopTotal) {
    const localLoopTime = localT - inTotal;
    const normalizedLoopProgress = (localLoopTime % LOOP_CYCLE_SEC) / LOOP_CYCLE_SEC;
    return { ...IDENTITY_TRANSFORM, ...loopFn(normalizedLoopProgress, idx) };
  }
  const outStartTime = inTotal + loopTotal + itemStagger;
  const localOutTime = Math.max(0, localT - outStartTime);
  const rawProgress = Math.min(1, localOutTime / Math.max(0.0001, outDurationSec));
  const progress = LyricsEasings.backIn(rawProgress);
  return { ...IDENTITY_TRANSFORM, ...outFn(progress, idx) };
}

/** Bikin 1 TemplateLyricsTextLayer default (dipakai template "Lyrics" di
 *  data/templates.ts) — nilai default disamakan dengan state awal di
 *  prototype "Text Animation Tool Pro" (topText "BUAH"/bottomText
 *  "MANGGIS", font Mulish, slideUp -> floating -> slideDown, dst),
 *  ditumpuk di atas `overrides` (biasanya cuma id/label). */
export function defaultLyricsLayer(
  overrides: Partial<TemplateLyricsTextLayer> &
    Pick<TemplateLyricsTextLayer, "id" | "label">,
): TemplateLyricsTextLayer {
  return {
    defaultTopText: "",
    defaultBottomText: "",
    x: 50,
    y: 50,
    topFontSize: 120,
    bottomFontSize: 60,
    colorTop: "#c3b0ff",
    colorBottom: "#ffffff",
    fontFamily: "Mulish",
    skewDeg: -8,
    animMode: "char",
    staggerOrder: "normal",
    staggerDelaySec: 0.05,
    loopBehavior: "standard",
    inStyle: "slideUp",
    inDurationSec: 0.8,
    loopStyle: "floating",
    outStyle: "slideDown",
    outDurationSec: 0.8,
    startSec: 0,
    endSec: 4.5,
    ...overrides,
  };
}
