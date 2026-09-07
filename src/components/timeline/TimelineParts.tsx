import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, GripVertical, Eye, EyeOff, Link2 } from "lucide-react";

// Dipindah dari Editor.tsx (Tahap 1: pecah Timeline jadi komponen
// terpisah) — komponen murni, tanpa closure ke state Editor, jadi aman
// di-memo & dipakai ulang di Timeline.tsx.

export function TrackLabel({
  hidden,
  onToggleHidden,
  icon: Icon,
  label,
  hiddenTitle,
  shownTitle,
  onReorderPointerDown,
  // --- Fitur seleksi banyak track buat "Jadikan Grup" (khusus dipakai
  // baris track lirik, lihat renderLyricsRow) — tahan lama ikon mata
  // buat masuk mode seleksi, abis itu nge-tap SELURUH pill label toggle
  // masuk/keluar seleksi. Kalau tidak diisi (track lain: background/
  // slot/audio), perilaku lama (klik ikon mata = toggle hidden) tetap
  // apa adanya. ---
  selectMode,
  selected,
  onSelectToggle,
  onEyeLongPress,
  grouped,
}: {
  hidden: boolean;
  onToggleHidden: (e: React.MouseEvent) => void;
  icon: LucideIcon;
  label: string;
  hiddenTitle?: string;
  shownTitle?: string;
  // Opsional: kalau diisi, track ini bisa di-drag naik/turun buat ubah
  // urutan (dipakai khusus track teks custom hasil "Add teks" — reorder
  // sekaligus ngatur mana yang di depan/belakang pas overlap di canvas).
  onReorderPointerDown?: (e: React.PointerEvent) => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
  onEyeLongPress?: () => void;
  grouped?: boolean;
}) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  return (
    <div
      onClick={selectMode ? onSelectToggle : undefined}
      className={`sticky left-1 z-20 flex h-8 w-[104px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] text-ed-text transition ${
        selectMode
          ? `cursor-pointer active:scale-[0.98] ${
              selected ? "bg-editor-accent/25 ring-1 ring-editor-accent" : "bg-ed-card"
            }`
          : "bg-ed-card"
      }`}
    >
      {selectMode ? (
        // Ganti grip/reorder handle jadi checkbox bulat pas mode
        // seleksi aktif — nggak masuk akal drag-reorder bareng seleksi.
        <span
          className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border ${
            selected
              ? "border-editor-accent bg-editor-accent text-white"
              : "border-ed-dim/60"
          }`}
        >
          {selected && <Check className="h-[10px] w-[10px]" strokeWidth={3} />}
        </span>
      ) : (
        onReorderPointerDown && (
          <button
            onPointerDown={onReorderPointerDown}
            title="Tahan & geser buat ubah urutan"
            aria-label="Ubah urutan track"
            className="flex h-[14px] w-[10px] shrink-0 cursor-ns-resize touch-none items-center justify-center active:scale-90"
          >
            <GripVertical className="h-[14px] w-[14px] shrink-0 text-ed-dim" />
          </button>
        )
      )}
      <button
        onClick={(e) => {
          if (selectMode) {
            // Biar klik di ikon mata pas mode seleksi ikut nge-toggle
            // seleksi baris (bukan diam), tapi jangan trigger 2x lewat
            // bubbling ke div pembungkus.
            e.stopPropagation();
            onSelectToggle?.();
            return;
          }
          if (didLongPressRef.current) {
            // Abis long-press berhasil masuk mode seleksi, "click" yang
            // otomatis nyusul (dari pointerup yang sama) jangan ikut
            // toggle hidden — cukup 1 aksi per tahan.
            didLongPressRef.current = false;
            return;
          }
          onToggleHidden(e);
        }}
        onPointerDown={(e) => {
          if (!onEyeLongPress) return;
          e.stopPropagation();
          didLongPressRef.current = false;
          clearLongPressTimer();
          longPressTimerRef.current = setTimeout(() => {
            didLongPressRef.current = true;
            onEyeLongPress();
          }, 500);
        }}
        onPointerUp={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        title={
          selectMode
            ? "Ketuk buat pilih/batal track ini"
            : hidden
              ? (hiddenTitle ?? "Tampilkan elemen")
              : (shownTitle ?? "Sembunyikan elemen (tahan buat pilih beberapa track)")
        }
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
      {grouped && !selectMode && (
        <span
          className="ml-auto flex h-[10px] w-[10px] shrink-0 items-center justify-center"
          title="Bagian dari grup — resize font bareng anggota lain"
        >
          <Link2 className="h-[10px] w-[10px] text-editor-accent" />
        </span>
      )}
    </div>
  );
}

// Label KECIL tambahan di pojok kiri-atas badan tiap klip (BUKAN
// pengganti pill TrackLabel di atas — itu tetap apa adanya, nggak
// disentuh). Cuma nama + ikon super kecil, dibekingi highlight hitam
// tipis yang memanjang ke kanan (gradient fade) biar tetap kebaca
// kontras di atas thumbnail/warna apa pun isi klipnya.
export function ClipCornerLabel({
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
