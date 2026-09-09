import type { LucideIcon } from "lucide-react";
import {
  Music,
  Music2,
  Type,
  Plus,
  X,
  Layers,
  SlidersHorizontal,
  Combine,
  MoreVertical,
  Link2,
  Unlink2,
  ListChecks,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TrackLabel, ClipCornerLabel } from "./TimelineParts";
import type {
  TemplateSlot,
  TemplateTextLayer,
  TemplateLyricsTextLayer,
  LyricsGroup,
  SlotType,
} from "../../types";
import type { SlotMediaState, TextValueState } from "../../lib/render";
import type { AudioAnalysis } from "../../lib/waveform";
import type { AudioClip } from "../Editor";

export type { AudioClip };
export type AudioInfo = AudioAnalysis | null;

// ---- Props Timeline ----
// Catatan Tahap 1: komponen ini "cuma" mindahin JSX & fungsi render track
// dari Editor.tsx apa adanya (logic-nya TIDAK diubah) — tujuannya supaya
// Editor.tsx nggak lagi 1 file raksasa & langkah selanjutnya (Tahap 2:
// drag pakai ref bukan setState, Tahap 3: React.memo per klip) bisa
// dikerjain di file/komponen yang jelas batasnya. Props di bawah sengaja
// masih banyak (mirror closure Editor.tsx) — ini akan dirapikan lagi di
// Tahap 3 (state "hot" dipisah lewat context supaya nggak nge-trigger
// render Editor induk).
export interface TimelineProps {
  // --- Layout & visibility ---
  isFullscreen: boolean;
  timelineHeight: number;
  handleTimelineDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleTimelineDragMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleTimelineDragEnd: (e: React.PointerEvent<HTMLDivElement>) => void;

  // --- Durasi & metrik timeline ---
  DURATION: number;
  TIME_MARKS: number[];
  TRACK_WIDTH: number;
  TIMELINE_CLIP_OFFSET_PX: number;
  effectivePxPerSec: number;
  viewportWidth: number;
  timelineScrollRef: React.RefObject<HTMLDivElement>;

  // --- Zoom ---
  timelineZoom: number;
  MIN_TIMELINE_ZOOM: number;
  MAX_TIMELINE_ZOOM: number;
  TIMELINE_ZOOM_STEP: number;
  zoomTimelineBy: (factor: number) => void;
  resetTimelineZoom: () => void;
  handleTimelinePinchPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleTimelinePinchPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleTimelinePinchPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;

  // --- Playhead ---
  handlePlayheadPointerDown: (e: React.PointerEvent) => void;

  // --- Mode seleksi track (fitur "Jadikan Grup") ---
  trackSelectMode: boolean;
  selectedTrackBaseIds: Set<string>;
  cancelTrackSelectMode: () => void;
  trackGroupMenuOpen: boolean;
  setTrackGroupMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  canMakeGroupFromSelection: boolean;
  handleMakeGroupFromSelection: () => void;
  matchingSelectedGroup: LyricsGroup | undefined;
  handleUngroupSelection: () => void;
  setTrackSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  toggleRowTrackSelect: (rowBaseIds: string[]) => void;
  groupOfBaseId: (baseId: string) => LyricsGroup | undefined;

  // --- Mode Teks / lirik ---
  isTextMode: boolean;
  lyricsRowDragHint: string | null;
  allLyricsLayers: TemplateLyricsTextLayer[];
  allTextLayers: TemplateTextLayer[];
  lyricsTextEntries: TemplateTextLayer[];
  customLyricsLayers: TemplateLyricsTextLayer[];
  autoCompactLyricsRows: () => void;
  showAddTextStyles: boolean;
  setShowAddTextStyles: React.Dispatch<React.SetStateAction<boolean>>;
  addCustomTextLayer: (style: "purple" | "white") => void;
  lyricsBaseIdOf: (id: string) => string | null;
  lyricsRowOf: (baseId: string) => number;
  getEffectiveLyricsLayer: (baseId: string) => TemplateLyricsTextLayer | null;
  handleLyricsRowDragStart: (e: React.PointerEvent, sourceRow: number) => void;
  handleLyricsClipDragStart: (
    e: React.PointerEvent,
    baseId: string,
    eff: TemplateLyricsTextLayer,
    activeLayerId: string,
  ) => void;
  handleLyricsClipStretchStart: (
    e: React.PointerEvent,
    baseId: string,
    eff: TemplateLyricsTextLayer,
  ) => void;
  selectedTextLayerId: string | null;
  setSelectedTextLayerId: React.Dispatch<React.SetStateAction<string | null>>;
  textValues: TextValueState;
  setTextToolbarMode: React.Dispatch<React.SetStateAction<"quick" | "edit">>;
  dismissAirplayHint: () => void;

