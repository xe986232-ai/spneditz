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
        // Token warna PERSIS dari repo Mock-up (src/styles.css, oklch) —
        // dipakai apa adanya buat komponen yang di-migrasi dari Mock-up
        // (mis. pill label track & menu titik tiga di timeline), BUKAN
        // diadaptasi ke palet editor-* di atas.
        "ed-bg": "oklch(0.06 0.005 285)",
        "ed-panel": "oklch(0.12 0.008 285)",
        "ed-card": "oklch(0.16 0.01 285)",
        "ed-card-2": "oklch(0.21 0.012 285)",
        "ed-line": "oklch(0.26 0.012 285)",
        "ed-text": "oklch(0.97 0 0)",
        "ed-dim": "oklch(0.68 0.01 285)",
        "ed-accent": "oklch(0.55 0.23 285)",
        "ed-accent-soft": "oklch(0.7 0.17 288)",
        "ed-teal": "oklch(0.75 0.13 180)",
      },
    },
  },
  plugins: [],
};
