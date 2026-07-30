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
}
