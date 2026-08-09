import { useEffect, useRef, useState } from "react";
import type { Template } from "../types";
import { renderTemplateThumbnail } from "../lib/thumbnail";

// Cache di level modul (bukan per-komponen) — sekali ke-render, dipakai
// ulang tiap kartu template ini muncul lagi (nggak perlu render ulang
// tiap kali galeri di-mount/scroll).
const thumbnailCache = new Map<string, string>();

// Skeleton loading WAJIB kelihatan minimal sekian ms — walaupun render
// thumbnail-nya kelar duluan (jaringan bagus/dari cache), biar transisinya
// smooth & konsisten, bukan "kedip" sekejap terus langsung ganti gambar.
const MIN_SKELETON_MS = 2000;

/** Shimmer skeleton — placeholder abu-abu dengan highlight yang gerak dari
 *  kiri ke kanan, dipakai selama thumbnail belum siap ditampilkan. */
function ThumbnailSkeleton({ className }: { className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden bg-graphite ${className ?? ""}`}>
      <div className="absolute inset-0 animate-pulse bg-mute/10" />
      <div
        className="absolute inset-0 -translate-x-full animate-skeleton-shimmer"
        style={{
          backgroundImage:
            "linear-gradient(100deg, transparent 30%, rgba(236,234,228,0.10) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}

export default function TemplateThumbnail({
  template,
  className,
  alt,
}: {
  template: Template;
  className?: string;
  alt: string;
}) {
  const cachedSrc = thumbnailCache.get(template.id);
  const [src, setSrc] = useState<string | null>(cachedSrc ?? null);
  // Skeleton default nyala TERUS di render pertama, meskipun sebenarnya
  // udah ada di thumbnailCache — biar transisi tetap konsisten (nggak
  // langsung "lompat" ke gambar final tanpa animasi loading sama sekali).
  const [showSkeleton, setShowSkeleton] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const startedAt = Date.now();

    function revealAfterMinimum() {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SKELETON_MS - elapsed);
      window.setTimeout(() => {
        if (!cancelledRef.current) setShowSkeleton(false);
      }, remaining);
    }

    if (thumbnailCache.has(template.id)) {
      setSrc(thumbnailCache.get(template.id)!);
      revealAfterMinimum();
      return () => {
        cancelledRef.current = true;
      };
    }

    setShowSkeleton(true);
    renderTemplateThumbnail(template)
      .then((dataUrl) => {
        if (cancelledRef.current) return;
        thumbnailCache.set(template.id, dataUrl);
        setSrc(dataUrl);
      })
      .catch(() => {
        // Render frame gagal (mis. aset gagal load) — biarin fallback ke
        // previewImage statis di bawah, jangan bikin kartu kosong.
      })
      .finally(() => {
        if (!cancelledRef.current) revealAfterMinimum();
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [template]);

  const finalSrc = src ?? template.previewImage;

  return (
    <>
      {finalSrc && (
        <img
          src={finalSrc}
          alt={alt}
          className={`${className ?? ""} transition-opacity duration-500 ${
            showSkeleton ? "opacity-0" : "opacity-100"
          }`}
        />
      )}
      {showSkeleton && <ThumbnailSkeleton className={className} />}
    </>
  );
}
