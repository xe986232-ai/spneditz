import { useEffect, useState } from "react";
import { ref, onValue, off } from "firebase/database";
import { Lock, Eye, EyeOff, ShieldCheck, ImagePlus, Trash2 } from "lucide-react";
import { db } from "../lib/firebase";
import { TEMPLATES } from "../data/templates";
import { subscribeTemplateEnabled, setTemplateEnabled } from "../lib/templateFlags";
import {
  subscribeCoverImages,
  addCoverImage,
  removeCoverImage,
  type CoverImageEntry,
} from "../lib/coverImages";

// Password ringan buat buka dashboard ini — BUKAN pengaman kelas berat
// (nggak pakai Firebase Auth), cuma penghalang tambahan di atas nama
// halamannya yang udah sengaja dibikin susah ditebak ("/sawadikap").
// Ganti nilainya sendiri kapan aja kalau mau.
const DASHBOARD_PASSWORD = "p";

interface ExportsData {
  total: number;
  byDay: Record<string, number>;
  byTemplate: Record<string, number>;
}

export default function AdminDashboard() {
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);

  const [data, setData] = useState<ExportsData | null>(null);

  // Status aktif/nonaktif tiap template, key-nya template.id. null = masih
  // dimuat. Dipakai buat toggle di panel "Kelola Template" di bawah.
  const [templateEnabledMap, setTemplateEnabledMap] = useState<
    Record<string, boolean | null>
  >({});
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(
    null,
  );

  // Daftar foto default (Unsplash) tiap template, key-nya template.id.
  // Dipakai buat panel "Foto Default (Unsplash)" di bawah.
  const [coverImagesMap, setCoverImagesMap] = useState<
    Record<string, CoverImageEntry[]>
  >({});
  const [coverFormTemplateId, setCoverFormTemplateId] = useState<
    string | null
  >(null);
  const [coverFormUrl, setCoverFormUrl] = useState("");
  const [coverFormCredit, setCoverFormCredit] = useState("");
  const [coverFormError, setCoverFormError] = useState<string | null>(null);
  const [savingCover, setSavingCover] = useState(false);
  const [removingCoverId, setRemovingCoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!unlocked) return;

    const exportsRef = ref(db, "exports");

    const unsubExports = onValue(exportsRef, (snapshot) => {
      const val = snapshot.val() ?? {};
      setData({
        total: typeof val.total === "number" ? val.total : 0,
        byDay: val.byDay ?? {},
        byTemplate: val.byTemplate ?? {},
      });
    });

    return () => {
      off(exportsRef, "value", unsubExports);
    };
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;

    // Satu listener per template — dengerin real-time biar kalau diubah
    // dari device/tab lain, dashboard ini ikut update juga.
    const unsubs = TEMPLATES.map((t) =>
      subscribeTemplateEnabled(t.id, (enabled) => {
        setTemplateEnabledMap((prev) => ({ ...prev, [t.id]: enabled }));
      }),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;

    const unsubs = TEMPLATES.map((t) =>
      subscribeCoverImages(t.id, (entries) => {
        setCoverImagesMap((prev) => ({ ...prev, [t.id]: entries }));
      }),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [unlocked]);

  async function handleAddCoverImage(e: React.FormEvent) {
    e.preventDefault();
    if (!coverFormTemplateId) return;
    const url = coverFormUrl.trim();
    if (!url) {
      setCoverFormError("URL foto belum diisi.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setCoverFormError("URL-nya gak valid.");
      return;
    }
    if (parsed.protocol !== "https:") {
      setCoverFormError("URL harus https://.");
      return;
    }
    setCoverFormError(null);
    setSavingCover(true);
    try {
      await addCoverImage(coverFormTemplateId, {
        url,
        thumbUrl: url,
        credit: coverFormCredit.trim() || undefined,
      });
      setCoverFormUrl("");
      setCoverFormCredit("");
    } catch (err) {
      setCoverFormError(
        err instanceof Error ? err.message : "Gagal nambahin foto.",
      );
    } finally {
      setSavingCover(false);
    }
  }

  async function handleRemoveCoverImage(templateId: string, entryId: string) {
    setRemovingCoverId(entryId);
    try {
      await removeCoverImage(templateId, entryId);
    } finally {
      setRemovingCoverId(null);
    }
  }

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInput === DASHBOARD_PASSWORD) {
      setUnlocked(true);
      setWrongPassword(false);
    } else {
      setWrongPassword(true);
    }
  }

  async function toggleTemplateEnabled(templateId: string) {
    const current = templateEnabledMap[templateId];
    if (current === null || current === undefined) return;
    setSavingTemplateId(templateId);
    try {
      await setTemplateEnabled(templateId, !current);
    } finally {
      setSavingTemplateId(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-graphite px-6 font-sans">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-[320px] rounded-2xl border border-mute/15 bg-panel p-6"
        >
          <div className="mb-4 flex items-center gap-2 text-paper">
            <Lock size={18} />
            <h1 className="text-base font-semibold">Dashboard Terkunci</h1>
          </div>
          <div className="relative mb-3">
            <input
              type={showPassword ? "text" : "password"}
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setWrongPassword(false);
              }}
              placeholder="Masukkan password"
              autoFocus
              className="w-full rounded-lg border border-mute/20 bg-graphite px-3 py-2.5 pr-10 text-sm text-paper outline-none focus:border-paper/40"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mute"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {wrongPassword && (
            <p className="mb-3 text-xs text-red-400">Password salah, coba lagi.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-full bg-rec px-3.5 py-2.5 text-sm font-semibold text-paper active:scale-95"
          >
            Buka
          </button>
        </form>
      </div>
    );
  }

  const byDayEntries = Object.entries(data?.byDay ?? {}).sort((a, b) =>
    a[0] < b[0] ? 1 : -1,
  );
  const byTemplateEntries = Object.entries(data?.byTemplate ?? {}).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="min-h-[100dvh] w-screen bg-graphite px-4 py-6 font-sans text-paper">
      <div className="mx-auto max-w-[520px]">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck size={20} className="text-emerald-400" />
          <h1 className="text-lg font-semibold">Dashboard — spneditz</h1>
        </div>

        {/* Total export */}
        <div className="mb-4 rounded-2xl border border-mute/15 bg-panel p-5">
          <p className="text-xs text-mute">Total video di-export</p>
          <p className="mt-1 text-4xl font-bold">
            {data ? data.total.toLocaleString("id-ID") : "…"}
          </p>
        </div>

        {/* Kelola Template — nyala/matiin tiap template satu-satu */}
        <div className="mb-4 rounded-2xl border border-mute/15 bg-panel p-5">
          <p className="mb-1 text-sm font-semibold">Kelola Template</p>
          <p className="mb-3 text-xs text-mute">
            Template yang dinonaktifkan tetap muncul di galeri, tapi tombol
            "Gunakan" bakal munculin alert (nggak lanjut ke editor).
          </p>
          <div className="flex flex-col gap-3">
            {TEMPLATES.map((t) => {
              const enabled = templateEnabledMap[t.id];
              const saving = savingTemplateId === t.id;
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 border-t border-mute/10 pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="mt-0.5 text-xs text-mute">
                      {enabled === undefined || enabled === null
                        ? "Memuat status…"
                        : enabled
                          ? "Aktif — bisa dipakai di galeri."
                          : "Nonaktif — tombol \"Gunakan\" munculin alert."}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleTemplateEnabled(t.id)}
                    disabled={
                      enabled === undefined || enabled === null || saving
                    }
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                      enabled ? "bg-emerald-500" : "bg-mute/30"
                    } ${saving ? "opacity-50" : ""}`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Foto Default (Unsplash) — foto yang otomatis ngisi slot sampul
            (jadi background juga) sebelum user upload foto sendiri. Per
            template, minimal biarin 1 foto biar slot gak kosong. */}
        <div className="mb-4 rounded-2xl border border-mute/15 bg-panel p-5">
          <p className="mb-1 text-sm font-semibold">Foto Default (Unsplash)</p>
          <p className="mb-3 text-xs text-mute">
            Foto-foto ini yang otomatis ngisi slot sampul & background
            sebelum user upload foto sendiri — beda-beda per template, satu
            dipilih acak tiap kali editor dibuka.
          </p>
          <div className="flex flex-col gap-4">
            {TEMPLATES.map((t) => {
              const entries = coverImagesMap[t.id];
              const formOpen = coverFormTemplateId === t.id;
              return (
                <div
                  key={t.id}
                  className="border-t border-mute/10 pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="mb-2 text-sm font-medium">{t.name}</p>
                  {entries === undefined ? (
                    <p className="text-xs text-mute">Memuat…</p>
                  ) : entries.length === 0 ? (
                    <p className="text-xs text-mute">Belum ada foto.</p>
                  ) : (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {entries.map((entry) => (
                        <div key={entry.id} className="group relative">
                          <img
                            src={entry.thumbUrl}
                            alt={entry.credit ?? "Foto default"}
                            className="h-14 w-14 rounded-lg border border-mute/15 object-cover"
                          />
                          <button
                            onClick={() => handleRemoveCoverImage(t.id, entry.id)}
                            disabled={removingCoverId === entry.id}
                            title={
                              entry.credit
                                ? `Hapus foto by ${entry.credit}`
                                : "Hapus foto"
                            }
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {formOpen ? (
                    <form
                      onSubmit={handleAddCoverImage}
                      className="flex flex-col gap-2 rounded-lg border border-mute/15 bg-graphite/40 p-3"
                    >
                      <input
                        type="url"
                        required
                        value={coverFormUrl}
                        onChange={(e) => setCoverFormUrl(e.target.value)}
                        placeholder="https://images.unsplash.com/photo-..."
                        className="w-full rounded-lg border border-mute/20 bg-graphite px-2.5 py-2 text-xs text-paper outline-none focus:border-paper/40"
                      />
                      <input
                        type="text"
                        value={coverFormCredit}
                        onChange={(e) => setCoverFormCredit(e.target.value)}
                        placeholder="Nama fotografer (opsional)"
                        className="w-full rounded-lg border border-mute/20 bg-graphite px-2.5 py-2 text-xs text-paper outline-none focus:border-paper/40"
                      />
                      {coverFormError && (
                        <p className="text-xs text-red-400">{coverFormError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={savingCover}
                          className="flex-1 rounded-full bg-paper px-3 py-2 text-xs font-semibold text-graphite active:scale-95 disabled:opacity-50"
                        >
                          {savingCover ? "Nyimpen…" : "Tambah"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCoverFormTemplateId(null);
                            setCoverFormError(null);
                          }}
                          className="rounded-full border border-mute/20 px-3 py-2 text-xs text-mute"
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => {
                        setCoverFormTemplateId(t.id);
                        setCoverFormUrl("");
                        setCoverFormCredit("");
                        setCoverFormError(null);
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium text-mute transition hover:text-paper"
                    >
                      <ImagePlus size={13} />
                      Tambah foto
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Per hari */}
        <div className="mb-4 rounded-2xl border border-mute/15 bg-panel p-5">
          <p className="mb-3 text-sm font-semibold">Export per hari</p>
          <table className="w-full text-sm">
            <tbody>
              {byDayEntries.length === 0 && (
                <tr>
                  <td className="py-1 text-mute">Belum ada data.</td>
                </tr>
              )}
              {byDayEntries.map(([day, count]) => (
                <tr key={day} className="border-t border-mute/10">
                  <td className="py-1.5 text-mute">{day}</td>
                  <td className="py-1.5 text-right font-medium">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per template */}
        <div className="rounded-2xl border border-mute/15 bg-panel p-5">
          <p className="mb-3 text-sm font-semibold">Export per template</p>
          <table className="w-full text-sm">
            <tbody>
              {byTemplateEntries.length === 0 && (
                <tr>
                  <td className="py-1 text-mute">Belum ada data.</td>
                </tr>
              )}
              {byTemplateEntries.map(([id, count]) => (
                <tr key={id} className="border-t border-mute/10">
                  <td className="py-1.5 text-mute">{id}</td>
                  <td className="py-1.5 text-right font-medium">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
