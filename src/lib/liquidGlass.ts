// Mesin render "liquid glass" buat canvas 2D — dipakai bareng sama Editor
// (preview live) & export (ffmpeg + WebCodecs), jadi SATU implementasi
// yang sama dipakai di mana-mana (nggak ada logic kaca yang kepisah/beda
// antara preview & hasil export).
//
// Filter graph (feDisplacementMap + chromatic aberration per-channel)
// di bawah ini di-copy PERSIS dari komponen <GlassFilter> di
// rdev/liquid-glass-react (src/index.tsx, MIT License) — cuma dipindah
// dari JSX ke string SVG mentah supaya bisa disuntikkan ke DOM secara
// imperatif (dipakai lewat `ctx.filter = "url(#id)"` pas gambar ke
// canvas). Grafik filternya TIDAK diubah sama sekali dari versi asli.
import type { LiquidGlassSettings, LiquidGlassMode } from "../types";
import { roundRectPath } from "./render";
import {
  displacementMap,
  polarDisplacementMap,
  prominentDisplacementMap,
} from "./liquidGlassMaps";
import { ShaderDisplacementGenerator, fragmentShaders } from "./liquidGlassShader";

export const DEFAULT_LIQUID_GLASS_SETTINGS: LiquidGlassSettings = {
  mode: "standard",
  displacementScale: 70,
  blurAmount: 0.5,
  saturation: 140,
  aberrationIntensity: 2,
  overLight: false,
};

// Cache displacement map mode "shader" per ukuran (generate sekali per
// ukuran rect, dipakai ulang tiap frame — generatenya lumayan berat kalau
// diulang tiap render loop).
const shaderMapCache = new Map<string, string>();
function getShaderMapUrl(width: number, height: number): string {
  const key = `${width}x${height}`;
  const cached = shaderMapCache.get(key);
  if (cached) return cached;
  const generator = new ShaderDisplacementGenerator({
    width,
    height,
    fragment: fragmentShaders.liquidGlass,
  });
  const url = generator.updateShader();
  generator.destroy();
  shaderMapCache.set(key, url);
  return url;
}

function getMapUrl(mode: LiquidGlassMode, width: number, height: number): string {
  switch (mode) {
    case "standard":
      return displacementMap;
    case "polar":
      return polarDisplacementMap;
    case "prominent":
      return prominentDisplacementMap;
    case "shader":
      return getShaderMapUrl(width, height);
    default:
      return displacementMap;
  }
}

// Root <svg> tersembunyi tempat semua <filter id="..."> disuntikkan.
// Satu root dipakai bareng oleh semua card kaca di semua template (id-nya
// dibedain per layer), jadi nggak numpuk elemen DOM.
const FILTER_ROOT_ID = "liquid-glass-filter-defs-root";
function ensureFilterRoot(): SVGSVGElement {
  let svg = document.getElementById(FILTER_ROOT_ID) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("id", FILTER_ROOT_ID);
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.overflow = "hidden";
    svg.style.pointerEvents = "none";
    document.body.appendChild(svg);
  }
  return svg;
}

// Nilai terakhir yang dipakai buat tiap filterId, biar kita cuma bikin
// ulang <filter> pas ada settingan yang beneran berubah (bukan tiap frame).
const lastFilterSignature = new Map<string, string>();

/** Suntik/update <filter> SVG buat 1 card kaca (dipanggil sebelum
 *  ctx.filter = url(#filterId) dipakai). Grafik filter feDisplacementMap
 *  + chromatic aberration per-channel di bawah = PERSIS punya
 *  rdev/liquid-glass-react punya, cuma dalam bentuk string. */
