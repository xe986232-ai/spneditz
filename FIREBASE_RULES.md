# Firebase Realtime Database — Security Rules

Data export counter ditulis ke path `exports/...` (lihat `src/lib/exportLog.ts`).
Supaya ini beneran bisa kekirim, dan angka **"X kali digunakan"** bisa
ditampilin di halaman pilih template, set rules di **Firebase Console →
Realtime Database → Rules** ke:

```json
{
  "rules": {
    "exports": {
      "total": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isNumber()"
      },
      "byDay": {
        "$day": {
          ".read": true,
          ".write": true,
          ".validate": "newData.isNumber()"
        }
      },
      "byTemplate": {
        "$templateId": {
          ".read": true,
          ".write": true,
          ".validate": "newData.isNumber()"
        }
      }
    },
    "config": {
      "waveformEnabled": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isBoolean()"
      },
      "templates": {
        "$templateId": {
          "enabled": {
            ".read": true,
            ".write": true,
            ".validate": "newData.isBoolean()"
          }
        }
      }
    },
    ".read": false,
    ".write": false
  }
}
```

Kenapa gini:

- `.write: true` di dalam `exports/...` → aplikasi (siapa aja yang buka web-nya)
  boleh nambah angka counter, tanpa perlu login.
- `total` & `byDay` tetap `.read: false` → cuma kamu yang bisa lihat lewat
  Firebase Console (owner project otomatis bypass rules).
- `total` & `byDay` sekarang **`.read: true`** juga → supaya dashboard admin
  (`/sawadikap`) bisa nampilin angkanya. Konsekuensinya: siapa pun yang tau
  config Firebase kamu (yang memang sudah publik di kode frontend) juga
  bisa baca angka ini langsung lewat REST API, di luar dashboard. Untuk
  kebutuhan "sekadar liat jumlah export" ini oke — datanya nggak sensitif.
- `byTemplate` tetap `.read: true` → dipakai juga buat badge "X kali
  digunakan" di halaman pilih template.
- `config/waveformEnabled` sekarang **`.write: true`** juga → supaya toggle
  di dashboard admin beneran nyimpen ke database. Karena Realtime Database
  Rules nggak tau "siapa yang mengetik dari halaman /sawadikap dengan
  password yang benar" (itu cuma pengecekan di sisi aplikasi/JS, bukan di
  Rules), siapa pun yang tau URL Firebase kamu **secara teknis** bisa nulis
  ke path ini langsung tanpa lewat dashboard/password sama sekali.
  Password & nama halaman yang susah ditebak (`/sawadikap`) di sini
  fungsinya cuma "penghalang casual" (security by obscurity), BUKAN
  proteksi yang kuat. Kalau nanti butuh beneran aman, perlu ditambah
  Firebase Authentication + rule `auth != null` (bisa dibantu kalau mau).
- `config/templates/$templateId/enabled` sama kayak `waveformEnabled` di
  atas (`.write: true`, batas keamanannya sama juga) — dipakai buat
  nyala/matiin tiap template satu-satu lewat panel "Kelola Template" di
  dashboard admin. Kalau `enabled` di-set `false`, template itu tetap
  muncul di galeri (biar nggak bikin bingung "kok hilang") tapi tombol
  "Gunakan"-nya munculin alert, bukan lanjut ke editor. Kalau path ini
  belum pernah di-set sama sekali (belum pernah disentuh dari dashboard),
  aplikasi nganggep template itu AKTIF (fail-open) — jadi template baru
  otomatis kepake tanpa perlu di-toggle manual dulu.
- `.validate: "newData.isNumber()"` → mencegah orang iseng nulis nilai aneh
  (string, object, dll) ke path itu lewat DevTools/network tab.
- Root `.read/.write: false` → path lain di luar `exports`/`config` tertutup
  total.

## Dashboard admin

Buka `https://domain-kamu/sawadikap` (ganti `domain-kamu` sesuai domain
deploy-nya), masukin password (di kode: `src/components/AdminDashboard.tsx`,
konstanta `DASHBOARD_PASSWORD` — **ganti sendiri** ke password pilihan
kamu). Di situ kamu bisa:

- Lihat total export & breakdown per hari/template.
- Toggle badge Premium buat gaya "Waveform berjalan" (nyalain =
  `config/waveformEnabled` jadi `true`, semua orang boleh pakai).
- Nyala/matiin tiap template lewat panel "Kelola Template" — kalau
  dimatiin, template tetap kelihatan di galeri (ditandai badge "Nonaktif" +
  gambar jadi grayscale) tapi tombol "Gunakan" munculin alert modal,
  bukan lanjut buka editor.

Baca catatan soal batas keamanan pendekatan ini di bagian atas file ini.

## Cara liat angkanya

Buka [Firebase Console](https://console.firebase.google.com/) → pilih project
**wiwok-c9f4b** → menu **Realtime Database** → tab **Data**. Kamu akan lihat
struktur:

```
exports/
  total: 42
  byDay/
    2026-07-30: 5
  byTemplate/
    iphone-music-player: 42
```

## Catatan

- Rules di atas cuma pakai `newData.isNumber()`, jadi teknisnya orang iseng
  masih bisa ngirim increment sembarangan lewat DevTools kalau tau path-nya
  (nggak ada auth). Ini wajar buat kebutuhan "sekadar liat jumlah export" —
  kalau nanti butuh lebih ketat (misal harus login dulu), bisa ditambah
  Firebase Authentication + rule `auth != null`.
