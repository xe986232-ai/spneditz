/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: "#15171C",
        panel: "#1E2126",
        rec: "#E14C4C",
        paper: "#ECEAE4",
        mute: "#868C96",
        // Palet khusus UI Editor (desain baru) — dipisah dari palet lama
        // biar AdminDashboard/TemplateGallery nggak kena imbas.
        "editor-bg": "#0a0a0b",
        "editor-panel": "#0a0a0b",
        "editor-track": "#161618",
        "editor-accent": "#7c6cff",
        "editor-tag": "rgba(90,80,220,0.18)",
        "editor-muted": "#6b6b6b",
      },
    },
  },
  plugins: [],
};
