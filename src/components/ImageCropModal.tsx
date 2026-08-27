import { useCallback, useRef, useState } from "react";
import { Check, X, ZoomIn } from "lucide-react";

interface ImageCropModalProps {
  /** Object URL dari file mentah yang baru dipilih user (belum di-crop). */
  imageUrl: string;
  /** Ukuran target area slot di canvas template (dalam px skala canvas
   *  asli, misal 1080x1920) — dipakai buat nentuin rasio frame crop DAN
   *  resolusi output, biar hasil crop pas nempel di slot itu. */
  targetWidth: number;
  targetHeight: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// Batas ukuran frame crop di layar (px CSS), biar muat di HP maupun desktop.
const FRAME_MAX_W = 340;
const FRAME_MAX_H = 480;
// Lantai resolusi output, biar hasil crop nggak pecah kalau slotnya kecil.
const MIN_OUTPUT_DIM = 480;

/** Overlay full-screen buat crop foto sampul sebelum dipakai — muncul
 *  begitu user pilih file baru dari galeri/kamera. User bisa geser
 *  (pan) & zoom foto di dalam frame yang rasionya SAMA PERSIS kayak area
 *  slot foto di template, jadi hasil crop-nya pasti pas begitu ditempel
 *  balik ke canvas (drawImageCover di lib/render.ts). */
export default function ImageCropModal({
  imageUrl,
  targetWidth,
  targetHeight,
  onConfirm,
  onCancel,
}: ImageCropModalProps) {
  const aspect = targetWidth > 0 && targetHeight > 0 ? targetWidth / targetHeight : 1;

  const frame = (() => {
    let w = FRAME_MAX_W;
    let h = w / aspect;
    if (h > FRAME_MAX_H) {
      h = FRAME_MAX_H;
      w = h * aspect;
    }
    return { w, h };
  })();

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Faktor zoom TAMBAHAN di atas baseScale (skala minimum biar foto full
  // nutup frame, mirip object-fit: cover).
  const [zoom, setZoom] = useState(1);
  // Posisi kiri-atas foto relatif ke frame (px), transform-origin 0 0.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const baseScale = natural ? Math.max(frame.w / natural.w, frame.h / natural.h) : 1;
  const totalScale = baseScale * zoom;

  const clampOffset = useCallback(
    (x: number, y: number, scale: number) => {
      if (!natural) return { x, y };
      const dispW = natural.w * scale;
      const dispH = natural.h * scale;
      const minX = frame.w - dispW;
      const minY = frame.h - dispH;
      return {
        x: Math.min(0, Math.max(minX, x)),
        y: Math.min(0, Math.max(minY, y)),
      };
    },
    [natural, frame.w, frame.h],
  );

  function handleImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    setNatural({ w, h });
    const scale = Math.max(frame.w / w, frame.h / h);
    // Tengahin foto pas pertama kali kebuka.
    setOffset({ x: (frame.w - w * scale) / 2, y: (frame.h - h * scale) / 2 });
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setOffset(clampOffset(drag.startOffsetX + dx, drag.startOffsetY + dy, totalScale));
  }

  function handlePointerUp() {
    dragRef.current = null;
    setIsDragging(false);
  }

  // Ganti zoom lewat slider — anchor-nya titik TENGAH frame biar zoom-nya
  // kerasa natural (bukan nyontek dari sudut kiri-atas foto).
  function handleZoomChange(nextZoom: number) {
    if (!natural) {
      setZoom(nextZoom);
      return;
    }
    const oldScale = baseScale * zoom;
    const newScale = baseScale * nextZoom;
    const cx = (frame.w / 2 - offset.x) / oldScale;
    const cy = (frame.h / 2 - offset.y) / oldScale;
    setZoom(nextZoom);
    setOffset(
      clampOffset(frame.w / 2 - cx * newScale, frame.h / 2 - cy * newScale, newScale),
    );
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img || !natural) return;

    // Balikin posisi frame (layar) ke koordinat piksel ASLI foto.
    const srcX = (0 - offset.x) / totalScale;
    const srcY = (0 - offset.y) / totalScale;
    const srcW = frame.w / totalScale;
    const srcH = frame.h / totalScale;

    // Resolusi output disamain sama ukuran slot di canvas template, biar
    // gak lebay gede & gak kekecilan — dengan lantai minimum.
    const outScale = Math.max(1, MIN_OUTPUT_DIM / Math.min(targetWidth, targetHeight));
    const outW = Math.max(1, Math.round(targetWidth * outScale));
    const outH = Math.max(1, Math.round(targetHeight * outScale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <button
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-paper transition active:scale-90"
          title="Batal"
        >
          <X size={18} />
        </button>
        <span className="text-sm font-medium text-paper">Atur foto sampul</span>
        <button
          onClick={handleConfirm}
          disabled={!natural}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-editor-accent text-paper transition active:scale-90 disabled:opacity-40"
          title="Pakai crop ini"
        >
          <Check size={18} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <div
          className="relative touch-none select-none overflow-hidden rounded-2xl bg-black ring-2 ring-white/20"
          style={{
            width: frame.w,
            height: frame.h,
            cursor: isDragging ? "grabbing" : "grab",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            onLoad={handleImgLoad}
            draggable={false}
            alt="Pratinjau crop"
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${totalScale})`,
              visibility: natural ? "visible" : "hidden",
            }}
          />
          {/* Grid rule-of-thirds tipis, bantu framing doang, gak ikut ke-crop. */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="border border-white/10" />
            ))}
          </div>
        </div>

        <div className="flex w-full max-w-xs items-center gap-3">
          <ZoomIn size={16} className="shrink-0 text-mute" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            className="w-full accent-editor-accent"
          />
        </div>
        <p className="max-w-xs text-center text-[11px] text-mute">
          Geser buat atur posisi, slider buat zoom. Rasio bingkai udah
          disamain sama area foto sampul di template.
        </p>
      </div>
    </div>
  );
}
