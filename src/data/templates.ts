import type { Template } from "../types";

// Dua template aktif untuk sekarang: iPhone Music Player (card solid
// hitam) & duplikatnya "iPhone Music Player Glass" (card kaca/liquid
// glass translucent, posisi & ukuran semua elemen identik dengan aslinya).
// Template "iPhone Music Player Cover" (ketiga) sudah dihapus.
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
          // Bbox & radius disamain ke mock-up baru (template2_mock-up):
          // card lebih tinggi & lebar sedikit dikurangi dari sebelumnya.
          x: 9.63,
          y: 9.27,
          width: 80.65,
          height: 81.41,
          cornerRadius: 70,
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
        // Badge AirPlay (ikon + teks "AirPlay" + card pill samar di
        // belakangnya), semua di-bake jadi satu asset transparan penuh
        // canvas. Ikonnya digambar dari SVG "AirPlay Audio" resmi (bukan
        // ikon cast generik kayak sebelumnya), diposisikan di bawah baris
        // kontrol/volume & masih di dalam batas card kaca — niru posisi
        // badge AirPlay di lockscreen iOS.
        label: "Badge AirPlay",
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
        x: 15.37,
        y: 12.5,
        width: 69.17,
        height: 38.91,
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
    // Posisi teks digeser naik & disamain ke tepi kiri baru (15.83, sejajar
    // progress bar) biar pas sama gap baru antara sampul (habis di ~51.4%)
    // & progress bar (mulai ~62%) di layout mock-up.
    textLayers: [
      {
        id: "device",
        label: "Nama device",
        defaultText: "psiquiss",
        x: 15.83,
        y: 54.9,
        fontSize: 30,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 24,
      },
      {
        id: "title",
        label: "Judul",
        defaultText: "new vision",
        x: 15.83,
        y: 56.9,
        fontSize: 48,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 30,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "@nyxvoids",
        x: 15.83,
        y: 58.7,
        fontSize: 28,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
    ],
    durationLayer: {
      currentX: 15.83,
      currentY: 64.0,
      totalX: 84.07,
      totalY: 64.0,
      fontSize: 32,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
    },
    progressLayer: {
      x1: 15.83, // ≈171/1080, sejajar ujung kiri progressbar.png (mock-up baru)
      x2: 84.07, // ≈908/1080, sejajar ujung kanan progressbar.png
      y: 62.03, // ≈1191/1920, tengah track progressbar.png (mock-up baru)
      thickness: 19, // disamain ke tinggi track progressbar.png baru (hasil ekstrak mock-up), biar isian putih nggak keliatan kurus di dalam track abu-abu
      color: "#FFFFFF",
    },
  },
  {
    // Duplikat "iPhone Music Player Glass" — SEMUA posisi/ukuran slot,
    // teks, progress, layout dsb PERSIS SAMA. Satu-satunya beda: card
    // player BUKAN liquid glass (nggak nembus/merefraksi background) —
    // diganti rounded-rect hitam solid, geometrinya (x/y/width/height/
    // cornerRadius) di-copy identik dari `liquidGlass` template 2 di atas,
    // cuma dibake jadi PNG solid (lihat
    // public/templates/iphone-music-player-black/card.png).
    id: "iphone-music-player-black",
    name: "iPhone Music Player Black",
    duration: "0:15",
    gradientFrom: "#3A3A3E",
    gradientTo: "#0A0A0C",
    previewImage: "/templates/iphone-music-player-black/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    baseAssetSrc: "/templates/iphone-music-player-black/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player",
        // Card solid hitam (bukan liquid glass) — TIDAK ada properti
        // `liquidGlass` di sini, jadi digambar sebagai PNG biasa
        // (drawImage full canvas), sama seperti card di template 1.
        assetSrc: "/templates/iphone-music-player-black/card.png",
        order: "back",
        opacity: 100,
        adjustable: true,
      },
      {
        id: "icon",
        label: "Badge AirPlay",
        assetSrc: "/templates/iphone-music-player-black/icon.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        assetSrc: "/templates/iphone-music-player-black/progressbar.png",
        order: "front",
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        assetSrc: "/templates/iphone-music-player-black/musicplayer.png",
        order: "front",
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 15.37,
        y: 12.5,
        width: 69.17,
        height: 38.91,
        startSec: 0,
        endSec: 15,
        radius: 36,
        sampleSrc: "/templates/iphone-music-player-black/sample-cover.jpg",
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
        defaultText: "psiquiss",
        x: 15.83,
        y: 54.9,
        fontSize: 30,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 24,
      },
      {
        id: "title",
        label: "Judul",
        defaultText: "new vision",
        x: 15.83,
        y: 56.9,
        fontSize: 48,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 30,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "@nyxvoids",
        x: 15.83,
        y: 58.7,
        fontSize: 28,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
    ],
    durationLayer: {
      currentX: 15.83,
      currentY: 64.0,
      totalX: 84.07,
      totalY: 64.0,
      fontSize: 32,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
    },
    progressLayer: {
      x1: 15.83,
      x2: 84.07,
      y: 62.03,
      thickness: 19,
      color: "#FFFFFF",
    },
  },
  {
    // Template ke-4: "iPhone Music Player V4" — layout & asset dikirim
    // langsung sama user (LAYOUT.png, FOTO Custom.png, JUDUL &ARTIST
    // Custom.png, CARD HITAM ... opacity 35%.png), semua koordinat di
    // bawah ini hasil ukur presisi dari bounding-box alpha channel
    // masing2 asset (bukan estimasi manual). Bedanya dari 3 template
    // sebelumnya: ada ikon favorit (star) di kontrol, & card default-nya
    // dipakai di opacity 35% (bukan 100) sesuai instruksi nama file asset.
    id: "iphone-music-player-v4",
    name: "iPhone Music Player V4",
    duration: "0:15",
    gradientFrom: "#3A2E5C",
    gradientTo: "#0A090E",
    previewImage: "/templates/iphone-music-player-v4/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    baseAssetSrc: "/templates/iphone-music-player-v4/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player",
        assetSrc: "/templates/iphone-music-player-v4/card.png",
        order: "back",
        // Sesuai nama asli asset ("BUAT DEFAULT JADI OVACITY 35%") —
        // defaultnya transparan 35%, beda dari 3 template lain yang 100.
        opacity: 35,
        adjustable: true,
      },
      {
        // Dulu satu file icon.png (pill card + ikon AirPlay nempel jadi
        // satu). Sekarang dipecah 2 asset biar opacity card-nya bisa
        // diatur terpisah dari ikonnya (lihat "airplayLogo" di bawah) —
        // posisi & ukuran sama persis (full-canvas 1080x1920), cuma
        // kontennya beda: yang ini cuma pill/card-nya doang.
        id: "airplayCard",
        label: "Card AirPlay",
        assetSrc: "/templates/iphone-music-player-v4/airplay-card.png",
        order: "front",
        // Sesuai instruksi: default card-nya di-ovacity ~17%.
        opacity: 17,
        adjustable: true,
      },
      {
        // Ikon AirPlay-nya sendiri — posisi tetap, opacity tetap penuh
        // (nggak ikut diredupkan bareng card di atas).
        id: "airplayLogo",
        label: "Ikon AirPlay",
        assetSrc: "/templates/iphone-music-player-v4/airplay-logo.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        // Nggak ada di asset asli (LAYOUT.png cuma kasih kontrol +
        // duration text, track progress-nya nggak digambar) — jadi
        // track abu-abu ini digenerate ulang manual, posisinya diukur
        // dari screenshot hasil jadi yang user kirim (sejajar persis
        // sama tepi kiri/kanan teks durasi di bawahnya).
        assetSrc: "/templates/iphone-music-player-v4/progressbar.png",
        order: "front",
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        // Cuma rewind/pause/fast-forward — ikon star & volume sudah
        // dipisah ke layer "layout" sendiri (lihat di bawah) biar
        // opacity-nya bisa diatur terpisah dari tombol play/skip.
        // Opacity default full (100%), nggak diubah.
        assetSrc: "/templates/iphone-music-player-v4/musicplayer.png",
        order: "front",
      },
      {
        // Dulu isinya star + volume (icon speaker kiri/kanan + bar).
        // Di-crop ulang jadi cuma batang volume-nya doang — ikon star
        // & kedua speaker udah dihapus dari asset ini. Posisi bar
        // tetap sama persis (full-canvas 1080x1920), opacity tetap 10%.
        id: "layout",
        label: "Volume bar (redup)",
        assetSrc: "/templates/iphone-music-player-v4/layout.png",
        order: "front",
        opacity: 10,
        adjustable: true,
      },
      {
        // Track volume yang keliatan jelas — ditaruh di atas layer
        // "layout" biar nutupin track volume yang ikut ke-redupin di
        // sana (opacity 10%). Posisi udah pas nempel sejajar sama
        // track volume redup di bawahnya (full-canvas 1080x1920, sama
        // kayak layer lain). Opacity full, nggak diredupin.
        id: "volume",
        label: "Volume bar",
        assetSrc: "/templates/iphone-music-player-v4/volume.png",
        order: "front",
        adjustable: true,
      },
      {
        // Asset baru yang misahin ikon star (favorit) + kedua ikon
        // speaker (kiri/kanan) — batang volume-nya sendiri udah ada di
        // layer "volume"/"layout" terpisah, jadi asset ini cuma isi
        // star & speaker doang. Posisi sama persis (full-canvas
        // 1080x1920). Opacity default 40%.
        id: "starSpeaker",
        label: "Star & Speaker",
        assetSrc: "/templates/iphone-music-player-v4/star-speaker.png",
        order: "front",
        opacity: 40,
        adjustable: true,
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 15.56,
        y: 14.79,
        width: 68.7,
        height: 38.65,
        startSec: 0,
        endSec: 15,
        radius: 36,
        sampleSrc: "/templates/iphone-music-player-v4/sample-cover.jpg",
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
        id: "title",
        label: "Judul",
        defaultText: "MABUK CINTA JDM PLAT KT REMIX",
        x: 16.2,
        y: 57.47,
        fontSize: 35,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 40,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "Ragil YETE",
        x: 16.3,
        y: 59.87,
        fontSize: 29,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
      {
        // Teks nama device di badge AirPlay (dulu "NyxVoid's" nempel
        // permanen di icon.png). Sekarang textnya dipisah jadi textLayer
        // sendiri biar bisa di-custom user — icon.png cuma nyisain pill +
        // ikon AirPlay-nya aja (bagian teksnya sudah dibersihkan/dihapus
        // dari asset). Posisi diukur dari bounding-box asli huruf
        // "NyxVoid's" di icon.png (x mulai persis setelah ikon+jarak,
        // y center sejajar tengah pill).
        id: "airplayDevice",
        label: "Nama Perangkat AirPlay",
        defaultText: "NyxVoid's",
        x: 46.5,
        y: 82.86,
        fontSize: 28,
        fontWeight: 500,
        color: "#FFFFFF",
        align: "left",
        maxLength: 20,
      },
    ],
    durationLayer: {
      currentX: 16.2,
      currentY: 67.63,
      totalX: 83.7,
      totalY: 67.63,
      fontSize: 30,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
      // Angka kanan ikut gerak (mundur "-M:SS" tiap detik) bukan total
      // durasi diam, sesuai gaya Apple Music/Spotify.
      countdown: true,
    },
    progressLayer: {
      x1: 16.2,
      x2: 83.7,
      y: 64.84,
      thickness: 18,
      color: "#FFFFFF",
    },
    // Ikon spectrum/equalizer kecil di kanan judul (mirip indikator
    // "Now Playing" iOS) — animasinya ngikutin energi audio asli
    // (lihat drawSpectrumIndicator di lib/render.ts). Posisi disejajarkan
    // ke baris judul (title.y = 57.47), nempel di tepi kanan yang sama
    // dengan ujung kanan progress bar/total durasi (x2 = 83.7) biar rapi.
    // x di sini adalah TITIK TENGAH grup bar (drawSpectrumIndicator
    // nge-center dari x ini), jadi dikurangi setengah lebar total grup
    // (barCount*barWidth + (barCount-1)*gap, dikonversi ke % lebar
    // canvas 1080px) supaya tepi KANAN grup pas nempel di 83.7, bukan
    // titik tengahnya — kalau barCount/barWidth/gap diubah, x WAJIB
    // dihitung ulang pakai rumus yang sama biar nggak nongol keluar card
    // lagi (lihat riwayat commit fix sebelumnya).
    //
    // 6 batang (bukan 4) — PHASE_OFFSETS_SEC & WEIGHTS di render.ts
    // emang udah disiapin 6 elemen dari awal (masing2 "mengintip" titik
    // waktu & bobot beda), jadi barCount=6 ini pas manfaatin full variasi
    // gerakannya, bukan cuma kepotong 4 pertama. barWidth dikecilin
    // (6->4px) & maxHeight/minHeight dinaikin (30/7 -> 38/9px) biar tiap
    // batang keliatan lebih ramping & "menjulang", bukan gemuk-pendek.
    // Warna putih redup (bukan putih penuh) sesuai referensi tampilan asli.
    spectrumLayer: {
      x: 81.7,
      y: 57.6,
      barCount: 6,
      barWidth: 4,
      gap: 4,
      maxHeight: 38,
      minHeight: 9,
      color: "rgba(255,255,255,0.55)",
    },
  },
  {
    // Template ke-5: "iPhone Music Player V5" — awalnya duplikat persis
    // dari V4, sekarang sudah dikustomisasi: card player opacity full
    // (100%, dulu 35%) + foto sampul dikasih ambient glow blur di
    // belakangnya (slot "sampul" -> glowBehind: true, lihat types.ts &
    // lib/render.ts/drawSlotGlow). Thumbnail preview belum diubah dulu.
    id: "iphone-music-player-v5",
    name: "iPhone Music Player V5",
    duration: "0:15",
    gradientFrom: "#3A2E5C",
    gradientTo: "#0A090E",
    previewImage: "/templates/iphone-music-player-v5/preview.jpg",
    canvasWidth: 1080,
    canvasHeight: 1920,
    baseAssetSrc: "/templates/iphone-music-player-v5/bg.jpg",
    baseAssetType: "image",
    decorLayers: [
      {
        id: "card",
        label: "Card Player",
        assetSrc: "/templates/iphone-music-player-v5/card.png",
        order: "back",
        opacity: 100,
        adjustable: true,
      },
      {
        id: "airplayCard",
        label: "Card AirPlay",
        assetSrc: "/templates/iphone-music-player-v5/airplay-card.png",
        order: "front",
        opacity: 17,
        adjustable: true,
      },
      {
        id: "airplayLogo",
        label: "Ikon AirPlay",
        assetSrc: "/templates/iphone-music-player-v5/airplay-logo.png",
        order: "front",
      },
      {
        id: "progressbar",
        label: "Progress bar",
        assetSrc: "/templates/iphone-music-player-v5/progressbar.png",
        order: "front",
        hideInWaveformMode: true,
      },
      {
        id: "musicplayer",
        label: "Kontrol",
        assetSrc: "/templates/iphone-music-player-v5/musicplayer.png",
        order: "front",
      },
      {
        id: "layout",
        label: "Volume bar (redup)",
        assetSrc: "/templates/iphone-music-player-v5/layout.png",
        order: "front",
        opacity: 10,
        adjustable: true,
      },
      {
        id: "volume",
        label: "Volume bar",
        assetSrc: "/templates/iphone-music-player-v5/volume.png",
        order: "front",
        adjustable: true,
      },
      {
        id: "starSpeaker",
        label: "Star & Speaker",
        assetSrc: "/templates/iphone-music-player-v5/star-speaker.png",
        order: "front",
        opacity: 40,
        adjustable: true,
      },
    ],
    slots: [
      {
        id: "sampul",
        type: "image",
        label: "Foto sampul",
        x: 15.56,
        y: 14.79,
        width: 68.7,
        height: 38.65,
        startSec: 0,
        endSec: 15,
        radius: 36,
        sampleSrc: "/templates/iphone-music-player-v5/sample-cover.jpg",
        // Efek ambient glow: foto sampul yang sama digambar ulang di
        // belakang versi tajamnya, diperbesar sedikit + diblur berat
        // (lihat drawSlotGlow di lib/render.ts) — bukan asset shadow
        // statis, tapi live pakai foto sampul asli yang diupload user.
        glowBehind: true,
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
        id: "title",
        label: "Judul",
        defaultText: "MABUK CINTA JDM PLAT KT REMIX",
        x: 16.2,
        y: 57.47,
        fontSize: 35,
        fontWeight: 800,
        color: "#FFFFFF",
        align: "left",
        maxLength: 40,
      },
      {
        id: "artist",
        label: "Artist",
        defaultText: "Ragil YETE",
        x: 16.3,
        y: 59.87,
        fontSize: 29,
        fontWeight: 500,
        color: "rgba(255,255,255,0.65)",
        align: "left",
        maxLength: 30,
      },
      {
        id: "airplayDevice",
        label: "Nama Perangkat AirPlay",
        defaultText: "NyxVoid's",
        x: 46.5,
        y: 82.86,
        fontSize: 28,
        fontWeight: 500,
        color: "#FFFFFF",
        align: "left",
        maxLength: 20,
      },
    ],
    durationLayer: {
      currentX: 16.2,
      currentY: 67.63,
      totalX: 83.7,
      totalY: 67.63,
      fontSize: 30,
      fontWeight: 500,
      color: "rgba(255,255,255,0.7)",
      countdown: true,
    },
    progressLayer: {
      x1: 16.2,
      x2: 83.7,
      y: 64.84,
      thickness: 18,
      color: "#FFFFFF",
    },
    spectrumLayer: {
      x: 81.7,
      y: 57.6,
      barCount: 6,
      barWidth: 4,
      gap: 4,
      maxHeight: 38,
      minHeight: 9,
      color: "rgba(255,255,255,0.55)",
    },
  },
];
