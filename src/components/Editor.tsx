import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Video,
  Music,
  Image as ImageIcon,
  Type,
  Undo2,
  Redo2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Diamond,
  Plus,
  Scissors,
  Loader2,
  X,
  RefreshCcw,
  SlidersHorizontal,
  Layers,
  RotateCcw,
  Trash2,
  AudioWaveform,
  Bookmark,
  Save,
  Maximize2,
  Minimize2,
  Download,
  ArrowLeft,
  Eye,
  EyeOff,
  Sparkles,
  Check,
  Crop,
  Music2,
  Palette,
  MonitorSmartphone,
  RectangleVertical,
  RectangleHorizontal,
  Pencil,
} from "lucide-react";
import ImageCropModal from "./ImageCropModal";
import type { Template, TemplateSlot, TemplateTextLayer, TemplateLyricsTextLayer, SlotType, LiquidGlassSettings } from "../types";
import { LYRICS_FONTS, LyricsAnimationPresets, defaultLyricsLayer } from "../lib/lyricsAnim";
import {
  parseDurationSec,
  initialSlotMedia,
  initialLayerOpacity,
  initialTextValues,
  isSlotActiveAt,
  roundRectPath,
  drawImageCover,
  drawImageCoverZoomed,
  drawSlotGlow,
  drawTextLayers,
  drawLyricsTextLayer,
  drawDurationLayer,
  drawProgressFill,
  drawWaveformProgress,
  drawSpectrumIndicator,
  applyGlowBloom,
  getPressBounceScale,
  drawImageCoverWithPressBounce,
  ImageCache,
  MAX_BACKGROUND_BLUR,
  BACKGROUND_BLUR_OVERSCAN_FACTOR,
  defaultBackgroundBlurFor,
} from "../lib/render";
import type {
  SlotMediaEntry,
  SlotMediaState,
  LayerOpacityState,
  TextValueState,
} from "../lib/render";
import {
  drawLiquidGlassCard,
  resolveLiquidGlassRectPx,
  DEFAULT_LIQUID_GLASS_SETTINGS,
} from "../lib/liquidGlass";
import { exportTemplateVideoAuto, ExportCancelledError, type ExportProgress, type ExportEngine } from "../lib/engine";
import { analyzeAudio, type AudioAnalysis } from "../lib/waveform";
import { logExportEvent } from "../lib/exportLog";
import { subscribeCoverImages, type CoverImageEntry } from "../lib/coverImages";
import {
  savePreset,
  listPresets,
  getPreset,
  deletePreset,
  storedMediaToEntry,
  ensurePersistentStorage,
  type PresetSummary,
} from "../lib/presets";
import { saveDraft, getDraft as getDraftRecord } from "../lib/drafts";

type Tool = {
  id: string;
  label: string;
  icon: LucideIcon;
};

// 4 tab tetap, samain persis sama mock-up UI (Edit/Audio/Teks/Gaya) —
// bukan kondisional lagi. Tab "Efek" (Liquid Glass/Glow) sengaja dicabut
// dulu dari sini nyusul migrasi UI ke mock-up (belum ada tempatnya di
// desain baru); state & logic glow-nya (glowIntensity) masih ada di
// bawah, cuma UI togglenya yang untuk sementara gak ditampilkan.
const TOOLS: Tool[] = [
  { id: "media", label: "Edit", icon: Scissors },
  { id: "audio", label: "Audio", icon: Music2 },
  { id: "text", label: "Teks", icon: Type },
  { id: "progress", label: "Gaya", icon: AudioWaveform },
  // Tab "Rasio" — ganti orientasi canvas (9:16 potret / 16:9 lanskap).
  // Resolusi tetap 1920x1080 (cuma tukar mana yang jadi lebar/tinggi),
  // lihat canvasRatio & getRatioCanvasSize di bawah.
  { id: "ratio", label: "Rasio", icon: MonitorSmartphone },
];

/** Ukuran canvas efektif buat tiap pilihan Rasio — SELALU dari budget
 *  resolusi 1920x1080 (cuma orientasinya yang beda), independen dari
 *  canvasWidth/canvasHeight bawaan template (yang semuanya masih 1080x1920
 *  fixed di data/templates.ts). Dipakai di preview (canvas asli & CSS
 *  aspect-ratio-nya) DAN di export (webcodecs-export.ts baca dari
 *  exportTemplate.canvasWidth/Height, lihat handleExport). */
function getRatioCanvasSize(ratio: "9:16" | "16:9"): {
  width: number;
  height: number;
} {
  return ratio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

const SLOT_ICON: Record<SlotType, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
};

// Label singkat per tipe slot — dipakai teks tombol "Ganti ..." di toolbar
// bawah biar nggak kepanjangan (misal slot.label "Foto sampul" cukup
// ditulis "Foto" aja: "Ganti Foto").
const SLOT_SHORT_LABEL: Record<SlotType, string> = {
  image: "Foto",
  video: "Video",
  audio: "Audio",
};

// Daftar warna preset buat color picker di panel edit teks — dipilih yang
// kontras & gampang kebaca di atas video (putih/hitam netral + beberapa
// warna terang standar). Urutan dari yang paling sering dipakai (putih,
// hitam) sampai warna aksen.
const TEXT_COLOR_SWATCHES: string[] = [
  "#FFFFFF",
  "#000000",
  "#FF3B30",
  "#FF9500",
  "#FFEB3B",
  "#34C759",
  "#0A84FF",
  "#AF52DE",
  "#FF2D95",
];

// Tombol nav generik — ikon di atas, label kecil di bawah, ukuran & style
// SAMA PERSIS kayak toolbar utama (Media/Audio/Teks/Urungkan/dst). Dipakai
// juga di semua toolbar kontekstual (Ganti Foto, Selesai, Reset, Batal,
// dst) biar begitu menu utama "disembunyikan" & diganti menu lain, style-nya
// tetap konsisten satu sama lain — bukan bikin tampilan/bar baru yang beda.
function NavAction({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-90 ${
        active
          ? "bg-editor-accent/20 text-editor-accent"
          : "text-paper/55 hover:text-paper"
      } ${disabled ? "opacity-30" : ""}`}
      title={label}
      aria-label={label}
    >
      <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-[9px] font-medium leading-none">{label}</span>
    </button>
  );
}

// Card nav bawah — SATU-SATUNYA container tetap buat semua toolbar
// kontekstual (menu utama Media/Audio/Teks, pengaturan Background,
// Liquid Glass, opacity layer, ganti slot, edit teks, dst). Yang boleh
// ganti cuma ISI di dalamnya lewat prop `panelKey`: begitu panelKey
// beda dari sebelumnya, isinya diganti LANGSUNG (instan, tanpa animasi
// slide turun/naik) — biar konten lama (mis. kartu pilihan Gaya) gak
// "kebawa"/nongol pas udah pindah ke menu lain.
//
// Tinggi card-nya: cuma dianimasikan pas MEMBESAR (panel baru muncul/isinya
// nambah) biar kerasa mulus pas "masuk". Pas MENGECIL/nutup (pindah ke
// menu lain yang kontennya lebih pendek atau kosong), tingginya LANGSUNG
// instan tanpa transisi sama sekali — sesuai permintaan: gak boleh ada
// animasi nutup, cuma animasi masuk.
function BottomNavCard({
  panelKey,
  height,
  children,
}: {
  // Identitas konten yang lagi ditampilkan (mis. "default" | "slot" |
  // "text" | dst) — dipakai buat ndeteksi kapan isi harus diganti.
  panelKey: string;
  // Tinggi eksplisit (px) buat panel yang bisa di-drag manual (Background
  // & Liquid Glass pakai sheetHeight). Kalau undefined, tinggi ngikutin
  // konten aslinya (diukur otomatis).
  height?: number;
  children: ReactNode;
}) {
  const [shown, setShown] = useState<{ key: string; node: ReactNode }>({
    key: panelKey,
    node: children,
  });
  const [cardHeight, setCardHeight] = useState<number | "auto">(height ?? "auto");
  const contentRef = useRef<HTMLDivElement>(null);

  // panelKey ATAU children berubah -> ganti isi yang ditampilkan sekarang
  // juga, gak ditunda-tunda lewat fase exit/enter apa pun.
  //
  // PAKAI useLayoutEffect (BUKAN useEffect biasa) — ini kuncinya. useEffect
  // jalan SETELAH browser sempet paint, jadi ada 1 frame "hantu" nampilin
  // konten & tinggi LAMA dulu sebelum ke-update ke yang baru. Itu yang
  // bikin overlay kerasa lag/lambat pas nutup padahal kodenya udah
  // "instan". useLayoutEffect jalan SEBELUM paint, jadi swap konten & ukur
  // tinggi kelar duluan sebelum ada yang sempet kegambar — user langsung
  // liat hasil akhirnya, gak ada frame nyasar.
  useLayoutEffect(() => {
    setShown({ key: panelKey, node: children });
  }, [panelKey, children]);

  // Tinggi eksplisit (drag manual buat Background/Liquid Glass) — ganti
  // langsung tiap frame drag, jarinya nempel pas.
  useLayoutEffect(() => {
    if (height === undefined) return;
    setCardHeight(height);
  }, [height]);

  // Tinggi otomatis: ukur tinggi konten asli & pantau perubahannya
  // (ResizeObserver) biar card tetap pas walau isi di dalamnya berubah.
  //
  // SENGAJA TANPA ANIMASI SAMA SEKALI (baik membesar maupun mengecil) —
  // panel ini "muncul"/"nutup"/ganti isi langsung "plukk" instan, gak ada
  // transition-[height] apa pun. Ini permintaan eksplisit: animasi
  // naik-turun kerasa lambat & bikin gelisah, jadi dihapus total daripada
  // cuma "diperhalus" kondisinya. (Diukur pakai useLayoutEffect di atas,
  // BUKAN useEffect, supaya beneran gak ada frame transisi yang kelihatan.)
  useLayoutEffect(() => {
    if (height !== undefined) return;
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardHeight(el.scrollHeight));
    ro.observe(el);
    setCardHeight(el.scrollHeight);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, shown.key]);

  return (
    <div
      className="relative z-30 flex shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-white/5 bg-editor-panel shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{ height: cardHeight }}
    >
      <div ref={contentRef} key={shown.key} className="flex flex-1 flex-col">
        {shown.node}
      </div>
    </div>
  );
}

// ID khusus (bukan decorLayer beneran dari template) buat nandain track
// "Background" di timeline — dipakai bareng selectedLayerId yang sama
// biar reuse UI seleksi track yang sudah ada.
const BACKGROUND_LAYER_ID = "__background__";
// localStorage key buat nyimpen status "udah pernah liat hint bubble teks
// AirPlay" — sekali di-dismiss, gak muncul lagi di browser yang sama.
const AIRPLAY_HINT_DISMISSED_KEY = "spneditz_hint_airplay_device_dismissed";
// Downsample sebuah array titik amplitude ke jumlah bar target, dengan
// ambil nilai PEAK (bukan rata-rata) per bucket — biar transient/hentakan
// kecil di antara sample nggak "keblur"/ilang pas dipadetin. Dipakai buat
// bikin waveform klip audio di timeline lebih rapat & mengalir kayak
// editor video lain (CapCut dkk), bukan cuma segelintir bar gemuk.
function downsamplePeaks(source: number[], targetCount: number): number[] {
  if (source.length === 0) return [];
  if (targetCount <= 0) return [];
  if (source.length <= targetCount) {
    // Kurang titik dari target: interpolasi linear biar tetap sehalus
    // mungkin ngisi lebar klip, bukan cuma diulang-ulang.
    const out: number[] = [];
    for (let i = 0; i < targetCount; i++) {
      const pos = (i / Math.max(1, targetCount - 1)) * (source.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(source.length - 1, lo + 1);
      const t = pos - lo;
      out.push(source[lo] * (1 - t) + source[hi] * t);
    }
    return out;
  }
  const out: number[] = [];
  const bucketSize = source.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let peak = 0;
    for (let j = start; j < end && j < source.length; j++) {
      if (source[j] > peak) peak = source[j];
    }
    out.push(peak);
  }
  return out;
}
// Kepadatan piksel/detik minimum — dipakai kalau durasinya panjang (biar
// tetap perlu discroll). Kalau durasinya pendek, kepadatan efektif dihitung
// dinamis (lihat effectivePxPerSec) supaya timeline selalu mepet ke kanan.
const MIN_PX_PER_SEC = 8;
// Jumlah batang waveform yang di-generate per file audio.
const WAVEFORM_BAR_COUNT = 120;
// Waveform datar sementara, ditampilin pas file audio baru diupload dan
// masih dianalisis (belum ada data amplitude asli).
const FALLBACK_PEAKS = Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.22);
// Durasi minimum satu potongan klip audio (detik) — dijaga biar nggak
// bisa ditrim/dipotong sampai lebih pendek dari ini (biar nggak "hilang").
const MIN_CLIP_DURATION = 0.3;
// Sama kayak MIN_CLIP_DURATION, tapi buat track teks/lirik — dijaga biar
// motong track teks nggak bisa bikin salah satu potongannya lebih pendek
// dari ini (biar animasi in/out-nya masih kelihatan wajar, nggak "kepotong
// abis" jadi 0 detik).
const MIN_LYRICS_CLIP_DURATION = 0.4;
// Berapa detik playhead digeser tiap klik tombol mundur/maju di sebelah
// tombol play — 1 detik cukup presisi buat nyari posisi tanpa harus
// drag manual di timeline.
// (Tombol mundur/maju dihapus di UI baru — seek dilakukan lewat drag playhead.)

// Satu potongan klip di track audio: menyimpan rentang mana dari file
// audio ASLI yang dipakai (trimStart..trimEnd, dalam detik source asli)
// dan di detik berapa klip ini "ditempel" di timeline utama (offset).
// Semua klip berasal dari file audio yang sama (audioMedia) — motong
// (Potong/gunting) bikin satu klip jadi dua, geser cuma ubah offset,
// drag tepi kiri/kanan cuma ubah trimStart/trimEnd.
type AudioClip = {
  id: string;
  trimStart: number;
  trimEnd: number;
  offset: number;
};

let clipIdCounter = 0;
function makeClipId() {
  clipIdCounter += 1;
  return `clip-${Date.now()}-${clipIdCounter}`;
}

// Satu "langkah" riwayat Undo/Redo — nyimpen SEMUA state yang beneran
// mendefinisikan isi project (media tiap slot, teks, warna, opacity,
// efek kaca, background, klip audio, elemen yang disembunyikan, dst).
// State UI murni (tab toolbar aktif, fullscreen, panel preset kebuka,
// dst.) SENGAJA tidak ikut, biar Undo/Redo cuma mundur/maju perubahan
// project-nya aja, bukan navigasi UI.
type ProjectSnapshot = {
  slotMedia: SlotMediaState;
  customBackground: SlotMediaEntry | null;
  layerOpacity: LayerOpacityState;
  glassSettings: Record<string, Partial<LiquidGlassSettings>>;
  backgroundOpacity: number;
  backgroundBlur: number;
  progressStyle: "bar" | "waveform";
  glowIntensity: number;
  textValues: TextValueState;
  textColors: Record<string, string>;
  audioClips: AudioClip[];
  hiddenElements: Set<string>;
  customLyricsLayers: TemplateLyricsTextLayer[];
  removedLyricsIds: Set<string>;
  lyricsSettings: Record<string, Partial<TemplateLyricsTextLayer>>;
};

// Format detik jadi mm:ss buat label waktu di atas baris playback.
function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Pill label di kiri tiap baris track — nempel (sticky) ke tepi kiri
// area timeline yang scrollable, jadi tetap keliatan/gampang diketuk
// meskipun user geser timeline ke kanan. Markup & class-nya DIAMBIL
// PERSIS dari repo Mock-up (bagian "Track: background/cover photo/
// audio/text" di src/routes/index.tsx) — pakai token warna ed-* yang
// sama, bukan diadaptasi ke palet lama (editor-*/mute/paper) di
// spneditz. Bedanya cuma nambahin logic toggle hidden/show (di mockup
// aslinya cuma ikon statis, di sini beneran bisa diklik).
function TrackLabel({
  hidden,
  onToggleHidden,
  icon: Icon,
  label,
  hiddenTitle,
  shownTitle,
}: {
  hidden: boolean;
  onToggleHidden: (e: React.MouseEvent) => void;
  icon: LucideIcon;
  label: string;
  hiddenTitle?: string;
  shownTitle?: string;
}) {
  return (
    <div className="sticky left-1 z-20 flex h-8 w-[104px] shrink-0 items-center gap-2 rounded-lg bg-ed-card px-2 text-[11px] text-ed-text">
      <button
        onClick={onToggleHidden}
        title={hidden ? (hiddenTitle ?? "Tampilkan elemen") : (shownTitle ?? "Sembunyikan elemen")}
        aria-label={hidden ? "Tampilkan elemen" : "Sembunyikan elemen"}
        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center transition active:scale-90"
      >
        {hidden ? (
          <EyeOff className="h-[14px] w-[14px] shrink-0 text-ed-dim" />
        ) : (
          <Eye className="h-[14px] w-[14px] shrink-0 text-ed-text" />
        )}
      </button>
      <Icon className="h-[14px] w-[14px] shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

// Label KECIL tambahan di pojok kiri-atas badan tiap klip (BUKAN
// pengganti pill TrackLabel di atas — itu tetap apa adanya, nggak
// disentuh). Cuma nama + ikon super kecil, dibekingi highlight hitam
// tipis yang memanjang ke kanan (gradient fade) biar tetap kebaca
// kontras di atas thumbnail/warna apa pun isi klipnya.
function ClipCornerLabel({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[13px] items-center gap-[3px] overflow-hidden bg-gradient-to-r from-black/80 via-black/35 to-transparent pl-1 pr-6">
      <Icon className="h-[9px] w-[9px] shrink-0 text-white/90" />
      <span className="truncate text-[7px] font-semibold leading-none text-white/90">
        {label}
      </span>
    </div>
  );
}

function generateTimeMarks(duration: number): number[] {
  const step = duration <= 20 ? 5 : 10;
  const marks: number[] = [];
  for (let t = 0; t <= duration; t += step) marks.push(t);
  if (marks[marks.length - 1] !== duration) marks.push(duration);
  return marks;
}

// Template yang SENGAJA dilewatin dari sistem "foto default random dari
// Firebase" (lihat efek subscribeCoverImages di bawah) — kosong sekarang,
// artinya SEMUA template (termasuk "iphone-music-player-glass") pakai
// foto sampul default random dari Firebase/Unsplash (config/coverImages/
// {templateId}, lihat DEFAULT_COVER_IMAGES di lib/coverImages.ts buat
// fallback-nya kalau Firebase kosong/offline). sample-cover.jpg lokal
// tetap ada, tapi sekarang cuma jadi fallback instan sekejap sebelum
// daftar Firebase/Unsplash kebaca.
const SKIP_DYNAMIC_COVER_TEMPLATE_IDS = new Set<string>([]);

// Label ID buat tiap opsi mode animasi / stagger / loop behavior —
// key mentahnya (char/word/whole, dst) tetep dipakai sebagai value yang
// disimpen ke data (TemplateLyricsTextLayer), cuma labelnya yang di-Indo-in.
const LYRICS_ANIM_MODE_LABELS: Record<string, string> = {
  char: "Huruf",
  word: "Kata",
  whole: "Baris",
};
const LYRICS_STAGGER_ORDER_LABELS: Record<string, string> = {
  normal: "Normal",
  reverse: "Terbalik",
  random: "Acak",
};
const LYRICS_LOOP_BEHAVIOR_LABELS: Record<string, string> = {
  standard: "Berurutan",
  continuous: "Menumpuk",
};

// Baris pemilih chip generik (dipakai buat font, mode animasi, stagger
// order, loop behavior, style in/loop/out) — gaya tombol pill konsisten
// sama chip lain di panel edit (mis. tab Teks/Animasi, swatch warna).
function LyricsChipRow({
  label,
  options,
  value,
  labels,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium text-mute">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition active:scale-95 ${
              value === opt
                ? "bg-editor-accent text-paper"
                : "bg-graphite text-mute"
            }`}
          >
            {labels?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// Slider durasi/delay (detik) — dipakai buat stagger delay & durasi in/out.
function LyricsRangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[10px] font-medium text-mute">
        {label}
        <span className="text-paper">{value.toFixed(2)}s</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-editor-accent"
      />
    </div>
  );
}

// Panel "Animasi" khusus klip Lyrics — porting dari settingan di prototype
// standalone (LyricsTemplatePreview), tapi UI-nya dibikin nyatu sama gaya
// panel edit spneditz (chip pill + range slider bawaan Tailwind), BUKAN
// styling asli prototype (yang HTML/CSS custom sendiri). Satu klip lirik =
// satu setting, berlaku buat baris atas & bawah sekaligus (sesuai data
// model TemplateLyricsTextLayer yang sekarang).
function LyricsAnimPanel({
  layer,
  onChange,
}: {
  layer: TemplateLyricsTextLayer;
  onChange: <K extends keyof TemplateLyricsTextLayer>(
    key: K,
    value: TemplateLyricsTextLayer[K],
  ) => void;
}) {
  return (
    // Sengaja DIBIKIN RENDAH (bukan 52vh kayak sebelumnya) — panel ini
    // dulu bisa naik sampai setengah layar & nutupin canvas preview pas
    // lagi ngatur animasi. 28vh cukup keliatan beberapa opsi tanpa geser
    // scroll, sisanya (In/Loop/Out, dst) tinggal di-scroll ke bawah lewat
    // overflow-y-auto — canvas di atas tetap kebuka jelas buat liat hasil
    // animasi sambil diutak-atik.
    <div className="flex max-h-[28vh] flex-col gap-4 overflow-y-auto px-3 pb-4 pt-3">
      <LyricsChipRow
        label="Font"
        options={LYRICS_FONTS}
        value={layer.fontFamily}
        onChange={(v) => onChange("fontFamily", v)}
      />
      <LyricsChipRow
        label="Mode animasi"
        options={["char", "word", "whole"]}
        value={layer.animMode}
        labels={LYRICS_ANIM_MODE_LABELS}
        onChange={(v) => onChange("animMode", v as TemplateLyricsTextLayer["animMode"])}
      />
      <LyricsChipRow
        label="Urutan stagger"
        options={["normal", "reverse", "random"]}
        value={layer.staggerOrder}
        labels={LYRICS_STAGGER_ORDER_LABELS}
        onChange={(v) =>
          onChange("staggerOrder", v as TemplateLyricsTextLayer["staggerOrder"])
        }
      />
      <LyricsRangeRow
        label="Stagger delay"
        value={layer.staggerDelaySec}
        min={0}
        max={0.2}
        step={0.01}
        onChange={(v) => onChange("staggerDelaySec", v)}
      />
      <LyricsChipRow
        label="Loop behavior"
        options={["standard", "continuous"]}
        value={layer.loopBehavior}
        labels={LYRICS_LOOP_BEHAVIOR_LABELS}
        onChange={(v) =>
          onChange("loopBehavior", v as TemplateLyricsTextLayer["loopBehavior"])
        }
      />

      <div className="h-px bg-mute/10" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-mute">
        In (masuk)
      </span>
      <LyricsChipRow
        label="Gaya masuk"
        options={Object.keys(LyricsAnimationPresets.IN)}
        value={layer.inStyle}
        onChange={(v) => onChange("inStyle", v)}
      />
      <LyricsRangeRow
        label="Durasi in"
        value={layer.inDurationSec}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => onChange("inDurationSec", v)}
      />

      <div className="h-px bg-mute/10" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-mute">
        Loop
      </span>
      <LyricsChipRow
        label="Gaya loop"
        options={Object.keys(LyricsAnimationPresets.LOOP)}
        value={layer.loopStyle}
        onChange={(v) => onChange("loopStyle", v)}
      />

      <div className="h-px bg-mute/10" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-mute">
        Out (keluar)
      </span>
      <LyricsChipRow
        label="Gaya keluar"
        options={Object.keys(LyricsAnimationPresets.OUT)}
        value={layer.outStyle}
        onChange={(v) => onChange("outStyle", v)}
      />
      <LyricsRangeRow
        label="Durasi out"
        value={layer.outDurationSec}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => onChange("outDurationSec", v)}
      />
    </div>
  );
}

