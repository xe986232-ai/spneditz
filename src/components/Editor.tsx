import { useEffect, useMemo, useRef, useState } from "react";
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
  ZoomOut,
  ZoomIn,
  Plus,
  Scissors,
  Home,
  Download,
  Loader2,
  X,
  RefreshCcw,
  SlidersHorizontal,
  Layers,
  RotateCcw,
  Trash2,
  AudioWaveform,
  SkipBack,
  SkipForward,
  Bookmark,
  Save,
  Lock,
} from "lucide-react";
import { getDominantColor } from "../lib/color";
import type { Template, TemplateSlot, SlotType, LiquidGlassSettings } from "../types";
import {
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
import { subscribeWaveformEnabled } from "../lib/premiumFlags";
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

// ID khusus (bukan decorLayer beneran dari template) buat nandain track
// "Background" di timeline — dipakai bareng selectedLayerId yang sama
// biar reuse UI seleksi track yang sudah ada.
const BACKGROUND_LAYER_ID = "__background__";
// Batas max blur (px, dalam skala canvas asli 1080x1920).
const MAX_BACKGROUND_BLUR = 40;
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
const SEEK_STEP_SEC = 1;

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
}: {
  template: Template;
  onBack: () => void;
}) {
  const [activeTool, setActiveTool] = useState<string>("text");
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
  const [backgroundBlur, setBackgroundBlur] = useState(0);
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
    "bar",
  );
  // ---- Status fitur premium "Waveform berjalan" — dengerin real-time
  // dari Firebase Realtime Database (config/waveformEnabled). Selama belum
  // kebaca (null), anggap terkunci dulu (fail-safe) biar nggak sempat
  // kebuka keliru sebelum datanya sampai. ----
  const [waveformEnabled, setWaveformEnabled] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    const unsubscribe = subscribeWaveformEnabled(setWaveformEnabled);
    return unsubscribe;
  }, []);
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
  useEffect(() => {
    if (!isPlaying) return;

    startRef.current = performance.now() - currentSec * 1000;

    const tick = (now: number) => {
      const elapsed = (now - startRef.current) / 1000;
      if (elapsed >= DURATION) {
        setCurrentSec(DURATION);
        setIsPlaying(false);
        return;
      }
      setCurrentSec(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

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
  const backgroundSrc = customBackground?.url ?? template.baseAssetSrc;

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
      if (customBackground) {
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
      drawTextLayers(ctx, canvasW, canvasH, template.textLayers, textValues);
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
    setBackgroundBlur(0);
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const slotId = pendingSlotRef.current;
    e.target.value = "";
    if (!file || !slotId) return;
    const url = URL.createObjectURL(file);
    const entry: SlotMediaEntry = { kind: "file", url, file };
    setSlotMedia((prev) => ({ ...prev, [slotId]: entry }));
    setSelectedSlotId(null);
    // Foto sampul otomatis dipakai lagi jadi background begitu diganti —
    // gak perlu pencet "Transfer" manual, dan otomatis REPLACE (bukan
    // numpuk) background lama siapa pun sumbernya.
    if (slotId === coverSlotId) {
      setCustomBackground(entry);
      setBackgroundOpacity(100);
      setBackgroundBlur(0);
    }
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
    // Gaya "Waveform berjalan" boleh dipilih & di-preview bebas, tapi
    // EXPORT-nya dikunci selama config/waveformEnabled di Firebase belum
    // true — badge "Premium" di tombolnya sudah ngasih tau ini dari awal.
    if (progressStyle === "waveform" && !waveformEnabled) {
      setExportError(
        "Gaya \"Waveform berjalan\" masih Premium — belum bisa dipakai buat export. Ganti dulu ke gaya \"Standar\", atau tunggu fiturnya diaktifkan.",
      );
      return;
    }
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
        decorLayers: template.decorLayers?.map((layer) =>
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
      const { blob, engine } = await exportTemplateVideoAuto(
        exportTemplate,
        slotMedia,
        layerOpacity,
        (p) => setExportProgress(p),
        customBackground,
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
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-graphite font-sans">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-mute/10 bg-panel px-3 py-2">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
          title="Kembali ke daftar template"
        >
          <Home size={18} />
        </button>

        <span className="truncate text-xs font-medium text-mute">
          {template.name}
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPresetPanel(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Preset"
          >
            <Bookmark size={18} />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Urungkan"
          >
            <Undo2 size={18} />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Ulangi"
          >
            <Redo2 size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {template.baseAssetSrc && (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex h-9 items-center gap-1.5 rounded-full bg-paper px-3 text-xs font-semibold text-graphite transition active:scale-95 disabled:opacity-60"
            >
              {isExporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {isExporting ? "Merender…" : "Ekspor"}
            </button>
          )}
        </div>
      </div>

      {/* Canvas / preview area — takes remaining space, keeps 9:16 ratio */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-graphite p-3">
        {/* Ambient glow — warnanya ngikutin warna dominan foto yang
            diupload user (lihat coverSourceUrl/dominantColor di atas),
            transisi halus tiap kali warnanya berubah. Diletakkan di
            belakang canvas (persis kayak efek "Canvas" Spotify). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[background] duration-700 ease-out"
          style={{
            background: `radial-gradient(60% 55% at 50% 45%, rgba(${dominantColor}, 0.55), rgba(${dominantColor}, 0.18) 45%, rgba(${dominantColor}, 0) 75%)`,
            filter: "blur(40px)",
          }}
        />
        <div className="relative aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-md bg-black shadow-sm">
          {template.baseAssetSrc ? (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="h-full w-full cursor-pointer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs text-paper/40">Pratinjau video</span>
            </div>
          )}
          {customBackground && (
            <button
              onClick={() => {
                setSelectedSlotId(null);
                setSelectedLayerId(BACKGROUND_LAYER_ID);
                setShowBgLabel(true);
              }}
              className={`absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-paper backdrop-blur-sm transition-opacity duration-700 ease-out active:scale-95 ${
                showBgLabel ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              title="Atur opacity & blur background"
            >
              <Layers size={11} className="text-sky-300" />
              Background kustom
            </button>
          )}
          <audio ref={audioElRef} src={audioMedia?.url} className="hidden" />
        </div>
      </div>

      {/* Playback controls */}
      <div className="grid shrink-0 grid-cols-3 items-center border-t border-mute/10 bg-panel px-4 py-1.5">
        <div className="justify-self-start flex items-center gap-1">
          <button
            onClick={handleCutAudio}
            disabled={!canCutAudio}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-95 ${
              canCutAudio
                ? "text-paper hover:bg-graphite"
                : "cursor-not-allowed text-mute/40"
            }`}
            title={
              canCutAudio
                ? "Potong audio di posisi playhead"
                : "Pilih track audio & posisikan playhead di tengah klip buat motong"
            }
          >
            <Scissors size={17} />
          </button>
          <button
            onClick={handleDeleteAudioClip}
            disabled={!canDeleteAudioClip}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-95 ${
              canDeleteAudioClip
                ? "text-rec hover:bg-graphite"
                : "cursor-not-allowed text-mute/40"
            }`}
            title={
              canDeleteAudioClip
                ? "Hapus bagian audio yang dipilih"
                : "Pilih dulu bagian audio (klip) yang mau dihapus"
            }
          >
            <Trash2 size={17} />
          </button>
        </div>

        <div className="justify-self-center flex items-center gap-3">
          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentSec((s) => Math.max(0, s - SEEK_STEP_SEC));
            }}
            disabled={currentSec <= 0}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
              currentSec <= 0
                ? "cursor-not-allowed text-mute/30"
                : "text-mute hover:bg-graphite hover:text-paper"
            }`}
            title={`Mundur ${SEEK_STEP_SEC} detik`}
          >
            <SkipBack size={15} fill="currentColor" />
          </button>

          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-paper text-graphite transition hover:bg-paper/90 active:scale-95"
            title={isPlaying ? "Jeda" : "Putar"}
          >
            {isPlaying ? (
              <Pause size={16} fill="#15171C" />
            ) : (
              <Play size={16} fill="#15171C" className="ml-0.5" />
            )}
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentSec((s) => Math.min(DURATION, s + SEEK_STEP_SEC));
            }}
            disabled={currentSec >= DURATION}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
              currentSec >= DURATION
                ? "cursor-not-allowed text-mute/30"
                : "text-mute hover:bg-graphite hover:text-paper"
            }`}
            title={`Maju ${SEEK_STEP_SEC} detik`}
          >
            <SkipForward size={15} fill="currentColor" />
          </button>
        </div>

        <div className="justify-self-end flex items-center gap-1">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Perkecil"
          >
            <ZoomOut size={17} />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Perbesar"
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Timeline — bisa digeser horizontal (overflow-x-auto) */}
      <div className="shrink-0 select-none border-t border-mute/10 bg-panel px-4 pb-1.5 pt-2">
        <div ref={timelineScrollRef} className="overflow-x-auto">
          <div className="relative" style={{ width: TRACK_WIDTH }}>
            {/* Ruler */}
            <div className="relative mb-1.5 h-3 text-[10px] text-mute">
              {TIME_MARKS.map((t) => (
                <span
                  key={t}
                  className="absolute"
                  style={{ left: t * effectivePxPerSec }}
                >
                  {t === 60 ? "1m" : `${t}s`}
                </span>
              ))}
            </div>

            {/* Playhead — hit area digedein (w-6) biar enak digeser di HP,
                garis & segitiga visualnya tetap tipis di tengah. top-5
                dimulai dari bawah ruler, bottom-0 biar nembus semua layer
                nggak peduli berapa banyak layer-nya. */}
            <div
              onPointerDown={handlePlayheadPointerDown}
              className="absolute bottom-0 top-5 z-10 w-6 -translate-x-1/2 touch-none cursor-ew-resize"
              style={{ left: currentSec * effectivePxPerSec }}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-rec" />
              <div className="pointer-events-none absolute -top-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-t-[8px] border-t-rec" />
            </div>

            {template.baseAssetSrc && isTextMode ? (
              /* Mode "Teks" aktif — hide semua track lain (Background, slot
                 foto/video/audio, decor layer), cuma tampilin track teks
                 sejumlah textLayers template ini. Klik salah satu track buat
                 munculin input edit teks khusus layer itu di toolbar bawah. */
              template.textLayers?.length ? (
                <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-1 pb-1">
                  {template.textLayers.map((layer) => {
                    const isSelected = selectedTextLayerId === layer.id;
                    const value = textValues[layer.id] || layer.defaultText;
                    return (
                      <div
                        key={layer.id}
                        className="relative h-9 rounded-md border border-mute/10 bg-black/20"
                      >
                        <div
                          onClick={() => {
                            setSelectedSlotId(null);
                            setSelectedLayerId(null);
                            setSelectedTextLayerId(layer.id);
                          }}
                          className={`absolute inset-y-0.5 left-0.5 cursor-pointer overflow-hidden rounded border transition ${
                            isSelected
                              ? "border-paper ring-2 ring-paper bg-amber-400/20"
                              : "border-amber-400/40 bg-amber-400/15"
                          }`}
                          style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
                          title={layer.label}
                        >
                          <div className="flex h-full items-center gap-1 px-1.5">
                            <Type size={11} className="shrink-0 text-amber-200" />
                            <span className="truncate text-[9px] font-medium text-paper">
                              {layer.label}
                            </span>
                            <span className="ml-auto max-w-[45%] shrink-0 truncate text-[8px] text-amber-200/80">
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
              <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-1 pb-1">
                {/* Pilihan tampilan progress lagu dipindah ke toolbar
                    bawah (muncul pas tab "Audio" aktif) — lihat
                    activeTool === "audio" di bagian toolbar. */}
                {/* Track "Background" — otomatis muncul begitu template
                    punya foto sampul (dari sample bawaan ATAU upload user),
                    karena foto sampul sekarang OTOMATIS jadi background
                    juga (lihat handleFileChange), gak perlu transfer manual
                    lagi. Klik buat munculin slider opacity & blur di
                    toolbar bawah. */}
                {customBackground && (
                  <div className="relative h-9 rounded-md border border-mute/10 bg-black/20">
                    <div
                      onClick={() => {
                        setSelectedSlotId(null);
                        setSelectedLayerId(BACKGROUND_LAYER_ID);
                      }}
                      className={`absolute inset-y-0.5 left-0.5 cursor-pointer overflow-hidden rounded border transition ${
                        isBackgroundLayerSelected
                          ? "border-paper ring-2 ring-paper bg-sky-400/20"
                          : "border-sky-400/40 bg-sky-400/15"
                      }`}
                      style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
                      title="Background"
                    >
                      <div className="flex h-full items-center gap-1 px-1.5">
                        <Layers size={11} className="shrink-0 text-sky-200" />
                        <span className="truncate text-[9px] font-medium text-paper">
                          Background
                        </span>
                        <span className="ml-auto shrink-0 text-[8px] text-sky-200/80">
                          {Math.round(backgroundOpacity)}%
                          {backgroundBlur > 0 ? ` · Blur ${Math.round(backgroundBlur)}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {visibleSlots.map((slot) => {
                  const isAudio = slot.type === "audio";
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
                        className={`relative h-9 rounded-md border bg-black/20 transition ${
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

                          let clipPeaks: number[];
                          if (audioInfo?.peaks?.length) {
                            const total = audioInfo.peaks.length;
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
                            clipPeaks = audioInfo.peaks.slice(startIdx, endIdx);
                          } else {
                            const barCount = Math.max(
                              4,
                              Math.round(
                                (clipDuration / Math.max(sourceDuration, 0.001)) *
                                  WAVEFORM_BAR_COUNT,
                              ),
                            );
                            clipPeaks = FALLBACK_PEAKS.slice(0, barCount);
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
                                  asli potongan file audio klip ini. */}
                              <div className="pointer-events-none absolute inset-0 flex items-center gap-[2px] px-1.5">
                                {clipPeaks.map((p, i) => (
                                  <span
                                    key={i}
                                    className="w-[2px] shrink-0 rounded-full bg-emerald-300/80"
                                    style={{
                                      height: `${Math.max(8, Math.min(100, p * 100))}%`,
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
                  const clipLeft = start * effectivePxPerSec + 2;
                  const clipWidth = Math.max(
                    28,
                    (end - start) * effectivePxPerSec - 4,
                  );
                  return (
                    <div
                      key={slot.id}
                      className="relative h-9 rounded-md border border-mute/10 bg-black/20"
                    >
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
                        } ${isSelected && filled ? "bg-sky-400/20" : ""}`}
                        style={{ left: clipLeft, width: clipWidth }}
                        title={slot.label}
                      >
                        <div className="flex h-full items-center gap-1 px-1.5">
                          <Icon
                            size={11}
                            className={`shrink-0 ${filled ? "text-sky-200" : "text-mute"}`}
                          />
                          <span
                            className={`truncate text-[9px] font-medium ${
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
                    buka file picker. */}
                {adjustableLayers.map((layer) => {
                  const isSelected = selectedLayerId === layer.id;
                  const op = layerOpacity[layer.id] ?? layer.opacity ?? 100;
                  return (
                    <div
                      key={layer.id}
                      className="relative h-9 rounded-md border border-mute/10 bg-black/20"
                    >
                      <div
                        onClick={() => {
                          setSelectedSlotId(null);
                          setSelectedLayerId(layer.id);
                        }}
                        className={`absolute inset-y-0.5 left-0.5 cursor-pointer overflow-hidden rounded border transition ${
                          isSelected
                            ? "border-paper ring-2 ring-paper bg-violet-400/20"
                            : "border-violet-400/40 bg-violet-400/15"
                        }`}
                        style={{ width: Math.max(28, DURATION * effectivePxPerSec - 4) }}
                        title={layer.label}
                      >
                        <div className="flex h-full items-center gap-1 px-1.5">
                          <SlidersHorizontal size={11} className="shrink-0 text-violet-200" />
                          <span className="truncate text-[9px] font-medium text-paper">
                            {layer.label}
                          </span>
                          <span className="ml-auto shrink-0 text-[8px] text-violet-200/80">
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

      {/* Toolbar bawah — kontekstual: default cuma Audio & Teks, tapi
          begitu ada slot yang diketuk/terseleksi, berubah jadi satu
          tombol besar "Ganti" buat slot itu. */}
      {isBackgroundLayerSelected ? (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border border-mute/10 bg-panel shadow-[0_-8px_30px_rgba(0,0,0,0.35)]"
          style={{ height: sheetHeight }}
        >
          <SheetDragHandle />
          <div className="flex shrink-0 items-center gap-3 px-3 pb-2.5">
            <button
              onClick={() => setSelectedLayerId(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
              title="Selesai"
            >
              <X size={18} />
            </button>
            <span className="flex-1 text-xs font-semibold text-paper">
              Pengaturan Background
            </span>
            <button
              onClick={handleResetBackground}
              className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-mute transition hover:text-paper"
              title="Kembalikan background asli"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-3 pb-4">
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
        </div>
      ) : selectedLayer?.liquidGlass ? (
        (() => {
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
          return (
            <div
              className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border border-mute/10 bg-panel shadow-[0_-8px_30px_rgba(0,0,0,0.35)]"
              style={{ height: sheetHeight }}
            >
              <SheetDragHandle />
              <div className="flex shrink-0 items-center gap-3 px-3 pb-2.5">
                <button
                  onClick={() => setSelectedLayerId(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
                  title="Selesai"
                >
                  <X size={18} />
                </button>
                <span className="flex-1 truncate text-xs font-semibold text-paper">
                  Pengaturan Kaca — {layer.label}
                </span>
                <button
                  onClick={() =>
                    setGlassSettings((prev) => ({ ...prev, [layer.id]: {} }))
                  }
                  className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-mute transition hover:text-paper"
                  title="Kembalikan default"
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
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
            </div>
          );
        })()
      ) : selectedLayer ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-mute/10 bg-panel px-3 py-2.5">
          <button
            onClick={() => setSelectedLayerId(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Selesai"
          >
            <X size={18} />
          </button>
          <div className="flex flex-1 items-center gap-3">
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
        </div>
      ) : selectedSlot ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-mute/10 bg-panel px-3 py-2">
          <button
            onClick={() => {
              setSelectedSlotId(null);
              setSelectedAudioClipId(null);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Batal"
          >
            <X size={18} />
          </button>
          <button
            onClick={() => openPicker(selectedSlot)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-paper/40 px-3 py-2.5 text-xs font-semibold text-paper transition active:scale-95"
          >
            <RefreshCcw size={15} />
            Ganti {SLOT_SHORT_LABEL[selectedSlot.type]}
          </button>
        </div>
      ) : selectedTextLayer ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-mute/10 bg-panel px-3 py-2.5">
          <button
            onClick={() => setSelectedTextLayerId(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Selesai"
          >
            <X size={18} />
          </button>
          <label className="flex flex-1 flex-col gap-1">
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
          </label>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col border-t border-mute/10 bg-panel">
          {/* Muncul cuma pas tombol "Audio" lagi aktif — tombol kecil buat
              beneran buka file picker. Sengaja dipisah dari tombol "Audio"
              di bawah biar klik "Audio" nggak langsung lompat ke pemilihan
              file, tapi mampir dulu ke sini. */}
          {activeTool === "audio" && (
            <div className="flex items-center justify-center border-b border-mute/10 px-3 py-2">
              <button
                onClick={() => audioSlotDef && openPicker(audioSlotDef)}
                className="flex items-center gap-1.5 rounded-full bg-paper px-3.5 py-1.5 text-[11px] font-semibold text-graphite transition active:scale-95"
              >
                <Plus size={13} />
                Tambah Audio
              </button>
            </div>
          )}
          {/* Tab "Gaya" — preview visual tiap opsi progress bar SEBELUM
              dipilih (bukan cuma teks label doang), biar user kebayang
              hasilnya bakal kayak gimana. Preview-nya CSS ringan aja
              (bukan render canvas asli) biar responsif & gak berat. */}
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
                {/* Badge "Premium" — muncul selama config/waveformEnabled
                    di Firebase belum di-set true. Gaya ini tetap BOLEH
                    dipilih di sini (cuma preview), tapi export-nya nanti
                    diblokir di handleExport kalau masih terkunci. Ilang
                    otomatis (real-time) begitu diaktifkan lewat dashboard
                    /sawadikap. */}
                {!waveformEnabled && (
                  <span className="absolute -top-2 right-1 flex items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-bold text-graphite shadow-sm">
                    <Lock size={8} strokeWidth={3} />
                    Premium haha🗿
                  </span>
                )}
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
          <div
            className="grid px-1 py-1.5"
            style={{ gridTemplateColumns: `repeat(${visibleTools.length}, minmax(0, 1fr))` }}
          >
            {visibleTools.map(({ id, label, icon: Icon }) => {
              const active = activeTool === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setActiveTool(id);
                    // Tombol "Media" langsung menuju slot media (foto/video)
                    // pertama di template — sama efeknya kayak nge-tap slot
                    // itu langsung di timeline (munculin toolbar "Ganti").
                    if (id === "media") {
                      setIsTextMode(false);
                      setSelectedTextLayerId(null);
                      setSelectedLayerId(null);
                      setSelectedAudioClipId(null);
                      if (mediaSlotDef) setSelectedSlotId(mediaSlotDef.id);
                    }
                    // Tombol "Audio" cuma nampilin tombol kecil "Tambah
                    // Audio" di atas (lihat blok di atas) — file picker
                    // baru kebuka begitu tombol kecil itu yang diklik.
                    if (id === "audio") {
                      setIsTextMode(false);
                      setSelectedTextLayerId(null);
                      setSelectedSlotId(null);
                      setSelectedLayerId(null);
                      setSelectedAudioClipId(null);
                    }
                    // Tombol "Teks" ganti timeline jadi nampilin track teks
                    // aja (hide track lain) — bukan file picker.
                    if (id === "text") {
                      setSelectedSlotId(null);
                      setSelectedLayerId(null);
                      setSelectedAudioClipId(null);
                      setIsTextMode(true);
                    }
                    // Tombol "Gaya" cuma nampilin preview-picker progress
                    // bar (lihat blok di atas) — bukan file picker ataupun
                    // mode teks, jadi clear semua seleksi biar timeline
                    // balik netral kayak awal.
                    if (id === "progress") {
                      setIsTextMode(false);
                      setSelectedTextLayerId(null);
                      setSelectedSlotId(null);
                      setSelectedLayerId(null);
                      setSelectedAudioClipId(null);
                    }
                  }}
                  className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 transition ${
                    active ? "text-rec" : "text-mute hover:text-paper"
                  }`}
                >
                  <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
                  <span className="text-[9.5px] font-medium leading-none">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}


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

      {/* Modal progress / hasil export */}
      {(isExporting || exportResultUrl || exportError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-xs rounded-2xl bg-panel p-5 text-center shadow-xl">
            {isExporting && (
              <>
                {exportSnapshot && (
                  <div className="relative mx-auto mb-3 aspect-[9/16] w-full overflow-hidden rounded-lg">
                    <img
                      src={exportSnapshot}
                      alt=""
                      className="h-full w-full object-cover transition-opacity duration-300 ease-linear"
                      style={{ opacity: 0.25 + 0.75 * ((exportProgress?.percent ?? 0) / 100) }}
                    />
                    <div className="animate-export-scan pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-white/25 to-transparent" />
                  </div>
                )}
                <p className="text-sm font-medium text-paper">
                  eksport video eluuu...
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-graphite">
                  <div
                    className="h-full rounded-full bg-rec transition-all"
                    style={{ width: `${exportProgress?.percent ?? 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-mute">
                  {exportProgress?.percent ?? 0}%
                </p>
                <button
                  onClick={handleCancelExport}
                  className="mt-4 rounded-full bg-graphite px-4 py-2 text-xs font-medium text-paper"
                >
                  Batalkan
                </button>
              </>
            )}

            {!isExporting && exportError && (
              <>
                <p className="text-sm font-medium text-rec">Export gagal</p>
                <p className="mt-1 text-xs text-mute">{exportError}</p>
                <button
                  onClick={() => setExportError(null)}
                  className="mt-4 rounded-full bg-graphite px-4 py-2 text-xs font-medium text-paper"
                >
                  Tutup
                </button>
              </>
            )}

            {!isExporting && exportResultUrl && (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-paper">Video siap 🎉</p>
                  {exportEngineUsed && (
                    <span
                      className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                      title="Dirender pakai WebCodecs API (VideoEncoder/AudioEncoder) — hardware-accelerated"
                    >
                      ⚡ WebCodecs
                    </span>
                  )}
                </div>
                <video
                  src={exportResultUrl}
                  controls
                  className="mt-3 aspect-[9/16] w-full rounded-lg bg-black"
                />
                <div className="mt-3 flex gap-2">
                  <a
                    href={exportResultUrl}
                    download={`${template.id}.mp4`}
                    className="flex-1 rounded-full bg-rec px-3 py-2 text-xs font-semibold text-paper"
                  >
                    Unduh
                  </a>
                  <button
                    onClick={() => setExportResultUrl(null)}
                    className="flex-1 rounded-full bg-graphite px-3 py-2 text-xs font-medium text-paper"
                  >
                    Tutup
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