function upsertGlassFilter(
  filterId: string,
  settings: LiquidGlassSettings,
  width: number,
  height: number,
) {
  const mapUrl = getMapUrl(settings.mode, width, height);
  const scaleSign = settings.mode === "shader" ? 1 : -1;
  const signature = JSON.stringify([
    settings.mode,
    settings.displacementScale,
    settings.aberrationIntensity,
    width,
    height,
  ]);
  if (lastFilterSignature.get(filterId) === signature) return;
  lastFilterSignature.set(filterId, signature);

  const svg = ensureFilterRoot();
  const existing = svg.querySelector(`#${CSS.escape(filterId)}`);
  if (existing) existing.remove();

  const ds = settings.displacementScale;
  const ai = settings.aberrationIntensity;

  const filterMarkup = `
    <filter id="${filterId}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href="${mapUrl}" preserveAspectRatio="xMidYMid slice" />
      <feColorMatrix in="DISPLACEMENT_MAP" type="matrix" values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0" result="EDGE_INTENSITY" />
      <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
        <feFuncA type="discrete" tableValues="0 ${ai * 0.05} 1" />
      </feComponentTransfer>
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${ds * scaleSign}" xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
      <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${ds * (scaleSign - ai * 0.05)}" xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED" />
      <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${ds * (scaleSign - ai * 0.1)}" xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED" />
      <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />
      <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
      <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
      <feGaussianBlur in="RGB_COMBINED" stdDeviation="${Math.max(0.1, 0.5 - ai * 0.1)}" result="ABERRATED_BLURRED" />
      <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />
      <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
        <feFuncA type="table" tableValues="1 0" />
      </feComponentTransfer>
      <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
      <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
    </filter>`;

  svg.insertAdjacentHTML("beforeend", filterMarkup);
}

// Feature-detect sekali: browser ini beneran render `ctx.filter =
// "url(#id)"` atau nggak (Firefox & Safari cenderung nggak / parsial —
// sama seperti catatan resmi rdev/liquid-glass-react). Kalau nggak
// didukung, kita fallback ke backdrop blur+saturate polos aja (tanpa
// refraksi/aberration) daripada nge-render kanvas kosong.
let svgCanvasFilterSupported: boolean | null = null;
function detectSvgCanvasFilterSupport(): boolean {
  if (svgCanvasFilterSupported !== null) return svgCanvasFilterSupported;
  try {
    const svg = ensureFilterRoot();
    const testId = "liquid-glass-feature-test";
    if (!svg.querySelector(`#${testId}`)) {
      svg.insertAdjacentHTML(
        "beforeend",
        `<filter id="${testId}"><feColorMatrix type="saturate" values="0" /></filter>`,
      );
    }
    const test = document.createElement("canvas");
    test.width = 4;
    test.height = 4;
    const tctx = test.getContext("2d")!;
    tctx.fillStyle = "#ff0000";
    tctx.fillRect(0, 0, 4, 4);
    const probe = document.createElement("canvas");
    probe.width = 4;
    probe.height = 4;
    const pctx = probe.getContext("2d")!;
    pctx.filter = `url(#${testId})`;
    pctx.drawImage(test, 0, 0);
    const data = pctx.getImageData(0, 0, 1, 1).data;
    // Saturate(0) di piksel merah pekat harus jadi abu-abu (R turun jauh
    // dari 255, G/B naik dari 0) kalau filternya beneran dijalankan.
    svgCanvasFilterSupported = data[0] < 250 && data[0] > 0;
  } catch {
    svgCanvasFilterSupported = false;
  }
  return svgCanvasFilterSupported;
}

export interface LiquidGlassRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
}

/** Gambar satu card liquid glass ke `ctx`, "menembus" apa pun yang sudah
 *  ada di `backdropSource` (background/base image yang SUDAH digambar di
 *  posisi yang sama) di area `rect`. Dipanggil dari render loop Editor
 *  DAN dari export.ts/webcodecs-export.ts — satu fungsi, satu hasil. */
