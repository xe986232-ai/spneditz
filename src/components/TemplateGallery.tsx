import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Search,
  Sparkles,
  ArrowRight,
  AudioWaveform,
  SlidersHorizontal,
  LayoutGrid,
  FolderClock,
  Trash2,
  Loader2,
  FilePlus2,
} from "lucide-react";
import { TEMPLATES } from "../data/templates";
import type { Template } from "../types";
import { subscribeTemplateUsage } from "../lib/exportLog";
import { subscribeTemplateEnabled } from "../lib/templateFlags";
import TemplateThumbnail, { ThumbnailSkeleton } from "./TemplateThumbnail";
import { renderTemplateThumbnail } from "../lib/thumbnail";
import {
  listDrafts,
  deleteDraft,
  MAX_DRAFTS,
  type DraftSummary,
} from "../lib/drafts";

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

// "5 menit lalu", "2 jam lalu", dst — dipakai buat label kapan draft
// terakhir di-auto-save.
function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

function DraftCard({
  draft,
  onResume,
  onDelete,
  busy,
}: {
  draft: DraftSummary;
  onResume: (draft: DraftSummary) => void;
  onDelete: (draft: DraftSummary) => void;
  busy: boolean;
}) {
  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-editor-panel text-left shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl ring-1 ring-inset ring-white/[0.06]" />
      <button
        onClick={() => onResume(draft)}
        disabled={busy}
        className="relative flex h-full flex-col overflow-hidden text-left transition active:scale-[0.97] disabled:opacity-60"
      >
        <div className="relative aspect-[9/16] w-full overflow-hidden bg-graphite">
          {draft.thumbnail ? (
            <img
              src={draft.thumbnail}
              alt={`Draft ${draft.templateName}`}
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-active:scale-105"
            />
          ) : (
            <ThumbnailSkeleton />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/15" />
          <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-editor-accent/50 bg-editor-panel/85 px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-editor-accent backdrop-blur-sm">
            <FolderClock size={9} strokeWidth={2.5} />
            Draft
          </span>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2.5 pt-10">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-paper">
              {draft.templateName}
            </p>
            <p className="mt-1 truncate text-[9.5px] text-editor-muted">
              {formatRelativeTime(draft.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-black/20 px-3 py-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-paper/85">
            Lanjutkan
          </span>
          <span className="flex h-6 items-center justify-center rounded-full bg-editor-accent px-2.5 text-[10px] font-semibold tracking-wide text-paper shadow-[0_2px_10px_rgba(124,108,255,0.5)] transition-transform duration-300 group-active:translate-x-0.5">
            Edit
          </span>
        </div>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(draft);
        }}
        disabled={busy}
        title="Hapus draft"
        aria-label="Hapus draft"
        className="absolute right-2.5 top-2.5 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/60 text-paper/80 backdrop-blur-sm transition hover:text-rec active:scale-90 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Trash2 size={12} />
        )}
      </button>
    </div>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: Template;
  onSelect: (t: Template) => void;
}) {
  // Jumlah "X kali digunakan" — dengerin real-time dari Firebase Realtime
  // Database, di-update otomatis tiap ada export baru (nggak perlu refresh).
  const [usageCount, setUsageCount] = useState<number | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeTemplateUsage(template.id, setUsageCount);
    return unsubscribe;
  }, [template.id]);

  function handleClick() {
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
              className="transition duration-500 group-active:scale-105"
            />
          ) : (
            <TemplateThumbnail
              template={template}
              alt={`Preview ${template.name}`}
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-active:scale-105"
            />
          )}

          {/* vignette halus biar teks & badge kebaca di semua foto */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/15" />

          {/* badge "2 Gaya Progress" — cuma di kartu bergaya kolase */}
          {isCollageStyle && (
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
          <span className="text-[11px] font-semibold tracking-wide text-paper/85">
            Gunakan
          </span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-editor-accent text-paper shadow-[0_2px_10px_rgba(124,108,255,0.5)] transition-transform duration-300 group-active:translate-x-0.5">
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
  /** draftId diisi kalau user melanjutkan draft lama dari tab "Draft" —
   *  Editor bakal hydrate semua state project-nya dari draft itu. Kosong
   *  (undefined) = project baru dari template polos seperti biasa. */
  onSelect: (template: Template, draftId?: string) => void;
}) {
  // Set berisi id template yang lagi DINONAKTIFIN dari dashboard admin
  // (config/templates/{id}/enabled === false). Template yang ada di sini
  // langsung di-hide total dari galeri, bukan cuma digrayscale kayak
  // sebelumnya — dengerin real-time per template biar begitu admin
  // matiin/nyalain lewat dashboard, daftar di sini ikut update otomatis
  // tanpa perlu refresh.
  const [disabledTemplateIds, setDisabledTemplateIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const unsubscribes = TEMPLATES.map((template) =>
      subscribeTemplateEnabled(template.id, (enabled) => {
        setDisabledTemplateIds((prev) => {
          const alreadyDisabled = prev.has(template.id);
          if (enabled === !alreadyDisabled) return prev; // no change, skip re-render
          const next = new Set(prev);
          if (enabled) next.delete(template.id);
          else next.add(template.id);
          return next;
        });
      }),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);
  const visibleTemplates = useMemo(
    () => TEMPLATES.filter((t) => !disabledTemplateIds.has(t.id)),
    [disabledTemplateIds],
  );

  // Tab bawah: "draft" (default — daftar project yang lagi dikerjain,
  // auto-tersimpan, lihat lib/drafts.ts) atau "template" (galeri).
  // Default-nya "draft" biar tiap buka web / keluar dari Editor, user
  // langsung diarahin ke project lama dulu, bukan galeri template.
  const [activeTab, setActiveTab] = useState<"draft" | "template">(
    "draft",
  );
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null);

  function refreshDrafts() {
    setDraftsLoading(true);
    listDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]))
      .finally(() => setDraftsLoading(false));
  }

  // Muat daftar draft begitu tab-nya dibuka (bukan langsung pas app mount,
  // biar gak nunggu IndexedDB kalau usernya emang mau pilih Template aja).
  useEffect(() => {
    if (activeTab !== "draft") return;
    refreshDrafts();
  }, [activeTab]);

  function handleResumeDraft(draft: DraftSummary) {
    const template = TEMPLATES.find((t) => t.id === draft.templateId);
    if (!template || disabledTemplateIds.has(template.id)) {
      // Template sumber draft ini udah gak ada lagi di daftar (mis. sudah
      // dihapus dari katalog) ATAU lagi dinonaktifin admin — daripada
      // nyangkut, draft-nya dianggap tidak bisa dilanjutkan.
      window.alert(
        !template
          ? "Template untuk draft ini sudah tidak tersedia lagi. Draft akan dihapus."
          : "Template untuk draft ini lagi dinonaktifkan sementara. Draft akan dihapus.",
      );
      void deleteDraft(draft.id).then(refreshDrafts);
      return;
    }
    onSelect(template, draft.id);
  }

  async function handleDeleteDraft(draft: DraftSummary) {
    if (draftBusyId) return;
    if (!window.confirm(`Hapus draft "${draft.templateName}"? Tidak bisa dibatalkan.`)) {
      return;
    }
    setDraftBusyId(draft.id);
    try {
      await deleteDraft(draft.id);
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } finally {
      setDraftBusyId(null);
    }
  }

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
              {activeTab === "draft" ? "Draft Project" : "Pilih Template"}
            </h1>
            <p className="mt-0.5 text-xs text-editor-muted">
              {activeTab === "draft"
                ? "Auto-tersimpan, tinggal lanjutin kapan aja"
                : "Tinggal isi foto & audio, sisanya udah beres"}
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

      {activeTab === "template" ? (
        /* Grid template — dua berbanjar (2 kolom). Cuma template yang
           masih AKTIF (bukan config/templates/{id}/enabled === false)
           yang dirender di sini. */
        <div className="relative grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 pb-2">
          {visibleTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        /* Daftar Draft Project — maksimal MAX_DRAFTS item, auto-save dari
           Editor (lihat lib/drafts.ts), diurutkan terbaru diubah duluan. */
        <div className="relative flex-1 overflow-y-auto p-4 pb-2">
          {draftsLoading ? (
            <div className="flex h-full items-center justify-center text-editor-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06]">
                <FilePlus2 size={20} className="text-editor-muted" />
              </div>
              <p className="text-sm font-semibold text-paper">
                Belum ada draft
              </p>
              <p className="text-xs leading-relaxed text-editor-muted">
                Mulai project dari tab Template — perubahannya bakal
                ke-auto-save di sini, sampai maksimal {MAX_DRAFTS} project
                sekaligus.
              </p>
              <button
                onClick={() => setActiveTab("template")}
                className="mt-1 rounded-full bg-editor-accent px-4 py-2 text-xs font-semibold text-paper shadow-[0_4px_16px_rgba(124,108,255,0.4)] transition hover:brightness-110 active:scale-[0.98]"
              >
                Pilih Template
              </button>
            </div>
          ) : (
            <div className="grid auto-rows-min grid-cols-2 gap-3">
              {drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onResume={handleResumeDraft}
                  onDelete={handleDeleteDraft}
                  busy={draftBusyId === draft.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab bar bawah — Draft (kiri) & Template (kanan), fixed nempel di
          bawah layar, pola visual sama persis header (bg-editor-panel/80,
          border-white/5, backdrop-blur) biar konsisten satu identitas. */}
      <div className="relative z-30 flex shrink-0 items-center gap-2 border-t border-white/5 bg-editor-panel/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          onClick={() => setActiveTab("draft")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold tracking-wide transition active:scale-[0.97] ${
            activeTab === "draft"
              ? "bg-editor-accent text-paper shadow-[0_2px_12px_rgba(124,108,255,0.45)]"
              : "text-editor-muted hover:text-paper"
          }`}
        >
          <FolderClock size={15} />
          Draft Project
        </button>
        <button
          onClick={() => setActiveTab("template")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold tracking-wide transition active:scale-[0.97] ${
            activeTab === "template"
              ? "bg-editor-accent text-paper shadow-[0_2px_12px_rgba(124,108,255,0.45)]"
              : "text-editor-muted hover:text-paper"
          }`}
        >
          <LayoutGrid size={15} />
          Template
        </button>
      </div>

      {/* Modal alert "Template belum bisa dipakai" udah dibuang — sekarang
          template yang lagi off langsung di-hide total dari grid di atas,
          jadi user gak akan pernah bisa nge-tap template yang nonaktif. */}
    </div>
  );
}
