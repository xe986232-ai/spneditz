import { useEffect, useState } from "react";
import { ref, onValue, off, update } from "firebase/database";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { db } from "../lib/firebase";

// Password ringan buat buka dashboard ini — BUKAN pengaman kelas berat
// (nggak pakai Firebase Auth), cuma penghalang tambahan di atas nama
// halamannya yang udah sengaja dibikin susah ditebak ("/sawadikap").
// Ganti nilainya sendiri kapan aja kalau mau.
const DASHBOARD_PASSWORD = "wiwok-sawadikap-88";

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
  const [waveformEnabled, setWaveformEnabledState] = useState<boolean | null>(
    null,
  );
  const [savingFlag, setSavingFlag] = useState(false);

  useEffect(() => {
    if (!unlocked) return;

    const exportsRef = ref(db, "exports");
    const flagRef = ref(db, "config/waveformEnabled");

    const unsubExports = onValue(exportsRef, (snapshot) => {
      const val = snapshot.val() ?? {};
      setData({
        total: typeof val.total === "number" ? val.total : 0,
        byDay: val.byDay ?? {},
        byTemplate: val.byTemplate ?? {},
      });
    });

    const unsubFlag = onValue(flagRef, (snapshot) => {
      setWaveformEnabledState(snapshot.val() === true);
    });

    return () => {
      off(exportsRef, "value", unsubExports);
      off(flagRef, "value", unsubFlag);
    };
  }, [unlocked]);

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInput === DASHBOARD_PASSWORD) {
      setUnlocked(true);
      setWrongPassword(false);
    } else {
      setWrongPassword(true);
    }
  }

  async function toggleWaveformPremium() {
    if (waveformEnabled === null) return;
    setSavingFlag(true);
    try {
      await update(ref(db), {
        "config/waveformEnabled": !waveformEnabled,
      });
    } finally {
      setSavingFlag(false);
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

        {/* Toggle badge Premium */}
        <div className="mb-4 rounded-2xl border border-mute/15 bg-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Gaya "Waveform berjalan"</p>
              <p className="mt-0.5 text-xs text-mute">
                {waveformEnabled === null
                  ? "Memuat status…"
                  : waveformEnabled
                    ? "Aktif — semua orang boleh pakai, badge Premium hilang."
                    : "Terkunci — muncul badge Premium di editor."}
              </p>
            </div>
            <button
              onClick={toggleWaveformPremium}
              disabled={waveformEnabled === null || savingFlag}
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                waveformEnabled ? "bg-emerald-500" : "bg-mute/30"
              } ${savingFlag ? "opacity-50" : ""}`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  waveformEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
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
