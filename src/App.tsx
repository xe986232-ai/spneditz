import { useEffect, useState } from "react";
import TemplateGallery from "./components/TemplateGallery";
import Editor from "./components/Editor";
import AdminDashboard from "./components/AdminDashboard";
import type { DiscordExportGateState } from "./components/DiscordExportGate";
import type { Template } from "./types";
import { TEMPLATES } from "./data/templates";
import {
  ensureCoverImagesSeeded,
  ensureGlassCoverImagesMigrated,
} from "./lib/coverImages";
import {
  readAndCleanQueryParam,
  readAndClearPendingWaveformExport,
} from "./lib/discordSession";

// Nama halaman dashboard sengaja dibikin susah ditebak — bukan link yang
// muncul di mana pun di UI, cuma bisa diakses kalau tau URL persisnya:
// https://domain-kamu/sawadikap
const DASHBOARD_PATH = "/sawadikap";

// State awal buat Editor pas app baru mount HASIL balik dari alur login
// Discord (lihat handleExport di Editor.tsx + lib/discordSession.ts). App
// ini sendiri TERBUKA BEBAS — Discord cuma diminta pas user pencet Export
// dengan gaya progress bar "Waveform berjalan".
type PendingEditorInit = {
  progressStyle: "waveform";
  gateState: DiscordExportGateState | null;
};

export default function App() {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [editorInit, setEditorInit] = useState<PendingEditorInit | null>(
    null,
  );
  // Diisi kalau user masuk Editor lewat tab "Draft Project" (lanjutin
  // project lama, bukan mulai baru dari galeri Template) — lihat
  // TemplateGallery.tsx & lib/drafts.ts.
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);

  // Sekali aja pas app pertama kali dibuka (di device siapa pun) — kalau
  // Firebase belum punya config/coverImages sama sekali, ke-seed otomatis
  // pakai DEFAULT_COVER_IMAGES. No-op kalau udah pernah ke-seed/diedit
  // admin. Lihat lib/coverImages.ts.
  useEffect(() => {
    ensureCoverImagesSeeded();
    // Migrasi sekali: benerin foto default template Glass yang sebelumnya
    // Unsplash-nya udah mati (balik jadi placeholder gradient) — lihat
    // ensureGlassCoverImagesMigrated di lib/coverImages.ts.
    ensureGlassCoverImagesMigrated();
  }, []);

  // OAuth Discord (api/discord-callback.ts) SELALU redirect balik ke "/",
  // jadi kalau tadi user lagi di Editor (pilih gaya "Waveform berjalan" lalu
  // pencet Export), state itu ilang begitu browser navigasi ulang. Di sini
  // kita pulihkan: baca template mana yang lagi dibuka (disimpen di
  // sessionStorage sebelum redirect) + baca query flag hasil callback, terus
  // langsung buka lagi ke Editor yang sama dengan gate Discord-nya kalau
  // masih perlu.
  useEffect(() => {
    const loginResult = readAndCleanQueryParam("discord_login");
    const notMember = readAndCleanQueryParam("discord_not_member");
    const hadError = readAndCleanQueryParam("discord_error");

    const pending = readAndClearPendingWaveformExport();
    if (!pending) return;

    const tpl = TEMPLATES.find((t) => t.id === pending.templateId);
    if (!tpl) return;

    setSelectedTemplate(tpl);
    setEditorInit({
      progressStyle: "waveform",
      gateState: notMember ? "not_member" : hadError ? "error" : null,
    });
    // loginResult === "success" -> sesi udah valid, gak perlu modal lagi,
    // user tinggal pencet Export sekali lagi dan langsung lolos.
    void loginResult;
  }, []);

  return window.location.pathname.replace(/\/+$/, "") === DASHBOARD_PATH ? (
    <AdminDashboard />
  ) : !selectedTemplate ? (
    <TemplateGallery
      onSelect={(template, draftId) => {
        setResumeDraftId(draftId ?? null);
        setSelectedTemplate(template);
      }}
    />
  ) : (
    <Editor
      template={selectedTemplate}
      onBack={() => {
        setSelectedTemplate(null);
        setEditorInit(null);
        setResumeDraftId(null);
      }}
      initialProgressStyle={editorInit?.progressStyle}
      initialDiscordGateState={editorInit?.gateState ?? null}
      resumeDraftId={resumeDraftId}
    />
  );
}

