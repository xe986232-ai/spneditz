import { useEffect, useRef, useState } from "react";
import type { Template } from "../types";
import { renderTemplateThumbnail } from "../lib/thumbnail";

// Cache di level modul (bukan per-komponen) — sekali ke-render, dipakai
// ulang tiap kartu template ini muncul lagi (nggak perlu render ulang
// tiap kali galeri di-mount/scroll).
const thumbnailCache = new Map<string, string>();

export default function TemplateThumbnail({
  template,
  className,
  alt,
}: {
  template: Template;
  className?: string;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(
    thumbnailCache.get(template.id) ?? null,
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (thumbnailCache.has(template.id)) {
      setSrc(thumbnailCache.get(template.id)!);
      return;
    }
    renderTemplateThumbnail(template)
      .then((dataUrl) => {
        if (cancelledRef.current) return;
        thumbnailCache.set(template.id, dataUrl);
        setSrc(dataUrl);
      })
      .catch(() => {
        // Render frame gagal (mis. aset gagal load) — biarin fallback ke
        // previewImage statis di bawah, jangan bikin kartu kosong.
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [template]);

  const finalSrc = src ?? template.previewImage;
  if (!finalSrc) return null;

  return <img src={finalSrc} alt={alt} className={className} />;
}
