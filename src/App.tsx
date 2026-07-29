import { useState } from "react";
import TemplateGallery from "./components/TemplateGallery";
import Editor from "./components/Editor";
import type { Template } from "./types";

export default function App() {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );

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
