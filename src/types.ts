export type SlotType = "image" | "video" | "audio";

export interface TemplateSlot {
  id: string;
  type: SlotType;
  /** Contoh: "Foto 1", "Musik latar" */
  label: string;
  /** Posisi & ukuran slot di atas baseAssetSrc, dalam PERSEN (0-100)
   *  relatif ke canvasWidth/canvasHeight template. Cuma dipakai untuk
   *  slot image/video (audio tidak digambar). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Kapan slot ini "tampil" di timeline (detik). Untuk audio, biasanya
   *  0 s/d durasi total template. */
  startSec?: number;
  endSec?: number;
  /** Radius sudut membulat saat digambar di canvas (dalam px, skala
   *  canvasWidth/canvasHeight asli — bukan skala layar). */
  radius?: number;
  /** Gambar/klip contoh dari internet, dipakai sebagai isi default slot
   *  ini sebelum user upload media sendiri sendiri (biar preview & test
   *  export bisa langsung jalan tanpa nunggu user upload apa-apa). */
  sampleSrc?: string;
  /** Kalau true, foto slot ini (SAMA persis, bukan asset lain) digambar
   *  ulang di belakang versi tajamnya sendiri — diperbesar sedikit &
   *  diblur berat, jadi ada efek ambient glow/halo lembut yang "meleber"
   *  di sekeliling cover (lihat drawSlotGlow di lib/render.ts). Dipakai
   *  di iPhone Music Player V5. Default false/undefined = perilaku lama
   *  (tidak ada glow tambahan). */
  glowBehind?: boolean;
}

/** Layer dekoratif statis (bukan slot isian user) yang ditumpuk di atas
 *  baseAssetSrc — misalnya kartu/panel music player, ikon, progress bar,
 *  dsb. Aset PNG-nya full-canvas (transparan di luar bentuknya) supaya
 *  posisinya sudah "fix" di dalam gambar itu sendiri, nggak perlu x/y/width. */
export interface TemplateDecorLayer {
  id: string;
  /** Nama yang muncul di timeline (kalau adjustable) */
  label: string;
  assetSrc: string;
  /** "back" = digambar SEBELUM slot foto/video (jadi di belakang foto),
   *  "front" = digambar SETELAH slot (di depan/atas foto). */
  order: "back" | "front";
  /** Opacity default, 0-100. Default 100 kalau tidak diisi. */
  opacity?: number;
  /** Kalau true, layer ini muncul sebagai track sendiri di timeline dan
   *  bisa diklik user untuk diatur opacity-nya lewat slider. Kalau
   *  false/undefined, layer cuma dirender diam-diam sebagai dekorasi
   *  statis (nggak bisa diklik/diedit). */
  adjustable?: boolean;
  /** Kalau true, layer ini adalah track statis progress bar (misal
   *  progressbar.png) yang cuma relevan buat mode progressStyle "bar".
   *  Di mode "waveform", bar-nya gambar ulang total (bukan cuma isian),
   *  jadi track statis ini harus di-skip biar nggak dobel sama bar
   *  waveform yang baru. */
  hideInWaveformMode?: boolean;
  /** Kalau diisi, layer ini TIDAK digambar dari assetSrc (PNG statis) —
   *  melainkan dirender live sebagai kaca "liquid glass" beneran: nembus
   *  & merefraksi apa pun yang ada di baseAssetSrc/background di
   *  belakangnya (persis kayak library rdev/liquid-glass-react), plus
   *  blur/saturasi/chromatic-aberration/corner-radius bisa di-custom user
   *  lewat panel pengaturan. assetSrc tetap harus diisi (dipakai sebagai
   *  fallback kalau browser user nggak dukung SVG filter di canvas). */
  liquidGlass?: TemplateLiquidGlassConfig;
}

/** Kotak area kaca (dalam PERSEN dari canvasWidth/canvasHeight, sama
 *  seperti TemplateSlot) + setelan efek default-nya. User bisa ubah
 *  settingnya lewat panel "Pengaturan Kaca" pas layer ini diseleksi;
 *  rect (x/y/width/height/cornerRadius) tetap tidak berubah. */
