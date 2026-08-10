import { useEffect, useState } from "react";
import TemplateGallery from "./components/TemplateGallery";
import Editor from "./components/Editor";
import AdminDashboard from "./components/AdminDashboard";
import DiscordGate from "./components/DiscordGate";
import type { Template } from "./types";
import {
  ensureCoverImagesSeeded,
  ensureGlassCoverImagesMigrated,
} from "./lib/coverImages";

// Nama halaman dashboard sengaja dibikin susah ditebak — bukan link yang
// muncul di mana pun di UI, cuma bisa diakses kalau tau URL persisnya:
// https://domain-kamu/sawadikap
const DASHBOARD_PATH = "/sawadikap";

export default function App() {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );

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

  return (
    <DiscordGate>
      {window.location.pathname.replace(/\/+$/, "") === DASHBOARD_PATH ? (
        <AdminDashboard />
      ) : !selectedTemplate ? (
        <TemplateGallery onSelect={setSelectedTemplate} />
      ) : (
        <Editor
          template={selectedTemplate}
          onBack={() => setSelectedTemplate(null)}
        />
      )}
    </DiscordGate>
  );
}
