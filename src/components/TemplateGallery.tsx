import { useEffect, useState } from "react";
import { Image as ImageIcon, Search, Lock } from "lucide-react";
import { TEMPLATES } from "../data/templates";
import type { Template } from "../types";
import { subscribeTemplateUsage } from "../lib/exportLog";
import { subscribeTemplateEnabled } from "../lib/templateFlags";

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
    <div className="flex flex-col gap-2">
      {/* kartu: cuma gambar preview statis, nggak ada interaksi play */}
      <div
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl"
        style={{
          backgroundImage: `linear-gradient(160deg, ${template.gradientFrom}, ${template.gradientTo})`,
        }}
      >
        {template.previewImage && (
          <img
            src={template.previewImage}
            alt={`Preview ${template.name}`}
            className={`absolute inset-0 h-full w-full object-cover ${
              enabled ? "" : "grayscale"
            }`}
          />
        )}

        {/* dim overlay + badge "Nonaktif" kalau template lagi dimatiin */}
        {!enabled && (
          <div className="absolute inset-0 bg-graphite/55">
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-graphite/80 px-2 py-0.5 text-[10px] font-medium text-paper">
              <Lock size={10} strokeWidth={2.5} />
              Nonaktif
            </span>
          </div>
        )}

        <span className="absolute right-2 top-2 rounded-full bg-graphite/70 px-2 py-0.5 text-[10px] font-medium text-paper">
          {template.duration}
        </span>

        {/* overlay bawah + info */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-2.5 pb-2 pt-8">
          <p className="truncate text-[13px] font-semibold text-paper">
            {template.name}
          </p>

          {/* ikon foto + "X kali digunakan", rata kiri */}
          {usageCount !== null && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-paper/75">
              <ImageIcon size={11} strokeWidth={2} />
              <span>{usageCount.toLocaleString("id-ID")} kali digunakan</span>
            </div>
          )}
        </div>
      </div>

      {/* tombol Gunakan langsung di bawah card, selalu tampil — kalau
          template nonaktif, tetap bisa diklik tapi munculin alert lewat
          onDisabledClick, bukan disabled/abu-abu diam tanpa penjelasan */}
      <button
        onClick={handleClick}
        className={`w-full rounded-full px-3.5 py-2 text-sm font-semibold shadow-sm active:scale-95 ${
          enabled
            ? "bg-rec text-paper"
            : "bg-mute/20 text-mute"
        }`}
      >
        Gunakan
      </button>
    </div>
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
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-graphite font-sans">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-mute/10 bg-panel px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-paper">
              Pilih Template
            </h1>
            <p className="text-xs text-mute">
              Tinggal isi foto & audio, sisanya udah beres
            </p>
          </div>
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition hover:bg-graphite hover:text-paper active:scale-95"
            title="Cari template"
          >
            <Search size={18} />
          </button>
        </div>
      </div>

      {/* Grid template — untuk sekarang cuma 2 template aktif, jadi
          1 kolom & dikasih max-width biar kartunya nggak melebar penuh */}
      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-4">
        {TEMPLATES.map((template) => (
          <div key={template.id} className="mx-auto w-full max-w-[280px]">
            <TemplateCard
              template={template}
              onSelect={onSelect}
              onDisabledClick={setDisabledAlertTemplate}
            />
          </div>
        ))}
      </div>

      {/* Alert modal — muncul kalau tombol "Gunakan" diklik pas template
          lagi dinonaktifkan dari dashboard admin */}
      {disabledAlertTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
          onClick={() => setDisabledAlertTemplate(null)}
        >
          <div
            className="w-full max-w-[320px] rounded-2xl border border-mute/15 bg-panel p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rec/15 text-rec">
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
              className="w-full rounded-full bg-rec px-3.5 py-2.5 text-sm font-semibold text-paper active:scale-95"
            >
              Oke
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
