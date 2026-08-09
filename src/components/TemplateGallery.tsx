import { useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Search,
  Lock,
  Sparkles,
  ArrowRight,
  AudioWaveform,
  SlidersHorizontal,
} from "lucide-react";
import { TEMPLATES } from "../data/templates";
import type { Template } from "../types";
import { subscribeTemplateUsage } from "../lib/exportLog";
import { subscribeTemplateEnabled } from "../lib/templateFlags";
import TemplateThumbnail, { ThumbnailSkeleton } from "./TemplateThumbnail";
import { renderTemplateThumbnail } from "../lib/thumbnail";

// Id template yang dapet perlakuan khusus: thumbnail kolase 2 foto yang
// dibelah miring, biar sekilas kelihatan template ini punya 2 gaya
// progress (bar polos & waveform) — bukan cuma 1 render statis kayak
// kartu template lain. Kalau nanti ada template lain yang mau dikasih
// gaya sama, tinggal tambahin id-nya di sini.
const COLLAGE_TEMPLATE_IDS = new Set(["iphone-music-player"]);

// Cache di level modul buat 2 potongan kolase (bar & waveform) — sama
// pola-nya kayak thumbnailCache di TemplateThumbnail.tsx, biar nggak
// render ulang canvas tiap kartu ini muncul lagi.
const collageCache = new Map<string, { bar: string; waveform: string }>();

/** Thumbnail kolase — 2 potongan gambar dibelah pakai clip-path miring
 *  ("keren", bukan potongan lurus doang), disambung sama pita aksen ungu
 *  — SAMA PERSIS warna editor-accent yang dipakai di halaman Editor
 *  (rgba(124,108,255,…)), bukan warna ungu custom terpisah, biar kartu
 *  galeri & editor kerasa satu identitas visual. Potongan atas & bawahnya
 *  jepretan CANVAS SUNGGUHAN (hasil renderTemplateThumbnail, sama mesinnya
 *  kayak TemplateThumbnail), jadi kelihatan background, card player, foto
 *  sampul (random dari Firebase/Unsplash), teks, DAN progress-nya
 *  sekalian — potongan atas gaya "Progress Bar" klasik, potongan bawah
 *  gaya "Waveform" iconik. */
