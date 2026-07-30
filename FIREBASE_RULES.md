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
        ".read": false,
        ".write": true,
        ".validate": "newData.isNumber()"
      },
      "byDay": {
        "$day": {
          ".read": false,
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
- `byTemplate` sekarang `.read: true` → **publik boleh baca**, soalnya ini
  yang dipakai buat nampilin badge "X kali digunakan" di halaman pilih
  template. Nggak masalah dibuka karena isinya cuma angka pemakaian, bukan
  data sensitif.
- `.validate: "newData.isNumber()"` → mencegah orang iseng nulis nilai aneh
  (string, object, dll) ke path itu lewat DevTools/network tab.
- Root `.read/.write: false` → path lain di luar `exports` tertutup total.

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
