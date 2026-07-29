# Video Editor (Placeholder UI)

Project React + Vite + Tailwind, tampilan awal editor video (canvas, timeline, toolbar) — tombol-tombol masih dummy, fungsinya menyusul.

## Jalankan di lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`.

## Build produksi

```bash
npm run build
npm run preview   # untuk cek hasil build
```

## Deploy ke Vercel

**Cara 1 — lewat CLI:**
```bash
npm install -g vercel
vercel
```
Ikuti prompt-nya, Vercel otomatis mendeteksi ini project Vite.

**Cara 2 — lewat dashboard Vercel:**
1. Push folder ini ke repo GitHub baru.
2. Buka [vercel.com/new](https://vercel.com/new), import repo tersebut.
3. Framework preset: pilih **Vite**. Build command `npm run build`, output directory `dist` (biasanya otomatis terdeteksi).
4. Klik **Deploy**.

## Struktur folder

```
video-editor/
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
└── src/
    ├── main.jsx     # entry point React
    ├── App.jsx      # komponen utama editor (UI placeholder)
    └── index.css    # Tailwind directives
```