function CollageThumbnail({
  template,
  className,
}: {
  template: Template;
  className?: string;
}) {
  const cached = collageCache.get(template.id);
  const [shots, setShots] = useState<{ bar: string; waveform: string } | null>(
    cached ?? null,
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    if (collageCache.has(template.id)) {
      setShots(collageCache.get(template.id)!);
      return () => {
        cancelledRef.current = true;
      };
    }

    Promise.all([
      // Crop 6%–75% tinggi canvas: lompatin margin atas kosong, langsung
      // mulai dari foto sampul, ikutin teks judul/artist, sampai progress
      // bar/waveform + label durasi — biar elemen progress-nya SAMA-SAMA
      // kepotong di dalam frame kolase (baik potongan atas "bar" maupun
      // potongan bawah "waveform").
      renderTemplateThumbnail(template, undefined, "bar", [0.06, 0.75]),
      renderTemplateThumbnail(template, undefined, "waveform", [0.06, 0.75]),
    ])
      .then(([bar, waveform]) => {
        if (cancelledRef.current) return;
        const result = { bar, waveform };
        collageCache.set(template.id, result);
        setShots(result);
      })
      .catch(() => {
        // Render canvas gagal (mis. aset gagal load) — biarin kosong,
        // ThumbnailSkeleton di TemplateCard tetap kepasang lewat fallback
        // gradient background kartu, jadi kartu nggak kelihatan rusak.
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [template]);

  // Garis potong miring: dari (0%, 58%) ke (100%, 44%) — dipakai bareng
  // buat 2 foto DAN pita pemisahnya, biar semuanya nyambung presisi
  // walau ukuran kartu beda-beda (persen, bukan px, jadi selalu pas).
  const topClip = "polygon(0% 0%, 100% 0%, 100% 44%, 0% 58%)";
  const bottomClip = "polygon(0% 58%, 100% 44%, 100% 100%, 0% 100%)";
  const bandClip = "polygon(0% 55.5%, 100% 41.5%, 100% 47%, 0% 61%)";

  if (!shots) {
    return <ThumbnailSkeleton className={className} />;
  }

  return (
    <div className={`absolute inset-0 ${className ?? ""}`}>
      <img
        src={shots.bar}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: topClip }}
      />
      <img
        src={shots.waveform}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: bottomClip }}
      />

      {/* glow ambient di garis sambungan — warna editor-accent, senada
          Editor */}
      <div
        className="pointer-events-none absolute inset-x-0 top-[38%] h-24 opacity-80 blur-2xl"
        style={{
          backgroundImage:
            "linear-gradient(100deg, transparent, rgba(124,108,255,0.55), transparent)",
        }}
      />

      {/* pita pemisah miring, warna editor-accent persis (bukan ungu
          custom terpisah) + highlight tipis biar keliatan kayak kaca */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: bandClip,
          backgroundImage:
            "linear-gradient(100deg, rgba(124,108,255,0.92), rgba(168,157,255,0.98) 45%, rgba(124,108,255,0.92))",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 animate-skeleton-shimmer opacity-70"
        style={{
          clipPath: bandClip,
          backgroundImage:
            "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.85) 50%, transparent 70%)",
        }}
      />

      {/* badge bulat pas di tengah sambungan */}
      <div className="absolute left-1/2 top-[49.5%] z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-editor-accent/60 bg-editor-panel shadow-[0_0_18px_rgba(124,108,255,0.65)]">
        <Sparkles size={12} className="text-editor-accent" />
      </div>

      {/* chip mini "Progress Bar" di potongan atas — gaya progress bar
          klasik (isian putih polos), pill gelap + border tipis, sama pola
          badge mengambang di preview Editor (bg-black/45, border-white/10,
          backdrop-blur-sm) */}
      <div className="absolute left-2.5 top-[15%] flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 py-1 pl-1.5 pr-2 backdrop-blur-sm">
        <SlidersHorizontal size={9} className="shrink-0 text-paper/80" />
        <div className="h-1 w-9 overflow-hidden rounded-full bg-white/25">
          <div className="h-full w-[62%] rounded-full bg-paper" />
        </div>
      </div>

      {/* chip mini "Waveform" di potongan bawah — bar naik-turun kayak
          gelombang audio beneran, warna emerald sama kayak klip audio di
          Editor, biar konsisten identitas warnanya */}
      <div className="absolute bottom-[14%] left-2.5 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 py-1 pl-1.5 pr-2 backdrop-blur-sm">
        <AudioWaveform size={9} className="shrink-0 text-emerald-300" />
        <div className="flex items-end gap-[1.5px]">
          {[3, 7, 4, 9, 5, 8, 3].map((h, i) => (
            <span
              key={i}
              className="w-[2px] rounded-full bg-emerald-300"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onSelect,
  onDisabledClick,
}: {
  template: Template;
  onSelect: (t: Template) => void;
  onDisabledClick: (t: Template) => void;
}) {
  // Jumlah "X kali digunakan" — dengerin real-time dari Firebase Realtime
  // Database, di-update otomatis tiap ada export baru (nggak perlu refresh).
  const [usageCount, setUsageCount] = useState<number | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeTemplateUsage(template.id, setUsageCount);
    return unsubscribe;
  }, [template.id]);

  // Status aktif/nonaktif template ini, diatur dari dashboard admin
  // (config/templates/{id}/enabled). Default true (fail-open) sampai
  // data pertama datang, biar nggak sempat kelihatan nonaktif sekejap.
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const unsubscribe = subscribeTemplateEnabled(template.id, setEnabled);
    return unsubscribe;
  }, [template.id]);

  function handleClick() {
    if (!enabled) {
      onDisabledClick(template);
      return;
    }
    onSelect(template);
  }

  // Template dengan gaya kolase khusus — potongan atas & bawahnya dua
  // jepretan canvas SUNGGUHAN dari template ini sendiri (gaya "bar" &
  // "waveform").
  const isCollageStyle = COLLAGE_TEMPLATE_IDS.has(template.id);

  return (
    <button
      onClick={handleClick}
      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-editor-panel text-left shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition-transform duration-300 active:scale-[0.97]"
    >
      {/* ring tipis di dalam border, kesan "kaca premium" — pola yang
          sama dipakai di snapshot export Editor (ring-1 ring-inset
          ring-white/10) */}
      <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl ring-1 ring-inset ring-white/[0.06]" />

      <div className="relative flex h-full flex-col overflow-hidden">
        {/* kartu preview */}
        <div
          className="relative aspect-[9/16] w-full overflow-hidden"
          style={{
            backgroundImage: `linear-gradient(160deg, ${template.gradientFrom}, ${template.gradientTo})`,
          }}
        >
          {isCollageStyle ? (
            <CollageThumbnail
              template={template}
              className={`transition duration-500 ${
                enabled ? "group-active:scale-105" : "grayscale"
              }`}
            />
          ) : (
            <TemplateThumbnail
              template={template}
              alt={`Preview ${template.name}`}
              className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${
                enabled ? "group-active:scale-105" : "grayscale"
              }`}
            />
          )}

          {/* vignette halus biar teks & badge kebaca di semua foto */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/15" />

          {/* dim overlay + badge "Nonaktif" kalau template lagi dimatiin —
              gelap pekat senada bg-editor-bg, bukan lagi abu-abu graphite */}
          {!enabled && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px]">
              <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper/90 backdrop-blur-sm">
                <Lock size={9} strokeWidth={2.5} />
                Nonaktif
              </span>
            </div>
          )}

          {/* badge "2 Gaya Progress" — cuma di kartu bergaya kolase */}
          {isCollageStyle && enabled && (
            <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-editor-accent/50 bg-editor-panel/85 px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-editor-accent backdrop-blur-sm">
              <Sparkles size={9} strokeWidth={2.5} />
              2 Gaya Progress
            </span>
          )}

          <span className="absolute right-2.5 top-2.5 rounded-full border border-white/10 bg-black/50 px-2 py-0.5 text-[9px] font-semibold tabular-nums tracking-wide text-paper/90 backdrop-blur-sm">
            {template.duration}
          </span>

          {/* overlay bawah + info */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2.5 pt-10">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-paper">
              {template.name}
            </p>

            {isCollageStyle ? (
              <p className="mt-1 truncate text-[9.5px] text-editor-accent/90">
                Bar klasik & waveform iconik, tinggal pilih
              </p>
            ) : (
              usageCount !== null && (
                <div className="mt-1 flex items-center gap-1 text-[9.5px] text-editor-muted">
                  <ImageIcon size={10} strokeWidth={2} />
                  <span className="tabular-nums">
                    {usageCount.toLocaleString("id-ID")} kali digunakan
                  </span>
                </div>
              )
            )}
          </div>
        </div>

        {/* footer tipis — CTA "Gunakan" pakai aksen ungu editor-accent
            (bukan lagi merah "rec"), sama pola visual sama tombol "Unduh"
            di modal export Editor (bg-editor-accent + glow shadow ungu) */}
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-black/20 px-3 py-2.5">
          <span
            className={`text-[11px] font-semibold tracking-wide ${
              enabled ? "text-paper/85" : "text-editor-muted"
            }`}
          >
            Gunakan
          </span>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300 group-active:translate-x-0.5 ${
              enabled
                ? "bg-editor-accent text-paper shadow-[0_2px_10px_rgba(124,108,255,0.5)]"
                : "bg-white/[0.06] text-editor-muted"
            }`}
          >
            <ArrowRight size={12} strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </button>
  );
}

