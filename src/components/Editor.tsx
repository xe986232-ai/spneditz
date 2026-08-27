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
} from "lucide-react";
import ImageCropModal from "./ImageCropModal";
import { getDominantColor } from "../lib/color";
import type { Template, TemplateSlot, SlotType, LiquidGlassSettings } from "../types";import {
  parseDurationSec,
  initialSlotMedia,
  initialLayerOpacity,
  initialTextValues,
  isSlotActiveAt,
  roundRectPath,
  drawImageCover,
  drawImageCoverZoomed,
  drawTextLayers,
  drawDurationLayer,
  drawProgressFill,
  drawWaveformProgress,
  drawSpectrumIndicator,
  ImageCache,
} from "../lib/render";
import type { SlotMediaEntry } from "../lib/render";
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

const TOOLS: Tool[] = [
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "audio", label: "Audio", icon: Music },
  { id: "text", label: "Teks", icon: Type },
];

// Tab tambahan khusus pemilihan GAYA progress bar (Standar / Waveform
// berjalan) — cuma ditampilkan kalau template-nya emang punya
// progressLayer (bukan semua template punya elemen ini), makanya
// dipisah dari TOOLS di atas dan digabung belakangan lewat visibleTools.
const PROGRESS_STYLE_TOOL: Tool = {
  id: "progress",
  label: "Gaya",
  icon: AudioWaveform,
};

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

