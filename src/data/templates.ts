import type { Template } from "../types";

// Placeholder — nanti diganti video hasil render asli tiap template.
// (Big Buck Bunny, CC-BY, cuma buat contoh video preview-nya jalan)
const PLACEHOLDER_PREVIEW =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

export const TEMPLATES: Template[] = [
  {
    id: "ceria-3foto",
    name: "Reels Ceria",
    duration: "0:15",
    gradientFrom: "#FF9A5A",
    gradientTo: "#E14C4C",
    previewSrc: PLACEHOLDER_PREVIEW,
    // Template AKTIF dengan asset & mesin render beneran — sisanya di
    // bawah masih placeholder gradient (belum dikerjain, giliran berikut).
    canvasWidth: 1080,
    canvasHeight: 1920,
    // Background dasar template: foto asli (bukan gradient kode), diambil
    // dari internet (Picsum -> sumber foto Unsplash). Nanti gampang
    // diganti ke asset desain sendiri, tinggal ganti string URL ini.
    baseAssetSrc: "https://picsum.photos/id/1043/1080/1920",
    baseAssetType: "image",
    slots: [
      {
        id: "img1",
        type: "image",
        label: "Foto 1",
        x: 7.4,
        y: 7.3,
        width: 85.2,
        height: 29.2,
        startSec: 0,
        endSec: 5,
        radius: 24,
        sampleSrc: "https://picsum.photos/id/1015/920/560",
      },
      {
        id: "img2",
        type: "image",
        label: "Foto 2",
        x: 7.4,
        y: 38.5,
        width: 85.2,
        height: 29.2,
        startSec: 5,
        endSec: 10,
        radius: 24,
        sampleSrc: "https://picsum.photos/id/1016/920/560",
      },
      {
        id: "img3",
        type: "image",
        label: "Foto 3",
        x: 7.4,
        y: 69.8,
        width: 85.2,
        height: 24.0,
        startSec: 10,
        endSec: 15,
        radius: 24,
        sampleSrc: "https://picsum.photos/id/1018/920/460",
      },
      {
        id: "audio1",
        type: "audio",
        label: "Musik latar",
        startSec: 0,
        endSec: 15,
      },
    ],
  },
  {
    id: "iphone-music-player",
    name: "iPhone Music Player",
    // Durasi ini cuma acuan skala awal — begitu user upload audio, durasi
    // asli video otomatis ikut panjang audio itu (lihat src/lib/export.ts).
    duration: "0:15",
    gradientFrom: "#2C2C2E",
    gradientTo: "#0A0A0C",
    previewSrc: PLACEHOLDER_PREVIEW,
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
    id: "minimal-2foto",
    name: "Minimal Duo",
    duration: "0:10",
    gradientFrom: "#8E9AAF", 
    gradientTo: "#3A3F4B",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "img1", type: "image", label: "Foto 1" },
      { id: "img2", type: "image", label: "Foto 2" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
  {
    id: "produk-4foto",
    name: "Katalog Produk",
    duration: "0:20",
    gradientFrom: "#5AC8A8",
    gradientTo: "#1E6E5C",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "img1", type: "image", label: "Foto produk 1" },
      { id: "img2", type: "image", label: "Foto produk 2" },
      { id: "img3", type: "image", label: "Foto produk 3" },
      { id: "img4", type: "image", label: "Foto produk 4" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
  {
    id: "vlog-video",
    name: "Vlog Harian",
    duration: "0:30",
    gradientFrom: "#F2C14E",
    gradientTo: "#B8860B",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "vid1", type: "video", label: "Klip video" },
      { id: "img1", type: "image", label: "Foto penutup" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
  {
    id: "quotes-1foto",
    name: "Kutipan Harian",
    duration: "0:08",
    gradientFrom: "#B08CE0",
    gradientTo: "#5C3D91",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "img1", type: "image", label: "Foto latar" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
  {
    id: "before-after",
    name: "Before / After",
    duration: "0:12",
    gradientFrom: "#4EA1F2",
    gradientTo: "#1A4E8A",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "img1", type: "image", label: "Foto sebelum" },
      { id: "img2", type: "image", label: "Foto sesudah" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
  {
    id: "giveaway-seru",
    name: "Giveaway Seru",
    duration: "0:12",
    gradientFrom: "#F26DA8",
    gradientTo: "#7C3AAD",
    previewSrc: PLACEHOLDER_PREVIEW,
    slots: [
      { id: "img1", type: "image", label: "Foto hadiah" },
      { id: "img2", type: "image", label: "Foto brand/logo" },
      { id: "audio1", type: "audio", label: "Musik latar" },
    ],
  },
];
