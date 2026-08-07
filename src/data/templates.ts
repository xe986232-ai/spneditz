import type { Template } from "../types";

// Dua template aktif untuk sekarang: iPhone Music Player (card solid
// hitam) & duplikatnya "iPhone Music Player Glass" (card kaca/liquid
// glass translucent, posisi & ukuran semua elemen identik dengan aslinya).
// Template lain (Reels Ceria, Minimal Duo, dst) dilepas dulu dari galeri
// sampai asset & mesin render masing-masing beneran siap.
export const TEMPLATES: Template[] = [
  {
    id: "iphone-music-player",
    name: "iPhone Music Player",
    // Durasi ini cuma acuan skala awal — begitu user upload audio, durasi
    // asli video otomatis ikut panjang audio itu (lihat src/lib/export.ts).
    duration: "0:15",
    gradientFrom: "#2C2C2E",
    gradientTo: "#0A0A0C",
    previewImage: "/templates/iphone-music-player/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    // Background polos gelap doang — dekorasinya (card, ikon, progress
    // bar, info lagu) sekarang dipisah jadi decorLayers di bawah, BUKAN
    // digabung jadi satu frame kayak sebelumnya. Ini biar tiap elemen bisa
    // diatur sendiri-sendiri (misalnya opacity card player).
    baseAssetSrc: "/templates/iphone-music-player/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player",
        assetSrc: "/templates/iphone-music-player/card.png",
        // "back" -> digambar SEBELUM foto sampul, jadi card ini di
        // BELAKANG foto (foto nempel di atas "lubang" gelap si card).
        order: "back",
        opacity: 100,
        // Cuma layer ini yang muncul di timeline & bisa diklik buat
        // diatur opacity-nya lewat slider di toolbar bawah.
        adjustable: true,
      },
      {
        id: "icon",
        label: "Ikon AirPlay",
        assetSrc: "/templates/iphone-music-player/icon.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        assetSrc: "/templates/iphone-music-player/progressbar.png",
        order: "front",
        // Track abu-abu statis ini cuma buat mode "bar" (drawProgressFill
        // isian di atasnya). Mode "waveform" gambar bar-nya dari nol
        // (drawWaveformProgress), jadi track ini harus disembunyikan biar
        // gak dobel/numpuk sama waveform-nya.
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        // Cuma tombol rewind/pause/fast-forward + slider volume — teksnya
        // (judul/artist/device) sudah dikosongin dari asset ini dari awal,
        // jadi aman ditumpuk sama textLayers (nggak dobel/bentrok).
        assetSrc: "/templates/iphone-music-player/musicplayer.png",
        order: "front",
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 13.89,
        y: 15,
        width: 72.22,
        height: 40.57,
        startSec: 0,
        endSec: 15,
        radius: 36,
        sampleSrc: "/templates/iphone-music-player/sample-cover.jpg",
      },
      {
        id: "audio1",
        type: "audio",
        label: "Musik latar",
        startSec: 0,
        endSec: 15,
      },
    ],
    // Teks yang bisa di-custom user lewat panel "Teks" di toolbar bawah.
    // Posisi & ukuran dalam persen/px skala canvas 1080x1920. musicplayer.png
    // yang lama sudah dikosongkan teksnya — sekarang teks ini yang gantiin,
    // jadi bisa di-custom, bukan lagi baked di gambar.
    // Posisi disamain ke layout referensi iOS media widget: rata kiri,
    // nempel rapi di bawah foto sampul — bukan lagi center & renggang.
    // x=13.8 dipilih biar sejajar sama tepi kiri progress bar (149/1080).
    textLayers: [
      {
        id: "device",
        label: "Nama device",
        defaultText: "iPhone",
        x: 13.8, // ≈149/1080, sejajar tepi kiri progress bar
        y: 59.4, // ≈1140/1920, digeser naik biar blok teks di tengah2
        // antara foto sampul (habis di ~1067) & progress bar (mulai ~1287)
        fontSize: 30,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 24,
      },
      {
        id: "title",
        label: "Judul",
        defaultText: "PLERRR",
        x: 13.8,
        y: 61.6, // ≈1182/1920, jarak ke baris atas dirapetin dikit
        fontSize: 48,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 30,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "@artist",
        x: 13.8,
        y: 63.6, // ≈1222/1920, jarak ke judul dirapetin dikit juga
        fontSize: 28,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
    ],
    // Label durasi berjalan (kiri) & total (kanan) — SELALU otomatis dari
    // playhead & panjang audio asli, dikunci (tidak masuk textLayers,
    // jadi tidak muncul di panel "Teks" dan tidak bisa diketik user).
    durationLayer: {
      currentX: 13.8, // ≈149/1080, sejajar tepi kiri progress bar
      currentY: 69.3, // ≈1330/1920, tepat di bawah garis progress bar
      totalX: 86.0, // ≈929/1080, sejajar tepi kanan progress bar
      totalY: 69.3,
      fontSize: 32,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
    },
    // Isian putih di atas progressbar.png (yang cuma track abu-abu diam) —
    // panjangnya otomatis ngikutin currentSec/DURATION, sama kayak
    // durationLayer. x1/x2/y disamain persis sama posisi progressbar.png
    // (149px–929px, tengah y≈1292px dari 1920) biar nempel pas di track-nya.
    progressLayer: {
      x1: 13.8, // ≈149/1080, sejajar ujung kiri progressbar.png
      x2: 86.02, // ≈929/1080, sejajar ujung kanan progressbar.png
      y: 67.29, // ≈1292/1920, tengah track progressbar.png
      thickness: 10,
      color: "#FFFFFF",
    },
  },
  {
    // Duplikat "iPhone Music Player" — SEMUA posisi/ukuran slot, teks,
    // progress, dsb PERSIS SAMA. Satu-satunya beda: card.png diganti versi
    // "liquid glass" (translucent/frosted, bukan solid hitam), jadi kartu
    // player terlihat kaca tembus pandang alih-alih blok hitam pekat.
    id: "iphone-music-player-glass",
    name: "iPhone Music Player Glass",
    duration: "0:15",
    gradientFrom: "#3A3A3E",
    gradientTo: "#0A0A0C",
    previewImage: "/templates/iphone-music-player-glass/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    baseAssetSrc: "/templates/iphone-music-player-glass/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player (Glass)",
        // assetSrc di sini cuma FALLBACK (dipakai kalau browser user
        // nggak dukung filter SVG di canvas — lihat liquidGlass.ts). Yang
        // dipakai normalnya adalah `liquidGlass` di bawah: card ini
        // dirender LIVE tiap frame, nembus & merefraksi apa pun yang ada
        // di background (bukan lagi PNG kaca yang diam/statis kayak
        // sebelumnya), pakai mesin yang sama persis dengan library
        // rdev/liquid-glass-react (lihat src/lib/liquidGlass.ts).
        assetSrc: "/templates/iphone-music-player-glass/card.png",
        order: "back",
        opacity: 100,
        adjustable: true,
        liquidGlass: {
          // Bbox & radius sudut identik dengan card.png original (biar
          // posisi cover/kontrol tetep pas), tapi sekarang ini beneran
          // kaca hidup, bukan gambar mati.
          x: 8.33,
          y: 11.875,
          width: 83.24,
          height: 76.15,
          cornerRadius: 72,
          settings: {
            mode: "standard",
            displacementScale: 70,
            blurAmount: 0.5,
            saturation: 140,
            aberrationIntensity: 2,
            overLight: false,
          },
        },
      },
      {
        id: "icon",
        label: "Ikon AirPlay",
        assetSrc: "/templates/iphone-music-player-glass/icon.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        assetSrc: "/templates/iphone-music-player-glass/progressbar.png",
        order: "front",
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        assetSrc: "/templates/iphone-music-player-glass/musicplayer.png",
        order: "front",
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 13.89,
        y: 15,
        width: 72.22,
        height: 40.57,
        startSec: 0,
        endSec: 15,
        radius: 36,
        sampleSrc: "/templates/iphone-music-player-glass/sample-cover.jpg",
      },
      {
        id: "audio1",
        type: "audio",
        label: "Musik latar",
        startSec: 0,
        endSec: 15,
      },
    ],
    textLayers: [
      {
        id: "device",
        label: "Nama device",
        defaultText: "iPhone",
        x: 13.8,
        y: 59.4,
        fontSize: 30,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 24,
      },
      {
        id: "title",
        label: "Judul",
        defaultText: "PLERRR",
        x: 13.8,
        y: 61.6,
        fontSize: 48,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 30,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "@artist",
        x: 13.8,
        y: 63.6,
        fontSize: 28,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
    ],
    durationLayer: {
      currentX: 13.8,
      currentY: 69.3,
      totalX: 86.0,
      totalY: 69.3,
      fontSize: 32,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
    },
    progressLayer: {
      x1: 13.8,
      x2: 86.02,
      y: 67.29,
      thickness: 10,
      color: "#FFFFFF",
    },
  },
  {
    // Template ketiga — "iPhone Music Player Cover". Beda struktur dari
    // dua template di atas: foto sampul jauh lebih besar/dominan (hampir
    // penuh lebar card), TANPA baris "nama device" (langsung judul+artist
    // di bawah sampul), ada ikon spectrum/equalizer kecil statis di kanan
    // baris judul, dan kontrol (rewind/pause/ff + volume) ditaruh
    // lebih ke bawah, terpisah jauh dari sampul. Semua posisi diukur dari
    // referensi screenshot user (video preview 1080x1920 penuh).
    id: "iphone-music-player-cover",
    name: "iPhone Music Player Cover",
    duration: "0:15",
    gradientFrom: "#2A2A2E",
    gradientTo: "#050506",
    previewImage: "/templates/iphone-music-player-cover/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    baseAssetSrc: "/templates/iphone-music-player-cover/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player",
        assetSrc: "/templates/iphone-music-player-cover/card.png",
        order: "back",
        opacity: 92,
        adjustable: true,
      },
      {
        id: "icon",
        label: "Ikon AirPlay",
        assetSrc: "/templates/iphone-music-player-cover/icon.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        assetSrc: "/templates/iphone-music-player-cover/progressbar.png",
        order: "front",
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        // Rewind/pause/ff + volume slider + ikon spectrum kecil di kanan
        // baris judul — semua statis, teks (judul/artist) dipisah jadi
        // textLayers biar bisa di-custom user.
        assetSrc: "/templates/iphone-music-player-cover/musicplayer.png",
        order: "front",
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 15.28,
        y: 12.5,
        width: 68.98,
        height: 37.76,
        startSec: 0,
        endSec: 15,
        radius: 48,
        sampleSrc: "/templates/iphone-music-player-cover/sample-cover.jpg",
      },
      {
        id: "audio1",
        type: "audio",
        label: "Musik latar",
        startSec: 0,
        endSec: 15,
      },
    ],
    // Cuma judul & artist — TIDAK ada layer "device" di template ini
    // (sesuai referensi: langsung judul, tanpa baris nama perangkat).
    textLayers: [
      {
        id: "title",
        label: "Judul",
        defaultText: "PLERRR",
        x: 15.28,
        y: 55.44,
        fontSize: 44,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 40,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "@artist",
        x: 15.28,
        y: 58.0,
        fontSize: 28,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 40,
      },
    ],
    durationLayer: {
      currentX: 15.28,
      currentY: 63.96,
      totalX: 84.26,
      totalY: 63.96,
      fontSize: 30,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
    },
    progressLayer: {
      x1: 15.28,
      x2: 84.26,
      y: 61.95,
      thickness: 10,
      color: "#FFFFFF",
    },
  },
];