export function drawLiquidGlassCard(
  ctx: CanvasRenderingContext2D,
  backdropSource: CanvasImageSource,
  rect: LiquidGlassRect,
  filterId: string,
  settings: LiquidGlassSettings,
  opacity = 1,
) {
  const { x, y, width, height } = rect;
  if (width <= 0 || height <= 0 || opacity <= 0) return;
  const radius = Math.max(0, Math.min(rect.cornerRadius, width / 2, height / 2));

  const supportsSvgFilter = detectSvgCanvasFilterSupport();
  const pad = Math.max(24, Math.round(settings.displacementScale * 0.6));
  const pw = Math.round(width + pad * 2);
  const ph = Math.round(height + pad * 2);

  // Pass 1: crop backdrop di area kaca (+ padding overscan) lalu blur +
  // saturate — ini padanan `backdrop-filter: blur() saturate()` di CSS.
  const blurPx = (settings.overLight ? 12 : 4) + settings.blurAmount * 32;
  const passA = document.createElement("canvas");
  passA.width = pw;
  passA.height = ph;
  const actx = passA.getContext("2d")!;
  actx.filter = `blur(${blurPx}px) saturate(${settings.saturation}%)`;
  actx.drawImage(backdropSource, x - pad, y - pad, pw, ph, 0, 0, pw, ph);

  // Pass 2: filter SVG (feDisplacementMap + chromatic aberration per
  // channel di tepi) — padanan `filter: url(#id)` di CSS punya library asli.
  let sourceForCard: CanvasImageSource = passA;
  if (supportsSvgFilter) {
    upsertGlassFilter(filterId, settings, pw, ph);
    const passB = document.createElement("canvas");
    passB.width = pw;
    passB.height = ph;
    const bctx = passB.getContext("2d")!;
    bctx.filter = `url(#${filterId})`;
    bctx.drawImage(passA, 0, 0);
    sourceForCard = passB;
  }

  ctx.save();
  ctx.globalAlpha = opacity;

  // Bayangan lembut di belakang card (padanan box-shadow di library asli).
  ctx.save();
  ctx.shadowColor = settings.overLight ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.25)";
  ctx.shadowBlur = settings.overLight ? 70 : 40;
  ctx.shadowOffsetY = settings.overLight ? 16 : 12;
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = "rgba(0,0,0,0.001)";
  ctx.fill();
  ctx.restore();

  // Isi kaca: crop hasil pass 2 (buang padding overscan-nya) ke bentuk
  // rounded-rect card.
  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(sourceForCard, pad, pad, width, height, x, y, width, height);

  // "Over light": tint gelap tambahan biar tetap kebaca di atas background
  // terang (padanan 2 layer bg-black opacity-20 + mix-blend-overlay).
  if (settings.overLight) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x, y, width, height);
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, width, height);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();

  // Rim/outline highlight yang nggak solid — gradasi diagonal terang di
  // sisi kiri-atas, padanan "border layer" (mix-blend screen + overlay)
  // di library asli.
  drawGlassRim(ctx, x, y, width, height, radius);

  ctx.restore();
}

function drawGlassRim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const grad = ctx.createLinearGradient(x, y, x + width * 0.75, y + height * 0.75);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.33, "rgba(255,255,255,0.22)");
  grad.addColorStop(0.66, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");

  const lineWidth = Math.max(1.5, Math.min(width, height) * 0.003);

  ctx.save();
  roundRectPath(ctx, x + lineWidth / 2, y + lineWidth / 2, width - lineWidth, height - lineWidth, radius);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = grad;
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();
}

/** Ubah rect kaca dari persen (skala template) ke px canvas asli. */
export function resolveLiquidGlassRectPx(
  glass: { x: number; y: number; width: number; height: number; cornerRadius: number },
  canvasW: number,
  canvasH: number,
): LiquidGlassRect {
  return {
    x: (glass.x / 100) * canvasW,
    y: (glass.y / 100) * canvasH,
    width: (glass.width / 100) * canvasW,
    height: (glass.height / 100) * canvasH,
    cornerRadius: glass.cornerRadius,
  };
}
