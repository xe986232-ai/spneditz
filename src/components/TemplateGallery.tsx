import { useEffect, useState } from "react";
import { Image as ImageIcon, Search, Lock, Sparkles, ArrowRight } from "lucide-react";
import { TEMPLATES } from "../data/templates";
import type { Template } from "../types";
import { subscribeTemplateUsage } from "../lib/exportLog";
import { subscribeTemplateEnabled } from "../lib/templateFlags";
import TemplateThumbnail from "./TemplateThumbnail";

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
          <TemplateThumbnail
            template={template}
            alt={`Preview ${template.name}`}
            className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${
              enabled ? "group-active:scale-105" : "grayscale"
            }`}
          />

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

          <span className="absolute right-2.5 top-2.5 rounded-full border border-paper/10 bg-black/40 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-paper/90 backdrop-blur-sm">
            {template.duration}
          </span>

          {/* overlay bawah + info */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-2.5 pt-10">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-paper">
              {template.name}
            </p>

            {/* ikon foto + "X kali digunakan", rata kiri */}
            {usageCount !== null && (
              <div className="mt-1 flex items-center gap-1 text-[9.5px] text-paper/60">
                <ImageIcon size={10} strokeWidth={2} />
                <span>{usageCount.toLocaleString("id-ID")} kali digunakan</span>
              </div>
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
