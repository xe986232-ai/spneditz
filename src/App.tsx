import { useState } from "react";
import TemplateGallery from "./components/TemplateGallery";
import Editor from "./components/Editor";
import AdminDashboard from "./components/AdminDashboard";
import type { Template } from "./types";

// Nama halaman dashboard sengaja dibikin susah ditebak — bukan link yang
// muncul di mana pun di UI, cuma bisa diakses kalau tau URL persisnya:
// https://domain-kamu/sawadikap
const DASHBOARD_PATH = "/sawadikap";

export default function App() {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );

  if (window.location.pathname.replace(/\/+$/, "") === DASHBOARD_PATH) {
    return <AdminDashboard />;
  }

  if (!selectedTemplate) {
    return <TemplateGallery onSelect={setSelectedTemplate} />;
  }

  return (
    <Editor
      template={selectedTemplate}
      onBack={() => setSelectedTemplate(null)}
    />
  );
}
