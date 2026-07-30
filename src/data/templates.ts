import type { Template } from "../types";

// Hanya satu template yang aktif untuk sekarang: iPhone Music Player.
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
];