export interface TemplateLiquidGlassConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radius sudut dalam px, skala canvasWidth/canvasHeight asli. */
  cornerRadius: number;
  settings: LiquidGlassSettings;
}

export type LiquidGlassMode = "standard" | "polar" | "prominent" | "shader";

/** Setelan efek kaca — namanya & default-nya sengaja disamakan persis
 *  dengan props komponen <LiquidGlass> di rdev/liquid-glass-react, biar
 *  hasilnya konsisten sama library aslinya. */
export interface LiquidGlassSettings {
  mode: LiquidGlassMode;
  /** Seberapa kuat refraksi/bengkokan tepi kaca. Default 70. */
  displacementScale: number;
  /** Kekuatan blur backdrop. Default 0.5 (skala sama kayak library asli:
   *  px akhir = (overLight ? 12 : 4) + blurAmount * 32). */
  blurAmount: number;
  /** Saturasi warna backdrop yang nembus, dalam %. Default 140. */
  saturation: number;
  /** Intensitas efek chromatic aberration di tepian kaca. Default 2. */
  aberrationIntensity: number;
  /** Kalau true, kaca ditintkan gelap (dipakai kalau card ada di atas
   *  background yang terang, biar tetap kebaca). Default false. */
  overLight: boolean;
}

/** Layer teks yang bisa di-custom user (judul, artist, nama device, dsb).
 *  Beda dari TemplateDecorLayer (yang isinya gambar statis) — ini digambar
 *  langsung dari kode pakai canvas fillText, jadi isinya bisa diganti user
 *  lewat panel "Teks" di toolbar bawah. */
export interface TemplateTextLayer {
  id: string;
  /** Label yang muncul di panel edit teks, misal "Judul", "Artist" */
  label: string;
  /** Isi default sebelum user mengubahnya */
  defaultText: string;
  /** Posisi horizontal, dalam PERSEN (0-100) relatif canvasWidth.
   *  Jadi titik acuan align (align="center" -> titik tengah teks di x ini). */
  x: number;
  /** Posisi vertikal (titik tengah baris teks secara vertikal), PERSEN
   *  (0-100) relatif canvasHeight. */
  y: number;
  /** Ukuran font, dalam px SKALA CANVAS ASLI (1080x1920), bukan skala layar. */
  fontSize: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  /** Placeholder pendek buat input field di panel edit (opsional). */
  maxLength?: number;
}

/** Konfigurasi tampilan durasi (mm:ss kiri = posisi berjalan, kanan =
 *  total durasi). SELALU dihitung otomatis dari playhead & durasi audio
 *  asli — tidak pernah bisa di-custom user (dikunci by design), makanya
 *  dipisah dari textLayers (yang memang untuk teks custom). */
export interface TemplateDurationLayer {
  /** Posisi teks waktu berjalan (kiri), PERSEN relatif canvas. */
  currentX: number;
  currentY: number;
  /** Posisi teks total durasi (kanan), PERSEN relatif canvas. */
  totalX: number;
  totalY: number;
  fontSize: number;
  fontWeight?: number;
  color?: string;
  /** Kalau true, teks KANAN nampilin SISA waktu yang "ikut gerak" (mundur,
   *  format "-M:SS", turun terus tiap detik) — bukan total durasi lagu
   *  yang diam/statis. Mirip gaya Apple Music/Spotify. Default false
   *  (perilaku lama: kanan = total durasi tetap). */
  countdown?: boolean;
}

/** Garis putih di atas progressbar.png (yang cuma track abu-abu diam) —
 *  panjangnya ngikutin currentSec/totalSec, dihitung otomatis kayak
 *  durationLayer, TIDAK bisa di-custom user. x1/x2 = ujung kiri/kanan
 *  track, PERSEN relatif canvasWidth (samain sama posisi progressbar.png
 *  aslinya biar nempel pas). */
export interface TemplateProgressLayer {
  x1: number;
  x2: number;
  /** Posisi vertikal tengah garis, PERSEN relatif canvasHeight. */
  y: number;
  /** Tebal garis dalam px skala canvas asli. */
  thickness: number;
  color?: string;
}