  // --- Slot media (foto/video/audio) ---
  hasSlotTracks: boolean;
  activeTool: string;
  visibleSlots: TemplateSlot[];
  customBackground: { url: string } | null | { url: string; file?: File };
  backgroundOpacity: number;
  backgroundBlur: number;
  isBackgroundLayerSelected: boolean;
  BACKGROUND_LAYER_ID: string;
  hiddenElements: Set<string>;
  setHiddenElements: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleElementHidden: (id: string, e?: React.MouseEvent) => void;
  setSelectedSlotId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedLayerId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedSlotId: string | null;
  selectedLayerId: string | null;
  slotMedia: SlotMediaState;
  SLOT_ICON: Record<SlotType, LucideIcon>;

  // --- Audio ---
  audioInfo: AudioInfo;
  audioClips: AudioClip[];
  selectedAudioClipId: string | null;
  setSelectedAudioClipId: React.Dispatch<React.SetStateAction<string | null>>;
  handleAudioClipDragStart: (e: React.PointerEvent, clip: AudioClip) => void;
  handleAudioClipTrimStart: (
    e: React.PointerEvent,
    clip: AudioClip,
    edge: "left" | "right",
  ) => void;
  clampNum: (v: number, min: number, max: number) => number;
  downsamplePeaks: (source: number[], targetCount: number) => number[];
  FALLBACK_PEAKS: number[];
  audioSlotDef: TemplateSlot | undefined;
  audioMedia: unknown;
  openPicker: (slot: TemplateSlot) => void;

  // --- Decor layer (mis. Card Player) ---
  adjustableLayers: Array<{
    id: string;
    label: string;
    assetSrc?: string;
    opacity?: number;
  }>;
  layerOpacity: Record<string, number>;

  // --- Media slot "+" button ---
  mediaSlotDef: TemplateSlot | undefined;
}

