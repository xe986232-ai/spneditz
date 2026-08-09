import { useEffect, useState } from "react";
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
import TemplateThumbnail from "./TemplateThumbnail";

// Id template yang dapet perlakuan khusus: thumbnail kolase 2 foto yang
// dibelah miring, biar sekilas kelihatan template ini punya 2 gaya
// progress (bar polos & waveform) — bukan cuma 1 render statis kayak
// kartu template lain. Kalau nanti ada template lain yang mau dikasih
// gaya sama, tinggal tambahin id-nya di sini.
const COLLAGE_TEMPLATE_IDS = new Set(["iphone-music-player"]);

/** Thumbnail kolase — 2 foto dibelah pakai clip-path miring ("keren", bukan
 *  potongan lurus doang), disambung sama pita aksen ungu (senada
 *  editor-accent di halaman Editor). Potongan atas dikasih chip mini
 *  "Progress Bar" (gaya klasik), potongan bawah dikasih chip mini
 *  "Waveform" (gaya lebih iconik) — dua gaya progress yang bisa dipilih
 *  user pas ngedit, jadi kelihatan dari thumbnail-nya doang. */
function CollageThumbnail({
  topSrc,
  bottomSrc,
  className,
}: {
  topSrc: string;
  bottomSrc: string;
  className?: string;
}) {
  // Garis potong miring: dari (0%, 58%) ke (100%, 44%) — dipakai bareng
  // buat 2 foto DAN pita pemisahnya, biar semuanya nyambung presisi
  // walau ukuran kartu beda-beda (persen, bukan px, jadi selalu pas).
  const topClip = "polygon(0% 0%, 100% 0%, 100% 44%, 0% 58%)";
  const bottomClip = "polygon(0% 58%, 100% 44%, 100% 100%, 0% 100%)";
  const bandClip = "polygon(0% 55.5%, 100% 41.5%, 100% 47%, 0% 61%)";

  return (
    <div className={`absolute inset-0 ${className ?? ""}`}>
      <img
        src={topSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: topClip }}
      />
      <img
        src={bottomSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: bottomClip }}
      />

      {/* glow ambient di garis sambungan — kesan "premium", bukan sekadar
          dua foto ditempel */}
      <div
        className="pointer-events-none absolute inset-x-0 top-[38%] h-24 opacity-80 blur-2xl"
        style={{
          backgroundImage:
            "linear-gradient(100deg, transparent, rgba(124,108,255,0.6), transparent)",
        }}
      />

      {/* pita pemisah miring, aksen ungu senada editor-accent (bukan garis
          lurus polos) + highlight tipis biar keliatan kayak kaca/metal */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: bandClip,
          backgroundImage: "linear-gradient(100deg, #5a4fd6, #a695ff 45%, #5a4fd6)",
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

      {/* badge bulat pas di tengah sambungan, biar potongannya kelihatan
          sengaja didesain, bukan sekedar dipotong */}
      <div className="absolute left-1/2 top-[49.5%] z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-editor-accent/60 bg-editor-panel shadow-[0_0_18px_rgba(124,108,255,0.65)]">
        <Sparkles size={12} className="text-editor-accent" />
      </div>

      {/* chip mini "Progress Bar" di potongan atas — gaya progress bar
          klasik (isian putih polos) */}
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

  // Template dengan gaya kolase khusus — pakai 2 foto sampul beda template
  // (punya sendiri + tetangganya) biar potongannya kelihatan kontras/niat,
  // bukan foto yang sama diulang dua kali.
  const isCollageStyle = COLLAGE_TEMPLATE_IDS.has(template.id);
  const collageTopSrc = template.slots.find((s) => s.type === "image")?.sampleSrc;
  const collageBottomSrc = TEMPLATES.find(
    (t) => t.id !== template.id,
  )?.slots.find((s) => s.type === "image")?.sampleSrc;

  return (
    <button
      onClick={handleClick}
      className="group relative flex w-full flex-col overflow-hidden rounded-[22px] p-[1px] text-left transition-transform duration-300 active:scale-[0.97]"
      style={{
        backgroundImage:
          "linear-gradient(155deg, rgba(236,234,228,0.28), rgba(236,234,228,0.04) 35%, rgba(236,234,228,0.02) 60%, rgba(225,76,76,0.25))",
      }}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[21px] bg-panel">
        {/* kartu preview */}
        <div
          className="relative aspect-[9/16] w-full overflow-hidden"
          style={{
            backgroundImage: `linear-gradient(160deg, ${template.gradientFrom}, ${template.gradientTo})`,
          }}
        >
          {isCollageStyle && collageTopSrc && collageBottomSrc ? (
            <CollageThumbnail
              topSrc={collageTopSrc}
              bottomSrc={collageBottomSrc}
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
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/10" />

          {/* dim overlay + badge "Nonaktif" kalau template lagi dimatiin */}
          {!enabled && (
            <div className="absolute inset-0 bg-graphite/60 backdrop-blur-[1px]">
              <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-paper/10 bg-graphite/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper/90">
                <Lock size={9} strokeWidth={2.5} />
                Nonaktif
              </span>
            </div>
          )}

          {/* badge "2 Gaya Progress" — cuma di kartu bergaya kolase, promosiin
              kalau template ini bisa pakai progress bar ATAU waveform */}
          {isCollageStyle && enabled && (
            <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-editor-accent/50 bg-editor-panel/85 px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-editor-accent backdrop-blur-sm">
              <Sparkles size={9} strokeWidth={2.5} />
              2 Gaya Progress
            </span>
          )}

          <span className="absolute right-2.5 top-2.5 rounded-full border border-paper/10 bg-black/40 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-paper/90 backdrop-blur-sm">
            {template.duration}
          </span>

          {/* overlay bawah + info */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-2.5 pt-10">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-paper">
              {template.name}
            </p>

            {isCollageStyle ? (
              <p className="mt-1 truncate text-[9.5px] text-editor-accent/90">
                Bar klasik & waveform iconik, tinggal pilih
              </p>
            ) : (
              usageCount !== null && (
                <div className="mt-1 flex items-center gap-1 text-[9.5px] text-paper/60">
                  <ImageIcon size={10} strokeWidth={2} />
                  <span>{usageCount.toLocaleString("id-ID")} kali digunakan</span>
                </div>
              )
            )}
          </div>
        </div>

        {/* footer tipis, gantiin tombol lama — sekarang seluruh kartu bisa
            diklik, footer ini cuma jadi indikator visual "Gunakan" */}
        <div className="flex items-center justify-between gap-2 border-t border-paper/[0.06] px-3 py-2.5">
          <span
            className={`text-[11px] font-semibold tracking-wide ${
              enabled ? "text-paper/85" : "text-mute"
            }`}
          >
            Gunakan
          </span>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300 group-active:translate-x-0.5 ${
              enabled ? "bg-rec text-paper" : "bg-mute/15 text-mute"
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
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-graphite font-sans">
      {/* glow ambient di belakang header, kesan premium bukan flat generic */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[140%] -translate-x-1/2 opacity-40 blur-3xl"
        style={{
          backgroundImage:
            "radial-gradient(closest-side, rgba(225,76,76,0.35), transparent)",
        }}
      />

      {/* Header */}
      <div className="relative flex shrink-0 flex-col gap-3 border-b border-paper/[0.06] bg-panel/80 px-4 pb-4 pt-5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rec">
              <Sparkles size={11} strokeWidth={2.5} />
              Koleksi Template
            </div>
            <h1 className="text-xl font-bold tracking-tight text-paper">
              Pilih Template
            </h1>
            <p className="mt-0.5 text-xs text-mute">
              Tinggal isi foto & audio, sisanya udah beres
            </p>
          </div>
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper/10 bg-graphite/60 text-mute transition hover:text-paper active:scale-95"
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

      {/* Alert modal — muncul kalau tombol "Gunakan" diklik pas template
          lagi dinonaktifkan dari dashboard admin */}
      {disabledAlertTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
          onClick={() => setDisabledAlertTemplate(null)}
        >
          <div
            className="w-full max-w-[320px] rounded-3xl border border-paper/10 bg-panel p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rec/15 text-rec">
              <Lock size={18} />
            </div>
            <p className="mb-1 text-sm font-semibold text-paper">
              Template belum bisa dipakai
            </p>
            <p className="mb-4 text-xs text-mute">
              "{disabledAlertTemplate.name}" lagi dinonaktifkan sementara.
              Coba lagi nanti ya.
            </p>
            <button
              onClick={() => setDisabledAlertTemplate(null)}
              className="w-full rounded-full bg-rec px-3.5 py-2.5 text-sm font-semibold text-paper shadow-lg shadow-rec/20 active:scale-95"
            >
              Oke
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