/** Ikon "spectrum"/equalizer kecil (mirip indikator "Now Playing" di iOS)
 *  — beberapa batang vertikal pendek yang naik-turun ngikutin ENERGI AUDIO
 *  ASLI (bassPeaks) di posisi currentSec, biasanya ditaruh nempel di
 *  sebelah kanan judul lagu. BEDA dari progressLayer/mode "waveform
 *  berjalan": itu representasi SELURUH rentang lagu di sepanjang track
 *  progress, ini cuma indikator kecil "lagu lagi diputar" yang nunjukin
 *  level energi SAAT INI doang (posisinya independen, di dekat judul,
 *  bukan di track progress) — dan selalu jalan otomatis, tidak ikut
 *  toggle gaya progress "Standar"/"Waveform berjalan". Opsional —
 *  template lama tanpa ini tetap jalan seperti biasa. */
export interface TemplateSpectrumLayer {
  /** Posisi titik tengah horizontal ikon, PERSEN relatif canvasWidth. */
  x: number;
  /** Posisi titik tengah vertikal ikon, PERSEN relatif canvasHeight. */
  y: number;
  /** Jumlah batang, default 4 (mirip ikon Now Playing asli). */
  barCount?: number;
  /** Lebar tiap batang, px skala canvas asli (1080x1920). */
  barWidth?: number;
  /** Jarak antar batang, px skala canvas asli. */
  gap?: number;
  /** Tinggi maksimum batang (energi audio penuh), px skala canvas asli. */
  maxHeight?: number;
  /** Tinggi minimum batang (energi nol/diam), px skala canvas asli. */
  minHeight?: number;
  color?: string;
}

export interface Template {
  id: string;
  name: string;
  /** Durasi hasil akhir, contoh "0:15" */
  duration: string;
  /** Warna gradasi thumbnail preview (bukan warna UI/chrome) */
  gradientFrom: string;
  gradientTo: string;
  /** Video contoh hasil jadi (sudah tidak dipakai di gallery — kartu template
   *  sekarang selalu tampilkan gambar statis lewat previewImage). Dibiarkan
   *  ada di tipe biar kompatibel kalau video preview mau diaktifkan lagi. */
  previewSrc?: string;
  /** Gambar preview statis (hasil komposit tampilan jadi template ini),
   *  ditampilkan langsung di kartu galeri tanpa perlu diklik/diputar. */
  previewImage?: string;
  slots: TemplateSlot[];

  /** Asset dasar template (background/frame/dekorasi) — gambar ASLI,
   *  bukan digambar dari kode. Slot foto/video user ditempel di atasnya
   *  sesuai posisi masing-masing. Opsional: template lama tanpa ini akan
   *  tetap tampil pakai placeholder gradient seperti sebelumnya. */
  baseAssetSrc?: string;
  baseAssetType?: "image" | "video";
  /** Resolusi kerja canvas render (px). Semua x/y/width/height slot di
   *  atas dihitung relatif terhadap ini. Rasio 9:16 -> default 1080x1920. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Layer dekoratif tambahan (kartu, ikon, progress bar, dst) yang
   *  ditumpuk di atas baseAssetSrc. Opsional — template lama tanpa ini
   *  tetap jalan seperti biasa. */
  decorLayers?: TemplateDecorLayer[];

  /** Layer teks yang bisa di-custom user lewat panel "Teks" (misal: judul
   *  lagu, nama artist, nama device). Opsional — template lama tanpa ini
   *  tetap jalan seperti biasa. */
  textLayers?: TemplateTextLayer[];
  /** Tampilan durasi berjalan/total, dikunci & dihitung otomatis — TIDAK
   *  masuk textLayers karena memang tidak boleh di-custom user. */
  durationLayer?: TemplateDurationLayer;
  /** Garis progress putih (isian) yang ngikutin currentSec/totalSec,
   *  ditumpuk di atas progressbar.png (track abu-abu statis). Opsional —
   *  template lama tanpa ini tetap jalan seperti biasa. */
  progressLayer?: TemplateProgressLayer;
  /** Ikon spectrum/equalizer kecil di dekat judul, animasinya ngikutin
   *  energi audio asli (lihat drawSpectrumIndicator di lib/render.ts).
   *  Opsional — template lama tanpa ini tetap jalan seperti biasa. */
  spectrumLayer?: TemplateSpectrumLayer;
}