export default function Timeline(props: TimelineProps) {
  const {
    isFullscreen,
    timelineHeight,
    handleTimelineDragStart,
    handleTimelineDragMove,
    handleTimelineDragEnd,
    DURATION,
    TIME_MARKS,
    TRACK_WIDTH,
    TIMELINE_CLIP_OFFSET_PX,
    effectivePxPerSec,
    viewportWidth,
    timelineScrollRef,
    timelineZoom,
    MIN_TIMELINE_ZOOM,
    MAX_TIMELINE_ZOOM,
    TIMELINE_ZOOM_STEP,
    zoomTimelineBy,
    resetTimelineZoom,
    handleTimelinePinchPointerDown,
    handleTimelinePinchPointerMove,
    handleTimelinePinchPointerUp,
    handlePlayheadPointerDown,
    trackSelectMode,
    selectedTrackBaseIds,
    cancelTrackSelectMode,
    trackGroupMenuOpen,
    setTrackGroupMenuOpen,
    canMakeGroupFromSelection,
    handleMakeGroupFromSelection,
    matchingSelectedGroup,
    handleUngroupSelection,
    setTrackSelectMode,
    toggleRowTrackSelect,
    groupOfBaseId,
    isTextMode,
    lyricsRowDragHint,
    allLyricsLayers,
    allTextLayers,
    lyricsTextEntries,
    customLyricsLayers,
    autoCompactLyricsRows,
    showAddTextStyles,
    setShowAddTextStyles,
    addCustomTextLayer,
    lyricsBaseIdOf,
    lyricsRowOf,
    getEffectiveLyricsLayer,
    handleLyricsRowDragStart,
    handleLyricsClipDragStart,
    handleLyricsClipStretchStart,
    selectedTextLayerId,
    setSelectedTextLayerId,
    textValues,
    setTextToolbarMode,
    dismissAirplayHint,
    hasSlotTracks,
    activeTool,
    visibleSlots,
    customBackground,
    backgroundOpacity,
    backgroundBlur,
    isBackgroundLayerSelected,
    BACKGROUND_LAYER_ID,
    hiddenElements,
    setHiddenElements,
    toggleElementHidden,
    setSelectedSlotId,
    setSelectedLayerId,
    selectedSlotId,
    selectedLayerId,
    slotMedia,
    SLOT_ICON,
    audioInfo,
    audioClips,
    selectedAudioClipId,
    setSelectedAudioClipId,
    handleAudioClipDragStart,
    handleAudioClipTrimStart,
    clampNum,
    downsamplePeaks,
    FALLBACK_PEAKS,
    audioSlotDef,
    audioMedia,
    openPicker,
    adjustableLayers,
    layerOpacity,
    mediaSlotDef,
  } = props;

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
  // Text layer BIASA (judul/artist/dst) — selalu 1 blok statis sepanjang
  // DURATION, gak punya waktu/row sendiri, gak bisa di-drag posisinya.
  function renderTextTrack(layer: TemplateTextLayer) {
    const isSelected = selectedTextLayerId === layer.id;
    const value = textValues[layer.id] || layer.defaultText;
    const isTextHidden = hiddenElements.has(layer.id);
    const clipLeft = TIMELINE_CLIP_OFFSET_PX;
    const clipWidth = Math.max(28, DURATION * effectivePxPerSec - 4);
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

  // ---- Klip lirik (baris atas/bawah 1 klip TemplateLyricsTextLayer) —
  // BEDA dari renderTextTrack di atas: cuma badan klip-nya doang (TANPA
  // TrackLabel/wrapper row), karena sekarang 1 baris track bisa isi
  // BANYAK klip lirik berdampingan (lihat renderLyricsRow di bawah) —
  // dipakai bareng lewat drag-numpang-row (handleLyricsRowDragStart).
  function renderLyricsClipBox(
    layer: TemplateTextLayer,
    timeRange: { start: number; end: number },
    dragCtx: { baseId: string; eff: TemplateLyricsTextLayer },
  ) {
    const isSelected = selectedTextLayerId === layer.id;
    const value = textValues[layer.id] || layer.defaultText;
    const isTextHidden = hiddenElements.has(layer.id);
    const clipLeft = timeRange.start * effectivePxPerSec + TIMELINE_CLIP_OFFSET_PX;
    const clipWidth = Math.max(28, (timeRange.end - timeRange.start) * effectivePxPerSec - 4);
    return (
      <div
        key={layer.id}
        onClick={() => {
          setSelectedSlotId(null);
          setSelectedLayerId(null);
          setSelectedTextLayerId(layer.id);
          setTextToolbarMode("quick");
          setShowAddTextStyles(false);
        }}
        onPointerDown={(e) => handleLyricsClipDragStart(e, dragCtx.baseId, dragCtx.eff, layer.id)}
        className={`absolute inset-y-0.5 overflow-hidden rounded-md border transition ${
          isSelected ? "cursor-grabbing touch-none" : "cursor-grab touch-none active:cursor-grabbing"
        } ${
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

        {/* Handle stretch di tepi KANAN — cuma nongol pas klip ini
            terseleksi (sama kayak pola handle trim audio), biar nggak
            numpuk-numpuk keliatannya pas klip masih kecil/banyak. Geser
            ke kanan = panjangin durasi, geser ke kiri = pendekin —
            startSec/posisi awal klip nggak ikut kegeser (beda sama drag
            badan klip yang mindahin seluruh klip). */}
        {isSelected && (
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              handleLyricsClipStretchStart(e, dragCtx.baseId, dragCtx.eff);
            }}
            className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize touch-none bg-paper/90"
            title="Geser buat panjangin/pendekin durasi teks ini"
          >
            <div className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-graphite" />
          </div>
        )}
      </div>
    );
  }

  // ---- 1 baris track lirik — bisa isi 1 ATAU BEBERAPA klip lirik
  // berdampingan (hasil "numpang row" lewat drag, lihat
  // handleLyricsRowDragStart). Satu TrackLabel doang per baris (grip buat
  // drag row & toggle hidden nyentuh SEMUA klip di baris itu bareng).
  function renderLyricsRow(row: number, entries: TemplateTextLayer[]) {
    if (entries.length === 0) return null;
    const allHidden = entries.every((l) => hiddenElements.has(l.id));
    const label = entries.length > 1 ? `${entries.length} klip` : entries[0].label;
    const rowBaseIds = entries
      .map((l) => lyricsBaseIdOf(l.id))
      .filter((id): id is string => !!id);
    const rowSelected =
      rowBaseIds.length > 0 && rowBaseIds.every((id) => selectedTrackBaseIds.has(id));
    const rowGrouped = rowBaseIds.some((id) => !!groupOfBaseId(id));
    return (
      <div key={`lyrics-row-${row}`} className="relative flex h-8 items-center justify-between">
        <TrackLabel
          hidden={allHidden}
          onToggleHidden={(e) => {
            e.stopPropagation();
            setHiddenElements((prev) => {
              const next = new Set(prev);
              entries.forEach((l) => {
                if (allHidden) next.delete(l.id);
                else next.add(l.id);
              });
              return next;
            });
          }}
          icon={Type}
          label={label}
          hiddenTitle="Tampilkan baris ini"
          shownTitle="Sembunyikan baris ini"
          onReorderPointerDown={(e) => handleLyricsRowDragStart(e, row)}
          selectMode={trackSelectMode}
          selected={rowSelected}
          grouped={rowGrouped}
          onSelectToggle={() => toggleRowTrackSelect(rowBaseIds)}
          onEyeLongPress={
            rowBaseIds.length > 0
              ? () => {
                  setTrackSelectMode(true);
                  toggleRowTrackSelect(rowBaseIds);
                }
              : undefined
          }
        />
        {entries.map((layer) => {
          const baseId = lyricsBaseIdOf(layer.id);
          const eff = baseId ? getEffectiveLyricsLayer(baseId) : null;
          if (!baseId || !eff) return null;
          return renderLyricsClipBox(layer, { start: eff.startSec, end: eff.endSec }, { baseId, eff });
        })}
      </div>
    );
  }

  return (
    <>
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
        {/* Kontrol zoom timeline — cubit 2 jari di area track di bawah
            juga bisa (lihat handleTimelinePinchPointer*), ini cuma versi
            tombol buat yang lebih presisi/gampang di-tap. Ditampilin
            selalu (bukan cuma pas ada klip terpilih) soalnya zoom
            berlaku ke SELURUH timeline, bukan cuma 1 klip. */}
        <div className="flex shrink-0 items-center justify-between gap-1 px-4 pb-1.5">
          {trackSelectMode ? (
            // --- Bar seleksi track (fitur "Jadikan Grup") — gantiin
            // total bar zoom/Rapikan selama mode seleksi aktif, biar
            // fokus user nggak kepecah. Titik tiga di kanan buka menu
            // Jadikan Grup / Batalkan Grup sesuai isi seleksi sekarang. ---
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  onClick={cancelTrackSelectMode}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-editor-muted active:scale-90"
                  title="Batalkan seleksi"
                  aria-label="Batalkan seleksi"
                >
                  <X size={13} />
                </button>
                <span className="flex shrink-0 items-center gap-1 truncate text-[10px] font-medium text-editor-muted">
                  <ListChecks size={12} className="shrink-0 text-editor-accent" />
                  {selectedTrackBaseIds.size} track dipilih
                </span>
              </div>
              <div className="relative flex shrink-0 items-center">
                <button
                  onClick={() => setTrackGroupMenuOpen((v) => !v)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-editor-muted active:scale-90"
                  title="Menu aksi grup"
                  aria-label="Menu aksi grup"
                >
                  <MoreVertical size={14} />
                </button>
                {trackGroupMenuOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-editor-panel py-1 shadow-lg">
                    {canMakeGroupFromSelection && (
                      <button
                        onClick={handleMakeGroupFromSelection}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-ed-text active:bg-white/10"
                      >
                        <Link2 size={12} className="text-editor-accent" />
                        Jadikan Grup
                      </button>
                    )}
                    {matchingSelectedGroup && (
                      <button
                        onClick={handleUngroupSelection}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-ed-text active:bg-white/10"
                      >
                        <Unlink2 size={12} className="text-editor-muted" />
                        Batalkan Grup
                      </button>
                    )}
                    {!canMakeGroupFromSelection && !matchingSelectedGroup && (
                      <div className="px-3 py-2 text-left text-[10px] text-editor-muted">
                        Pilih minimal 2 track dulu
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`truncate text-[10px] font-medium text-editor-muted transition-opacity duration-300 ${
                    lyricsRowDragHint ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {lyricsRowDragHint}
                </span>
                {isTextMode && allLyricsLayers.length > 1 && (
                  <button
                    onClick={autoCompactLyricsRows}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-editor-muted active:scale-95"
                    title="Rapatkan otomatis semua klip lirik yang gak tabrakan waktu jadi baris sesedikit mungkin"
                  >
                    <Combine size={11} />
                    Rapikan
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => zoomTimelineBy(1 / TIMELINE_ZOOM_STEP)}
                disabled={timelineZoom <= MIN_TIMELINE_ZOOM}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-editor-muted disabled:opacity-30"
                title="Zoom out timeline"
              >
                <ZoomOut size={13} />
              </button>
              <button
                onClick={resetTimelineZoom}
                disabled={timelineZoom === 1}
                className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-editor-muted disabled:opacity-30"
                title="Reset zoom ke fit layar"
              >
                {Math.round(timelineZoom * 100)}%
              </button>
              <button
                onClick={() => zoomTimelineBy(TIMELINE_ZOOM_STEP)}
                disabled={timelineZoom >= MAX_TIMELINE_ZOOM}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-editor-muted disabled:opacity-30"
                title="Zoom in timeline (buat trim lebih presisi)"
              >
                <ZoomIn size={13} />
              </button>
              </div>
            </>
          )}
        </div>
        {/* scrollbar-gutter:stable — reservasi ruang scrollbar vertikal
            PERMANEN (baik lagi kepake atau nggak), biar clientWidth
            `timelineScrollRef` di bawah nggak tiba-tiba nyusut/ngelebar
            pas jumlah track berubah-ubah nyampe/nggak nyampe batas
            overflow (mis. abis nambah "Add teks" baru, atau abis nge-
            drag handle timeline jadi lebih pendek). Tanpa ini,
            munculnya scrollbar vertikal makan ~15px lebar horizontal,
            effectivePxPerSec ngikut turun, & seluruh track/klip di
            timeline keliatan "nyusut" tiba-tiba — persis bug yang
            dilaporin. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-gutter:stable]">
        <div
          ref={timelineScrollRef}
          className="overflow-x-auto touch-none"
          onPointerDown={handleTimelinePinchPointerDown}
          onPointerMove={handleTimelinePinchPointerMove}
          onPointerUp={handleTimelinePinchPointerUp}
          onPointerCancel={handleTimelinePinchPointerUp}
          onPointerLeave={handleTimelinePinchPointerUp}
        >
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

            {/* Playhead — SEKARANG DIAM di tengah viewport timeline,
                nggak ikut ke-geser pas timeline di-scroll horizontal
                (yang jalan/scroll adalah ruler & klip-klipnya, lewat
                centerTimelineOnSec di atas). Triknya: bungkus dulu
                dengan frame absolute yang bentang penuh (top-4..bottom-0,
                left-0..right-0, sama persis kayak dulu) biar tinggi
                garisnya nggak berubah, lalu di dalemnya taruh anchor
                position:sticky (left:0) — posisi "natural"-nya anchor
                ini selalu di ujung kiri konten (x=0), jadi begitu
                di-scroll dia langsung nempel & ngikutin tepi kiri
                VIEWPORT yang kelihatan (bukan tepi kiri konten). Dari
                situ, marker visualnya baru digeser ke tengah viewport
                pakai `left: viewportWidth / 2`. */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 top-4 z-10">
              <div className="pointer-events-none sticky left-0 h-full w-0">
                <div
                  onPointerDown={handlePlayheadPointerDown}
                  className="pointer-events-auto absolute inset-y-0 w-6 -translate-x-1/2 touch-none cursor-ew-resize"
                  style={{ left: viewportWidth / 2 }}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-paper" />
                  <div className="pointer-events-none absolute -top-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-t-[7px] border-t-paper" />
                </div>
              </div>
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
                  {(() => {
                    // Klip "Add teks" (customLyricsLayers) sengaja cuma
                    // punya 1 baris aktif — baris satunya di-set hidden +
                    // transparan biar visualnya 1 baris (lihat
                    // addCustomTextLayer). Baris nonaktif itu JANGAN
                    // dimunculin sebagai track kosong di daftar (dulu
                    // tetap kerender dicoret, bikin keliatan kayak nambah
                    // 2 track padahal cuma "Add teks" sekali). Klip
                    // "Lirik" bawaan template (bukan custom) tetap
                    // tampilin 2 baris seperti biasa.
                    const visibleEntries = lyricsTextEntries.filter((layer) => {
                      const baseId = lyricsBaseIdOf(layer.id);
                      const isCustomSingleLine = baseId
                        ? customLyricsLayers.some((l) => l.id === baseId)
                        : false;
                      return !(isCustomSingleLine && hiddenElements.has(layer.id));
                    });
                    // Kelompokin per BARIS (row) — beberapa klip lirik yang
                    // udah "numpang" ke row yang sama (lihat
                    // handleLyricsRowDragStart) dirender BERDAMPINGAN
                    // dalam 1 baris track, bukan baris terpisah-pisah.
                    const rowMap = new Map<number, TemplateTextLayer[]>();
                    visibleEntries.forEach((layer) => {
                      const baseId = lyricsBaseIdOf(layer.id);
                      if (!baseId) return;
                      const row = lyricsRowOf(baseId);
                      const arr = rowMap.get(row) ?? [];
                      arr.push(layer);
                      rowMap.set(row, arr);
                    });
                    return [...rowMap.keys()]
                      .sort((a, b) => a - b)
                      .map((row) => renderLyricsRow(row, rowMap.get(row)!));
                  })()}
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
    </>
  );
}
