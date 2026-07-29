import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import type { Template, TemplateSlot, SlotType } from "../types";
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
  ImageCache,
} from "../lib/render";
import type { SlotMediaEntry } from "../lib/render";
import { exportTemplateVideoAuto, type ExportProgress, type ExportEngine } from "../lib/engine";
import { analyzeAudio, type AudioAnalysis } from "../lib/waveform";

type Tool = {
  id: string;
  label: string;
  icon: LucideIcon;
};

const TOOLS: Tool[] = [
  { id: "audio", label: "Audio", icon: Music },
  { id: "text", label: "Teks", icon: Type },
];

const SLOT_ICON: Record<SlotType, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
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

function generateTimeMarks(duration: number): number[] {
  const step = duration <= 20 ? 5 : 10;
  const marks: number[] = [];
  for (let t = 0; t <= duration; t += step) marks.push(t);
  if (marks[marks.length - 1] !== duration) marks.push(duration);
  return marks;
}

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
  // Isi tiap textLayer yang bisa di-custom (judul, artist, nama device),
  // mulai dari defaultText di data template, diubah user lewat panel
  // "Teks" di toolbar bawah. Label durasi TIDAK ada di sini — itu selalu
  // dihitung otomatis (lihat drawDurationLayer), bukan dari state ini.
  const [textValues, setTextValues] = useState(() => initialTextValues(template));
  // Panel "Teks" lagi kebuka/nggak — beda dari selectedSlotId/selectedLayerId
  // karena teks nggak butuh diklik satu-satu di canvas/timeline, cukup satu
  // panel isi semua field teks yang tersedia untuk template ini.
  const [textPanelOpen, setTextPanelOpen] = useState(false);

  // ---- Mesin render: state media tiap slot (diisi contoh dari internet
  // dulu via sampleSrc, user bisa ganti kapan saja) ----
  const [slotMedia, setSlotMedia] = useState(() => initialSlotMedia(template));
  // Kalau user pilih "Jadi Background" di salah satu sampul, isi slot itu
  // (foto) dipindah ke sini & dipakai gantiin baseAssetSrc template pas
  // render preview maupun export. null = masih pakai background asli.
  const [customBackground, setCustomBackground] = useState<SlotMediaEntry | null>(
    null,
  );
  // Opacity (0-100) & blur (0-MAX_BACKGROUND_BLUR px) khusus buat
  // background hasil transfer sampul — diatur lewat track "Background"
  // di timeline, cuma relevan selama customBackground aktif.
  const [backgroundOpacity, setBackgroundOpacity] = useState(100);
  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const imageCacheRef = useRef(new ImageCache());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<string | null>(null);

  // ---- Export state ----
  const [isExporting, setIsExporting] = useState(false);
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
  // ---- Lebar area timeline yang kelihatan, dipakai biar track selalu
  // mepet ke kanan layar baik durasinya panjang maupun pendek ----
  const [viewportWidth, setViewportWidth] = useState(340);

  const audioSlotDef = template.slots.find((s) => s.type === "audio");
  const audioMedia = audioSlotDef ? slotMedia[audioSlotDef.id] : undefined;

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Baca durasi asli + waveform tiap kali audio diganti user
  useEffect(() => {
    let cancelled = false;
    setAudioInfo(null);
    if (!audioMedia) return;
    const source = audioMedia.file ?? audioMedia.url;
    analyzeAudio(source, WAVEFORM_BAR_COUNT)
      .then((info) => {
        if (!cancelled) setAudioInfo(info);
      })
      .catch(() => {
        if (!cancelled) setAudioInfo(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMedia?.url]);

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
    (l) => l.order === "front",
  );
  const adjustableLayers = (template.decorLayers ?? []).filter(
    (l) => l.adjustable,
  );
  const selectedLayer = adjustableLayers.find((l) => l.id === selectedLayerId);
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

  // Sinkronin audio latar sama playhead
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || !audioMedia) return;
    if (Math.abs(el.currentTime - currentSec) > 0.35) {
      el.currentTime = currentSec;
    }
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, currentSec, audioMedia]);

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
      const img = cache.get(layer.assetSrc, () => setRenderTick((t) => t + 1));
      if (!img) continue;
      const op = (layerOpacity[layer.id] ?? layer.opacity ?? 100) / 100;
      if (op <= 0) continue;
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
      drawProgressFill(
        ctx,
        canvasW,
        canvasH,
        template.progressLayer,
        currentSec,
        DURATION,
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
    backgroundSrc,
    customBackground,
    backgroundOpacity,
    backgroundBlur,
    textValues,
    DURATION,
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

  // Ambil media yang lagi ngisi sampul (slot) terpilih, lalu jadiin
  // background penuh canvas (gantiin baseAssetSrc template). Slot-nya
  // sendiri tetap terisi seperti semula — cuma background-nya yang ikut
  // berubah nyontek isi sampul itu.
  function handleTransferToBackground(slot: TemplateSlot) {
    const media = slotMedia[slot.id];
    if (!media) return;
    setCustomBackground(media);
    setBackgroundOpacity(100);
    setBackgroundBlur(0);
    setSelectedSlotId(null);
  }

  function handleResetBackground() {
    setCustomBackground(null);
    setBackgroundOpacity(100);
    setBackgroundBlur(0);
    setSelectedLayerId((id) => (id === BACKGROUND_LAYER_ID ? null : id));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const slotId = pendingSlotRef.current;
    e.target.value = "";
    if (!file || !slotId) return;
    const url = URL.createObjectURL(file);
    setSlotMedia((prev) => ({ ...prev, [slotId]: { kind: "file", url, file } }));
    setSelectedSlotId(null);
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
    setIsExporting(true);
    setExportError(null);
    setExportResultUrl(null);
    setExportEngineUsed(null);
    try {
      const { blob, engine } = await exportTemplateVideoAuto(
        template,
        slotMedia,
        layerOpacity,
        (p) => setExportProgress(p),
        customBackground,
        backgroundOpacity,
        backgroundBlur,
        textValues,
      );
      setExportResultUrl(URL.createObjectURL(blob));
      setExportEngineUsed(engine);
    } catch (err) {
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
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-graphite font-sans">
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
          <button className="rounded-full bg-rec px-4 py-2 text-sm font-semibold text-paper transition hover:bg-rec/90 active:scale-95">
            Selesai
          </button>
        </div>
      </div>

      {/* Canvas / preview area — takes remaining space, keeps 9:16 ratio */}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-graphite p-3">
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
              }}
              className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-paper backdrop-blur-sm transition active:scale-95"
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
        <button
          className="justify-self-start flex h-8 w-8 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
          title="Potong"
        >
          <Scissors size={17} />
        </button>

        <button
          onClick={() => setIsPlaying((p) => !p)}
          className="justify-self-center flex h-10 w-10 items-center justify-center rounded-full bg-paper text-graphite transition hover:bg-paper/90 active:scale-95"
          title={isPlaying ? "Jeda" : "Putar"}
        >
          {isPlaying ? (
            <Pause size={16} fill="#15171C" />
          ) : (
            <Play size={16} fill="#15171C" className="ml-0.5" />
          )}
        </button>

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

            {template.baseAssetSrc ? (
              /* Layer per elemen — tiap slot (foto/video/audio) punya
                 baris/track sendiri, kayak editor video beneran. Klik
                 buat SELECT (bukan langsung buka file picker) — ganti
                 media dilakukan lewat tombol "Ganti" di toolbar bawah. */
              <div style={{ width: TRACK_WIDTH }} className="flex flex-col gap-1 pb-1">
                {/* Track "Background" — cuma muncul kalau user udah transfer
                    sampul jadi background. Klik buat munculin slider
                    opacity & blur di toolbar bawah. */}
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
                  const start = slot.startSec ?? 0;
                  const end = slot.endSec ?? DURATION;
                  const filled = Boolean(slotMedia[slot.id]);
                  const isAudio = slot.type === "audio";
                  const isSelected = selectedSlotId === slot.id;
                  const Icon = SLOT_ICON[slot.type];
                  const clipLeft = start * effectivePxPerSec + 2;
                  const clipWidth = Math.max(
                    28,
                    (end - start) * effectivePxPerSec - 4,
                  );
                  const peaks =
                    isAudio && filled
                      ? audioInfo?.peaks ?? FALLBACK_PEAKS
                      : null;
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
                              ? isAudio
                                ? "border-emerald-500/40 bg-emerald-500/15"
                                : "border-sky-400/40 bg-sky-400/20"
                              : "border-dashed border-mute/40 bg-transparent"
                        } ${isSelected && filled ? (isAudio ? "bg-emerald-500/15" : "bg-sky-400/20") : ""}`}
                        style={{ left: clipLeft, width: clipWidth }}
                        title={slot.label}
                      >
                        {peaks ? (
                          <>
                            {/* Waveform beneran, ngikutin amplitude/frekuensi
                                asli file audio-nya (bukan dekorasi statis) */}
                            <div className="absolute inset-0 flex items-center gap-[2px] px-1.5">
                              {peaks.map((p, i) => (
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
                              <Icon size={9} className="shrink-0 text-emerald-300" />
                              <span className="max-w-[90px] truncate text-[8px] font-medium text-paper">
                                {slot.label}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full items-center gap-1 px-1.5">
                            <Icon
                              size={11}
                              className={`shrink-0 ${
                                filled
                                  ? isAudio
                                    ? "text-emerald-300"
                                    : "text-sky-200"
                                  : "text-mute"
                              }`}
                            />
                            <span
                              className={`truncate text-[9px] font-medium ${
                                filled ? "text-paper" : "text-mute"
                              }`}
                            >
                              {slot.label}
                            </span>
                          </div>
                        )}
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
        <div className="flex shrink-0 flex-col gap-2 border-t border-mute/10 bg-panel px-3 py-2.5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedLayerId(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
              title="Selesai"
            >
              <X size={18} />
            </button>
            <span className="w-11 shrink-0 text-xs font-medium text-paper">
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
            <div className="w-9 shrink-0" />
            <span className="w-11 shrink-0 text-xs font-medium text-paper">
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
          <button
            onClick={handleResetBackground}
            className="ml-12 flex w-fit items-center gap-1.5 text-[11px] font-medium text-mute transition hover:text-paper"
          >
            <RotateCcw size={12} />
            Kembalikan background asli
          </button>
        </div>
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
            onClick={() => setSelectedSlotId(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Batal"
          >
            <X size={18} />
          </button>
          <button
            onClick={() => openPicker(selectedSlot)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-paper px-3 py-2.5 text-xs font-semibold text-graphite transition active:scale-95"
          >
            <RefreshCcw size={15} />
            Ganti {selectedSlot.label}
          </button>
          {selectedSlot.type === "image" && (
            <button
              onClick={() => handleTransferToBackground(selectedSlot)}
              disabled={!slotMedia[selectedSlot.id]}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-paper/40 px-3 py-2.5 text-xs font-semibold text-paper transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              title="Transfer sampul jadi background"
            >
              <Layers size={15} />
              Jadi Background
            </button>
          )}
        </div>
      ) : textPanelOpen ? (
        <div className="flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto border-t border-mute/10 bg-panel px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-paper">Teks</span>
            <button
              onClick={() => setTextPanelOpen(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
              title="Selesai"
            >
              <X size={16} />
            </button>
          </div>
          {template.textLayers?.length ? (
            template.textLayers.map((layer) => (
              <label key={layer.id} className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-mute">
                  {layer.label}
                </span>
                <input
                  type="text"
                  value={textValues[layer.id] ?? ""}
                  maxLength={layer.maxLength}
                  onChange={(e) =>
                    setTextValues((prev) => ({
                      ...prev,
                      [layer.id]: e.target.value,
                    }))
                  }
                  placeholder={layer.defaultText}
                  className="w-full rounded-lg border border-mute/20 bg-graphite px-3 py-2 text-sm text-paper outline-none transition focus:border-paper/50"
                />
              </label>
            ))
          ) : (
            <span className="py-2 text-center text-xs text-mute">
              Template ini belum punya teks yang bisa di-custom.
            </span>
          )}
        </div>
      ) : (
        <div className="grid shrink-0 grid-cols-2 border-t border-mute/10 bg-panel px-1 py-1.5">
          {TOOLS.map(({ id, label, icon: Icon }) => {
            const active = activeTool === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setActiveTool(id);
                  // Tombol "Audio" langsung buka file picker audio, hasil
                  // upload-nya langsung nempel jadi layer audio baru di
                  // timeline (nggak muncul sebelum ini diklik).
                  if (id === "audio" && audioSlotDef) {
                    openPicker(audioSlotDef);
                  }
                  // Tombol "Teks" buka panel edit teks (judul/artist/nama
                  // device) — khusus layer teks aja, bukan file picker.
                  if (id === "text") {
                    setTextPanelOpen(true);
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
      )}


      {/* Modal progress / hasil export */}
      {(isExporting || exportResultUrl || exportError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-xs rounded-2xl bg-panel p-5 text-center shadow-xl">
            {isExporting && (
              <>
                <Loader2 className="mx-auto mb-3 animate-spin text-paper" size={28} />
                <p className="text-sm font-medium text-paper">
                  {exportProgress?.label ?? "Memproses…"}
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
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        exportEngineUsed === "webcodecs"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400"
                      }`}
                      title={
                        exportEngineUsed === "webcodecs"
                          ? "Dirender pakai WebCodecs API (VideoEncoder/AudioEncoder) — hardware-accelerated"
                          : "Dirender pakai FFmpeg.wasm (fallback) — WebCodecs tidak didukung/gagal di browser ini"
                      }
                    >
                      {exportEngineUsed === "webcodecs" ? "⚡ WebCodecs" : "🐢 FFmpeg (fallback)"}
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