export default function TemplateGallery({
  onSelect,
}: {
  onSelect: (template: Template) => void;
}) {
  // Nama template yang lagi dicoba dipakai padahal nonaktif — kalau ada
  // isinya, modal alert muncul. null = modal ketutup.
  const [disabledAlertTemplate, setDisabledAlertTemplate] =
    useState<Template | null>(null);

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-editor-bg font-sans">
      {/* glow ambient ungu di belakang header — senada persis sama glow
          di modal export Editor (bg-editor-accent/25 blur-3xl), bukan lagi
          glow merah generik */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[140%] -translate-x-1/2 rounded-full bg-editor-accent/20 opacity-90 blur-3xl"
      />

      {/* Header — border-white/5 & bg-editor-panel/80, sama persis pola
          panel gelap di Editor (bg-editor-panel, border-white/5) */}
      <div className="relative flex shrink-0 flex-col gap-3 border-b border-white/5 bg-editor-panel/80 px-4 pb-4 pt-5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-editor-accent">
              <Sparkles size={11} strokeWidth={2.5} />
              Koleksi Template
            </div>
            <h1 className="text-xl font-bold tracking-tight text-paper">
              Pilih Template
            </h1>
            <p className="mt-0.5 text-xs text-editor-muted">
              Tinggal isi foto & audio, sisanya udah beres
            </p>
          </div>
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-paper/70 transition hover:text-paper active:scale-90"
            title="Cari template"
          >
            <Search size={17} />
          </button>
        </div>
      </div>

      {/* Grid template — dua berbanjar (2 kolom) */}
      <div className="relative grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4">
        {TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={onSelect}
            onDisabledClick={setDisabledAlertTemplate}
          />
        ))}
      </div>

      {/* Alert modal — dipasang ulang persis kayak modal export di Editor:
          rounded-3xl, border-white/10, bg-editor-panel, glow ambient
          bg-editor-accent/25 blur-3xl, shadow gelap dalam, tombol CTA
          bg-editor-accent dengan glow shadow ungu. */}
      {disabledAlertTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
          onClick={() => setDisabledAlertTemplate(null)}
        >
          <div
            className="relative w-full max-w-xs overflow-hidden rounded-3xl border border-white/10 bg-editor-panel p-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-rec/20 blur-3xl" />
            <div className="relative">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rec/15">
                <Lock size={20} className="text-rec" />
              </div>
              <p className="text-sm font-semibold text-paper">
                Template belum bisa dipakai
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-editor-muted">
                "{disabledAlertTemplate.name}" lagi dinonaktifkan sementara.
                Coba lagi nanti ya.
              </p>
              <button
                onClick={() => setDisabledAlertTemplate(null)}
                className="mt-4 w-full rounded-full bg-editor-accent px-4 py-2.5 text-xs font-semibold text-paper shadow-[0_4px_16px_rgba(124,108,255,0.4)] transition hover:brightness-110 active:scale-[0.98]"
              >
                Oke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
