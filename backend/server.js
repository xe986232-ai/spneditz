// Backend super simpel: cuma nyatet tiap kali user berhasil export video,
// dan nampilin totalnya. Nggak ada login/akun user, nggak ada database berat
// — datanya disimpan di satu file JSON (data.json) di folder ini.

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3001;

// Kode akses buat liat halaman/stat-nya (BUKAN buat nyatet export — nyatet
// export tetap publik/tanpa key, soalnya itu yang dipanggil otomatis dari
// aplikasi editornya). Ganti ini lewat environment variable ADMIN_KEY pas
// deploy, jangan dibiarin pakai nilai default.
const ADMIN_KEY = process.env.ADMIN_KEY || "ganti-kode-ini";

// Origin yang boleh manggil endpoint /api/export-log dari browser (isi
// dengan domain frontend kamu pas sudah di-deploy, pisahkan koma kalau
// lebih dari satu). "*" dulu buat testing biar gampang.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { total: 0, byDay: {}, byTemplate: {}, recent: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { total: 0, byDay: {}, byTemplate: {}, recent: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// biar nulis file nggak tabrakan kalau ada 2 request barengan
let writeQueue = Promise.resolve();
function withLock(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
  }),
);

// Rate-limit kasar: 1 IP maksimal 20 catetan export per menit, biar nggak
// gampang di-spam biar angkanya nggak asal digedein orang iseng.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = hits.get(ip) ?? { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > 20;
}

function requireAdminKey(req, res, next) {
  const key = req.query.key || req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Kode akses salah atau kosong." });
  }
  next();
}

app.get("/", (_req, res) => {
  res.type("text").send("spneditz export counter — OK");
});

// Dipanggil dari frontend tiap kali export video BERHASIL selesai.
app.post("/api/export-log", (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip;
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Terlalu sering, coba lagi nanti." });
  }

  const templateId =
    typeof req.body?.templateId === "string"
      ? req.body.templateId.slice(0, 60)
      : "unknown";

  withLock(() => {
    const data = loadData();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    data.total += 1;
    data.byDay[today] = (data.byDay[today] || 0) + 1;
    data.byTemplate[templateId] = (data.byTemplate[templateId] || 0) + 1;
    data.recent.unshift({ ts: new Date().toISOString(), templateId });
    data.recent = data.recent.slice(0, 200); // simpan 200 event terakhir aja

    saveData(data);
  });

  res.status(204).end();
});

// Angka total dalam format JSON — dilindungi kode akses.
app.get("/api/stats", requireAdminKey, (_req, res) => {
  const data = loadData();
  res.json({
    total: data.total,
    byDay: data.byDay,
    byTemplate: data.byTemplate,
    recentCount: data.recent.length,
  });
});

// Halaman ringkas buat dibuka langsung di browser: /stats?key=KODE_AKSES
app.get("/stats", requireAdminKey, (_req, res) => {
  const data = loadData();
  const days = Object.entries(data.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const templates = Object.entries(data.byTemplate).sort((a, b) => b[1] - a[1]);

  res.send(`<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<title>Export Counter — spneditz</title>
<style>
  body { font-family: system-ui, sans-serif; background:#0c0d11; color:#ECEAE4; padding:2rem; max-width:640px; margin:0 auto; }
  h1 { font-size:1.1rem; color:#9aa0a6; font-weight:500; }
  .total { font-size:3rem; font-weight:700; margin:0.25rem 0 1.5rem; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  td, th { text-align:left; padding:0.4rem 0.6rem; border-bottom:1px solid #ffffff1a; }
  th { color:#9aa0a6; font-weight:500; }
</style>
</head>
<body>
  <h1>Total video di-export</h1>
  <div class="total">${data.total}</div>

  <table>
    <tr><th>Tanggal</th><th>Jumlah export</th></tr>
    ${days.map(([d, c]) => `<tr><td>${d}</td><td>${c}</td></tr>`).join("")}
  </table>

  <br/>

  <table>
    <tr><th>Template</th><th>Jumlah export</th></tr>
    ${templates.map(([t, c]) => `<tr><td>${t}</td><td>${c}</td></tr>`).join("")}
  </table>
</body>
</html>`);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Export counter jalan di http://localhost:${PORT}`);
});