// Tombol nav generik — ikon di atas, label kecil di bawah, ukuran & style
// SAMA PERSIS kayak toolbar utama (Media/Audio/Teks/Urungkan/dst). Dipakai
// juga di semua toolbar kontekstual (Ganti Foto, Selesai, Reset, Batal,
// dst) biar begitu menu utama "disembunyikan" & diganti menu lain, style-nya
// tetap konsisten satu sama lain — bukan bikin tampilan/bar baru yang beda.
function NavAction({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-90 ${
        active
          ? "bg-editor-accent/20 text-editor-accent"
          : "text-paper/55 hover:text-paper"
      }`}
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
// Batas max blur (px, dalam skala canvas asli 1080x1920).
const MAX_BACKGROUND_BLUR = 100;
// Blur background default per template (px). Template v4 langsung full
// blur (100px) begitu dibuka/direset, template lain tetap 0 (tajam).
function defaultBackgroundBlurFor(templateId: string): number {
  return templateId === "iphone-music-player-v4" ? 100 : 0;
}
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
// Seberapa banyak background di-zoom (overscan, px per level blur) biar
// pas di-blur nggak ada gradasi hitam di tepian — lihat drawImageCoverZoomed.
const BACKGROUND_BLUR_OVERSCAN_FACTOR = 2;

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

// Format detik jadi mm:ss buat label waktu di atas baris playback.
function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Tombol mata kecil di kiri tiap baris track — nempel (sticky) ke tepi
// kiri area timeline yang scrollable, jadi tetap keliatan/gampang diketuk
// meskipun user geser timeline ke kanan. Klik toggle hidden/show elemen
// itu tanpa ikut milih (select) track-nya.
function TrackEyeButton({
  hidden,
  onToggle,
  title,
}: {
  hidden: boolean;
  onToggle: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title ?? (hidden ? "Tampilkan elemen" : "Sembunyikan elemen")}
      aria-label={hidden ? "Tampilkan elemen" : "Sembunyikan elemen"}
      className={`sticky left-1 z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition active:scale-90 ${
        hidden
          ? "border-mute/20 bg-graphite/80 text-mute"
          : "border-editor-accent/40 bg-editor-accent/15 text-editor-accent"
      }`}
    >
      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
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
  // Mode "Teks" lagi aktif/nggak — begitu true, timeline berganti tampilan:
  // cuma nampilin track teks (sejumlah textLayers template ini), track lain
  // (Background/slot/decor) disembunyikan sementara.
  const [isTextMode, setIsTextMode] = useState(false);
  // Track teks yang lagi diketuk/terseleksi di timeline (dalam isTextMode) —
  // kalau ada isinya, toolbar bawah berubah jadi input edit khusus teks itu.
  const [selectedTextLayerId, setSelectedTextLayerId] = useState<string | null>(
    null,
  );

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
  // Warna dominan (vivid) hasil ekstraksi dari foto yang lagi diupload
  // user — dipakai buat ambient glow/shadow di belakang canvas preview,
  // biar nyatu sama warna foto-nya (mirip "Canvas" Spotify). Default abu2
  // netral selama belum ada foto/belum selesai dianalisis.
  const [dominantColor, setDominantColor] = useState("110, 110, 120");
  const [renderTick, setRenderTick] = useState(0);
  const imageCacheRef = useRef(new ImageCache());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
        setTextValues((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (record.textValues[key] !== undefined) {
              next[key] = record.textValues[key];
            }
          }
          return next;
        });
        setAudioClips(record.audioClips.map((c) => ({ ...c })));
        setHiddenElements(new Set(record.hiddenElements));
        setCurrentSec(record.currentSec ?? 0);
      } catch {
        // Gagal muat draft (mis. sudah kehapus/eviction browser) — biarin
        // Editor tetap kebuka normal pakai default template, gak usah
        // nge-block user dengan alert.
      } finally {
        if (!cancelled) hydratingDraftRef.current = false;
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
        textValues,
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
    textValues,
    audioClips,
    hiddenElements,
  ]);

  const audioSlotDef = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlotDef ? slotMedia[audioSlotDef.id] : undefined;
  // Slot media pertama (foto/video, bukan audio) — dipakai tombol "Media"
  // di toolbar bawah buat langsung menuju slot itu (sama seperti nge-tap
  // slot-nya langsung di timeline), tanpa buka file picker duluan.
  const mediaSlotDef = template.slots.find((s) => s.type !== "audio");
  // Tab "Gaya" (pilihan progress bar) cuma relevan buat template yang
  // punya progressLayer — biar reusable ke template lain yang gak punya
  // elemen ini tanpa nampilin tab kosong/gak guna.
  const visibleTools = template.progressLayer
    ? [...TOOLS, PROGRESS_STYLE_TOOL]
    : TOOLS;

  // Foto sumber buat glow ambient di belakang canvas — sampul yang
  // diupload user (slot media pertama non-audio), fallback ke background
  // kustom kalau itu yang aktif. Cuma dipakai kalau bukan sample bawaan
  // (biar glow-nya representasi foto ASLI user, bukan placeholder).
  const coverSourceUrl =
    (mediaSlotDef && slotMedia[mediaSlotDef.id]?.kind === "file"
      ? slotMedia[mediaSlotDef.id]?.url
      : undefined) ?? customBackground?.url;

  // Ekstrak ulang warna dominan tiap kali foto sumbernya ganti.
  useEffect(() => {
    if (!coverSourceUrl) {
      setDominantColor("110, 110, 120");
      return;
    }
    let cancelled = false;
    getDominantColor(coverSourceUrl).then((rgb) => {
      if (!cancelled) setDominantColor(rgb);
    });
    return () => {
      cancelled = true;
    };
  }, [coverSourceUrl]);

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


  const templateDurationSec = Math.max(
    0.1,
    template.baseAssetSrc ? parseDurationSec(template.duration) : 60,
  );
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
  // Track teks (dalam isTextMode) yang lagi terseleksi — dipakai buat nentuin
  // isi toolbar bawah (input edit teks khusus layer itu).
  const selectedTextLayer = template.textLayers?.find(
    (l) => l.id === selectedTextLayerId,
  );
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
    if (!canvas || !backgroundSrc) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const canvasW = template.canvasWidth ?? 1080;
    const canvasH = template.canvasHeight ?? 1920;
    canvas.width = canvasW;
    canvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const cache = imageCacheRef.current;
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
      drawImageCover(ctx, img, 0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // Teks custom (judul, artist, nama device) — di atas semua decor
    // layer, biar selalu kebaca jelas.
    if (template.textLayers?.length) {
      const visibleTextLayers = template.textLayers.filter(
        (l) => !hiddenElements.has(l.id),
      );
      if (visibleTextLayers.length) {
        drawTextLayers(ctx, canvasW, canvasH, visibleTextLayers, textValues);
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
    textValues,
    hiddenElements,
    DURATION,
    progressStyle,
    audioInfo,
  ]);

  // Drag playhead: geser langsung ke posisi jari/kursor, pause dulu selama digeser
  function handlePlayheadPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setIsPlaying(false);
    const container = timelineScrollRef.current;
    if (!container) return;

    const moveTo = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft;
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
        textValues,
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

      setTextValues((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (record.textValues[key] !== undefined) {
            next[key] = record.textValues[key];
          }
        }
        return next;
      });

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
      const canvasW = template.canvasWidth ?? 1080;
      const canvasH = template.canvasHeight ?? 1920;
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
    const canvasW = template.canvasWidth ?? 1080;
    const canvasH = template.canvasHeight ?? 1920;
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
    const canvasW = template.canvasWidth ?? 1080;
    const canvasH = template.canvasHeight ?? 1920;
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
        slots: template.slots.filter((slot) => !hiddenElements.has(slot.id)),
        textLayers: template.textLayers?.filter(
          (l) => !hiddenElements.has(l.id),
        ),
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

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-editor-bg font-sans">
      {/* Top bar minimal — back (kiri), nama template (tengah), tombol
          check bulat (kanan) = Ekspor. Di-hide total pas fullscreen. */}
      {!isFullscreen && (
      <div className="relative flex shrink-0 items-center justify-between px-3 py-2.5">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-paper/80 transition hover:text-paper active:scale-90"
          title="Kembali ke daftar template"
        >
          <ArrowLeft size={20} />
        </button>

        <span className="pointer-events-none absolute left-1/2 flex max-w-[55%] -translate-x-1/2 flex-col items-center">
          <span className="truncate text-sm font-semibold text-paper">
            {template.name}
          </span>
          <span
            className={`mt-0.5 flex items-center gap-1 text-[9.5px] font-medium text-emerald-300 transition-opacity duration-500 ${
              draftSavedFlash ? "opacity-100" : "opacity-0"
            }`}
          >
            <Check size={9} strokeWidth={3} />
            Draft tersimpan
          </span>
        </span>

        {template.baseAssetSrc ? (
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-paper transition active:scale-90 disabled:opacity-60"
            title={isExporting ? "Merender…" : "Ekspor video"}
            aria-label="Ekspor video"
          >
            {isExporting ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <Download size={17} strokeWidth={2.4} />
            )}
            <span className="text-sm font-semibold">Export</span>
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}
      </div>
      )}


      {/* Canvas / preview area — takes remaining space, keeps 9:16 ratio */}
      {/* Preview full-bleed — canvas nutup lebar penuh (cover), plus
          gradient fade di bawah biar nyambung ke background gelap. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-editor-bg">
        {/* Ambient glow — warnanya ngikutin warna dominan foto user. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[background] duration-700 ease-out"
          style={{
            background: `radial-gradient(60% 55% at 50% 45%, rgba(${dominantColor}, 0.45), rgba(${dominantColor}, 0.14) 45%, rgba(${dominantColor}, 0) 75%)`,
            filter: "blur(40px)",
          }}
        />
        <div className="relative mx-auto aspect-[9/16] h-full max-h-full max-w-full overflow-hidden bg-black">
          {template.baseAssetSrc ? (
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

        {/* Play/Pause + label waktu — mengambang nempel di preview
            (kayak referensi), jadi nggak butuh panel terpisah lagi. */}
        {!isFullscreen && (
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium tabular-nums text-paper backdrop-blur-sm">
              {formatClock(currentSec)}
              <span className="text-paper/50"> / {formatClock(DURATION)}</span>
            </span>
            <button
              onClick={() => setIsPlaying((p) => !p)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-paper backdrop-blur-sm transition active:scale-90"
              title={isPlaying ? "Jeda" : "Putar"}
            >
              {isPlaying ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" className="ml-0.5" />
              )}
            </button>
          </div>
        )}
      </div>


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
                  style={{ left: t * effectivePxPerSec }}
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
                    style={{ left: mid * effectivePxPerSec }}
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
              style={{ left: currentSec * effectivePxPerSec }}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-paper" />
              <div className="pointer-events-none absolute -top-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-t-[7px] border-t-paper" />
            </div>


            {template.baseAssetSrc && isTextMode ? (
              /* Mode "Teks" aktif — hide semua track lain (Background, slot
                 foto/video/audio, decor layer), cuma tampilin track teks
                 sejumlah textLayers template ini. Klik salah satu track buat
                 munculin input edit teks khusus layer itu di toolbar bawah. */
              template.textLayers?.length ? (
                <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-0.5 pb-1">
                  {template.textLayers.map((layer) => {
                    const isSelected = selectedTextLayerId === layer.id;
                    const value = textValues[layer.id] || layer.defaultText;
                    const isTextHidden = hiddenElements.has(layer.id);
                    return (
                      <div
                        key={layer.id}
                        className="relative flex h-11 items-center rounded-md border border-mute/10 bg-editor-track"
                      >
                        <TrackEyeButton
                          hidden={isTextHidden}
                          onToggle={(e) => toggleElementHidden(layer.id, e)}
                          title={
                            isTextHidden
                              ? `Tampilkan "${layer.label}"`
                              : `Sembunyikan "${layer.label}"`
                          }
                        />
                        <div
                          onClick={() => {
                            setSelectedSlotId(null);
                            setSelectedLayerId(null);
                            setSelectedTextLayerId(layer.id);
                            if (layer.id === "airplayDevice") dismissAirplayHint();
                          }}
                          className={`absolute inset-y-0.5 left-10 cursor-pointer overflow-hidden rounded border transition ${
                            isSelected
                              ? "border-paper ring-2 ring-paper bg-amber-400/20"
                              : "border-amber-400/40 bg-amber-400/15"
                          } ${isTextHidden ? "opacity-40 grayscale" : ""}`}
                          style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
                          title={layer.label}
                        >
                          <div className="flex h-full items-center gap-1 px-1.5">
                            <Type size={12} className="shrink-0 text-amber-200" />
                            <span className="truncate text-[10px] font-medium text-paper">
                              {layer.label}
                            </span>
                            <span className="ml-auto max-w-[45%] shrink-0 truncate text-[9px] text-amber-200/80">
                              {value}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{ width: TRACK_WIDTH }}
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-mute/25 bg-graphite/40 py-2.5 text-xs text-mute"
                >
                  Template ini belum punya teks yang bisa di-custom.
                </div>
              )
            ) : template.baseAssetSrc ? (
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
                  <div className="relative flex h-11 items-center rounded-md border border-mute/10 bg-editor-track">
                    <TrackEyeButton
                      hidden={hiddenElements.has(BACKGROUND_LAYER_ID)}
                      onToggle={(e) => toggleElementHidden(BACKGROUND_LAYER_ID, e)}
                    />
                    <div
                      onClick={() => {
                        setSelectedSlotId(null);
                        setSelectedLayerId(BACKGROUND_LAYER_ID);
                      }}
                      className={`absolute inset-y-0.5 left-10 cursor-pointer overflow-hidden rounded border transition ${
                        isBackgroundLayerSelected
                          ? "border-paper ring-2 ring-paper bg-sky-400/20"
                          : "border-sky-400/40 bg-sky-400/15"
                      } ${hiddenElements.has(BACKGROUND_LAYER_ID) ? "opacity-40 grayscale" : ""}`}
                      style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
                      title="Background"
                    >
                      {/* Thumbnail asli foto background (bukan cuma blok
                          warna polos), diulang ("tile") sepanjang durasi
                          biar keliatan isinya kayak referensi CapCut. */}
                      {customBackground?.url && (
                        <div
                          className="pointer-events-none absolute inset-0 bg-repeat-x opacity-70"
                          style={{
                            backgroundImage: `url(${customBackground.url})`,
                            backgroundSize: "auto 100%",
                          }}
                        />
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <div className="relative flex h-full items-center gap-1 px-1.5">
                        <Layers size={12} className="shrink-0 text-sky-200" />
                        <span className="truncate text-[10px] font-medium text-paper">
                          Background
                        </span>
                        <span className="ml-auto shrink-0 text-[9px] text-sky-200/80">
                          {Math.round(backgroundOpacity)}%
                          {backgroundBlur > 0 ? ` · Blur ${Math.round(backgroundBlur)}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tombol "+" ungu di ujung kiri baris klip — shortcut
                    nambah/ganti klip media (buka file picker yang sama).
                    Cuma di tool "Media", biar nggak nyampur sama tool
                    Audio. */}
                {mediaSlotDef && activeTool !== "audio" && (
                  <div className="flex items-center gap-2 pb-0.5">
                    <button
                      onClick={() => openPicker(mediaSlotDef)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-editor-accent text-paper transition active:scale-90"
                      title="Tambah / ganti klip media"
                      aria-label="Tambah klip media"
                    >
                      <Plus size={13} strokeWidth={2.5} />
                    </button>
                    <span className="text-[9px] font-medium text-editor-muted">
                      Tambah klip
                    </span>
                  </div>
                )}

                {visibleSlots.map((slot) => {

                  const isAudio = slot.type === "audio";
                  // Isolasi per tool: tool "Audio" cuma nampilin track
                  // audio, tool lain (Media/Gaya/dll) cuma nampilin track
                  // non-audio (foto/video) — biar nggak nyampur kayak
                  // sebelumnya.
                  if (isAudio && activeTool !== "audio") return null;
                  if (!isAudio && activeTool === "audio") return null;
                  const filled = Boolean(slotMedia[slot.id]);
                  const isSelected = selectedSlotId === slot.id;
                  const Icon = SLOT_ICON[slot.type];

                  // ---- Track audio: dirender sebagai kumpulan KLIP
                  // terpisah (bukan satu blok statis) — tiap klip bisa
                  // digeser (drag badan klip) & ditrim/dipotong (drag
                  // handle di tepi kiri/kanan-nya begitu klip diseleksi).
                  if (isAudio) {
                    if (!filled) return null;
                    const sourceDuration = audioInfo?.duration ?? DURATION;
                    return (
                      <div
                        key={slot.id}
                        onClick={() => {
                          setSelectedLayerId(null);
                          setSelectedSlotId(slot.id);
                        }}
                        className={`relative h-11 rounded-md border bg-black/20 transition ${
                          isSelected ? "border-paper/40" : "border-mute/10"
                        }`}
                      >
                        {audioClips.map((clip) => {
                          const clipDuration = clip.trimEnd - clip.trimStart;
                          const clipLeft = clip.offset * effectivePxPerSec + 2;
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
                              className={`absolute inset-y-0.5 touch-none overflow-hidden rounded border transition ${
                                isClipSelected
                                  ? "cursor-grabbing border-paper ring-2 ring-paper bg-emerald-500/25"
                                  : "cursor-grab border-emerald-500/40 bg-emerald-500/15 active:cursor-grabbing"
                              }`}
                              style={{ left: clipLeft, width: clipWidth }}
                              title="Musik latar — tahan & geser buat pindah posisi"
                            >
                              {/* Waveform beneran, ngikutin amplitude/frekuensi
                                  asli potongan file audio klip ini. Bar rapat
                                  (nggak ada gap, lebar ngisi % penuh) biar
                                  keliatan "mengalir" kayak gelombang asli,
                                  bukan segelintir batang gemuk berjarak
                                  lebar. */}
                              <div className="pointer-events-none absolute inset-0 flex items-center px-1">
                                {clipPeaks.map((p, i) => (
                                  <span
                                    key={i}
                                    className="shrink-0 rounded-[1px] bg-emerald-300/80"
                                    style={{
                                      width: `${100 / clipPeaks.length}%`,
                                      // Sedikit "gap" optis lewat border kiri
                                      // tipis, bukan margin/gap flex — biar
                                      // nggak ngurangin lebar total pas bar
                                      // dikit (klip pendek).
                                      borderLeft: "1px solid rgba(0,0,0,0.35)",
                                      height: `${Math.max(10, Math.min(100, p * 100))}%`,
                                    }}
                                  />
                                ))}
                              </div>
                              <div className="pointer-events-none absolute left-1 top-0.5 flex items-center gap-1 rounded bg-black/55 px-1 py-[1px]">
                                <Music size={9} className="shrink-0 text-emerald-300" />
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

                  // ---- Track slot lain (foto/video) — tetap seperti
                  // semula, satu blok statis sepanjang startSec..endSec. ----
                  const start = slot.startSec ?? 0;
                  const end = slot.endSec ?? DURATION;
                  const isSlotHidden = hiddenElements.has(slot.id);
                  const slotMediaEntry = slotMedia[slot.id];
                  const clipLeft = start * effectivePxPerSec + 40;
                  const clipWidth = Math.max(
                    28,
                    (end - start) * effectivePxPerSec - 4,
                  );
                  return (
                    <div
                      key={slot.id}
                      className="relative flex h-11 items-center rounded-md border border-mute/10 bg-editor-track"
                    >
                      <TrackEyeButton
                        hidden={isSlotHidden}
                        onToggle={(e) => toggleElementHidden(slot.id, e)}
                        title={
                          isSlotHidden
                            ? `Tampilkan "${slot.label}"`
                            : `Sembunyikan "${slot.label}"`
                        }
                      />
                      <div
                        onClick={() => {
                          setSelectedLayerId(null);
                          setSelectedSlotId(slot.id);
                        }}
                        className={`absolute inset-y-0.5 cursor-pointer overflow-hidden rounded border transition ${
                          isSelected
                            ? "border-paper ring-2 ring-paper"
                            : filled
                              ? "border-sky-400/40 bg-sky-400/20"
                              : "border-dashed border-mute/40 bg-transparent"
                        } ${isSelected && filled ? "bg-sky-400/20" : ""} ${
                          isSlotHidden ? "opacity-40 grayscale" : ""
                        }`}
                        style={{ left: clipLeft, width: clipWidth }}
                        title={slot.label}
                      >
                        {/* Thumbnail asli isi klip (foto/frame video),
                            diulang ("tile") sepanjang durasi slot — biar
                            kelihatan isinya beneran kayak track media di
                            CapCut, bukan cuma blok warna polos. */}
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
                        {filled && (
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />
                        )}
                        <div className="relative flex h-full items-center gap-1 px-1.5">
                          <Icon
                            size={12}
                            className={`shrink-0 ${filled ? "text-sky-200" : "text-mute"}`}
                          />
                          <span
                            className={`truncate text-[10px] font-medium ${
                              filled ? "text-paper" : "text-mute"
                            }`}
                          >
                            {slot.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

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
                      className="relative flex h-11 items-center rounded-md border border-mute/10 bg-editor-track"
                    >
                      <TrackEyeButton
                        hidden={isLayerHidden}
                        onToggle={(e) => toggleElementHidden(layer.id, e)}
                        title={
                          isLayerHidden
                            ? `Tampilkan "${layer.label}"`
                            : `Sembunyikan "${layer.label}"`
                        }
                      />
                      <div
                        onClick={() => {
                          setSelectedSlotId(null);
                          setSelectedLayerId(layer.id);
                        }}
                        className={`absolute inset-y-0.5 left-10 cursor-pointer overflow-hidden rounded border transition ${
                          isSelected
                            ? "border-paper ring-2 ring-paper bg-violet-400/20"
                            : "border-violet-400/40 bg-violet-400/15"
                        } ${isLayerHidden ? "opacity-40 grayscale" : ""}`}
                        style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
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
                        <div className="relative flex h-full items-center gap-1 px-1.5">
                          <SlidersHorizontal size={12} className="shrink-0 text-violet-200" />
                          <span className="truncate text-[10px] font-medium text-paper">
                            {layer.label}
                          </span>
                          <span className="ml-auto shrink-0 text-[9px] text-violet-200/80">
                            {Math.round(op)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
          content = (
            <>
              <div className="flex flex-col gap-1 px-3 pb-2 pt-2.5">
                <span className="text-[10px] font-medium text-mute">
                  {selectedTextLayer.label}
                </span>
                <input
                  type="text"
                  autoFocus
                  value={textValues[selectedTextLayer.id] ?? ""}
                  maxLength={selectedTextLayer.maxLength}
                  onChange={(e) =>
                    setTextValues((prev) => ({
                      ...prev,
                      [selectedTextLayer.id]: e.target.value,
                    }))
                  }
                  placeholder={selectedTextLayer.defaultText}
                  className="w-full rounded-lg border border-mute/20 bg-graphite px-3 py-2 text-sm text-paper outline-none transition focus:border-paper/50"
                />
              </div>
              <div className="flex items-center justify-center gap-1 px-3 pb-3 pt-1">
                <NavAction icon={X} label="Selesai" onClick={() => setSelectedTextLayerId(null)} />
              </div>
            </>
          );
        } else {
          content = (
            <>
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
        return (
          <div className="relative z-30 shrink-0">
            <div className="absolute inset-x-0 bottom-full">
              <BottomNavCard panelKey={panelMode} height={panelHeight}>
                {content}
              </BottomNavCard>
            </div>

            <div className="flex items-center justify-between gap-1 border-t border-white/5 bg-editor-panel px-3 pb-3 pt-2">
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

              <NavAction icon={Undo2} label="Urungkan" />
              <NavAction icon={Redo2} label="Ulangi" />
              <NavAction
                icon={Bookmark}
                label="Preset"
                onClick={() => setShowPresetPanel(true)}
              />
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
                  <div className="relative mx-auto mb-4 aspect-[9/16] w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
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
                  className="mt-3 aspect-[9/16] w-full rounded-2xl border border-white/10 bg-black"
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