export default function Editor({
  template,
  onBack,
  initialProgressStyle,
  resumeDraftId,
}: {
  template: Template;
  onBack: () => void;
  /** Diisi App.tsx kalau butuh buka Editor langsung dengan gaya progress
   *  bar tertentu (mis. deep-link). */
  initialProgressStyle?: "bar" | "waveform";
  /** Diisi kalau user masuk Editor lewat tab "Draft" (lanjutin project
   *  lama) — bukan lewat pilih Template baru dari galeri. Kalau ada
   *  isinya, semua state di bawah di-hydrate dari draft ini pas mount,
   *  DAN auto-save berikutnya nimpa draft yang sama (bukan bikin baru). */
  resumeDraftId?: string | null;
}) {
  const [activeTool, setActiveTool] = useState<string>("media");
  // Rasio canvas: "9:16" (potret, default — samain sama semua template
  // yang ada sekarang) atau "16:9" (lanskap). Resolusi TETAP di budget
  // 1920x1080, cuma tukar mana yang lebar/tinggi (lihat getRatioCanvasSize).
  const [canvasRatio, setCanvasRatio] = useState<"9:16" | "16:9">("9:16");
  const [isPlaying, setIsPlaying] = useState(false);

  const [currentSec, setCurrentSec] = useState(0);
  // Slot yang lagi diketuk/terseleksi di timeline atau canvas — kalau ada
  // isinya, toolbar bawah berubah jadi cuma tombol "Ganti" buat slot itu.
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  // Decor layer yang lagi terseleksi di timeline (misal: Card Player) —
  // kalau ada isinya, toolbar bawah berubah jadi slider opacity buat
  // layer itu. Cuma layer dengan `adjustable: true` yang bisa keseleksi.
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  // Opacity tiap decorLayer (0-100), mulai dari nilai default di data
  // template, diubah user lewat slider di toolbar bawah.
  const [layerOpacity, setLayerOpacity] = useState(() =>
    initialLayerOpacity(template),
  );
  // Setelan efek "liquid glass" per decorLayer yang punya `liquidGlass`
  // (misal: Card Player Glass) — cuma nyimpen field yang SUDAH diubah
  // user lewat panel "Pengaturan Kaca"; field yang belum disentuh tetap
  // pakai default dari data template (lihat getEffectiveGlassSettings).
  const [glassSettings, setGlassSettings] = useState<
    Record<string, Partial<LiquidGlassSettings>>
  >({});
  // Isi tiap textLayer yang bisa di-custom (judul, artist, nama device),
  // mulai dari defaultText di data template, diubah user lewat panel
  // "Teks" di toolbar bawah. Label durasi TIDAK ada di sini — itu selalu
  // dihitung otomatis (lihat drawDurationLayer), bukan dari state ini.
  const [textValues, setTextValues] = useState(() => initialTextValues(template));
  // Warna custom tiap textLayer (override dari layer.color default template),
  // key = textLayer.id, value = hex string ("#RRGGBB"). Kalau id belum ada
  // di sini, berarti belum di-custom user -> fallback ke layer.color bawaan
  // template (lihat penggunaan di bawah & di handleExport).
  const [textColors, setTextColors] = useState<Record<string, string>>({});
  // Override setting animasi layer "Lyrics" (font, mode animasi, stagger,
  // loop behavior, style+durasi in/loop/out) — key = id KLIP lirik (mis.
  // "lyric1", BUKAN "lyric1__top"/"__bottom", karena 1 klip lirik = 1 set
  // setting animasi buat 2 barisnya sekaligus). Kalau id belum ada di
  // sini, fallback ke default dari data template (lihat
  // getEffectiveLyricsLayer di bawah).
  const [lyricsSettings, setLyricsSettings] = useState<
    Record<string, Partial<TemplateLyricsTextLayer>>
  >({});
  // Tab aktif di panel edit klip lirik: "teks" (isi & warna, UI lama) atau
  // "anim" (setting animasi baru). Reset ke "teks" tiap ganti seleksi teks.
  const [lyricsPanelTab, setLyricsPanelTab] = useState<"teks" | "anim">(
    "teks",
  );
  // Mode "Teks" lagi aktif/nggak — begitu true, timeline berganti tampilan:
  // cuma nampilin track teks (sejumlah textLayers template ini), track lain
  // (Background/slot/decor) disembunyikan sementara.
  const [isTextMode, setIsTextMode] = useState(false);
  // Track teks yang lagi diketuk/terseleksi di timeline (dalam isTextMode) —
  // kalau ada isinya, toolbar bawah berubah jadi input edit khusus teks itu.
  const [selectedTextLayerId, setSelectedTextLayerId] = useState<string | null>(
    null,
  );
  // Reset panel klip lirik ("Teks"/"Animasi") ke tab "Teks" tiap kali
  // seleksi teks/lirik yang aktif berubah.
  useEffect(() => {
    setLyricsPanelTab("teks");
  }, [selectedTextLayerId]);
  // Sub-mode toolbar teks: begitu track teks diketuk, JANGAN langsung
  // nongolin menu editing (input + swatch dst) — tampilin quick menu dulu
  // (tombol pensil "Edit" & tombol "Add teks" + 2 pilihan style Ungu/
  // Putih). "quick" = quick menu, "edit" = menu editing penuh (dibuka
  // lewat tombol pensil, ATAU otomatis begitu track teks BARU hasil
  // "Add teks" langsung keseleksi buat diisi). SENGAJA diatur manual di
  // tiap titik transisi (klik track / bikin track baru), BUKAN lewat
  // useEffect yang listen selectedTextLayerId — soalnya bikin track baru
  // juga ganti selectedTextLayerId, dan itu justru harus lolos ke "edit",
  // bukan ke-reset paksa ke "quick".
  const [textToolbarMode, setTextToolbarMode] = useState<"quick" | "edit">(
    "quick",
  );
  // Sub-state quick menu: begitu tombol "Add teks" diketuk, JANGAN
  // langsung masuk mode edit — tampilin dulu 2 pilihan style (Ungu/
  // Putih), baru abis pilih salah satu, track teks BARU dibikin & masuk
  // mode edit.
  const [showAddTextStyles, setShowAddTextStyles] = useState(false);
  // Track teks custom yang dibikin user lewat "Add teks" — BUKAN
  // TemplateTextLayer polos, tapi TemplateLyricsTextLayer (engine yang
  // sama persis dgn klip "Lyrics" bawaan / "BUAH"-"MANGGIS"), biar teks
  // baru otomatis kebawa efek animasi glitch in/loop/out + bisa di-
  // custom lewat tab "Animasi" (LyricsAnimPanel) — BUKAN teks polos
  // statis. 1 entri = 1 track baru terpisah, TIDAK nimpa track yang lagi
  // diklik. Digabung sama template.lyricsTextLayers lewat allLyricsLayers
  // (didefinisikan di bawah, dekat lyricsTextEntries) di semua tempat
  // yang butuh daftar lengkap klip lirik (render canvas, timeline,
  // panel edit/animasi).
  const [customLyricsLayers, setCustomLyricsLayers] = useState<
    TemplateLyricsTextLayer[]
  >([]);
  const customLyricsCounterRef = useRef(0);
  // Id klip lirik (bawaan template MAUPUN custom) yang "dihapus" user lewat
  // tombol Hapus di quick menu, atau id klip ASAL yang udah dipecah jadi 2
  // lewat tombol Potong (Scissors) — di kedua kasus klip aslinya harus
  // hilang dari timeline & canvas, tapi datanya TETAP ada di
  // template.lyricsTextLayers/customLyricsLayers (nggak dimutasi langsung),
  // makanya di-filter di allLyricsLayers di bawah. 1 Set dipakai buat 2
  // skenario itu biar allLyricsLayers cuma butuh 1 filter, bukan 2 state
  // terpisah yang gampang lupa disinkronin.
  const [removedLyricsIds, setRemovedLyricsIds] = useState<Set<string>>(
    () => new Set(),
  );
  // allTextLayers = cuma text layer BIASA (judul/artist/dst) bawaan
  // template — track custom sekarang semuanya lewat jalur lirik
  // (customLyricsLayers), bukan di sini lagi.
  const allTextLayers: TemplateTextLayer[] = template.textLayers ?? [];


  // Hint bubble sekali-tampil ("teks ini bisa diubah") yang nunjuk ke
  // textLayer nama perangkat AirPlay di canvas — cuma buat kasih tau user
  // fitur custom text ini ada, ekornya nempel persis ke posisi teksnya.
  // Muncul sekali per browser (disimpen di localStorage), hilang kalau
  // di-tap silang atau kalau usernya udah masuk mode Teks & pilih track itu.
  const airplayHintLayer = useMemo(
    () => template.textLayers?.find((l) => l.id === "airplayDevice") ?? null,
    [template],
  );
  const [showAirplayHint, setShowAirplayHint] = useState(false);
  useEffect(() => {
    setShowAirplayHint(false);
    if (!airplayHintLayer) return;
    if (localStorage.getItem(AIRPLAY_HINT_DISMISSED_KEY) === "1") return;
    const showTimer = setTimeout(() => setShowAirplayHint(true), 700);
    return () => clearTimeout(showTimer);
  }, [airplayHintLayer]);
  function dismissAirplayHint() {
    setShowAirplayHint(false);
    localStorage.setItem(AIRPLAY_HINT_DISMISSED_KEY, "1");
  }

  // ---- Mesin render: state media tiap slot (diisi contoh dari internet
  // dulu via sampleSrc, user bisa ganti kapan saja) ----
  const [slotMedia, setSlotMedia] = useState(() => initialSlotMedia(template));
  // Slot foto sampul (cover) template ini — otomatis dipakai juga sebagai
  // sumber background, jadi user gak perlu pencet "Transfer" manual lagi.
  const coverSlotId = useMemo(
    () => template.slots.find((s) => s.type === "image")?.id ?? null,
    [template],
  );
  // Foto sampul (baik masih contoh/sample, atau udah diganti user) otomatis
  // dipakai jadi background, gantiin baseAssetSrc template pas render
  // preview maupun export. null = template ini gak punya slot foto sampul
  // sama sekali, jadi tetap pakai background asli.
  const [customBackground, setCustomBackground] = useState<SlotMediaEntry | null>(
    () => (coverSlotId ? initialSlotMedia(template)[coverSlotId] ?? null : null),
  );
  // Daftar foto default (Unsplash) buat slot sampul template ini, di-load
  // real-time dari Firebase — lihat lib/coverImages.ts. Selama ini masih
  // kosong, editor tetap jalan pakai sample statis lokal (sampleSrc) dulu
  // sebagai fallback instan, biar slot gak keliatan kosong pas nunggu.
  const [coverImages, setCoverImages] = useState<CoverImageEntry[]>([]);
  // Nge-pastiin foto default dari Firebase cuma di-random & diterapin
  // SEKALI per mount/template (bukan tiap kali daftarnya berubah real-time,
  // biar gak "loncat" ganti foto pas user lagi ngedit). Direset tiap ganti
  // template.
  const appliedCoverRef = useRef(false);
  // Opacity (0-100) & blur (0-MAX_BACKGROUND_BLUR px) khusus buat
  // background hasil auto-sync dari sampul — diatur lewat track
  // "Background" di timeline, cuma relevan selama customBackground aktif.
  const [backgroundOpacity, setBackgroundOpacity] = useState(100);
  // Template v4 defaultnya langsung full blur (100px) begitu dibuka.
  const [backgroundBlur, setBackgroundBlur] = useState(() =>
    defaultBackgroundBlurFor(template.id),
  );
  // Intensitas efek Glow (bloom) global, 0-100 — nempel di SELURUH isi
  // canvas (lihat applyGlowBloom di lib/render.ts), diatur lewat tab
  // "Efek" di toolbar bawah. Default 0 = mati.
  const [glowIntensity, setGlowIntensity] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  // Canvas 2D fillText() TIDAK auto-refresh kayak teks DOM begitu webfont
  // (lihat <link> Google Fonts di index.html) kelar di-load — kalau
  // render loop udah sempat jalan duluan sebelum font siap, hasilnya
  // "nyangkut" pakai font fallback sistem selamanya. Sekali render tick
  // ekstra begitu document.fonts.ready resolve, biar layer "Lyrics" pasti
  // ke-render ulang pakai font aslinya (Mulish/Poppins/dst), bukan cuma
  // pas kebetulan ada re-render lain (misal playhead gerak).
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready
      ?.then(() => {
        if (!cancelled) setRenderTick((t) => t + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const imageCacheRef = useRef(new ImageCache());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Container area preview (yang nge-flex-1 ngisi sisa ruang) — dipakai
  // buat ngukur berapa px yang beneran available, biar boks canvas bisa
  // di-"contain"-fit ke rasio yang dipilih user TANPA konflik CSS (lihat
  // catatan panjang di previewBoxSize di bawah).
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  // Ukuran boks canvas (px) hasil hitungan manual JS, BUKAN Tailwind
  // `aspect-[...]` class lagi. Kenapa: div boks sebelumnya pakai
  // `h-full` (paksa tinggi = tinggi container) BARENGAN `aspect-[ratio]`
  // — dua constraint itu SALING KONFLIK di CSS. Browser nge-resolve-nya
  // dengan TETAP mempertahankan h-full (tinggi = penuh, "tinggi" kayak
  // potret) terus lebar di-clamp ke max-w-full (sempit) TANPA
  // nge-recompute tinggi biar rasio-nya bener — jadi boksnya nggak
  // pernah beneran jadi bentuk landscape pas milih 16:9, tetap
  // "tinggi&sempit", dan canvas 1920x1080 yang di-object-cover ke boks
  // tinggi-sempit itu jadi ke-crop parah/"zoom" (persis yang dilaporin
  // user). Fix: hitung sendiri lewat ResizeObserver — lebar & tinggi
  // boks SELALU proporsional ke rasio target, di-"contain" ke ruang yang
  // available (kayak object-fit:contain), gak ada lagi tarik-menarik
  // constraint CSS.
  const [previewBoxSize, setPreviewBoxSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  // Nyimpen FILE ASLI (sebelum di-crop) per slotId — BUKAN url-nya —
  // biar tombol "Crop" selalu mulai dari sumber originalnya (bukan
  // numpuk crop di atas hasil crop sebelumnya). Sengaja simpen File
  // (bukan object URL) terus bikin object URL BARU tiap kali overlay
  // crop dibuka: nyimpen url lama-lama itu rawan jadi "basi"/invalid di
  // sebagian browser (terutama HP begitu tab di-background), sedangkan
  // File-nya sendiri aman disimpen selama masih ada referensinya di JS.
  const originalFileRef = useRef<Record<string, File>>({});
  // Foto yang lagi nunggu di-crop user lewat <ImageCropModal> — null
  // berarti overlay crop lagi ketutup. Diisi begitu user pilih file baru
  // ATAU pencet tombol "Crop" buat foto yang udah ada (lihat
  // handleFileChange & handleOpenCropForSlot).
  const [cropTarget, setCropTarget] = useState<{
    slotId: string;
    url: string;
    targetWidth: number;
    targetHeight: number;
    // Diisi kalau url di atas adalah object URL yang BARU dibikin dari
    // File (baik upload baru maupun recrop dari originalFileRef) — jadi
    // WAJIB di-revoke begitu sesi crop ini selesai (confirm/batal), beda
    // dari sample remote (https://...) yang bukan blob & gak perlu/gak
    // boleh di-revoke.
    file?: File;
  } | null>(null);

  // ---- Bottom sheet buat panel "banyak kontrol" (Background & Liquid
  // Glass) — sengaja dipisah dari toolbar bawah biasa dan dirender sebagai
  // overlay `position:absolute`, BUKAN elemen flex biasa yang ikut dorong
  // layout. Efeknya: canvas preview di atas selalu dapat tinggi penuh
  // (nggak nyusut lagi tiap kali user buka panel custom), dan user bisa
  // drag handle-nya buat ngatur berapa banyak canvas yang mau keliatan
  // sambil ngatur slider (mirip bottom sheet CapCut/InShot). Tinggi
  // disimpan dalam px & di-clamp tiap drag biar nggak nutupin top bar
  // atau ilang ke luar layar.
  const [sheetHeight, setSheetHeight] = useState(() =>
    typeof window !== "undefined" ? Math.round(window.innerHeight * 0.46) : 320,
  );
  const sheetDragRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );

  function clampSheetHeight(h: number) {
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    return Math.min(viewportH * 0.82, Math.max(180, h));
  }

  function handleSheetDragStart(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDragRef.current = { startY: e.clientY, startHeight: sheetHeight };
  }

  function handleSheetDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!sheetDragRef.current) return;
    const delta = e.clientY - sheetDragRef.current.startY;
    setSheetHeight(clampSheetHeight(sheetDragRef.current.startHeight - delta));
  }

  function handleSheetDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (sheetDragRef.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    sheetDragRef.current = null;
  }

  // Drag handle dipakai di dua panel (Background & Glass) — komponen
  // kecil biar nggak duplikasi markup.
  function SheetDragHandle() {
    return (
      <div
        onPointerDown={handleSheetDragStart}
        onPointerMove={handleSheetDragMove}
        onPointerUp={handleSheetDragEnd}
        onPointerCancel={handleSheetDragEnd}
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2 active:cursor-grabbing"
        title="Geser buat atur tinggi panel"
      >
        <div className="h-1 w-10 rounded-full bg-mute/30" />
      </div>
    );
  }

  // ---- Tinggi panel Timeline (bisa di-drag naik/turun) ----
  // Timeline defaultnya makan ruang lumayan besar. Biar canvas preview
  // bisa keliatan penuh kalau dibutuhkan, tinggi panel ini dibuat
  // adjustable lewat handle drag di atasnya (pola sama kayak SheetDragHandle
  // di atas) — geser ke bawah = panel mengecil = canvas kelihatan lebih
  // penuh, geser ke atas = panel membesar lagi.
  const [timelineHeight, setTimelineHeight] = useState(() =>
    typeof window !== "undefined" ? Math.round(window.innerHeight * 0.26) : 200,
  );
  const timelineDragRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );

  function clampTimelineHeight(h: number) {
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    // Minimum kecil banget (cuma handle + sedikit ruler) biar canvas bisa
    // hampir penuh; maksimum dibatasi biar nggak nutupin top bar & preview.
    return Math.min(viewportH * 0.55, Math.max(40, h));
  }

  function handleTimelineDragStart(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    timelineDragRef.current = { startY: e.clientY, startHeight: timelineHeight };
  }

  function handleTimelineDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!timelineDragRef.current) return;
    const delta = e.clientY - timelineDragRef.current.startY;
    setTimelineHeight(
      clampTimelineHeight(timelineDragRef.current.startHeight - delta),
    );
  }

  function handleTimelineDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (
      timelineDragRef.current &&
      e.currentTarget.hasPointerCapture(e.pointerId)
    ) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    timelineDragRef.current = null;
  }

  // ---- Visibilitas elemen di timeline ----
  // Set berisi id elemen (slot foto/video, "Background", decor layer
  // adjustable, atau text layer) yang lagi di-hide user lewat ikon mata
  // di kiri track. Elemen yang di-hide nggak digambar di canvas preview
  // MAUPUN di hasil export — bener-bener "dimatiin", bukan cuma disamarin
  // di timeline doang.
  const [hiddenElements, setHiddenElements] = useState<Set<string>>(
    () => new Set(),
  );
  function toggleElementHidden(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setHiddenElements((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- Export state ----
  const [isExporting, setIsExporting] = useState(false);
  const [exportSnapshot, setExportSnapshot] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [exportResultUrl, setExportResultUrl] = useState<string | null>(null);
  const [exportEngineUsed, setExportEngineUsed] = useState<ExportEngine | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  // ---- Analisis audio asli: durasi & waveform (bukan durasi template
  // yang di-hardcode) ----
  const [audioInfo, setAudioInfo] = useState<AudioAnalysis | null>(null);
  // ---- Gaya tampilan progress lagu — "bar" (garis isian polos, standar)
  // atau "waveform" (bar equalizer ngikutin bentuk lagu asli, "berjalan"
  // sesuai posisi playhead). Ini pilihan LEVEL PROJECT, bukan properti
  // template — jadi berlaku buat template MANAPUN yang punya
  // progressLayer, bukan cuma satu template tertentu. ----
  const [progressStyle, setProgressStyle] = useState<"bar" | "waveform">(
    initialProgressStyle ?? "bar",
  );
  // ---- Daftar foto default (Unsplash) template ini — dengerin real-time
  // dari Firebase (config/coverImages/{templateId}), lihat lib/coverImages.ts.
  // Begitu daftarnya nyampe, foto sampul yang masih "sample" (belum diganti
  // user) di-random-in satu dari daftar ini & langsung nyontek jadi
  // background juga (lewat customBackground, sama kayak upload manual).
  //
  // "iphone-music-player-glass" SENGAJA dilewatin (skip) dari sistem ini —
  // template ini pakai satu foto tetap dari file lokal
  // (/templates/iphone-music-player-glass/sample-cover.jpg, sekarang foto
  // kucing) sebagai default-nya, bukan foto random dari Firebase/Unsplash.
  // Jadi apapun isi node Firebase-nya, gak akan pernah nimpa sample lokal
  // ini. ----
  useEffect(() => {
    appliedCoverRef.current = false;
    if (SKIP_DYNAMIC_COVER_TEMPLATE_IDS.has(template.id)) {
      setCoverImages([]);
      return;
    }
    const unsubscribe = subscribeCoverImages(template.id, setCoverImages);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);
  useEffect(() => {
    if (!coverSlotId || coverImages.length === 0 || appliedCoverRef.current) {
      return;
    }
    appliedCoverRef.current = true;
    // User udah keburu upload foto sendiri sebelum daftar Firebase nyampe
    // -> jangan diganggu/ditimpa foto random.
    if (slotMedia[coverSlotId]?.kind === "file") return;
    const picked = coverImages[Math.floor(Math.random() * coverImages.length)];
    const entry: SlotMediaEntry = { kind: "sample", url: picked.url };
    setSlotMedia((prev) => ({ ...prev, [coverSlotId]: entry }));
    setCustomBackground(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverImages, coverSlotId]);
  // ---- Klip-klip di track audio (hasil potong/geser/trim user). Mulai
  // dari satu klip yang membentang penuh file audio, direset tiap kali
  // audio-nya diganti (lihat effect analisis audio di bawah). ----
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  // Klip audio yang lagi diketuk/terseleksi di timeline — beda dari
  // selectedSlotId (itu buat toolbar "Ganti Audio"), ini khusus nentuin
  // klip mana yang nampilin handle trim kiri/kanan & bisa digeser/dipotong.
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(
    null,
  );
  // ---- Lebar area timeline yang kelihatan, dipakai biar track selalu
  // mepet ke kanan layar baik durasinya panjang maupun pendek ----
  const [viewportWidth, setViewportWidth] = useState(340);
  // Label "Background kustom" di pojok kiri atas preview — cuma nongol
  // 3 detik tiap kali background kustom baru dipasang, abis itu fade out
  // sendiri (biar nggak nutupin preview terus-terusan). Klik masih bisa
  // lewat track "Background" di timeline bawah.
  const [showBgLabel, setShowBgLabel] = useState(false);

  // Mode preview full screen — cuma kanvas yang kelihatan, top bar,
  // playback controls, timeline & toolbar bawah semua di-hide. Ini
  // full-screen "in-app" (bukan Fullscreen API browser), biar konsisten
  // di semua browser/WebView mobile.
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Panel "Preset" — simpan/muat jepretan pengaturan (opacity, blur, gaya
  // progress, teks, & foto/background) biar gak perlu ngatur ulang dari nol
  // tiap buka project baru.
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetBusyId, setPresetBusyId] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  // ---- Auto-save Draft Project ----
  // Beda dari Preset (disimpan manual, pakai nama, jumlahnya bebas): draft
  // ini AUTO-SAVE diam-diam tiap kali ada perubahan, cuma nyimpen state
  // PALING TERAKHIR (bukan riwayat), dan dibatasi maksimal 3 draft
  // bersamaan (lihat lib/drafts.ts) — draft paling lama yang gak
  // disentuh otomatis kehapus kalau limitnya kelebihan.
  //
  // draftIdRef: id draft yang lagi "dipegang" Editor ini. Kalau Editor
  // dibuka dari tab Draft (lanjutin project lama), langsung diisi
  // resumeDraftId. Kalau dibuka dari galeri Template (project baru),
  // dibiarkan null dulu — auto-save PERTAMA yang bakal generate id-nya.
  const draftIdRef = useRef<string | null>(resumeDraftId ?? null);
  // true selama proses hydrate draft lama masih jalan (fetch dari
  // IndexedDB + terapin ke semua state) — auto-save DIJEDA sementara,
  // biar draft yang baru aja dimuat gak ketimpa balik oleh state awal
  // (default template) sebelum sempat ke-hydrate.
  const hydratingDraftRef = useRef(!!resumeDraftId);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Indikator kecil "Tersimpan" di top bar — nyala sebentar tiap kali
  // auto-save berhasil, biar user yakin project-nya kesimpen tanpa perlu
  // pencet tombol apa pun.
  const [draftSavedFlash, setDraftSavedFlash] = useState(false);
  const draftSavedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // ---- Riwayat Undo/Redo ----------------------------------------------
  // historyRef.past  : tumpukan snapshot SEBELUM state sekarang (paling
  //                     baru di ujung array) — dipakai tombol Undo.
  // historyRef.future: tumpukan snapshot yang barusan di-undo — dipakai
  //                     tombol Redo, DIKOSONGKAN lagi begitu ada
  //                     perubahan baru (bukan hasil undo/redo sendiri).
  // Disimpan di ref (bukan state) biar gak numpuk re-render tiap detik;
  // historyVersion di bawah cuma dipakai buat "maksa" re-render dikit
  // spy tombol Undo/Redo bisa update kondisi disabled-nya.
  const historyRef = useRef<{ past: ProjectSnapshot[]; future: ProjectSnapshot[] }>({
    past: [],
    future: [],
  });
  // Snapshot state project paling akhir yang udah "ke-commit" ke riwayat —
  // jadi baseline pembanding tiap kali ada perubahan baru masuk.
  const lastSnapshotRef = useRef<ProjectSnapshot | null>(null);
  // true sesaat setelah applyProjectSnapshot() manggil semua setter (pas
  // Undo/Redo ditekan) — effect pencatat riwayat di bawah bakal skip satu
  // kali biar perubahan akibat Undo/Redo gak ke-catat lagi jadi langkah
  // baru (yang bakal bikin future keputus/ilang).
  const isApplyingHistoryRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setHistoryVersion] = useState(0);

  function captureProjectSnapshot(): ProjectSnapshot {
    return {
      slotMedia,
      customBackground,
      layerOpacity,
      glassSettings,
      backgroundOpacity,
      backgroundBlur,
      progressStyle,
      glowIntensity,
      textValues,
      textColors,
      audioClips,
      hiddenElements,
      customLyricsLayers,
      removedLyricsIds,
      lyricsSettings,
    };
  }

  function applyProjectSnapshot(snap: ProjectSnapshot) {
    isApplyingHistoryRef.current = true;
    setSlotMedia(snap.slotMedia);
    setCustomBackground(snap.customBackground);
    setLayerOpacity(snap.layerOpacity);
    setGlassSettings(snap.glassSettings);
    setBackgroundOpacity(snap.backgroundOpacity);
    setBackgroundBlur(snap.backgroundBlur);
    setProgressStyle(snap.progressStyle);
    setGlowIntensity(snap.glowIntensity);
    setTextValues(snap.textValues);
    setTextColors(snap.textColors);
    setAudioClips(snap.audioClips);
    setHiddenElements(snap.hiddenElements);
    setCustomLyricsLayers(snap.customLyricsLayers);
    setRemovedLyricsIds(snap.removedLyricsIds);
    setLyricsSettings(snap.lyricsSettings);
    lastSnapshotRef.current = snap;
  }

  function handleUndo() {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const current = lastSnapshotRef.current ?? captureProjectSnapshot();
    historyRef.current = { past: past.slice(0, -1), future: [...future, current] };
    applyProjectSnapshot(previous);
    setHistoryVersion((v) => v + 1);
  }

  function handleRedo() {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const current = lastSnapshotRef.current ?? captureProjectSnapshot();
    historyRef.current = { past: [...past, current], future: future.slice(0, -1) };
    applyProjectSnapshot(next);
    setHistoryVersion((v) => v + 1);
  }

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // Shortcut keyboard standar: Ctrl/Cmd+Z buat Undo, Ctrl/Cmd+Shift+Z atau
  // Ctrl/Cmd+Y buat Redo. Dilewatin kalau fokus lagi di input/textarea
  // (mis. lagi ngetik judul lagu) biar gak nabrak undo bawaan browser
  // buat teks yang lagi diketik.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (key === "z") {
        e.preventDefault();
        handleUndo();
      } else if (key === "y") {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect ini yang beneran "mencatat" tiap perubahan state project ke
  // riwayat Undo — jalan tiap salah satu dependency di bawah berubah,
  // didebounce dikit (400ms) biar perubahan yang beruntun cepat (mis.
  // geser slider opacity, ketik teks huruf demi huruf) numpuk jadi SATU
  // langkah undo, bukan puluhan langkah kecil per keystroke.
  useEffect(() => {
    if (hydratingDraftRef.current) return;
    // Belum ada baseline sama sekali (baru mount / baru selesai hydrate
    // draft) — jadiin state sekarang sebagai titik awal riwayat, JANGAN
    // dicatat sebagai langkah undo (gak ada "sebelum"-nya).
    if (!lastSnapshotRef.current) {
      lastSnapshotRef.current = captureProjectSnapshot();
      return;
    }
    // Perubahan ini akibat applyProjectSnapshot() sendiri (Undo/Redo) —
    // baseline-nya udah di-update di situ, jangan dicatat ulang jadi
    // langkah baru (nanti future-nya keputus terus).
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const previous = lastSnapshotRef.current;
      if (!previous) return;
      historyRef.current = { past: [...historyRef.current.past, previous], future: [] };
      lastSnapshotRef.current = captureProjectSnapshot();
      setHistoryVersion((v) => v + 1);
    }, 400);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slotMedia,
    customBackground,
    layerOpacity,
    glassSettings,
    backgroundOpacity,
    backgroundBlur,
    progressStyle,
    glowIntensity,
    textValues,
    textColors,
    audioClips,
    hiddenElements,
    customLyricsLayers,
    removedLyricsIds,
    lyricsSettings,
  ]);

  // Hydrate semua state Editor dari draft lama (kalau resumeDraftId ada) —
  // jalan SEKALI pas mount, sebelum auto-save pertama diizinkan jalan.
  useEffect(() => {
    if (!resumeDraftId) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await getDraftRecord(resumeDraftId);
        if (!record || cancelled) return;
        draftIdRef.current = record.id;

        const nextSlotMedia = initialSlotMedia(template);
        for (const slot of template.slots) {
          const stored = record.slotMedia[slot.id];
          if (stored) {
            nextSlotMedia[slot.id] = storedMediaToEntry(
              stored,
              `${slot.id}-draft`,
            );
          }
        }
        setSlotMedia(nextSlotMedia);
        setCustomBackground(
          record.customBackground
            ? storedMediaToEntry(record.customBackground, "background-draft")
            : null,
        );
        setLayerOpacity((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (record.layerOpacity[key] !== undefined) {
              next[key] = record.layerOpacity[key];
            }
          }
          return next;
        });
        setGlassSettings(record.glassSettings ?? {});
        setBackgroundOpacity(record.backgroundOpacity);
        setBackgroundBlur(record.backgroundBlur);
        setProgressStyle(record.progressStyle);
        setGlowIntensity(record.glowIntensity ?? 0);
        setTextValues((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (record.textValues[key] !== undefined) {
              next[key] = record.textValues[key];
            }
          }
          return next;
        });
        setTextColors(record.textColors ?? {});
        setAudioClips(record.audioClips.map((c) => ({ ...c })));
        setHiddenElements(new Set(record.hiddenElements));
        setCurrentSec(record.currentSec ?? 0);
      } catch {
        // Gagal muat draft (mis. sudah kehapus/eviction browser) — biarin
        // Editor tetap kebuka normal pakai default template, gak usah
        // nge-block user dengan alert.
      } finally {
        if (!cancelled) {
          // Reset baseline riwayat Undo — state hasil hydrate draft ini
          // yang jadi titik awal baru, biar Undo pertama user gak malah
          // "mundur" ke project kosong sebelum draft dimuat.
          historyRef.current = { past: [], future: [] };
          lastSnapshotRef.current = null;
          hydratingDraftRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftId]);

  async function autosaveDraftNow() {
    if (hydratingDraftRef.current) return;
    try {
      const thumbnail = canvasRef.current?.toDataURL("image/jpeg", 0.55) ?? null;
      const record = await saveDraft(draftIdRef.current, {
        template,
        layerOpacity,
        glassSettings,
        backgroundOpacity,
        backgroundBlur,
        progressStyle,
        glowIntensity,
        textValues,
        textColors,
        slotMedia,
        customBackground,
        audioClips,
        hiddenElements,
        currentSec,
        thumbnail,
      });
      draftIdRef.current = record.id;
      setDraftSavedFlash(true);
      if (draftSavedFlashTimerRef.current) {
        clearTimeout(draftSavedFlashTimerRef.current);
      }
      draftSavedFlashTimerRef.current = setTimeout(
        () => setDraftSavedFlash(false),
        1800,
      );
    } catch {
      // Auto-save diam-diam gagal (mis. storage penuh/browser nolak) —
      // jangan ganggu user dengan alert; Preset manual tetap ada sebagai
      // cadangan buat nyimpen kerjaan pentingnya.
    }
  }

  // Auto-save di-debounce ~1.5 detik tiap ada perubahan di state utama
  // project — "ambil perubahan paling akhir aja", jadi tiap perubahan baru
  // menunda (bukan menumpuk) penyimpanan sebelumnya.
  useEffect(() => {
    if (hydratingDraftRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void autosaveDraftNow();
    }, 1500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slotMedia,
    customBackground,
    layerOpacity,
    glassSettings,
    backgroundOpacity,
    backgroundBlur,
    progressStyle,
    glowIntensity,
    textValues,
    textColors,
    audioClips,
    hiddenElements,
  ]);

  const audioSlotDef = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlotDef ? slotMedia[audioSlotDef.id] : undefined;
  // Dulu blok track slot di timeline cuma nyala kalau template punya
  // baseAssetSrc (foto/video dasar) — template kayak "Lyrics" yang
  // background-nya solidBackground (bukan baseAssetSrc) jadi ketimpa
  // placeholder statis walau sekarang udah dikasih slots (lihat
  // data/templates.ts). Gating yang bener: selama template ini PUNYA
  // slot sama sekali (media dan/atau audio), track-nya harus dirender —
  // baseAssetSrc cuma salah satu cara nyediain visual dasarnya.
  const hasSlotTracks = Boolean(template.baseAssetSrc) || template.slots.length > 0;
  // Slot media pertama (foto/video, bukan audio) — dipakai tombol "Media"
  // di toolbar bawah buat langsung menuju slot itu (sama seperti nge-tap
  // slot-nya langsung di timeline), tanpa buka file picker duluan.
  const mediaSlotDef = template.slots.find((s) => s.type !== "audio");
  // Tab "Gaya" (pilihan progress bar) cuma relevan buat template yang
  // punya progressLayer — biar reusable ke template lain yang gak punya
  // elemen ini tanpa nampilin tab kosong/gak guna.
  // 4 tab selalu tampil (samain persis mock-up) — konten tab "Gaya" sendiri
  // tetap dicek template.progressLayer di bawah, jadi kalau template gak
  // punya progress bar, tab-nya tetap kelihatan tapi gak nampilin apa-apa
  // pas ditekan (bukan ke-hide kayak sebelumnya).
  const visibleTools = TOOLS;

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Munculin label "Background kustom" tiap kali background kustom baru
  // dipasang, lalu otomatis fade-out sendiri setelah 3 detik.
  useEffect(() => {
    if (!customBackground) {
      setShowBgLabel(false);
      return;
    }
    setShowBgLabel(true);
    const timer = setTimeout(() => setShowBgLabel(false), 3000);
    return () => clearTimeout(timer);
  }, [customBackground]);

  // Baca durasi asli + waveform tiap kali audio diganti user
  useEffect(() => {
    let cancelled = false;
    setAudioInfo(null);
    // Audio ganti (upload baru/dihapus) — mulai lagi dari nol: satu klip
    // utuh nanti dibuat begitu durasi asli diketahui (lihat .then di bawah).
    setAudioClips([]);
    setSelectedAudioClipId(null);
    if (!audioMedia) return;
    // Blob URL dulu, File cuma fallback — File mentah dari input picker suka
    // jadi stale di Chrome Android (bikin FileReader gagal baca).
    const source = audioMedia.url ?? audioMedia.file;
    analyzeAudio(source, WAVEFORM_BAR_COUNT)
      .then((info) => {
        if (cancelled) return;
        setAudioInfo(info);
        // Klip default: satu klip yang membentang dari 0 sampai akhir file,
        // ditempel dari detik 0 di timeline.
        setAudioClips([
          { id: makeClipId(), trimStart: 0, trimEnd: info.duration, offset: 0 },
        ]);
      })
      .catch(() => {
        if (!cancelled) setAudioInfo(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMedia?.url]);

  // Muat daftar preset tiap kali panel-nya dibuka.
  useEffect(() => {
    if (!showPresetPanel) return;
    let cancelled = false;
    setPresetsLoading(true);
    setPresetError(null);
    ensurePersistentStorage();
    listPresets()
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setPresetError(
            e instanceof Error ? e.message : "Gagal memuat daftar preset.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPresetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showPresetPanel]);


  const templateDurationSec = Math.max(0.1, parseDurationSec(template.duration));
  // Durasi beneran yang dipakai preview: ikut audio asli kalau sudah
  // diupload, kalau belum tetap pakai durasi template.
  const DURATION = audioInfo?.duration ?? templateDurationSec;
  // Skala waktu buat slot foto/video lain, biar posisinya proporsional
  // ikut memanjang/memendek sesuai durasi audio asli (sama seperti logic
  // export.ts, jadi preview & hasil export konsisten).
  const timeScale = audioInfo?.duration
    ? audioInfo.duration / templateDurationSec
    : 1;

  const TIME_MARKS = generateTimeMarks(DURATION);
  // Kepadatan piksel/detik dinamis: kalau durasinya pendek, rapetin
  // supaya track pas mepet ke tepi kanan viewport. Kalau durasinya
  // panjang, turun ke minimum & jadi scrollable horizontal.
  const effectivePxPerSec = Math.max(
    MIN_PX_PER_SEC,
    (viewportWidth - 24) / DURATION,
  );
  const TRACK_WIDTH = Math.max(
    viewportWidth,
    DURATION * effectivePxPerSec + 24,
  );

  // Slot dengan startSec/endSec yang sudah di-scale ke DURATION asli.
  // Slot audio selalu dianggap membentang penuh 0..DURATION (satu file
  // utuh), slot lain (foto/video) di-scale proporsional.
  const effectiveSlots = template.slots.map((slot) => {
    if (slot.type === "audio") {
      return { ...slot, startSec: 0, endSec: DURATION };
    }
    return {
      ...slot,
      startSec: (slot.startSec ?? 0) * timeScale,
      endSec: (slot.endSec ?? templateDurationSec) * timeScale,
    };
  });

  // Slot lagi terseleksi (dari klik layer/canvas) — dipakai buat nentuin
  // isi toolbar bawah (kalau ada, ganti jadi tombol "Ganti").
  const selectedSlot = template.slots.find((s) => s.id === selectedSlotId);

  // Offset horizontal (px) buat nyamain posisi playhead & ruler sama
  // posisi ASLI klip di track foto/video/teks — klip-klip itu sengaja
  // digeser ke kanan (lihat clipLeft di bawah) biar nggak ketutupan
  // TrackLabel (pill label + ikon mata yang nempel "sticky left-1" di
  // kiri tiap baris track, gayanya diambil dari repo Mock-up). Kalau
  // offset ini nggak ada, garis putih playhead pas di detik 0 nongkrong
  // di x=0 (mentok kiri banget, ketutupan pill label), padahal klip
  // aslinya baru mulai gambar setelah pill — jadi playhead keliatan
  // "nggak nyambung"/ketinggalan dari klip. Makanya playhead & ruler
  // ikut digeser sebesar offset ini biar titik 0 mereka SAMA PERSIS
  // sama titik mulai klip yang keliatan di layar.
  // 104px lebar pill label kiri + jarak sticky (left-1 = 4px) + sedikit
  // gap sebelum klip mulai.
  const TIMELINE_CLIP_OFFSET_PX = 116;

  // decorLayers dipisah "back" (di belakang slot foto/video) & "front"
  // (di depan/atas slot), dipakai di render loop biar urutan gambarnya
  // bener. Cuma layer "adjustable" yang bisa diklik & punya slider opacity.
  const backDecorLayers = (template.decorLayers ?? []).filter(
    (l) => l.order === "back",
  );
  const frontDecorLayers = (template.decorLayers ?? []).filter(
    (l) =>
      l.order === "front" &&
      !(progressStyle === "waveform" && l.hideInWaveformMode),
  );
  const adjustableLayers = (template.decorLayers ?? []).filter(
    (l) => l.adjustable,
  );
  const selectedLayer = adjustableLayers.find((l) => l.id === selectedLayerId);
  // Setelan kaca efektif buat 1 layer: default template + override user
  // (kalau ada) — dipakai baik di render loop maupun di panel slider.
  const getEffectiveGlassSettings = (
    layer: (typeof adjustableLayers)[number],
  ): LiquidGlassSettings =>
    layer.liquidGlass
      ? { ...layer.liquidGlass.settings, ...glassSettings[layer.id] }
      : DEFAULT_LIQUID_GLASS_SETTINGS;
  // Layer "Lyrics" (kalau template ini punya) diwakilkan sebagai 2 entri
  // teks biasa (baris atas & bawah), biar bisa dipakai LANGSUNG lewat
  // mekanisme edit teks yang udah ada (renderTextTrack, textValues,
  // textColors, panel "Teks" di toolbar bawah) tanpa bikin UI baru dari
  // nol. id-nya sengaja "<lyricsId>__top"/"<lyricsId>__bottom" — dibaca
  // balik sama render loop (lihat drawLyricsTextLayer di useEffect di
  // atas) buat ngambil override teks & warna user.
  // allLyricsLayers = klip lirik bawaan template + custom bikinan user
  // lewat "Add teks" (customLyricsLayers) — 1 sumber tunggal, dipakai
  // gantiin template.lyricsTextLayers polos di semua tempat yang relevan
  // (render canvas, daftar entri teks, getEffectiveLyricsLayer, export).
  const allLyricsLayers: TemplateLyricsTextLayer[] = [
    ...(template.lyricsTextLayers ?? []),
    ...customLyricsLayers,
  ].filter((l) => !removedLyricsIds.has(l.id));
  const lyricsTextEntries: TemplateTextLayer[] = allLyricsLayers.flatMap(
    (l) => [
    {
      id: `${l.id}__top`,
      label: `${l.label} (baris atas)`,
      defaultText: l.defaultTopText,
      x: 50,
      y: 50,
      fontSize: l.topFontSize,
      color: l.colorTop,
      align: "center" as const,
      maxLength: 40,
    },
    {
      id: `${l.id}__bottom`,
      label: `${l.label} (baris bawah)`,
      defaultText: l.defaultBottomText,
      x: 50,
      y: 50,
      fontSize: l.bottomFontSize,
      color: l.colorBottom,
      align: "center" as const,
      maxLength: 40,
    },
  ]);
  // Track teks (dalam isTextMode) yang lagi terseleksi — dipakai buat nentuin
  // isi toolbar bawah (input edit teks khusus layer itu). Digabung sama
  // lyricsTextEntries biar 2 baris lirik juga bisa keseleksi & diedit.
  const selectedTextLayer = [
    ...allTextLayers,
    ...lyricsTextEntries,
  ].find((l) => l.id === selectedTextLayerId);
  // id entri teks lirik selalu "<lyricsId>__top"/"<lyricsId>__bottom" (lihat
  // lyricsTextEntries di atas) — helper ini buat balikin lyricsId asli-nya,
  // dan null kalau id yang dikasih BUKAN entri lirik (text layer biasa).
  const lyricsBaseIdOf = (id: string): string | null => {
    const m = id.match(/^(.+)__(top|bottom)$/);
    return m ? m[1] : null;
  };
  const selectedLyricsBaseId = selectedTextLayer
    ? lyricsBaseIdOf(selectedTextLayer.id)
    : null;
  // Setting animasi efektif 1 klip lirik: default dari template + override
  // user (lyricsSettings), dipakai baik di render loop maupun di panel
  // "Animasi" (form controlled langsung dari sini, tanpa state duplikat).
  const getEffectiveLyricsLayer = (
    baseId: string,
  ): TemplateLyricsTextLayer | null => {
    const base = allLyricsLayers.find((l) => l.id === baseId);
    if (!base) return null;
    return { ...base, ...lyricsSettings[baseId] };
  };
  function updateLyricsSetting<K extends keyof TemplateLyricsTextLayer>(
    baseId: string,
    key: K,
    value: TemplateLyricsTextLayer[K],
  ) {
    setLyricsSettings((prev) => ({
      ...prev,
      [baseId]: { ...prev[baseId], [key]: value },
    }));
  }
  // Bikin 1 klip teks lirik BARU (engine animasi sama persis dgn "BUAH"/
  // "MANGGIS") dgn style warna yg dipilih user di "Add teks" — Ungu
  // (baris atas aktif) atau Putih (baris bawah aktif). Baris yang gak
  // dipakai di-set transparan + font kecil + disembunyikan, jadi visualnya
  // tetap 1 baris teks (bukan 2 baris kayak klip Lyrics bawaan), TAPI
  // tetap kebawa full animasi in/loop/out + bisa di-custom lewat tab
  // "Animasi". Langsung terseleksi & masuk mode edit teks kosong.
  function addCustomTextLayer(style: "purple" | "white") {
    customLyricsCounterRef.current += 1;
    const n = customLyricsCounterRef.current;
    const newId = `custom-lyrics-${n}`;
    const isPurple = style === "purple";
    const newLayer = defaultLyricsLayer({
      id: newId,
      label: `Teks ${n}`,
      defaultTopText: "",
      defaultBottomText: "",
      colorTop: isPurple ? "#c3b0ff" : "transparent",
      colorBottom: isPurple ? "transparent" : "#FFFFFF",
      topFontSize: isPurple ? 90 : 1,
      bottomFontSize: isPurple ? 1 : 90,
      startSec: 0,
      endSec: DURATION,
    });
    setCustomLyricsLayers((prev) => [...prev, newLayer]);
    const activeLineId = `${newId}__${isPurple ? "top" : "bottom"}`;
    const inactiveLineId = `${newId}__${isPurple ? "bottom" : "top"}`;
    setHiddenElements((prev) => new Set(prev).add(inactiveLineId));
    setSelectedSlotId(null);
    setSelectedLayerId(null);
    setSelectedTextLayerId(activeLineId);
    setShowAddTextStyles(false);
    setTextToolbarMode("edit");
    setLyricsPanelTab("teks");
  }

  // Tombol gunting di quick menu track teks — motong 1 klip lirik (baris
  // atas+bawahnya sekaligus, karena 1 klip = 1 pasang baris) jadi DUA klip
  // terpisah di titik playhead sekarang, PERSIS pola handleCutAudio di
  // atas (klip lama "diganti" jadi 2 klip baru). Bedanya sama audio: di
  // sini titik potongnya otomatis jadi batas endSec klip kiri (jadi
  // animasi OUT klip kiri "pindah" ke titik potong) & startSec klip kanan
  // (animasi IN klip kanan mulai dari situ) — style/durasi in & out-nya
  // sendiri TETAP dipertahankan sama persis kayak klip asalnya, cuma
  // posisinya yang ngikut ke titik potong baru (lihat getLyricsTimeline di
  // lib/lyricsAnim.ts, yang emang selalu ngitung in/out relatif ke
  // startSec/endSec klip, bukan posisi absolut tetap).
  function handleCutLyricsClip(baseId: string) {
    const eff = getEffectiveLyricsLayer(baseId);
    if (!eff) return;
    const cutSec = currentSec;
    if (
      cutSec <= eff.startSec + MIN_LYRICS_CLIP_DURATION ||
      cutSec >= eff.endSec - MIN_LYRICS_CLIP_DURATION
    ) {
      return;
    }
    const leftId = makeClipId();
    const rightId = makeClipId();
    const leftLayer: TemplateLyricsTextLayer = {
      ...eff,
      id: leftId,
      endSec: cutSec,
    };
    const rightLayer: TemplateLyricsTextLayer = {
      ...eff,
      id: rightId,
      startSec: cutSec,
    };
    setCustomLyricsLayers((prev) => [...prev, leftLayer, rightLayer]);
    // Klip asal (bawaan template ATAU custom) disembunyikan permanen —
    // datanya sendiri dibiarkan apa adanya, cuma di-filter di
    // allLyricsLayers (lihat komentar di deklarasi removedLyricsIds).
    setRemovedLyricsIds((prev) => new Set(prev).add(baseId));

    // Isi teks/warna/status sembunyi baris atas & bawah klip asal dibawa
    // turun ke KEDUA klip hasil potongan, biar isinya identik dulu pas
    // baru dipotong (user lanjut edit salah satu/keduanya kalau perlu).
    const parts = ["top", "bottom"] as const;
    setTextValues((prev) => {
      const next = { ...prev };
      for (const part of parts) {
        const val = prev[`${baseId}__${part}`];
        if (val !== undefined) {
          next[`${leftId}__${part}`] = val;
          next[`${rightId}__${part}`] = val;
        }
      }
      return next;
    });
    setTextColors((prev) => {
      const next = { ...prev };
      for (const part of parts) {
        const val = prev[`${baseId}__${part}`];
        if (val !== undefined) {
          next[`${leftId}__${part}`] = val;
          next[`${rightId}__${part}`] = val;
        }
      }
      return next;
    });
    setHiddenElements((prev) => {
      const next = new Set(prev);
      for (const part of parts) {
        if (prev.has(`${baseId}__${part}`)) {
          next.add(`${leftId}__${part}`);
          next.add(`${rightId}__${part}`);
        }
      }
      return next;
    });

    // Lanjut pilih klip KANAN (hasil potongan setelah playhead) — sama
    // kayak handleCutAudio milih rightClip — pas di baris yang sama
    // (atas/bawah) yang lagi diedit user sebelum motong.
    const suffix = selectedTextLayerId?.endsWith("__bottom")
      ? "bottom"
      : "top";
    setSelectedTextLayerId(`${rightId}__${suffix}`);
  }

  // Tombol tong sampah di quick menu track teks — hapus 1 klip lirik
  // (baris atas+bawahnya) secara permanen dari timeline. Beda dari
  // handleDeleteAudioClip: TIDAK ada "ripple" geser klip lain, soalnya
  // klip lirik lain letaknya independen (nggak berurutan nempel kayak
  // klip audio), jadi ngegeser otomatis malah bisa bikin ketimpa tempo
  // klip lain yang nggak dimaksud.
  function handleDeleteLyricsClip(baseId: string) {
    setRemovedLyricsIds((prev) => new Set(prev).add(baseId));
    setSelectedTextLayerId(null);
    setTextToolbarMode("quick");
  }

  // Track pseudo "Background" (bukan decorLayer template) — aktif kalau
  // customBackground ada & lagi diseleksi user di timeline.
  const isBackgroundLayerSelected =
    selectedLayerId === BACKGROUND_LAYER_ID && Boolean(customBackground);

  // Slot yang muncul di timeline: foto/video selalu tampil, tapi audio
  // baru muncul SETELAH user nambahin lewat tombol Audio di toolbar
  // (bukan langsung nongol sebagai placeholder kosong).
  const visibleSlots = effectiveSlots.filter(
    (slot) => slot.type !== "audio" || Boolean(slotMedia[slot.id]),
  );

  // Jalanin playhead pas play, berhenti di posisi terakhir pas pause
  //
  // PENTING: DURATION WAJIB ada di dependency array (bukan cuma
  // isPlaying). DURATION = audioInfo?.duration ?? templateDurationSec
  // (baris atas) — audioInfo diisi ASINKRON hasil analyzeAudio (decode
  // Web Audio API), yang makan waktu buat file gede/lagu panjang. Kalau
  // user pencet Play SEBELUM audioInfo kelar, DURATION masih fallback
  // ke templateDurationSec (mis. cuma 15 detik buat V4), dan closure
  // tick() di bawah "membekukan" angka itu selama effect ini belum
  // restart. Dulu dependency-nya cuma [isPlaying], jadi begitu audioInfo
  // kelar loading (biasanya sepersekian detik setelah Play ditekan) &
  // DURATION harusnya udah jadi durasi asli lagu (misal 74 detik),
  // timer yang udah kadung jalan TETAP loop balik ke 0 tiap ~15 detik
  // terus-menerus — playhead "balik ke awal padahal lagu belum abis".
  // Dengan DURATION di deps, effect otomatis restart (re-baca currentSec
  // biar nggak ikut ke-reset ke 0) begitu durasi asli kelar dihitung.
  useEffect(() => {
    if (!isPlaying) return;

    startRef.current = performance.now() - currentSec * 1000;

    const tick = (now: number) => {
      const elapsed = (now - startRef.current) / 1000;
      if (elapsed >= DURATION) {
        // Sampe di akhir timeline — balikin playhead ke awal (0) &
        // lanjut muter otomatis (loop), biar nggak perlu drag manual
        // balik ke depan tiap mau preview ulang dari awal.
        startRef.current = now;
        setCurrentSec(0);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      setCurrentSec(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // currentSec sengaja TETAP di-exclude (cuma dibaca sekali di awal
    // buat startRef, bukan buat nge-trigger restart tiap frame — kalau
    // ikut di deps, effect bakal restart tiap tick & rAF-nya nggak
    // pernah jalan mulus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, DURATION]);

  // Klip audio yang aktif di detik playhead sekarang ini (kalau ada) —
  // dipakai buat nentuin posisi file asli mana yang harus disuarakan.
  // Karena hasil potong bisa bikin gap (klip nggak nutupin seluruh
  // timeline), currentSec bisa nggak ke-cover klip manapun (jeda senyap).
  const activeAudioClip = audioClips.find(
    (c) => currentSec >= c.offset && currentSec < c.offset + (c.trimEnd - c.trimStart),
  );

  // Sinkronin audio latar sama playhead — ikutin klip yang lagi aktif
  // (hasil potong/geser), bukan langsung 1:1 sama waktu di timeline.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || !audioMedia) return;
    if (!activeAudioClip) {
      // Nggak ada klip di posisi playhead sekarang (habis dipotong &
      // digeser jadi ada jeda) — diamkan audio-nya.
      el.pause();
      return;
    }
    const sourceTime =
      activeAudioClip.trimStart + (currentSec - activeAudioClip.offset);
    if (Math.abs(el.currentTime - sourceTime) > 0.35) {
      el.currentTime = sourceTime;
    }
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentSec, audioMedia, activeAudioClip?.id]);

  // ---- Render loop: gambar baseAssetSrc + slot yang aktif di detik ini ----
  const isBackgroundHidden = hiddenElements.has(BACKGROUND_LAYER_ID);
  const backgroundSrc =
    (!isBackgroundHidden ? customBackground?.url : undefined) ??
    template.baseAssetSrc;

  useEffect(() => {
    const canvas = canvasRef.current;
    // Template tanpa baseAssetSrc/customBackground TAPI punya solidBackground
    // (misal "Lyrics", background hitam polos) tetap harus lanjut render —
    // sebelumnya effect ini berhenti total di sini kalau backgroundSrc kosong,
    // jadi template kayak itu nggak pernah kelihatan apa-apa di canvas.
    if (!canvas || (!backgroundSrc && !template.solidBackground)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: canvasW, height: canvasH } = getRatioCanvasSize(canvasRatio);
    canvas.width = canvasW;
    canvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const cache = imageCacheRef.current;
    if (backgroundSrc) {
      const bgImg = cache.get(backgroundSrc, () =>
        setRenderTick((t) => t + 1),
      );
      if (bgImg) {
        ctx.save();
        let blurOverscan = 0;
        if (customBackground && !isBackgroundHidden) {
          ctx.globalAlpha = Math.max(0, Math.min(100, backgroundOpacity)) / 100;
          if (backgroundBlur > 0) {
            ctx.filter = `blur(${backgroundBlur}px)`;
            blurOverscan = backgroundBlur * BACKGROUND_BLUR_OVERSCAN_FACTOR;
          } else {
            ctx.filter = "none";
          }
        }
        drawImageCoverZoomed(ctx, bgImg, 0, 0, canvasW, canvasH, blurOverscan);
        ctx.restore();
      }
    } else if (template.solidBackground) {
      // Template "Lyrics" dkk — background warna solid, bukan foto.
      ctx.save();
      ctx.fillStyle = template.solidBackground;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Layer dekoratif "back" (misal: Card Player) — digambar SEBELUM slot
    // foto/video, jadi ada di belakang foto. Full-canvas, pakai opacity
    // masing-masing (default 100 kalau belum diubah user).
    for (const layer of backDecorLayers) {
      if (hiddenElements.has(layer.id)) continue;
      const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
      if (op <= 0) continue;
      if (layer.liquidGlass) {
        // Card kaca live: nembus & merefraksi background yang barusan
        // digambar di atas (`canvas` itu sendiri dipakai sebagai sumber
        // backdrop) — BUKAN lagi PNG statis. Setelan slider user
        // (glassSettings) di-merge di atas default template.
        const rect = resolveLiquidGlassRectPx(layer.liquidGlass, canvasW, canvasH);
        drawLiquidGlassCard(
          ctx,
          canvas,
          rect,
          `glass-preview-${layer.id}`,
          getEffectiveGlassSettings(layer),
          op,
        );
        continue;
      }
      const img = cache.get(layer.assetSrc, () => setRenderTick((t) => t + 1));
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha = op;
      drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
      ctx.restore();
    }

    for (const slot of effectiveSlots) {
      if (slot.type === "audio") continue;
      if (hiddenElements.has(slot.id)) continue;
      if (
        slot.x == null ||
        slot.y == null ||
        slot.width == null ||
        slot.height == null
      )
        continue;
      if (!isSlotActiveAt(slot, currentSec)) continue;

      const dx = (slot.x / 100) * canvasW;
      const dy = (slot.y / 100) * canvasH;
      const dw = (slot.width / 100) * canvasW;
      const dh = (slot.height / 100) * canvasH;
      const radius = slot.radius ?? 16;
      const media = slotMedia[slot.id];

      // Glow ambient blur di belakang foto sampul (cuma slot yang diflag
      // glowBehind, misal cover di V5) — digambar SEBELUM foto tajamnya
      // sendiri, pakai sumber gambar yang SAMA, diperbesar & diblur berat.
      if (slot.glowBehind && media) {
        const glowImg = cache.get(media.url, () => setRenderTick((t) => t + 1));
        if (glowImg) {
          drawSlotGlow(ctx, glowImg, dx, dy, dw, dh, radius);
        }
      }

      ctx.save();
      roundRectPath(ctx, dx, dy, dw, dh, radius);
      ctx.clip();
      if (media) {
        const img = cache.get(media.url, () => setRenderTick((t) => t + 1));
        if (img) {
          drawImageCover(ctx, img, dx, dy, dw, dh);
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(dx, dy, dw, dh);
        }
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(dx, dy, dw, dh);
      }
      ctx.restore();

      if (!media) {
        ctx.save();
        ctx.strokeStyle = "rgba(236,234,228,0.85)";
        ctx.lineWidth = 4;
        ctx.setLineDash([14, 10]);
        roundRectPath(ctx, dx + 3, dy + 3, dw - 6, dh - 6, radius);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Layer dekoratif "front" (ikon, progress bar, info & kontrol) —
    // digambar SETELAH slot foto/video, jadi selalu di atas/depan foto.
    for (const layer of frontDecorLayers) {
      if (hiddenElements.has(layer.id)) continue;
      const img = cache.get(layer.assetSrc, () => setRenderTick((t) => t + 1));
      if (!img) continue;
      const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
      if (op <= 0) continue;
      ctx.save();
      ctx.globalAlpha = op;
      if (layer.pressAnimation) {
        // Efek "abis diklik" cuma di detik-detik awal timeline (dari
        // playhead absolut currentSec, BUKAN loop) — lihat
        // getPressBounceScale di lib/render.ts.
        const scale = getPressBounceScale(
          currentSec,
          layer.pressAnimation.durationSec,
        );
        drawImageCoverWithPressBounce(
          ctx,
          img,
          canvasW,
          canvasH,
          layer.pressAnimation.anchorXPercent,
          layer.pressAnimation.anchorYPercent,
          scale,
        );
      } else {
        drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
      }
      ctx.restore();
    }

    // Teks custom (judul, artist, nama device) bawaan template — di atas
    // semua decor layer, biar selalu kebaca jelas. Teks custom hasil
    // "Add teks" render di blok lyrics layer di bawah (allLyricsLayers),
    // bukan di sini.
    if (allTextLayers.length) {
      const visibleTextLayers = allTextLayers
        .filter((l) => !hiddenElements.has(l.id))
        .map((l) =>
          textColors[l.id] ? { ...l, color: textColors[l.id] } : l,
        );
      if (visibleTextLayers.length) {
        drawTextLayers(ctx, canvasW, canvasH, visibleTextLayers, textValues);
      }
    }
    // Layer "Lyrics" (glitch teks animasi in/loop/out) — dipanggil per
    // klip, drawLyricsTextLayer sendiri yang skip kalau currentSec di
    // luar rentang startSec..endSec klip itu. Pakai textValues yang sama
    // dengan textLayers biasa (key = id klip) buat override top/bottom,
    // jadi kalau nanti ditambah panel edit teks lirik, tinggal isi
    // textValues["<id>__top"]/["<id>__bottom"] tanpa ubah render loop ini.
    if (allLyricsLayers.length) {
      for (const layer of allLyricsLayers) {
        if (hiddenElements.has(layer.id)) continue;
        const effectiveLayer = {
          ...layer,
          ...lyricsSettings[layer.id],
          colorTop: textColors[`${layer.id}__top`] ?? layer.colorTop,
          colorBottom: textColors[`${layer.id}__bottom`] ?? layer.colorBottom,
        };
        const topHidden = hiddenElements.has(`${layer.id}__top`);
        const bottomHidden = hiddenElements.has(`${layer.id}__bottom`);
        drawLyricsTextLayer(
          ctx,
          canvasW,
          canvasH,
          effectiveLayer,
          currentSec,
          topHidden ? " " : textValues[`${layer.id}__top`],
          bottomHidden ? " " : textValues[`${layer.id}__bottom`],
          isPlaying,
        );
      }
    }
    // Label durasi berjalan/total — selalu otomatis dari playhead & DURATION
    // asli, tidak pernah dari textValues (dikunci, tidak bisa di-custom).
    if (template.durationLayer) {
      drawDurationLayer(
        ctx,
        canvasW,
        canvasH,
        template.durationLayer,
        currentSec,
        DURATION,
      );
    }
    // Isian putih progress bar — juga selalu otomatis dari playhead,
    // digambar setelah durationLayer (urutan nggak penting, posisinya beda).
    if (template.progressLayer) {
      if (progressStyle === "waveform") {
        drawWaveformProgress(
          ctx,
          canvasW,
          canvasH,
          template.progressLayer,
          currentSec,
          DURATION,
          audioInfo?.bassPeaks?.length ? audioInfo.bassPeaks : FALLBACK_PEAKS,
        );
      } else {
        drawProgressFill(
          ctx,
          canvasW,
          canvasH,
          template.progressLayer,
          currentSec,
          DURATION,
        );
      }
    }
    // Ikon spectrum/equalizer kecil di dekat judul — SELALU jalan otomatis
    // (tidak ikut toggle progressStyle "Standar"/"Waveform berjalan"),
    // beda posisi & beda maksud dari progressLayer di atas.
    if (template.spectrumLayer && !hiddenElements.has("spectrumLayer")) {
      drawSpectrumIndicator(
        ctx,
        canvasW,
        canvasH,
        template.spectrumLayer,
        currentSec,
        DURATION,
        audioInfo?.bassPeaks?.length ? audioInfo.bassPeaks : FALLBACK_PEAKS,
      );
    }
    // Efek Glow (bloom) global — PALING TERAKHIR, setelah semua layer
    // (background, foto/video slot, decor front, teks, progress,
    // spectrum) selesai digambar, biar semua isi canvas kena.
    applyGlowBloom(ctx, canvasW, canvasH, glowIntensity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    template,
    currentSec,
    slotMedia,
    renderTick,
    timeScale,
    layerOpacity,
    glassSettings,
    backgroundSrc,
    customBackground,
    backgroundOpacity,
    backgroundBlur,
    glowIntensity,
    textValues,
    textColors,
    lyricsSettings,
    customLyricsLayers,
    hiddenElements,
    DURATION,
    progressStyle,
    audioInfo,
    isPlaying,
    canvasRatio,
  ]);

  // ---- Hitung ukuran boks preview (px) tiap kali rasio ganti ATAU area
  // preview di-resize (buka/tutup sidebar, rotate device, dst) — lihat
  // catatan panjang di deklarasi previewBoxSize di atas soal kenapa ini
  // TIDAK bisa diserahkan ke CSS `aspect-[...]` doang.
  // useLayoutEffect (bukan useEffect) biar ukuran ke-set SEBELUM paint,
  // gak ada frame "nyasar" nampilin ukuran lama pas ganti rasio.
  useLayoutEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    const { width: targetW, height: targetH } = getRatioCanvasSize(canvasRatio);
    const targetRatio = targetW / targetH;

    // Sisain sedikit "napas" (padding) di sekeliling boks biar gak
    // mepet nempel ke tepi area preview — samain kayak reference
    // (VEED dkk) yang selalu ada jarak dikit dari tepi container ke
    // canvas, di rasio manapun (9:16 ATAU 16:9). Tanpa ini, boks yang
    // di-height-constrain (kayak 16:9 di layar pendek) jadi nempel
    // pas banget di atas-bawah container, keliatan "sesak"/lebar
    // banget padahal secara angka rasionya udah benar.
    const PREVIEW_PADDING_RATIO = 0.06; // ~6% dari sisi pendek jadi jarak

    const recompute = () => {
      const rawW = el.clientWidth;
      const rawH = el.clientHeight;
      if (rawW <= 0 || rawH <= 0) return;
      const pad = Math.round(Math.min(rawW, rawH) * PREVIEW_PADDING_RATIO);
      const availW = Math.max(1, rawW - pad * 2);
      const availH = Math.max(1, rawH - pad * 2);
      // "Contain"-fit manual: coba lebar penuh dulu, kalau tingginya
      // kepanjangan (ngelebihin ruang), turun ke tinggi penuh sebagai
      // gantinya — persis logika object-fit:contain, tapi diterapkan ke
      // BOKS-nya sendiri (bukan gambar di dalamnya), jadi lebar & tinggi
      // boks selalu proporsional ke targetRatio, gak pernah konflik.
      let w = availW;
      let h = w / targetRatio;
      if (h > availH) {
        h = availH;
        w = h * targetRatio;
      }
      setPreviewBoxSize({ width: Math.round(w), height: Math.round(h) });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasRatio]);

  // Drag playhead: geser langsung ke posisi jari/kursor, pause dulu selama digeser
  function handlePlayheadPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setIsPlaying(false);
    const container = timelineScrollRef.current;
    if (!container) return;

    const moveTo = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft - TIMELINE_CLIP_OFFSET_PX;
      const sec = Math.min(DURATION, Math.max(0, x / effectivePxPerSec));
      setCurrentSec(sec);
    };

    moveTo(e.clientX);

    const handleMove = (ev: PointerEvent) => moveTo(ev.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // Tombol Skip-back/Skip-forward di Transport bar — loncat langsung ke
  // awal/akhir timeline, sekalian pause dulu (sama pola kayak drag
  // playhead manual di handlePlayheadPointerDown).
  function handleSkipToStart() {
    setIsPlaying(false);
    setCurrentSec(0);
  }
  function handleSkipToEnd() {
    setIsPlaying(false);
    setCurrentSec(DURATION);
  }

  function openPicker(slot: TemplateSlot) {
    pendingSlotRef.current = slot.id;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept =
      slot.type === "image" ? "image/*" : slot.type === "video" ? "video/*" : "audio/*";
    input.click();
  }

  // Balikin background ke bg.jpg asli template (lepas dari foto sampul).
  // Begitu user ganti/upload foto sampul lagi, auto-sync di
  // handleFileChange bakal langsung nyontek foto barunya lagi jadi
  // background (lihat komentar di sana) — jadi Reset ini sifatnya
  // sementara, bukan "matiin" auto-sync selamanya.
  function handleResetBackground() {
    setCustomBackground(null);
    setBackgroundOpacity(100);
    setBackgroundBlur(defaultBackgroundBlurFor(template.id));
    setSelectedLayerId((id) => (id === BACKGROUND_LAYER_ID ? null : id));
  }

  function clampNum(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
  }

  // Geser satu klip audio ke kiri/kanan di sepanjang timeline (posisi
  // "nempel"-nya doang yang berubah, isi trim-nya tetap sama).
  function handleAudioClipDragStart(e: React.PointerEvent, clip: AudioClip) {
    e.preventDefault();
    e.stopPropagation();
    if (audioSlotDef) setSelectedSlotId(audioSlotDef.id);
    setSelectedLayerId(null);
    setSelectedAudioClipId(clip.id);

    const startX = e.clientX;
    const originalOffset = clip.offset;
    const duration = clip.trimEnd - clip.trimStart;
    const maxOffset = Math.max(0, DURATION - duration);

    const handleMove = (ev: PointerEvent) => {
      const dSec = (ev.clientX - startX) / effectivePxPerSec;
      const newOffset = clampNum(originalOffset + dSec, 0, maxOffset);
      setAudioClips((prev) =>
        prev.map((c) => (c.id === clip.id ? { ...c, offset: newOffset } : c)),
      );
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // Drag handle di tepi kiri/kanan klip audio buat trim — tepi kiri
  // ubah trimStart (+ offset ikut geser), tepi kanan ubah trimEnd.
  function handleAudioClipTrimStart(
    e: React.PointerEvent,
    clip: AudioClip,
    edge: "left" | "right",
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (audioSlotDef) setSelectedSlotId(audioSlotDef.id);
    setSelectedLayerId(null);
    setSelectedAudioClipId(clip.id);

    const startX = e.clientX;
    const sourceDuration = audioInfo?.duration ?? clip.trimEnd;
    const { trimStart, trimEnd, offset } = clip;

    const handleMove = (ev: PointerEvent) => {
      const dSec = (ev.clientX - startX) / effectivePxPerSec;
      if (edge === "left") {
        const lowerBound = Math.max(-trimStart, -offset);
        const upperBound = trimEnd - MIN_CLIP_DURATION - trimStart;
        const clamped = clampNum(dSec, lowerBound, upperBound);
        const newTrimStart = trimStart + clamped;
        const newOffset = offset + clamped;
        setAudioClips((prev) =>
          prev.map((c) =>
            c.id === clip.id
              ? { ...c, trimStart: newTrimStart, offset: newOffset }
              : c,
          ),
        );
      } else {
        const maxTrimEnd = Math.min(
          sourceDuration,
          trimStart + (DURATION - offset),
        );
        const newTrimEnd = clampNum(
          trimEnd + dSec,
          trimStart + MIN_CLIP_DURATION,
          maxTrimEnd,
        );
        setAudioClips((prev) =>
          prev.map((c) => (c.id === clip.id ? { ...c, trimEnd: newTrimEnd } : c)),
        );
      }
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // Tombol gunting "Potong" di toolbar bawah — motong klip audio yang lagi
  // "dilewatin" playhead jadi dua klip terpisah (masing-masing bisa
  // digeser/ditrim sendiri-sendiri).
  function handleCutAudio() {
    const clip = audioClips.find(
      (c) =>
        currentSec > c.offset && currentSec < c.offset + (c.trimEnd - c.trimStart),
    );
    if (!clip) return;
    const splitSourceTime = clip.trimStart + (currentSec - clip.offset);
    const leftDuration = splitSourceTime - clip.trimStart;
    const rightDuration = clip.trimEnd - splitSourceTime;
    if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) return;

    const leftClip: AudioClip = {
      id: makeClipId(),
      trimStart: clip.trimStart,
      trimEnd: splitSourceTime,
      offset: clip.offset,
    };
    const rightClip: AudioClip = {
      id: makeClipId(),
      trimStart: splitSourceTime,
      trimEnd: clip.trimEnd,
      offset: currentSec,
    };
    setAudioClips((prev) => {
      const idx = prev.findIndex((c) => c.id === clip.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, leftClip, rightClip);
      return next;
    });
    setSelectedAudioClipId(rightClip.id);
  }

  // Tombol tong sampah di sebelah gunting — hapus klip audio yang lagi
  // dipilih (biasanya hasil potongan yang gak kepake). Dipakai "ripple
  // delete": klip-klip LAIN yang posisinya (offset) ada SETELAH klip yang
  // dihapus otomatis digeser maju sepanjang durasi klip yang kehapus, jadi
  // gak nyisain jeda senyap — klip berikutnya langsung mulai persis di
  // titik itu (bukan tetap di posisi asalnya kayak masih ada bolongnya).
  function handleDeleteAudioClip() {
    const clip = audioClips.find((c) => c.id === selectedAudioClipId);
    if (!clip) return;
    const removedDuration = clip.trimEnd - clip.trimStart;
    const gapStart = clip.offset;

    setAudioClips((prev) =>
      prev
        .filter((c) => c.id !== clip.id)
        .map((c) =>
          c.offset >= gapStart
            ? { ...c, offset: Math.max(0, c.offset - removedDuration) }
            : c,
        ),
    );
    setSelectedAudioClipId(null);
  }

  // Boleh hapus cuma kalau ada klip audio yang lagi keseleksi.
  const canDeleteAudioClip = Boolean(
    selectedAudioClipId &&
      audioClips.some((c) => c.id === selectedAudioClipId),
  );

  // Boleh motong cuma kalau track audio lagi keseleksi & playhead lagi
  // ada di TENGAH salah satu klip (bukan di tepi/di luar klip manapun).
  const canCutAudio = Boolean(
    audioSlotDef &&
      selectedSlotId === audioSlotDef.id &&
      audioClips.some(
        (c) =>
          currentSec > c.offset &&
          currentSec < c.offset + (c.trimEnd - c.trimStart),
      ),
  );

  async function handleSavePreset() {
    const name = presetName.trim();
    if (!name || isSavingPreset) return;
    setIsSavingPreset(true);
    setPresetError(null);
    setPresetNotice(null);
    try {
      const record = await savePreset({
        name,
        template,
        layerOpacity,
        backgroundOpacity,
        backgroundBlur,
        progressStyle,
        glowIntensity,
        textValues,
        textColors,
        slotMedia,
        customBackground,
      });
      setPresets((prev) =>
        [
          {
            id: record.id,
            name: record.name,
            createdAt: record.createdAt,
            templateId: record.templateId,
            templateName: record.templateName,
            hasMedia:
              Object.keys(record.slotMedia).length > 0 || !!record.customBackground,
          },
          ...prev,
        ].sort((a, b) => b.createdAt - a.createdAt),
      );
      setPresetName("");
      setPresetNotice(`Preset "${record.name}" tersimpan.`);
    } catch (e) {
      setPresetError(
        e instanceof Error ? e.message : "Gagal menyimpan preset.",
      );
    } finally {
      setIsSavingPreset(false);
    }
  }

  async function handleLoadPreset(id: string) {
    if (presetBusyId) return;
    setPresetBusyId(id);
    setPresetError(null);
    setPresetNotice(null);
    try {
      const record = await getPreset(id);
      if (!record) {
        setPresetError("Preset tidak ditemukan (mungkin sudah dihapus).");
        return;
      }

      // Slot media: cuma slot yang ADA di template SEKARANG yang diisi;
      // slot yang tidak kesimpan di preset (dulu masih "sample") dibiarkan
      // balik ke default sample template ini.
      const nextSlotMedia = initialSlotMedia(template);
      for (const slot of template.slots) {
        const stored = record.slotMedia[slot.id];
        if (stored) {
          nextSlotMedia[slot.id] = storedMediaToEntry(stored, `${slot.id}-preset`);
        }
      }
      setSlotMedia(nextSlotMedia);

      setCustomBackground(
        record.customBackground
          ? storedMediaToEntry(record.customBackground, "background-preset")
          : null,
      );

      // Opacity layer: cuma timpa layer yang beneran ada di template ini,
      // sisanya (kalau preset dibuat dari template lain) diabaikan.
      setLayerOpacity((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (record.layerOpacity[key] !== undefined) {
            next[key] = record.layerOpacity[key];
          }
        }
        return next;
      });
      setBackgroundOpacity(record.backgroundOpacity);
      setBackgroundBlur(record.backgroundBlur);
      setProgressStyle(record.progressStyle);
      setGlowIntensity(record.glowIntensity ?? 0);

      setTextValues((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (record.textValues[key] !== undefined) {
            next[key] = record.textValues[key];
          }
        }
        return next;
      });
      setTextColors(record.textColors ?? {});

      setPresetNotice(`Preset "${record.name}" dimuat.`);
      setShowPresetPanel(false);
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : "Gagal memuat preset.");
    } finally {
      setPresetBusyId(null);
    }
  }

  async function handleDeletePreset(id: string, name: string) {
    if (presetBusyId) return;
    if (!window.confirm(`Hapus preset "${name}"? Tidak bisa dibatalkan.`)) return;
    setPresetBusyId(id);
    setPresetError(null);
    try {
      await deletePreset(id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : "Gagal menghapus preset.");
    } finally {
      setPresetBusyId(null);
    }
  }

  // Dipanggil setelah file (langsung, atau hasil crop) siap dipakai —
  // nyimpen ke slotMedia + auto-sync ke background kalau ini coverSlotId.
  function applySlotMediaEntry(slotId: string, entry: SlotMediaEntry) {
    setSlotMedia((prev) => ({ ...prev, [slotId]: entry }));
    setSelectedSlotId(null);
    // Foto sampul otomatis dipakai lagi jadi background begitu diganti —
    // gak perlu pencet "Transfer" manual, dan otomatis REPLACE (bukan
    // numpuk) background lama siapa pun sumbernya.
    if (slotId === coverSlotId) {
      setCustomBackground(entry);
      setBackgroundOpacity(100);
      setBackgroundBlur(defaultBackgroundBlurFor(template.id));
    }
  }

  // Buka overlay crop dari sebuah File — SELALU bikin object URL baru
  // (bukan makai url lama yang mungkin udah basi), dipakai baik buat
  // upload baru maupun recrop dari originalFileRef.
  function openCropWithFile(
    slotId: string,
    file: File,
    targetWidth: number,
    targetHeight: number,
  ) {
    const url = URL.createObjectURL(file);
    setCropTarget({ slotId, url, targetWidth, targetHeight, file });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const slotId = pendingSlotRef.current;
    e.target.value = "";
    if (!file || !slotId) return;

    const slot = template.slots.find((s) => s.id === slotId);
    if (slot?.type === "image") {
      // Foto -> jangan langsung dipakai, suguhkan overlay crop dulu biar
      // user bisa atur posisi/zoom sebelum ditempel ke slot (lihat
      // <ImageCropModal> & handleCropConfirm di bawah).
      const { width: canvasW, height: canvasH } = getRatioCanvasSize(canvasRatio);
      const targetWidth = slot.width ? (slot.width / 100) * canvasW : canvasW;
      const targetHeight = slot.height ? (slot.height / 100) * canvasH : canvasH;
      openCropWithFile(slotId, file, targetWidth, targetHeight);
      return;
    }

    // Video/audio tetap langsung dipakai seperti sebelumnya (gak ada
    // konsep "crop" buat itu).
    const url = URL.createObjectURL(file);
    applySlotMediaEntry(slotId, { kind: "file", url, file });
  }

  // Buka overlay crop buat foto yang UDAH kepake di slot (dipicu dari
  // tombol "Crop" di toolbar slot terpilih) — beda dari handleFileChange
  // yang crop foto BARU. SELALU balik ke File ORIGINAL (sebelum di-crop)
  // yang tersimpan di originalFileRef kalau ada, biar crop ulang gak
  // numpuk di atas hasil crop sebelumnya (area makin sempit & pecah tiap
  // di-crop lagi). Fallback ke media yang lagi aktif kalau belum pernah
  // ada crop sebelumnya di slot ini (misal masih foto sample bawaan dari
  // Firebase/Unsplash — itu URL remote biasa, bukan blob, jadi aman
  // dipakai langsung tanpa perlu bikin object URL baru).
  function handleOpenCropForSlot(slot: TemplateSlot) {
    const { width: canvasW, height: canvasH } = getRatioCanvasSize(canvasRatio);
    const targetWidth = slot.width ? (slot.width / 100) * canvasW : canvasW;
    const targetHeight = slot.height ? (slot.height / 100) * canvasH : canvasH;

    const originalFile = originalFileRef.current[slot.id];
    if (originalFile) {
      openCropWithFile(slot.id, originalFile, targetWidth, targetHeight);
      return;
    }

    const current = slotMedia[slot.id];
    if (!current) return;
    if (current.file) {
      openCropWithFile(slot.id, current.file, targetWidth, targetHeight);
    } else {
      // Sample remote (kind: "sample") — url https:// biasa, bukan blob.
      setCropTarget({ slotId: slot.id, url: current.url, targetWidth, targetHeight });
    }
  }

  function handleCropConfirm(blob: Blob) {
    if (!cropTarget) return;
    const { slotId, url: sessionUrl, file: sourceFile } = cropTarget;
    const croppedFile = new File([blob], "sampul-crop.jpg", { type: "image/jpeg" });
    const url = URL.createObjectURL(croppedFile);

    if (sourceFile) {
      // Simpen (atau perbarui) anchor "original" buat slot ini, dan
      // lepas object URL sesi crop ini (udah gak kepake lagi — hasil
      // cropnya sendiri punya url baru terpisah di atas).
      originalFileRef.current[slotId] = sourceFile;
      URL.revokeObjectURL(sessionUrl);
    }
    // Kalau sourceFile kosong berarti sesi ini nge-crop sample remote
    // (bukan blob) — gak ada url yang perlu/boleh di-revoke.

    applySlotMediaEntry(slotId, { kind: "file", url, file: croppedFile });
    setCropTarget(null);
  }

  function handleCropCancel() {
    // Sesi ini pake object URL BARU yang dibikin khusus buat crop
    // (upload baru / recrop dari File) -> aman & wajib di-revoke pas
    // batal. Sample remote (file kosong) gak perlu di-revoke.
    if (cropTarget?.file) {
      URL.revokeObjectURL(cropTarget.url);
    }
    setCropTarget(null);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!template.baseAssetSrc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { width: canvasW, height: canvasH } = getRatioCanvasSize(canvasRatio);
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    for (const slot of effectiveSlots) {
      if (slot.type === "audio") continue;
      if (hiddenElements.has(slot.id)) continue;
      if (
        slot.x == null ||
        slot.y == null ||
        slot.width == null ||
        slot.height == null
      )
        continue;
      if (!isSlotActiveAt(slot, currentSec)) continue;
      const dx = (slot.x / 100) * canvasW;
      const dy = (slot.y / 100) * canvasH;
      const dw = (slot.width / 100) * canvasW;
      const dh = (slot.height / 100) * canvasH;
      if (px >= dx && px <= dx + dw && py >= dy && py <= dy + dh) {
        setSelectedLayerId(null);
        setSelectedSlotId(slot.id);
        return;
      }
    }
  }

  async function handleExport() {
    if (!template.baseAssetSrc) return;
    setIsExporting(true);
    setExportError(null);
    setExportResultUrl(null);
    setExportEngineUsed(null);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      setExportSnapshot(canvasRef.current?.toDataURL("image/jpeg", 0.8) ?? null);
    } catch {
      setExportSnapshot(null);
    }
    try {
      // Setelan kaca hasil slider user (glassSettings) belum tentu utuh
      // (cuma nyimpen field yang disentuh) — merge di atas default
      // template dulu jadi 1 objek Template baru, biar export (WebCodecs)
      // render kaca PERSIS sama seperti yang kelihatan di preview, bukan
      // balik ke default template.
      const exportTemplate: Template = {
        ...template,
        // Rasio dipilih user di tab "Rasio" (default 9:16 = tetap sama
        // seperti sebelumnya) — override di sini biar webcodecs-export.ts
        // (baca canvasWidth/canvasHeight dari exportTemplate) render video
        // final di orientasi yang sama persis kayak preview.
        canvasWidth: getRatioCanvasSize(canvasRatio).width,
        canvasHeight: getRatioCanvasSize(canvasRatio).height,
        slots: template.slots.filter((slot) => !hiddenElements.has(slot.id)),
        // allTextLayers cuma text layer BIASA (judul/artist/dst) bawaan
        // template — teks custom lewat "Add teks" sekarang jalur lirik
        // (allLyricsLayers), TAPI export video ini emang belum pernah
        // nangani lyricsTextLayers sama sekali (limitasi lama, bukan
        // regresi dari perubahan ini) — jadi animasi lirik (termasuk teks
        // custom baru) TIDAK ikut ke video hasil export, cuma tampil di
        // preview.
        textLayers: allTextLayers
          .filter((l) => !hiddenElements.has(l.id))
          .map((l) => (textColors[l.id] ? { ...l, color: textColors[l.id] } : l)),
        decorLayers: template.decorLayers
          ?.filter((layer) => !hiddenElements.has(layer.id))
          .map((layer) =>
            layer.liquidGlass
              ? {
                  ...layer,
                  liquidGlass: {
                    ...layer.liquidGlass,
                    settings: {
                      ...layer.liquidGlass.settings,
                      ...glassSettings[layer.id],
                    },
                  },
                }
              : layer,
          ),
      };
      const exportCustomBackground = hiddenElements.has(BACKGROUND_LAYER_ID)
        ? null
        : customBackground;
      const { blob, engine } = await exportTemplateVideoAuto(
        exportTemplate,
        slotMedia,
        layerOpacity,
        (p) => setExportProgress(p),
        exportCustomBackground,
        backgroundOpacity,
        backgroundBlur,
        textValues,
        controller.signal,
        audioClips.map(({ trimStart, trimEnd, offset }) => ({
          trimStart,
          trimEnd,
          offset,
        })),
        progressStyle,
        audioInfo?.bassPeaks?.length ? audioInfo.bassPeaks : FALLBACK_PEAKS,
        glowIntensity,
      );
      setExportResultUrl(URL.createObjectURL(blob));
      setExportEngineUsed(engine);
      logExportEvent(template.id);
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        // User yang batalin sendiri — nggak usah dianggap error, tutup aja diam-diam.
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[export] gagal:", err);
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : (() => {
                try {
                  return JSON.stringify(err);
                } catch {
                  return String(err);
                }
              })();
      setExportError(
        detail && detail !== "{}" ? detail : "Export gagal, coba lagi.",
      );
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
    }
  }

  function handleCancelExport() {
    exportAbortRef.current?.abort();
  }

  // ---- Track audio (dipakai bareng di tab Edit & tab Audio, biar musik
  // latar kelihatan pas lagi ngedit klip media juga, nggak perlu pindah
  // tab). Dirender sebagai kumpulan KLIP terpisah (bukan satu blok
  // statis) — tiap klip bisa digeser (drag badan klip) & ditrim/dipotong
  // (drag handle di tepi kiri/kanan-nya begitu klip diseleksi). Return
  // null kalau slot audio ini belum ada isinya.
  function renderAudioTrack(slot: TemplateSlot) {
    const filled = Boolean(slotMedia[slot.id]);
    if (!filled) return null;
    const sourceDuration = audioInfo?.duration ?? DURATION;
    const isAudioHidden = hiddenElements.has(slot.id);
    return (
      <div
        key={slot.id}
        onClick={() => {
          setSelectedLayerId(null);
          setSelectedSlotId(slot.id);
        }}
        className="relative flex h-8 items-center justify-between"
      >
        <TrackLabel
          hidden={isAudioHidden}
          onToggleHidden={(e) => toggleElementHidden(slot.id, e)}
          icon={Music2}
          label={slot.label ?? "Audio"}
          hiddenTitle={`Tampilkan "${slot.label ?? "Audio"}"`}
          shownTitle={`Sembunyikan "${slot.label ?? "Audio"}"`}
        />
        {audioClips.map((clip) => {
          const clipDuration = clip.trimEnd - clip.trimStart;
          const clipLeft =
            clip.offset * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX;
          const clipWidth = Math.max(
            22,
            clipDuration * effectivePxPerSec - 4,
          );
          const isClipSelected = selectedAudioClipId === clip.id;

          // Target jumlah bar mengikuti LEBAR KLIP DI LAYAR
          // (bukan angka tetap) — sekitar 1 bar tiap 3px,
          // biar klip pendek tetap padat & klip panjang
          // nggak keriting/numpuk. Ini yang bikin waveform
          // kerasa "mengalir" kayak di CapCut, bukan cuma
          // segelintir batang gemuk.
          const targetBarCount = clampNum(
            Math.round(clipWidth / 3),
            8,
            400,
          );

          // Sumber data: pakai bassPeaks (resolusi jauh
          // lebih rapat, ~30 titik/detik lagu) kalau ada,
          // fallback ke peaks broadband (120 titik/lagu),
          // baru fallback flat kalau audio belum selesai
          // dianalisis sama sekali.
          const richSource =
            audioInfo?.bassPeaks?.length
              ? audioInfo.bassPeaks
              : audioInfo?.peaks?.length
                ? audioInfo.peaks
                : null;

          let clipPeaks: number[];
          if (richSource) {
            const total = richSource.length;
            const startIdx = clampNum(
              Math.floor((clip.trimStart / sourceDuration) * total),
              0,
              total - 1,
            );
            const endIdx = clampNum(
              Math.ceil((clip.trimEnd / sourceDuration) * total),
              startIdx + 1,
              total,
            );
            const rawSlice = richSource.slice(startIdx, endIdx);
            clipPeaks = downsamplePeaks(rawSlice, targetBarCount);
          } else {
            clipPeaks = FALLBACK_PEAKS.slice(0, targetBarCount);
          }

          return (
            <div
              key={clip.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLayerId(null);
                setSelectedSlotId(slot.id);
                setSelectedAudioClipId(clip.id);
              }}
              onPointerDown={(e) =>
                handleAudioClipDragStart(e, clip)
              }
              className={`absolute inset-y-0.5 touch-none overflow-hidden rounded-md border transition ${
                isClipSelected
                  ? "cursor-grabbing border-paper ring-2 ring-paper bg-violet-500/25"
                  : "cursor-grab border-violet-500/40 bg-violet-500/15 active:cursor-grabbing"
              } ${isAudioHidden ? "opacity-40 grayscale" : ""}`}
              style={{ left: clipLeft, width: clipWidth }}
              title="Musik latar — tahan & geser buat pindah posisi"
            >
              {/* Waveform beneran, ngikutin amplitude/frekuensi asli
                  potongan file audio klip ini. Bentuk batang DISAMAIN
                  sama Mock-up: rata bawah (items-end, bukan tumbuh
                  dari tengah), ujung batang bulat penuh (rounded-full
                  kayak pil), & gap tipis beneran lewat gap-px —
                  bukan trik border kiri lagi. */}
              <div className="pointer-events-none absolute inset-0 flex items-end gap-px overflow-hidden px-1 pb-0.5">
                {clipPeaks.map((p, i) => (
                  <span
                    key={i}
                    className="min-w-[1.5px] flex-1 shrink-0 rounded-full bg-violet-300/80"
                    style={{
                      height: `${Math.max(8, Math.min(100, p * 100))}%`,
                    }}
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute left-1 top-0.5 flex items-center gap-1 rounded bg-black/55 px-1 py-[1px]">
                <Music size={9} className="shrink-0 text-violet-300" />
                <span className="max-w-[90px] truncate text-[8px] font-medium text-paper">
                  Musik latar
                </span>
              </div>

              {/* Handle trim — cuma nongol pas klip ini
                  terseleksi, biar nggak numpuk-numpuk
                  keliatannya pas klip masih kecil/banyak. */}
              {isClipSelected && (
                <>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleAudioClipTrimStart(e, clip, "left");
                    }}
                    className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize touch-none bg-paper/90"
                    title="Geser buat trim awal klip"
                  >
                    <div className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-graphite" />
                  </div>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleAudioClipTrimStart(e, clip, "right");
                    }}
                    className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize touch-none bg-paper/90"
                    title="Geser buat trim akhir klip"
                  >
                    <div className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-graphite" />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ---- Track teks (dipakai bareng di tab Edit & tab Teks, biar layer
  // teks kelihatan pas lagi ngedit klip media juga). Klik track buat
  // munculin input edit teks khusus layer itu di toolbar bawah.
  function renderTextTrack(
    layer: TemplateTextLayer,
    // Opsional: rentang startSec..endSec klip ini di timeline. Cuma diisi
    // buat entri LIRIK (baris atas/bawah klip TemplateLyricsTextLayer) —
    // itu satu-satunya jenis track teks yang beneran punya posisi/panjang
    // sendiri di waktu (bisa dipotong-potong). Text layer biasa (judul,
    // artist, dst) nggak punya startSec/endSec di tipenya sama sekali,
    // jadi tetap 1 blok statis sepanjang DURATION kalau param ini kosong.
    timeRange?: { start: number; end: number },
  ) {
    const isSelected = selectedTextLayerId === layer.id;
    const value = textValues[layer.id] || layer.defaultText;
    const isTextHidden = hiddenElements.has(layer.id);
    const clipStart = timeRange?.start ?? 0;
    const clipEnd = timeRange?.end ?? DURATION;
    const clipLeft = clipStart * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX;
    const clipWidth = Math.max(28, (clipEnd - clipStart) * effectivePxPerSec - 4);
    return (
      <div key={layer.id} className="relative flex h-8 items-center justify-between">
        <TrackLabel
          hidden={isTextHidden}
          onToggleHidden={(e) => toggleElementHidden(layer.id, e)}
          icon={Type}
          label={layer.label}
          hiddenTitle={`Tampilkan "${layer.label}"`}
          shownTitle={`Sembunyikan "${layer.label}"`}
        />
        <div
          onClick={() => {
            setSelectedSlotId(null);
            setSelectedLayerId(null);
            setSelectedTextLayerId(layer.id);
            setTextToolbarMode("quick");
            setShowAddTextStyles(false);
            if (layer.id === "airplayDevice") dismissAirplayHint();
          }}
          className={`absolute inset-y-0.5 cursor-pointer overflow-hidden rounded-md border transition ${
            isSelected
              ? "border-paper ring-2 ring-paper bg-emerald-400/20"
              : "border-emerald-400/40 bg-emerald-400/15"
          } ${isTextHidden ? "opacity-40 grayscale" : ""}`}
          style={{
            left: clipLeft,
            width: clipWidth,
          }}
          title={layer.label}
        >
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1.5">
            <div className="flex items-center gap-1">
              <Type className="h-[10px] w-[10px] shrink-0 text-emerald-200" />
              <span className="truncate text-[9px] font-semibold leading-none text-emerald-100">
                {layer.label}
              </span>
            </div>
            <span className="max-w-full truncate text-[8px] leading-none text-emerald-200/70">
              {value}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-editor-bg font-sans">
      {/* Top bar — restyle ala mockup "iPhone Music Player V4": grid 3 kolom
          (kiri: back + divider + judul, tengah: spacer, kanan: tombol
          Export solid), bukan lagi judul absolute-center kayak sebelumnya.
          Di-hide total pas fullscreen. */}
      {!isFullscreen && (
      <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-paper/80 transition hover:text-paper active:scale-90"
            title="Kembali ke daftar template"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="h-5 w-px shrink-0 bg-white/10" />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold text-paper sm:text-[15px]">
              {template.name}
            </h1>
            <span
              className={`flex items-center gap-1 text-[9.5px] font-medium text-emerald-300 transition-opacity duration-500 ${
                draftSavedFlash ? "opacity-100" : "opacity-0"
              }`}
            >
              <Check size={9} strokeWidth={3} />
              Draft tersimpan
            </span>
          </div>
        </div>

        <div />

        <div className="flex shrink-0 items-center justify-end">
          {template.baseAssetSrc ? (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2 rounded-xl bg-editor-accent px-3 py-[6px] text-[13px] font-semibold text-paper transition active:scale-90 disabled:opacity-60"
              title={isExporting ? "Merender…" : "Ekspor video"}
              aria-label="Ekspor video"
            >
              {isExporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} strokeWidth={2.4} />
              )}
              Export
            </button>
          ) : (
            <span className="h-9 w-9" />
          )}
        </div>
      </header>
      )}


      {/* Canvas / preview area — takes remaining space, keeps 9:16 ratio */}
      {/* Preview full-bleed — canvas nutup lebar penuh (cover), plus
          gradient fade di bawah biar nyambung ke background gelap. */}
      <div
        ref={previewAreaRef}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-editor-bg transition-[padding] duration-300 ${
          isFullscreen ? "" : "px-4 sm:px-8"
        }`}
      >
        <div
          // TIDAK pakai `aspect-[...]`/`h-full` lagi (lihat catatan di
          // previewBoxSize) — lebar & tinggi eksplisit dari hasil ukur
          // JS, jadi boks SELALU beneran berbentuk sesuai canvasRatio,
          // gak pernah "ke-zoom" gara-gara constraint CSS yang konflik.
          // Fallback w-full h-full dipakai sebelum ResizeObserver sempat
          // ngukur pertama kali (cuma sekejap, useLayoutEffect jadi
          // biasanya udah keburu keitung sebelum paint pertama).
          // Dulu ada ambient glow radial-gradient (2 layer) di belakang
          // boks + boxShadow warna-warni ngikut dominantColor foto
          // sampul — dihapus (diganti outline tipis polos) karena
          // kesannya norak/ganggu & bikin fokus teralih dari canvas.
          className="relative mx-auto max-h-full max-w-full overflow-hidden rounded-sm bg-black outline outline-1 outline-white/15"
          style={{
            width: previewBoxSize?.width ?? "100%",
            height: previewBoxSize?.height ?? "100%",
          }}
        >
          {template.baseAssetSrc || template.solidBackground ? (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="h-full w-full cursor-pointer object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs text-paper/40">Pratinjau video</span>
            </div>
          )}
          {/* canvas-fade — dekoratif, nggak ganggu klik canvas */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-editor-bg"
          />
          {customBackground && (
            <button
              onClick={() => {
                setSelectedSlotId(null);
                setSelectedLayerId(BACKGROUND_LAYER_ID);
                setShowBgLabel(true);
              }}
              className={`absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-paper backdrop-blur-sm transition-opacity duration-700 ease-out active:scale-95 ${
                showBgLabel ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              title="Atur opacity & blur background"
            >
              <Layers size={11} className="text-sky-300" />
              Background kustom
            </button>
          )}
          <audio ref={audioElRef} src={audioMedia?.url} className="hidden" />

          {/* Hint bubble sekali-tampil — nunjuk ke teks nama perangkat
              AirPlay pakai ekor gelembung chat, posisinya ngikutin x/y
              textLayer aslinya (persen relatif canvas, sama kayak dipakai
              buat render teksnya sendiri). Tap di mana aja buat nutup. */}
          {showAirplayHint && airplayHintLayer && (
            <div
              className="absolute inset-0 z-30"
              onClick={dismissAirplayHint}
            >
              <div
                className="absolute flex flex-col items-center"
                style={{
                  left: `${airplayHintLayer.x + 8}%`,
                  top: `${airplayHintLayer.y}%`,
                  transform: "translate(-50%, 0)",
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="animate-hint-pop relative mt-3 w-max max-w-[190px] rounded-2xl bg-paper px-3.5 py-2.5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
                >
                  <button
                    onClick={dismissAirplayHint}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-graphite text-paper shadow-md active:scale-90"
                    aria-label="Tutup pemberitahuan"
                  >
                    <X size={11} />
                  </button>
                  <p className="text-[11px] font-semibold leading-snug text-graphite">
                    Teks ini bisa diganti
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-graphite/60">
                    Buka panel Teks, lalu ketuk nama perangkatnya buat custom.
                  </p>
                  {/* Ekor gelembung, nunjuk lurus ke atas ke posisi teks */}
                  <div className="absolute bottom-full left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-x-transparent border-b-[8px] border-b-paper" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tombol Fullscreen — nempel di tepi kanan preview, re-style
            biar nyatu sama preview full-bleed. */}
        <button
          onClick={() => setIsFullscreen((f) => !f)}
          className="absolute right-3 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-paper backdrop-blur-sm transition active:scale-90"
          title={isFullscreen ? "Keluar dari fullscreen" : "Lihat preview fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

      </div>

      {/* Transport bar — diambil dari mockup (src/routes/index.tsx di
          repo "Mock-up"): Undo/Redo di kiri, Skip-back/Play-Pause/
          Skip-forward di tengah (absolute, biar tetap presisi di tengah
          walau lebar sisi kiri/kanan beda), durasi + ikon keyframe
          (Diamond) di kanan. Menggantikan overlay Play/Pause lama yang
          nempel-ngambang di atas preview (showFloatingControls dkk. —
          sudah dihapus semua).
          Undo/Redo sekarang beneran jalan (lihat historyRef & effect
          pencatat riwayat di atas) — nyatet SEMUA perubahan state
          project (media, teks, warna, opacity, glass, background, audio,
          elemen hidden). Diamond (keyframe) masih murni visual, belum
          ada sistem keyframe di editor ini. */}
      {!isFullscreen && (
        <div className="relative mx-3 mt-2 flex shrink-0 items-center justify-between rounded-xl bg-editor-panel px-3 py-2">
          <div className="flex items-center gap-4">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title={canUndo ? "Urungkan (Ctrl+Z)" : "Belum ada yang bisa diurungkan"}
              className={
                canUndo
                  ? "text-paper transition active:scale-90"
                  : "text-paper/30"
              }
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title={canRedo ? "Ulangi (Ctrl+Shift+Z)" : "Belum ada yang bisa diulangi"}
              className={
                canRedo
                  ? "text-paper transition active:scale-90"
                  : "text-paper/30"
              }
            >
              <Redo2 size={18} />
            </button>
          </div>

          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-5 sm:gap-8">
            <button
              onClick={handleSkipToStart}
              title="Ke awal"
              className="text-paper transition active:scale-90"
            >
              <SkipBack size={16} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? "Jeda" : "Putar"}
              aria-pressed={isPlaying}
              title={isPlaying ? "Jeda" : "Putar"}
              className="flex h-6 w-6 items-center justify-center text-paper transition active:scale-90"
            >
              {isPlaying ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" />
              )}
            </button>
            <button
              onClick={handleSkipToEnd}
              title="Ke akhir"
              className="text-paper transition active:scale-90"
            >
              <SkipForward size={16} fill="currentColor" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="truncate text-[10px] font-medium tabular-nums text-editor-muted">
              {formatClock(currentSec)}
              <span className="text-editor-muted/70"> / {formatClock(DURATION)}</span>
            </span>
            <button
              disabled
              title="Keyframe (belum tersedia)"
              className="text-paper/30"
            >
              <Diamond size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Baris Potong/Hapus audio — cuma nongol pas emang lagi motong
          klip audio (adaptif), biar nggak makan ruang pas nggak kepake. */}
      {!isFullscreen && canCutAudio && (
      <div className="shrink-0 border-t border-white/5 bg-editor-panel px-5 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={handleCutAudio}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-paper transition active:scale-90"
            title="Potong audio di posisi playhead"
          >
            <Scissors size={18} />
          </button>
          {canDeleteAudioClip && (
            <button
              onClick={handleDeleteAudioClip}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-rec transition active:scale-90"
              title="Hapus bagian audio yang dipilih"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>
      )}


      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Overlay crop foto sampul — muncul begitu user pilih file baru
          buat slot bertipe image (lihat handleFileChange). */}
      {cropTarget && (
        <ImageCropModal
          // key: mastiin instance-nya remount bersih tiap sesi crop baru
          // (mis. foto sample gagal -> user batal -> coba foto lain),
          // biar state cropError/pixelCrop/zoom lama nggak kebawa-bawa.
          key={`${cropTarget.slotId}-${cropTarget.url}`}
          imageUrl={cropTarget.url}
          targetWidth={cropTarget.targetWidth}
          targetHeight={cropTarget.targetHeight}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}

      {/* Timeline — bisa digeser horizontal (overflow-x-auto) & tingginya
          bisa di-drag naik/turun (overflow-y-auto di dalam), di-hide pas
          fullscreen */}
      {!isFullscreen && (
      <div
        className="flex shrink-0 select-none flex-col border-t border-white/5 bg-editor-panel"
        style={{ height: timelineHeight }}
      >
        {/* Handle drag — geser buat ngatur tinggi timeline, biar canvas
            preview di atas bisa keliatan penuh kalau ditarik ke bawah. */}
        <div
          onPointerDown={handleTimelineDragStart}
          onPointerMove={handleTimelineDragMove}
          onPointerUp={handleTimelineDragEnd}
          onPointerCancel={handleTimelineDragEnd}
          className="flex shrink-0 cursor-grab touch-none items-center justify-center py-1.5 active:cursor-grabbing"
          title="Geser buat atur tinggi timeline"
        >
          <div className="h-1 w-10 rounded-full bg-mute/30" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
        <div ref={timelineScrollRef} className="overflow-x-auto">
          <div className="relative" style={{ width: TRACK_WIDTH }}>
            {/* Ruler gaya baru — label lebih tipis + dot ticks kecil
                sebagai sub-mark di antara label. */}
            <div className="relative mb-1 h-3 text-[9px] font-medium tracking-wide text-editor-muted">
              {TIME_MARKS.map((t) => (
                <span
                  key={t}
                  className="absolute top-0"
                  style={{ left: t * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX }}
                >
                  {t === 60 ? "1m" : `${t}s`}
                </span>
              ))}
            </div>
            <div className="relative mb-1.5 h-1">
              {TIME_MARKS.slice(0, -1).map((t) => {
                const next = TIME_MARKS[TIME_MARKS.indexOf(t) + 1] ?? t;
                const mid = (t + next) / 2;
                return (
                  <span
                    key={t}
                    className="absolute top-0 h-[3px] w-[3px] rounded-full bg-white/15"
                    style={{ left: mid * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX }}
                  />
                );
              })}
            </div>

            {/* Tag pill mengambang — nampilin layer teks/decor yang aktif
                di atas klip, lengkap dengan connector bulat kiri-kanan. */}
            {(selectedTextLayer || selectedLayer) && (
              <div className="relative mb-1.5 h-6">
                <div className="absolute left-0 top-0 flex items-center gap-1.5 rounded-[7px] border border-editor-accent/50 bg-editor-tag px-2 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-editor-accent" />
                  {selectedTextLayer ? (
                    <Type size={10} className="text-paper/80" />
                  ) : (
                    <SlidersHorizontal size={10} className="text-paper/80" />
                  )}
                  <span className="max-w-[140px] truncate text-[9px] font-medium text-paper">
                    {selectedTextLayer?.label ?? selectedLayer?.label}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-editor-accent" />
                </div>
              </div>
            )}

            {/* Playhead — hit area digedein (w-6) biar enak digeser di HP,
                garis & segitiga visualnya tetap tipis di tengah. */}
            <div
              onPointerDown={handlePlayheadPointerDown}
              className="absolute bottom-0 top-4 z-10 w-6 -translate-x-1/2 touch-none cursor-ew-resize"
              style={{ left: currentSec * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX }}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-paper" />
              <div className="pointer-events-none absolute -top-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-t-[7px] border-t-paper" />
            </div>


            {isTextMode ? (
              /* Mode "Teks" aktif — hide semua track lain (Background, slot
                 foto/video/audio, decor layer), cuma tampilin track teks
                 sejumlah textLayers template ini (+ 2 baris "Lirik" kalau
                 template ini template Lyrics). Klik salah satu track buat
                 munculin input edit teks khusus layer itu di toolbar bawah. */
              allTextLayers.length || lyricsTextEntries.length ? (
                <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-0.5 pb-1">
                  {allTextLayers.map((layer) => renderTextTrack(layer))}
                  {lyricsTextEntries
                    // Klip "Add teks" (customLyricsLayers) sengaja cuma
                    // punya 1 baris aktif — baris satunya di-set hidden +
                    // transparan biar visualnya 1 baris (lihat
                    // addCustomTextLayer). Baris nonaktif itu JANGAN
                    // dimunculin sebagai track kosong di daftar (dulu
                    // tetap kerender dicoret, bikin keliatan kayak nambah
                    // 2 track padahal cuma "Add teks" sekali). Klip
                    // "Lirik" bawaan template (bukan custom) tetap
                    // tampilin 2 baris seperti biasa.
                    .filter((layer) => {
                      const baseId = lyricsBaseIdOf(layer.id);
                      const isCustomSingleLine = baseId
                        ? customLyricsLayers.some((l) => l.id === baseId)
                        : false;
                      return !(isCustomSingleLine && hiddenElements.has(layer.id));
                    })
                    .map((layer) => {
                    const baseId = lyricsBaseIdOf(layer.id);
                    const eff = baseId ? getEffectiveLyricsLayer(baseId) : null;
                    return renderTextTrack(
                      layer,
                      eff ? { start: eff.startSec, end: eff.endSec } : undefined,
                    );
                  })}
                </div>

              ) : !showAddTextStyles ? (
                <div
                  style={{ width: TRACK_WIDTH }}
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-mute/25 bg-graphite/40 py-2.5"
                >
                  <span className="text-xs text-mute">
                    Template ini belum punya teks bawaan.
                  </span>
                  <button
                    onClick={() => setShowAddTextStyles(true)}
                    className="flex items-center gap-1 rounded-lg bg-editor-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-editor-accent transition active:scale-95"
                  >
                    <Plus size={12} />
                    Add teks
                  </button>
                </div>
              ) : (
                // Pilihan style (Ungu/Putih) buat track teks pertama di
                // template yang belum punya text layer bawaan sama sekali.
                <div
                  style={{ width: TRACK_WIDTH }}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-mute/25 bg-graphite/40 px-2.5 py-2"
                >
                  <span className="shrink-0 text-[10px] font-medium text-mute">
                    Style:
                  </span>
                  <button
                    onClick={() => addCustomTextLayer("purple")}
                    className="flex items-center gap-1.5 rounded-lg border border-mute/20 bg-graphite px-2.5 py-1.5 transition active:scale-95"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-white/30"
                      style={{ backgroundColor: "#c3b0ff" }}
                    />
                    <span className="text-[11px] font-semibold text-paper">
                      Ungu
                    </span>
                  </button>
                  <button
                    onClick={() => addCustomTextLayer("white")}
                    className="flex items-center gap-1.5 rounded-lg border border-mute/20 bg-graphite px-2.5 py-1.5 transition active:scale-95"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-mute/30"
                      style={{ backgroundColor: "#FFFFFF" }}
                    />
                    <span className="text-[11px] font-semibold text-paper">
                      Putih
                    </span>
                  </button>
                  <button
                    onClick={() => setShowAddTextStyles(false)}
                    className="ml-auto shrink-0 text-[10px] font-medium text-mute underline underline-offset-2"
                  >
                    Batal
                  </button>
                </div>
              )
            ) : hasSlotTracks && activeTool === "progress" ? (
              /* Tab "Gaya" cuma buat atur setelan tampilan progress lagu
                 (Standar/Waveform, dst) lewat panel di toolbar bawah —
                 nggak ada klip/track yang relevan buat diedit di
                 timeline, jadi timeline-nya dikosongin biar nggak
                 membingungkan (nggak ada track yang bisa diklik di sini). */
              <div
                style={{ width: TRACK_WIDTH }}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-mute/25 bg-graphite/40 py-2.5 text-xs text-mute"
              >
                Pengaturan gaya ada di panel bawah — nggak ada track di sini.
              </div>
            ) : hasSlotTracks ? (
              /* Layer per elemen — tiap slot (foto/video/audio) punya
                 baris/track sendiri, kayak editor video beneran. Klik
                 buat SELECT (bukan langsung buka file picker) — ganti
                 media dilakukan lewat tombol "Ganti" di toolbar bawah. */
              <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-0.5 pb-1">
                {/* Pilihan tampilan progress lagu dipindah ke toolbar
                    bawah (muncul pas tab "Audio" aktif) — lihat
                    activeTool === "audio" di bagian toolbar. */}
                {/* Track "Background" — otomatis muncul begitu template
                    punya foto sampul (dari sample bawaan ATAU upload user),
                    karena foto sampul sekarang OTOMATIS jadi background
                    juga (lihat handleFileChange), gak perlu transfer manual
                    lagi. Klik buat munculin slider opacity & blur di
                    toolbar bawah.
                    Cuma nongol di tool "Media" — di tool "Audio" track ini
                    disembunyiin biar timeline-nya bersih cuma isi audio. */}
                {customBackground && activeTool !== "audio" && (
                  <div className="relative flex h-8 items-center justify-between">
                    <TrackLabel
                      hidden={hiddenElements.has(BACKGROUND_LAYER_ID)}
                      onToggleHidden={(e) => toggleElementHidden(BACKGROUND_LAYER_ID, e)}
                      icon={Layers}
                      label="Background"
                    />
                    <div
                      onClick={() => {
                        setSelectedSlotId(null);
                        setSelectedLayerId(BACKGROUND_LAYER_ID);
                      }}
                      className={`absolute inset-y-0.5 cursor-pointer overflow-hidden rounded-md transition ${
                        isBackgroundLayerSelected
                          ? "border border-paper ring-2 ring-paper"
                          : "border-0"
                      } ${hiddenElements.has(BACKGROUND_LAYER_ID) ? "opacity-40 grayscale" : ""}`}
                      style={{
                        left: TIMELINE_CLIP_OFFSET_PX,
                        width: Math.max(28, DURATION * effectivePxPerSec - 4),
                      }}
                      title="Background"
                    >
                      {/* Thumbnail asli foto background (bukan cuma blok
                          warna polos), diulang ("tile") sepanjang durasi
                          biar keliatan isinya kayak referensi CapCut.
                          Tampilan DISAMAIN sama Mock-up: polos tanpa
                          outline/tint warna & tanpa label di atasnya —
                          cuma readout opacity/blur kecil di pojok kanan
                          (biar tetap kelihatan settingnya lagi berapa). */}
                      {customBackground?.url && (
                        <div
                          className="pointer-events-none absolute inset-0 bg-repeat-x"
                          style={{
                            backgroundImage: `url(${customBackground.url})`,
                            backgroundSize: "auto 100%",
                          }}
                        />
                      )}
                      <ClipCornerLabel icon={Layers} label="Background" />
                      <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/55 px-1 py-[1px] text-[9px] text-paper">
                        {Math.round(backgroundOpacity)}%
                        {backgroundBlur > 0 ? ` · Blur ${Math.round(backgroundBlur)}` : ""}
                      </span>
                    </div>
                  </div>
                )}

                {visibleSlots.map((slot) => {

                  const isAudio = slot.type === "audio";
                  // Track audio digabung ke tab "Edit" (activeTool ===
                  // "media") juga — biar musik latar kelihatan bareng
                  // track foto/video pas lagi ngedit klip media, nggak
                  // perlu pindah-pindah tab. Tab "Audio" tetap fokus cuma
                  // nampilin track audio doang (non-audio disembunyikan),
                  // dan tab lain (mis. "Gaya") tetap nggak nampilin audio.
                  if (isAudio && activeTool !== "audio" && activeTool !== "media") {
                    return null;
                  }
                  if (!isAudio && activeTool === "audio") return null;
                  const filled = Boolean(slotMedia[slot.id]);
                  const isSelected = selectedSlotId === slot.id;
                  const Icon = SLOT_ICON[slot.type];

                  // ---- Track audio: pakai helper renderAudioTrack, yang
                  // sama juga dipakai di mode Teks di bawah — biar track
                  // audio & track teks bisa "digabung" tampil bareng di
                  // timeline yang sama.
                  if (isAudio) {
                    return renderAudioTrack(slot);
                  }

                  // ---- Track slot lain (foto/video) — tetap seperti
                  // semula, satu blok statis sepanjang startSec..endSec. ----
                  const start = slot.startSec ?? 0;
                  const end = slot.endSec ?? DURATION;
                  const isSlotHidden = hiddenElements.has(slot.id);
                  const slotMediaEntry = slotMedia[slot.id];
                  const clipLeft = start * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX;
                  const clipWidth = Math.max(
                    28,
                    (end - start) * effectivePxPerSec - 4,
                  );
                  return (
                    <div
                      key={slot.id}
                      className="relative flex h-8 items-center justify-between"
                    >
                      <TrackLabel
                        hidden={isSlotHidden}
                        onToggleHidden={(e) => toggleElementHidden(slot.id, e)}
                        icon={Icon}
                        label={slot.label}
                        hiddenTitle={`Tampilkan "${slot.label}"`}
                        shownTitle={`Sembunyikan "${slot.label}"`}
                      />
                      <div
                        onClick={() => {
                          setSelectedLayerId(null);
                          setSelectedSlotId(slot.id);
                        }}
                        className={`absolute inset-y-0.5 cursor-pointer overflow-hidden rounded-md transition ${
                          isSelected
                            ? "border border-paper ring-2 ring-paper"
                            : filled
                              ? "border-0"
                              : "border border-dashed border-mute/40 bg-transparent"
                        } ${isSlotHidden ? "opacity-40 grayscale" : ""}`}
                        style={{ left: clipLeft, width: clipWidth }}
                        title={slot.label}
                      >
                        <ClipCornerLabel icon={Icon} label={slot.label} />
                        {/* Thumbnail asli isi klip (foto/frame video),
                            diulang ("tile") sepanjang durasi slot — biar
                            kelihatan isinya beneran kayak track media di
                            CapCut, bukan cuma blok warna polos. Tampilan
                            DISAMAIN sama Mock-up: polos tanpa
                            outline/tint warna & tanpa label ikon-teks di
                            atasnya begitu klip udah keisi — cuma
                            thumbnail-nya doang yang keliatan. */}
                        {filled && slotMediaEntry && slot.type === "image" && (
                          <div
                            className="pointer-events-none absolute inset-0 bg-repeat-x"
                            style={{
                              backgroundImage: `url(${slotMediaEntry.url})`,
                              backgroundSize: "auto 100%",
                            }}
                          />
                        )}
                        {filled && slotMediaEntry && slot.type === "video" && (
                          <video
                            key={slotMediaEntry.url}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                            src={`${slotMediaEntry.url}#t=0.1`}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        )}
                        {!filled && (
                          <div className="relative flex h-full items-center gap-1 px-1.5">
                            <Icon size={12} className="shrink-0 text-mute" />
                            <span className="truncate text-[10px] font-medium text-mute">
                              {slot.label}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Track teks digabung di sini juga (tab Edit) — biar
                    layer teks (judul, artist, dst) kelihatan bareng
                    track foto/video/audio pas lagi ngedit klip media,
                    nggak perlu pindah ke tab Teks buat lihatnya. Pakai
                    helper yang sama kayak di tab Teks, jadi klik/edit-nya
                    identik. Cuma di tab "Media" — di tab Audio/Gaya
                    disembunyikan biar timeline-nya tetap fokus. */}
                {activeTool === "media" &&
                  allTextLayers.map((layer) => renderTextTrack(layer))}

                {/* Track khusus buat decorLayer yang "adjustable" (misal:
                    Card Player) — beda dari slot foto/video/audio karena
                    isinya statis dari awal sampai akhir & klik-nya cuma
                    buat munculin slider opacity di toolbar bawah, bukan
                    buka file picker. Disembunyiin pas tool "Audio" aktif
                    (ini elemen visual, bukan audio). */}
                {activeTool !== "audio" && adjustableLayers.map((layer) => {
                  const isSelected = selectedLayerId === layer.id;
                  const op = layerOpacity[layer.id] ?? layer.opacity ?? 100;
                  const isLayerHidden = hiddenElements.has(layer.id);
                  return (
                    <div
                      key={layer.id}
                      className="relative flex h-8 items-center justify-between"
                    >
                      <TrackLabel
                        hidden={isLayerHidden}
                        onToggleHidden={(e) => toggleElementHidden(layer.id, e)}
                        icon={SlidersHorizontal}
                        label={layer.label}
                        hiddenTitle={`Tampilkan "${layer.label}"`}
                        shownTitle={`Sembunyikan "${layer.label}"`}
                      />
                      <div
                        onClick={() => {
                          setSelectedSlotId(null);
                          setSelectedLayerId(layer.id);
                        }}
                        className={`absolute inset-y-0.5 cursor-pointer overflow-hidden rounded-md transition ${
                          isSelected
                            ? "border border-paper ring-2 ring-paper bg-violet-400/20"
                            : "border-0 bg-violet-400/15"
                        } ${isLayerHidden ? "opacity-40 grayscale" : ""}`}
                        style={{
                          left: TIMELINE_CLIP_OFFSET_PX,
                          width: Math.max(28, DURATION * effectivePxPerSec - 4),
                        }}
                        title={layer.label}
                      >
                        {/* Thumbnail asset PNG asli layer ini (kartu
                            player/AirPlay, volume bar, dst), diulang
                            sepanjang track — bukan cuma blok warna ungu
                            polos. */}
                        {layer.assetSrc && (
                          <div
                            className="pointer-events-none absolute inset-0 bg-repeat-x bg-graphite/60"
                            style={{
                              backgroundImage: `url(${layer.assetSrc})`,
                              backgroundSize: "auto 90%",
                              backgroundPosition: "center",
                            }}
                          />
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                        <ClipCornerLabel icon={SlidersHorizontal} label={layer.label} />
                        <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/55 px-1 py-[1px] text-[9px] text-paper">
                          {Math.round(op)}%
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Tombol "+" nambah/ganti klip media (buka file picker
                    yang sama) — dipindah ke PALING BAWAH daftar layer
                    (setelah semua track), persis posisi "+ Tambah Klip"
                    di Mock-up. Cuma di tool "Media", biar nggak nyampur
                    sama tool Audio. */}
                {mediaSlotDef && activeTool !== "audio" && (
                  <div className="flex items-center pt-1">
                    <button
                      onClick={() => openPicker(mediaSlotDef)}
                      className="flex items-center gap-2 rounded-lg bg-ed-card px-3 py-[6px] text-[11px] text-ed-text transition active:scale-95"
                      title="Tambah / ganti klip media"
                      aria-label="Tambah klip media"
                    >
                      <Plus className="h-[14px] w-[14px]" />
                      Tambah klip
                    </button>
                  </div>
                )}

                {/* Tombol "Tambah Audio" — cuma muncul di tool "Audio" DAN
                    selama slot audio-nya masih KOSONG (belum ada klip sama
                    sekali). Begitu audio sudah ada (audioMedia terisi),
                    tombol ini otomatis di-hide — track klip audio yang
                    dirender di visibleSlots.map di atas yang gantiin
                    perannya (klik klip buat pilih, geser/trim, dst). Juga
                    dipindah ke paling bawah, sama kayak tombol media. */}
                {audioSlotDef && activeTool === "audio" && !audioMedia && (
                  <div className="flex items-center pt-1">
                    <button
                      onClick={() => openPicker(audioSlotDef)}
                      className="flex items-center gap-2 rounded-lg bg-ed-card px-3 py-[6px] text-[11px] text-ed-text transition active:scale-95"
                      title="Tambah audio"
                      aria-label="Tambah audio"
                    >
                      <Plus className="h-[14px] w-[14px]" />
                      Tambah audio
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                style={{ width: TRACK_WIDTH }}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-mute/25 bg-graphite/40 py-2.5 text-xs text-mute transition hover:bg-graphite hover:text-paper active:scale-[0.99]"
              >
                <Plus size={14} />
                Menambahkan media ke proyek ini
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
      )}

      {/* Toolbar bawah — row menu utama (Media/Audio/Teks/Gaya/Urungkan/
          Ulangi/Preset) POSISINYA TETAP terkunci di paling bawah, gak
          pernah ikut animasi. Panel kontekstual (pengaturan Background,
          Liquid Glass, opacity layer, ganti slot, edit teks) di-render
          sebagai card overlay TERPISAH yang muncul/ganti isi DI ATAS row
          menu itu (lihat BottomNavCard di bawah) — jadi yang "naik-turun"
          cuma panelnya sendiri, timeline & row menu utama gak ikut geser. */}
      {!isFullscreen && (() => {
        const panelMode = isBackgroundLayerSelected
          ? "background"
          : selectedLayer?.liquidGlass
            ? "glass"
            : selectedLayer
              ? "layer"
              : selectedSlot
                ? "slot"
                : selectedTextLayer
                  ? "text"
                  : "default";

        // Cuma panel Background & Liquid Glass yang tingginya bisa
        // di-drag manual (sheetHeight); sisanya menyesuaikan isi
        // kontennya sendiri (diukur & dianimasikan otomatis oleh
        // BottomNavCard).
        const panelHeight =
          panelMode === "background" || panelMode === "glass"
            ? sheetHeight
            : undefined;

        let content: ReactNode;
        // Kalau ini keisi (bukan null), row menu utama (Media/Audio/Teks/
        // Gaya/Preset) di bawah DIGANTI TOTAL sama isi ini, bukan cuma
        // ditumpuk overlay di atasnya — dipakai khusus buat quick action
        // teks (Edit/Add teks/Cut/Delete/Tutup) begitu 1 track teks/lirik
        // diketuk, biar gak ada 2 baris menu numpuk kayak sebelumnya.
        let quickTextNavActions: ReactNode = null;
        // Overlay panel cuma perlu dirender kalau beneran ada isinya. Di
        // mode "default", Media & Audio emang sengaja kosong (gak ada
        // pengaturan apa-apa) — cuma tab Gaya (activeTool "progress") yang
        // punya konten. Daripada overlay nongol kosong lalu "ngempes" pas
        // ResizeObserver nyusul ngukur ulang, mending overlay-nya gak usah
        // di-mount sama sekali kalau kosong.
        const hasDefaultContent =
          (activeTool === "progress" && !!template.progressLayer) ||
          activeTool === "ratio";

        if (panelMode === "background") {
          content = (
            <>
              <SheetDragHandle />
              <div className="shrink-0 px-3 pb-2">
                <span className="text-xs font-semibold text-paper">
                  Pengaturan Background
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-2">
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-medium text-paper">
                    Opacity
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={backgroundOpacity}
                    onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                    title="Opacity background"
                  />
                  <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(backgroundOpacity)}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-medium text-paper">
                    Blur
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={MAX_BACKGROUND_BLUR}
                    step={1}
                    value={backgroundBlur}
                    onChange={(e) => setBackgroundBlur(Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                    title="Blur background"
                  />
                  <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(backgroundBlur)}px
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-center gap-6 border-t border-white/5 px-3 pb-3 pt-2">
                <NavAction icon={X} label="Selesai" onClick={() => setSelectedLayerId(null)} />
                <NavAction icon={RotateCcw} label="Reset" onClick={handleResetBackground} />
              </div>
            </>
          );
        } else if (panelMode === "glass" && selectedLayer) {
          const layer = selectedLayer;
          const glass = layer.liquidGlass!;
          const effective = getEffectiveGlassSettings(layer);
          const updateGlass = (patch: Partial<LiquidGlassSettings>) =>
            setGlassSettings((prev) => ({
              ...prev,
              [layer.id]: { ...prev[layer.id], ...patch },
            }));
          const modeOptions: { value: LiquidGlassSettings["mode"]; label: string }[] = [
            { value: "standard", label: "Standard" },
            { value: "polar", label: "Polar" },
            { value: "prominent", label: "Prominent" },
            { value: "shader", label: "Shader" },
          ];
          content = (
            <>
              <SheetDragHandle />
              <div className="shrink-0 px-3 pb-2">
                <span className="truncate text-xs font-semibold text-paper">
                  Pengaturan Kaca — {layer.label}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-2">
                {/* Opacity layer (sama seperti layer biasa) */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Opacity
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={layerOpacity[layer.id] ?? layer.opacity ?? 100}
                    onChange={(e) =>
                      setLayerOpacity((prev) => ({
                        ...prev,
                        [layer.id]: Number(e.target.value),
                      }))
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(layerOpacity[layer.id] ?? layer.opacity ?? 100)}%
                  </span>
                </div>

                {/* Refraction Mode */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-paper">
                    Refraction Mode
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {modeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => updateGlass({ mode: opt.value })}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition active:scale-95 ${
                          effective.mode === opt.value
                            ? "border-paper bg-paper text-ink"
                            : "border-mute/25 text-mute hover:text-paper"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {effective.mode === "shader" && (
                    <span className="text-[10px] text-mute">
                      Mode Shader (Experimental) — dihitung dari nol tiap ukuran
                      card, bisa sedikit lebih berat.
                    </span>
                  )}
                </div>

                {/* Displacement Scale */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Displacement
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={1}
                    value={effective.displacementScale}
                    onChange={(e) =>
                      updateGlass({ displacementScale: Number(e.target.value) })
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(effective.displacementScale)}
                  </span>
                </div>

                {/* Blur Amount */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Blur
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={effective.blurAmount}
                    onChange={(e) =>
                      updateGlass({ blurAmount: Number(e.target.value) })
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {effective.blurAmount.toFixed(2)}
                  </span>
                </div>

                {/* Saturation */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Saturation
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={1}
                    value={effective.saturation}
                    onChange={(e) =>
                      updateGlass({ saturation: Number(e.target.value) })
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(effective.saturation)}%
                  </span>
                </div>

                {/* Chromatic Aberration */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Aberration
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={effective.aberrationIntensity}
                    onChange={(e) =>
                      updateGlass({ aberrationIntensity: Number(e.target.value) })
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {effective.aberrationIntensity.toFixed(1)}
                  </span>
                </div>

                {/* Corner Radius */}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-paper">
                    Radius Sudut
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={1}
                    value={glass.cornerRadius}
                    disabled
                    className="h-1.5 flex-1 cursor-not-allowed appearance-none rounded-full bg-graphite opacity-40 accent-paper"
                    style={{ accentColor: "#ECEAE4" }}
                    title="Radius sudut kartu mengikuti layout template (biar posisi elemen lain tetap pas)"
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                    {Math.round(glass.cornerRadius)}px
                  </span>
                </div>

                {/* Over Light */}
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={effective.overLight}
                    onChange={(e) => updateGlass({ overLight: e.target.checked })}
                    className="h-4 w-4 shrink-0 accent-paper"
                  />
                  <span className="flex-1 text-xs font-medium text-paper">
                    Over Light — tint kaca gelap (buat background terang)
                  </span>
                </label>
              </div>

              <div className="flex shrink-0 items-center justify-center gap-6 border-t border-white/5 px-3 pb-3 pt-2">
                <NavAction icon={X} label="Selesai" onClick={() => setSelectedLayerId(null)} />
                <NavAction
                  icon={RotateCcw}
                  label="Reset"
                  onClick={() =>
                    setGlassSettings((prev) => ({ ...prev, [layer.id]: {} }))
                  }
                />
              </div>
            </>
          );
        } else if (panelMode === "layer" && selectedLayer) {
          content = (
            <>
              <div className="flex items-center gap-3 px-3 pb-2 pt-2.5">
                <span className="shrink-0 text-xs font-medium text-paper">
                  Opacity
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={layerOpacity[selectedLayer.id] ?? selectedLayer.opacity ?? 100}
                  onChange={(e) =>
                    setLayerOpacity((prev) => ({
                      ...prev,
                      [selectedLayer.id]: Number(e.target.value),
                    }))
                  }
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite accent-paper"
                  style={{ accentColor: "#ECEAE4" }}
                  title={`Opacity ${selectedLayer.label}`}
                />
                <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-mute">
                  {Math.round(layerOpacity[selectedLayer.id] ?? selectedLayer.opacity ?? 100)}%
                </span>
              </div>
              <div className="flex items-center justify-center gap-1 px-3 pb-3 pt-1">
                <NavAction icon={X} label="Selesai" onClick={() => setSelectedLayerId(null)} />
              </div>
            </>
          );
        } else if (panelMode === "slot" && selectedSlot) {
          content = (
            <div className="flex items-center justify-center gap-6 px-3 pb-3 pt-2">
              <NavAction
                icon={X}
                label="Batal"
                onClick={() => {
                  setSelectedSlotId(null);
                  setSelectedAudioClipId(null);
                }}
              />
              <NavAction
                icon={RefreshCcw}
                label={`Ganti ${SLOT_SHORT_LABEL[selectedSlot.type]}`}
                active
                onClick={() => openPicker(selectedSlot)}
              />
              {/* Cuma slot foto yang bisa di-crop ulang — video/audio gak
                  relevan buat crop gambar. */}
              {selectedSlot.type === "image" && (
                <NavAction
                  icon={Crop}
                  label="Crop"
                  onClick={() => handleOpenCropForSlot(selectedSlot)}
                />
              )}
            </div>
          );
        } else if (panelMode === "text" && selectedTextLayer) {
          // Warna aktif teks ini: pakai override user (textColors) kalau
          // ada, fallback ke warna default dari data template.
          const activeTextColor =
            textColors[selectedTextLayer.id] ?? selectedTextLayer.color ?? "#FFFFFF";
          const effLyrics = selectedLyricsBaseId
            ? getEffectiveLyricsLayer(selectedLyricsBaseId)
            : null;
          // Boleh motong cuma kalau klip lirik ini keseleksi & playhead lagi
          // di TENGAH klipnya (bukan di tepi/luar), sama kayak canCutAudio
          // — biar 2 hasil potongannya sama-sama nggak "hilang" (< durasi
          // minimum).
          const canCutSelectedLyrics = Boolean(
            effLyrics &&
              currentSec > effLyrics.startSec + MIN_LYRICS_CLIP_DURATION &&
              currentSec < effLyrics.endSec - MIN_LYRICS_CLIP_DURATION,
          );
          if (textToolbarMode === "quick" && !showAddTextStyles) {
            // ---- Quick action row — GANTI TOTAL row menu utama Media/
            // Audio/Teks/Gaya/Preset di bawah (bukan numpuk overlay lagi),
            // begitu track teks/lirik diketuk pertama kali. Semua tombol
            // SATU warna (putih polos, gaya sama kayak NavAction biasa) —
            // TANPA background ungu/merah, cuma ikon + label.
            quickTextNavActions = (
              <>
                <NavAction
                  icon={Pencil}
                  label="Edit"
                  onClick={() => setTextToolbarMode("edit")}
                />
                <NavAction
                  icon={Plus}
                  label="Add"
                  onClick={() => setShowAddTextStyles(true)}
                />
                {/* Potong & Hapus — cuma buat klip LIRIK (yang beneran
                    punya posisi/durasi sendiri di timeline & bisa
                    dipecah). Text layer biasa (judul/artist/dst) sengaja
                    TIDAK bisa dipotong/dihapus, karena itu field tetap
                    bawaan template, bukan track lepas. */}
                {selectedLyricsBaseId && (
                  <NavAction
                    icon={Scissors}
                    label="Cut"
                    disabled={!canCutSelectedLyrics}
                    onClick={() => handleCutLyricsClip(selectedLyricsBaseId)}
                  />
                )}
                {selectedLyricsBaseId && (
                  <NavAction
                    icon={Trash2}
                    label="Delete"
                    onClick={() => handleDeleteLyricsClip(selectedLyricsBaseId)}
                  />
                )}
                <NavAction
                  icon={X}
                  label="Tutup"
                  onClick={() => setSelectedTextLayerId(null)}
                />
              </>
            );
          } else if (textToolbarMode === "quick") {
            // showAddTextStyles true — submenu pilih style (Ungu/Putih)
            // masih dirender sebagai overlay biasa (bukan gantiin nav row)
            // karena butuh tampilan swatch besar, bukan cuma ikon simpel.
            content = (
              <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
                <span className="text-[10px] font-medium text-mute">
                  Pilih style teksnya
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => addCustomTextLayer("purple")}
                    className="flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-mute/20 bg-graphite transition active:scale-95"
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-white/30"
                      style={{ backgroundColor: "#c3b0ff" }}
                    />
                    <span className="text-[10px] font-semibold text-paper">
                      Ungu
                    </span>
                  </button>
                  <button
                    onClick={() => addCustomTextLayer("white")}
                    className="flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-mute/20 bg-graphite transition active:scale-95"
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-mute/30"
                      style={{ backgroundColor: "#FFFFFF" }}
                    />
                    <span className="text-[10px] font-semibold text-paper">
                      Putih
                    </span>
                  </button>
                </div>
                <button
                  onClick={() => setShowAddTextStyles(false)}
                  className="self-start text-[10px] font-medium text-mute underline underline-offset-2"
                >
                  Batal
                </button>
              </div>
            );
          } else {
            content = (
              <>
              {/* Tab "Teks" / "Animasi" — cuma muncul buat entri lirik
                  (baris atas/bawah klip Lyrics), text layer biasa (judul,
                  artist, dst) gak punya setting animasi jadi gak perlu tab. */}
              {selectedLyricsBaseId && effLyrics && (
                <div className="flex gap-1.5 px-3 pt-2.5">
                  {(["teks", "anim"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setLyricsPanelTab(tab)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                        lyricsPanelTab === tab
                          ? "bg-editor-accent text-paper"
                          : "bg-graphite text-mute"
                      }`}
                    >
                      {tab === "teks" ? "Teks" : "Animasi"}
                    </button>
                  ))}
                </div>
              )}
              {selectedLyricsBaseId && effLyrics && lyricsPanelTab === "anim" ? (
                <LyricsAnimPanel
                  layer={effLyrics}
                  onChange={(key, value) =>
                    updateLyricsSetting(selectedLyricsBaseId, key, value)
                  }
                />
              ) : (
              <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
                <span className="text-[10px] font-medium text-mute">
                  {selectedTextLayer.label}
                </span>
                {/* Input & tombol Selesai SATU baris (bukan input di atas,
                    tombol di bawahnya) — tombol nempel di kanan input.
                    PENTING: TIDAK ada autoFocus di sini — klik track cuma
                    nyeleksi & munculin panel ini, keyboard/edit baru aktif
                    kalau user beneran ngetuk kotak input-nya sendiri. */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={textValues[selectedTextLayer.id] ?? ""}
                    maxLength={selectedTextLayer.maxLength}
                    onChange={(e) =>
                      setTextValues((prev) => ({
                        ...prev,
                        [selectedTextLayer.id]: e.target.value,
                      }))
                    }
                    placeholder={selectedTextLayer.defaultText}
                    className="min-w-0 flex-1 rounded-lg border border-mute/20 bg-graphite px-3 py-2 text-sm text-paper outline-none transition focus:border-paper/50"
                  />
                  <button
                    onClick={() => setSelectedTextLayerId(null)}
                    className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-editor-accent/20 px-3 text-xs font-medium text-editor-accent transition active:scale-95"
                  >
                    <X size={14} />
                    Selesai
                  </button>
                </div>
                {/* Color picker — ganti warna teks layer ini. Swatch warna
                    umum dulu, terakhir 1 swatch custom (input type=color
                    asli browser) buat warna bebas di luar daftar preset. */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  {TEXT_COLOR_SWATCHES.map((c) => {
                    const isActive = activeTextColor.toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        onClick={() =>
                          setTextColors((prev) => ({
                            ...prev,
                            [selectedTextLayer.id]: c,
                          }))
                        }
                        title={c}
                        aria-label={`Warna ${c}`}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition active:scale-90 ${
                          isActive
                            ? "border-paper ring-2 ring-paper"
                            : "border-mute/30"
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {isActive && (
                          <Check
                            size={12}
                            className={
                              c === "#FFFFFF" || c === "#FFEB3B"
                                ? "text-graphite"
                                : "text-white"
                            }
                          />
                        )}
                      </button>
                    );
                  })}
                  <label
                    className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-mute/40 text-mute"
                    title="Warna custom"
                  >
                    <Palette size={12} />
                    <input
                      type="color"
                      value={activeTextColor}
                      onChange={(e) =>
                        setTextColors((prev) => ({
                          ...prev,
                          [selectedTextLayer.id]: e.target.value,
                        }))
                      }
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                </div>
              </div>
              )}
              </>
            );
          }
        } else {
          content = (
            <>
              {/* Tab "Rasio" — pilih orientasi canvas (potret 9:16 /
                  lanskap 16:9). Resolusi tetap di budget 1920x1080, cuma
                  tukar mana yang lebar/tinggi (lihat getRatioCanvasSize). */}
              {activeTool === "ratio" && (
                <div className="flex items-center justify-center gap-3 border-b border-mute/10 px-3 py-3">
                  <button
                    onClick={() => setCanvasRatio("9:16")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3.5 py-2.5 transition active:scale-95 ${
                      canvasRatio === "9:16"
                        ? "border-paper bg-paper/10"
                        : "border-mute/15 bg-graphite/40"
                    }`}
                  >
                    <RectangleVertical
                      size={22}
                      className={canvasRatio === "9:16" ? "text-paper" : "text-mute"}
                    />
                    <span
                      className={`text-[10px] font-medium ${
                        canvasRatio === "9:16" ? "text-paper" : "text-mute"
                      }`}
                    >
                      9:16
                    </span>
                  </button>
                  <button
                    onClick={() => setCanvasRatio("16:9")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3.5 py-2.5 transition active:scale-95 ${
                      canvasRatio === "16:9"
                        ? "border-paper bg-paper/10"
                        : "border-mute/15 bg-graphite/40"
                    }`}
                  >
                    <RectangleHorizontal
                      size={22}
                      className={canvasRatio === "16:9" ? "text-paper" : "text-mute"}
                    />
                    <span
                      className={`text-[10px] font-medium ${
                        canvasRatio === "16:9" ? "text-paper" : "text-mute"
                      }`}
                    >
                      16:9
                    </span>
                  </button>
                </div>
              )}
              {/* Tab "Gaya" — preview visual tiap opsi progress bar SEBELUM
                  dipilih (bukan cuma teks label doang). */}
              {activeTool === "progress" && template.progressLayer && (
                <div className="flex items-center justify-center gap-3 border-b border-mute/10 px-3 py-3">
                  <button
                    onClick={() => setProgressStyle("bar")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3.5 py-2.5 transition active:scale-95 ${
                      progressStyle === "bar"
                        ? "border-paper bg-paper/10"
                        : "border-mute/15 bg-graphite/40"
                    }`}
                  >
                    <div className="flex h-6 w-24 items-center rounded-full bg-black/50 px-1">
                      <div className="h-1.5 w-1/2 rounded-full bg-white" />
                    </div>
                    <span
                      className={`text-[10px] font-medium ${
                        progressStyle === "bar" ? "text-paper" : "text-mute"
                      }`}
                    >
                      Standar
                    </span>
                  </button>
                  <button
                    onClick={() => setProgressStyle("waveform")}
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-3.5 py-2.5 transition active:scale-95 ${
                      progressStyle === "waveform"
                        ? "border-paper bg-paper/10"
                        : "border-mute/15 bg-graphite/40"
                    }`}
                  >
                    <div className="flex h-6 w-24 items-end justify-center gap-[2px] rounded-full bg-black/50 px-1.5 py-1">
                      {[5, 10, 7, 14, 8, 12, 6, 5, 9, 5, 7, 4].map((h, i) => (
                        <div
                          key={i}
                          className="w-[2px] rounded-full bg-white"
                          style={{ height: h, opacity: i < 6 ? 1 : 0.32 }}
                        />
                      ))}
                    </div>
                    <span
                      className={`text-[10px] font-medium ${
                        progressStyle === "waveform" ? "text-paper" : "text-mute"
                      }`}
                    >
                      Waveform berjalan
                    </span>
                  </button>
                </div>
              )}
            </>
          );
        }

        // Row menu utama (Media/Audio/Teks/Gaya/Urungkan/Ulangi/Preset)
        // SENGAJA dipisah dari `content` di atas & dirender permanen di luar
        // BottomNavCard (lihat return di bawah) — biar posisinya TETAP,
        // gak pernah ikut animasi turun/naik atau geser walau panel
        // kontekstual (Background, Liquid Glass, opacity layer, ganti slot,
        // edit teks) lagi kebuka/ganti. Panel kontekstual itu sendiri
        // di-render sebagai overlay yang "naik" nutupin timeline dari bawah
        // (absolute, bottom-full), bukan bikin timeline/row menu ikut geser.
        //
        // PENGECUALIAN: quick action teks/lirik (quickTextNavActions) BUKAN
        // overlay numpuk di atas row ini — dia GANTI ISI row nav utama itu
        // sendiri (lihat return di bawah), jadi showOverlay-nya dimatiin
        // biar gak dobel.
        const showOverlay =
          !quickTextNavActions && (panelMode !== "default" || hasDefaultContent);

        return (
          <div className="relative z-30 shrink-0">
            {showOverlay && (
              <div className="absolute inset-x-0 bottom-full">
                <BottomNavCard
                  panelKey={panelMode === "default" ? `default-${activeTool}` : panelMode}
                  height={panelHeight}
                >
                  {content}
                </BottomNavCard>
              </div>
            )}

            <div className="flex items-center justify-between gap-1 border-t border-white/5 bg-editor-panel px-3 pb-3 pt-2">
              {quickTextNavActions ? (
                quickTextNavActions
              ) : (
                <>
                  {visibleTools.map(({ id, label, icon: Icon }) => (
                    <NavAction
                      key={id}
                      icon={Icon}
                      label={label}
                      active={activeTool === id}
                      onClick={() => {
                        setActiveTool(id);
                        if (id === "media") {
                          setIsTextMode(false);
                          setSelectedTextLayerId(null);
                          setSelectedLayerId(null);
                          setSelectedAudioClipId(null);
                          // Sengaja NGGAK langsung setSelectedSlotId di sini —
                          // itu bikin toolbar "nyasar" ke mode "Ganti Foto".
                          // Slot beneran dipilih lewat tombol "Ganti Media"
                          // di atas (activeTool === "media"), sama kayak pola
                          // tombol "Tambah Audio" buat tool Audio.
                          setSelectedSlotId(null);
                        }
                        if (id === "audio") {
                          setIsTextMode(false);
                          setSelectedTextLayerId(null);
                          setSelectedSlotId(null);
                          setSelectedLayerId(null);
                          setSelectedAudioClipId(null);
                        }
                        if (id === "text") {
                          setSelectedSlotId(null);
                          setSelectedLayerId(null);
                          setSelectedAudioClipId(null);
                          setIsTextMode(true);
                        }
                        if (id === "progress") {
                          setIsTextMode(false);
                          setSelectedTextLayerId(null);
                          setSelectedSlotId(null);
                          setSelectedLayerId(null);
                          setSelectedAudioClipId(null);
                        }
                      }}
                    />
                  ))}

                  <NavAction
                    icon={Bookmark}
                    label="Preset"
                    onClick={() => setShowPresetPanel(true)}
                  />
                </>
              )}
            </div>
          </div>
        );
      })()}



      {/* Modal Preset — simpan pengaturan sekarang jadi preset baru, atau
          muat/hapus preset yang sudah ada. */}
      {showPresetPanel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6">
          <div className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-t-2xl bg-panel shadow-xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-mute/10 px-4 py-3">
              <h2 className="text-sm font-semibold text-paper">Preset</h2>
              <button
                onClick={() => setShowPresetPanel(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
              >
                <X size={16} />
              </button>
            </div>

            <div className="shrink-0 border-b border-mute/10 p-4">
              <label className="mb-1.5 block text-[11px] font-medium text-mute">
                Simpan pengaturan sekarang sebagai preset baru
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Nama preset…"
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-lg border border-mute/20 bg-graphite px-3 py-2 text-xs text-paper placeholder:text-mute/60 focus:border-mute/40 focus:outline-none"
                />
                <button
                  onClick={handleSavePreset}
                  disabled={!presetName.trim() || isSavingPreset}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-paper px-3 text-xs font-semibold text-graphite transition active:scale-95 disabled:opacity-50"
                >
                  {isSavingPreset ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  Simpan
                </button>
              </div>
              {presetError && (
                <p className="mt-2 text-[11px] text-rec">{presetError}</p>
              )}
              {presetNotice && !presetError && (
                <p className="mt-2 text-[11px] text-mute">{presetNotice}</p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-2 text-[11px] font-medium text-mute">
                Preset tersimpan
              </p>
              <p className="mb-3 text-[10px] leading-relaxed text-mute/70">
                Preset disimpan lokal di HP/browser ini aja (bukan di server) —
                kalau hapus data situs / cache Chrome buat neditz.vercel.app,
                atau pindah browser lain, preset ini bakal ikut hilang.
              </p>
              {presetsLoading ? (
                <div className="flex items-center justify-center py-8 text-mute">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : presets.length === 0 ? (
                <p className="py-6 text-center text-xs text-mute">
                  Belum ada preset. Atur project ini dulu, terus simpan di atas.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {presets.map((p) => {
                    const isBusy = presetBusyId === p.id;
                    const isOtherTemplate = p.templateId !== template.id;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 rounded-xl border border-mute/10 bg-graphite/60 p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-paper">
                            {p.name}
                          </p>
                          <p className="truncate text-[10px] text-mute">
                            {p.templateName}
                            {isOtherTemplate && " · template beda"}
                            {" · "}
                            {new Date(p.createdAt).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleLoadPreset(p.id)}
                          disabled={isBusy}
                          className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-paper px-3 text-[11px] font-semibold text-graphite transition active:scale-95 disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            "Muat"
                          )}
                        </button>
                        <button
                          onClick={() => handleDeletePreset(p.id, p.name)}
                          disabled={isBusy}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-rec/10 hover:text-rec active:scale-95 disabled:opacity-50"
                          title="Hapus preset"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal progress / hasil export — dark theme senada sama editor
          (editor-bg/editor-panel/editor-track + aksen ungu editor-accent),
          bukan lagi palet lama (panel/graphite/rec) biar nyambung visual
          sama layar editornya. */}
      {(isExporting || exportResultUrl || exportError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-xs overflow-hidden rounded-3xl border border-white/10 bg-editor-panel p-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
            {/* Glow ambient ungu di belakang, senada sama editor-accent —
                kasih kesan "premium" tanpa ganggu keterbacaan. */}
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-editor-accent/25 blur-3xl" />

            {isExporting && (
              <div className="relative">
                {exportSnapshot ? (
                  <div className={`relative mx-auto mb-4 ${canvasRatio === "16:9" ? "aspect-[16/9]" : "aspect-[9/16]"} w-full overflow-hidden rounded-2xl border border-white/10 bg-black`}>
                    <img
                      src={exportSnapshot}
                      alt=""
                      className="h-full w-full object-cover transition-opacity duration-300 ease-linear"
                      style={{ opacity: 0.3 + 0.7 * ((exportProgress?.percent ?? 0) / 100) }}
                    />
                    <div className="animate-export-scan pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-editor-accent/30 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10" />
                    {/* Badge persen mengambang di pojok, biar fokus tetap di
                        preview sambil tetap keliatan progressnya jalan. */}
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur-sm">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-editor-accent" />
                      <span className="text-[10px] font-semibold tabular-nums text-paper">
                        {Math.round(exportProgress?.percent ?? 0)}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-editor-accent/15">
                    <Loader2 size={20} className="animate-spin text-editor-accent" />
                  </div>
                )}
                <div className="flex items-center justify-center gap-1.5">
                  <Sparkles size={13} className="text-editor-accent" />
                  <p className="text-sm font-semibold text-paper">
                    Merender video kamu…
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-editor-muted">
                  {exportProgress?.label ?? "Lagi diproses, jangan tutup dulu ya"}
                </p>
                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-editor-track">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-editor-accent/70 via-editor-accent to-editor-accent/70 transition-all duration-300 ease-out"
                    style={{ width: `${exportProgress?.percent ?? 0}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] font-medium tabular-nums text-editor-muted">
                  {Math.round(exportProgress?.percent ?? 0)}%
                </p>
                <button
                  onClick={handleCancelExport}
                  className="mt-4 w-full rounded-full border border-white/10 bg-editor-track px-4 py-2.5 text-xs font-medium text-paper transition hover:bg-white/10 active:scale-[0.98]"
                >
                  Batalkan
                </button>
              </div>
            )}

            {!isExporting && exportError && (
              <div className="relative">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rec/15">
                  <X size={20} className="text-rec" />
                </div>
                <p className="text-sm font-semibold text-paper">Export gagal</p>
                <p className="mt-1.5 text-xs leading-relaxed text-editor-muted">
                  {exportError}
                </p>
                <button
                  onClick={() => setExportError(null)}
                  className="mt-4 w-full rounded-full border border-white/10 bg-editor-track px-4 py-2.5 text-xs font-medium text-paper transition hover:bg-white/10 active:scale-[0.98]"
                >
                  Tutup
                </button>
              </div>
            )}

            {!isExporting && exportResultUrl && (
              <div className="relative">
                <div className="flex items-center justify-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15">
                    <Check size={16} className="text-emerald-400" />
                  </div>
                  <p className="text-sm font-semibold text-paper">Video siap!</p>
                  {exportEngineUsed && (
                    <span
                      className="rounded-full bg-editor-accent/15 px-2 py-0.5 text-[10px] font-semibold text-editor-accent"
                      title="Dirender pakai WebCodecs API (VideoEncoder/AudioEncoder) — hardware-accelerated"
                    >
                      ⚡ WebCodecs
                    </span>
                  )}
                </div>
                <video
                  src={exportResultUrl}
                  controls
                  className={`mt-3 ${canvasRatio === "16:9" ? "aspect-[16/9]" : "aspect-[9/16]"} w-full rounded-2xl border border-white/10 bg-black`}
                />
                <div className="mt-3 flex gap-2">
                  <a
                    href={exportResultUrl}
                    download={`${template.id}.mp4`}
                    className="flex-1 rounded-full bg-editor-accent px-3 py-2.5 text-xs font-semibold text-paper shadow-[0_4px_16px_rgba(124,108,255,0.4)] transition hover:brightness-110 active:scale-[0.98]"
                  >
                    Unduh
                  </a>
                  <button
                    onClick={() => setExportResultUrl(null)}
                    className="flex-1 rounded-full border border-white/10 bg-editor-track px-3 py-2.5 text-xs font-medium text-paper transition hover:bg-white/10 active:scale-[0.98]"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
