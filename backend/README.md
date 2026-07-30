# Export Counter (backend)

Backend super simpel — cuma buat nyatet & liat **berapa kali orang berhasil
export video** di spneditz. Nggak ada login/akun user, nggak ada database
berat, cuma satu file JSON (`data.json`) yang otomatis dibuat pas server
jalan.

## Jalankan di lokal

```bash
cd backend
npm install
cp .env.example .env
# buka .env, ganti ADMIN_KEY ke kode rahasia sendiri
npm start
```

Server jalan di `http://localhost:3001`.

## Endpoint

- `POST /api/export-log` — dipanggil otomatis dari aplikasi editor tiap kali
  export selesai. Body: `{ "templateId": "iphone-music-player" }`. Publik
  (tanpa kode akses), tapi dibatasi rate-limit kasar per IP.
- `GET /stats?key=KODE_AKSES` — halaman HTML nampilin total export, per hari,
  per template. **Buka ini buat liat angkanya.**
- `GET /api/stats?key=KODE_AKSES` — sama kayak di atas tapi format JSON.

Ganti `KODE_AKSES` sesuai `ADMIN_KEY` yang kamu set di `.env`.

## Hubungkan ke frontend

Di project React (folder di luar `backend/`), bikin file `.env` (atau
`.env.production`) dengan isi:

```
VITE_EXPORT_LOG_URL=https://domain-backend-kamu.com/api/export-log
```

Kalau env ini nggak di-set, aplikasi tetap jalan normal — cuma nggak
ngirim catetan export sama sekali (aman dipakai pas development lokal
sebelum backend-nya di-deploy).

## Deploy

Backend ini nulis ke file lokal (`data.json`), jadi butuh hosting dengan
**disk yang persisten** antar-request (bukan serverless function yang
filesystem-nya sekali pakai/reset). Beberapa opsi gratis/murah yang cocok:

- **Railway** (railway.app) — paling gampang, `railway up` dari folder ini.
- **Render** (render.com) — pilih "Web Service", root directory `backend`,
  build command `npm install`, start command `npm start`.
- VPS murah apa aja (jalankan lewat `pm2` atau `systemd`).

⚠️ Kalau di-deploy ke platform serverless (Vercel/Netlify/dsb), `data.json`
akan ke-reset tiap deploy baru / bahkan tiap request, jadi jangan pakai
platform itu untuk backend ini kecuali diganti dulu ke database beneran.

Jangan lupa set environment variable `ADMIN_KEY` (dan `ALLOWED_ORIGIN` kalau
mau dibatasi cuma domain frontend kamu) di dashboard hosting-nya.
