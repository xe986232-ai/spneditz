import { Image as ImageIcon, Video, Music, Search } from "lucide-react";
import { TEMPLATES } from "../data/templates";
import type { Template, SlotType } from "../types";

function slotCounts(template: Template) {
  const counts: Partial<Record<SlotType, number>> = {};
  for (const slot of template.slots) {
    counts[slot.type] = (counts[slot.type] ?? 0) + 1;
  }
  return counts;
}

const SLOT_ICON: Record<SlotType, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
};

function TemplateCard({
  template,
  onSelect,
}: {
  template: Template;
  onSelect: (t: Template) => void;
}) {
  const counts = slotCounts(template);

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
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        <span className="absolute right-2 top-2 rounded-full bg-graphite/70 px-2 py-0.5 text-[10px] font-medium text-paper">
          {template.duration}
        </span>

        {/* overlay bawah + info */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-2.5 pb-2 pt-8">
          <p className="truncate text-[13px] font-semibold text-paper">
            {template.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {(Object.keys(counts) as SlotType[]).map((type) => {
              const Icon = SLOT_ICON[type];
              return (
                <span
                  key={type}
                  className="flex items-center gap-0.5 text-[10px] text-paper/75"
                >
                  <Icon size={11} strokeWidth={2} />
                  {counts[type]}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* tombol Gunakan langsung di bawah card, selalu tampil */}
      <button
        onClick={() => onSelect(template)}
        className="w-full rounded-full bg-rec px-3.5 py-2 text-sm font-semibold text-paper shadow-sm active:scale-95"
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

      {/* Grid template — untuk sekarang cuma 1 template aktif, jadi
          1 kolom & dikasih max-width biar kartunya nggak melebar penuh */}
      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-4">
        {TEMPLATES.map((template) => (
          <div key={template.id} className="mx-auto w-full max-w-[280px]">
            <TemplateCard template={template} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </div>
  );
}
