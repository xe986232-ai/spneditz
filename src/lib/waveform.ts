export type AudioAnalysis = {
  /** Durasi asli file audio (detik) — dipakai biar timeline & preview
   *  ngikutin panjang lagu beneran, bukan durasi template yang di-hardcode. */
  duration: number;
  /** Peak amplitude per bar (broadband, semua frekuensi), dinormalisasi
   *  0-1 — dipakai buat gambar batang waveform "umum" di layer audio
   *  timeline editor (trim/potong klip). */
  peaks: number[];
  /** Energi kick/bass per bar (cuma frekuensi rendah ~40-150Hz, plus
   *  transient beat DITONJOLKAN lebih dari bass yang cuma "ngedengung"
   *  rata), dinormalisasi 0-1 — dipakai KHUSUS buat visual "waveform
   *  berjalan" (lihat drawWaveformProgress di render.ts) biar
   *  gerakannya kerasa "mukul" ngikutin beat/kick lagu, bukan cuma
   *  ngikutin volume keseluruhan (vokal/hi-hat ikut bikin bar tinggi
   *  kalau pakai peaks broadband). */
  bassPeaks: number[];
};

/** Render ulang audioBuffer lewat OfflineAudioContext dengan band-pass
 *  ~40-150Hz (rentang fundamental kick drum/bass), biar kita bisa hitung
 *  energi KHUSUS di frekuensi itu — vokal/hi-hat/cymbal (frekuensi lebih
 *  tinggi) otomatis kepotong duluan sebelum dianalisis. */
async function renderBassBand(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const offline = new OfflineCtor(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate,
  );
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;

  // Highpass dulu (buang rumble sub-40Hz yang biasanya cuma noise/DC),
  // baru lowpass (buang semua di atas ~150Hz — vokal, gitar, hi-hat,
  // cymbal, dst) — sisanya cuma "badan" kick/bass line.
  const highpass = offline.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 40;
  highpass.Q.value = 0.7;

  const lowpass = offline.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 150;
  lowpass.Q.value = 0.7;

  src.connect(highpass).connect(lowpass).connect(offline.destination);
  src.start();
  return offline.startRendering();
}

/** Dari sinyal yang sudah di-filter band bass, hitung energi RMS per bar
 *  lalu TONJOLKAN transient-nya (beat/kick yang "nyentak" naik tiba-tiba)
 *  dibanding bass yang cuma ngedengung rata/statis — supaya visual bar
 *  keliatan "mukul" pas kick-nya bunyi, bukan cuma naik-turun pelan. */
function computeBassBarsFromBuffer(
  bassBuffer: AudioBuffer,
  barCount: number,
): number[] {
  const channelCount = bassBuffer.numberOfChannels;
  const length = bassBuffer.length;
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(bassBuffer.getChannelData(c));

  const samplesPerBar = Math.max(1, Math.floor(length / barCount));
  const rms: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(length, start + samplesPerBar);
    const stride = Math.max(1, Math.floor((end - start) / 300));
    let sumSq = 0;
    let n = 0;
    for (let j = start; j < end; j += stride) {
      let sum = 0;
      for (let c = 0; c < channelCount; c++) sum += channels[c][j];
      const avg = sum / channelCount;
      sumSq += avg * avg;
      n++;
    }
    rms.push(n > 0 ? Math.sqrt(sumSq / n) : 0);
  }

  // Baseline = rata-rata bergerak beberapa bar sekitarnya (bass "dasar"/
  // sustain) — selisih rms terhadap baseline ini yang jadi sinyal
  // transient (kick/beat baru, bukan bass yang emang lagi nahan nada).
  const smoothRadius = 4;
  const baseline: number[] = rms.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -smoothRadius; k <= smoothRadius; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < rms.length) {
        sum += rms[idx];
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  });

  const transient = rms.map((v, i) => Math.max(0, v - baseline[i] * 0.65));
  // Gabungkan: sebagian besar dari "sentakan" transient (bikin kick
  // menonjol tajam), sisanya dari energi bass mentah (biar bassline yang
  // nahan nada tetap kelihatan badannya, nggak ilang total jadi nol).
  const combined = rms.map((v, i) => v * 0.35 + transient[i] * 1.4);

  const maxVal = Math.max(...combined, 0.0001);
  // Kurva pow(0.7) — sedikit "compress" biar hit yang lebih kecil tetap
  // kebaca, tapi kick paling keras tetap paling menonjol (mendekati 1).
  return combined.map((v) => Math.min(1, Math.pow(v / maxVal, 0.7)));
}

/** Decode file/URL audio via Web Audio API, lalu ambil durasi asli +
 *  peak amplitude per segmen (buat waveform) + energi kick/bass per
 *  segmen (buat visual "waveform berjalan"). Satu kali decode dipakai
 *  buat semuanya biar hemat. */
export async function analyzeAudio(
  source: File | string,
  barCount: number,
): Promise<AudioAnalysis> {
  const arrayBuffer =
    source instanceof File
      ? await source.arrayBuffer()
      : await (await fetch(source)).arrayBuffer();

  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioContextCtor();

  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelCount = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    const samplesPerBar = Math.max(1, Math.floor(length / barCount));
    const rawPeaks: number[] = [];
    for (let i = 0; i < barCount; i++) {
      const start = i * samplesPerBar;
      const end = Math.min(length, start + samplesPerBar);
      let peak = 0;
      // Loncat tiap beberapa sample biar tetap cepat buat file panjang,
      // tanpa kehilangan bentuk umum waveform-nya.
      const stride = Math.max(1, Math.floor((end - start) / 200));
      for (let j = start; j < end; j += stride) {
        let sum = 0;
        for (let c = 0; c < channelCount; c++) sum += Math.abs(channels[c][j]);
        const avg = sum / channelCount;
        if (avg > peak) peak = avg;
      }
      rawPeaks.push(peak);
    }

    const maxPeak = Math.max(...rawPeaks, 0.0001);
    const peaks = rawPeaks.map((p) => Math.min(1, p / maxPeak));

    // Analisis bass/kick — kalau gagal (browser aneh/OfflineAudioContext
    // bermasalah), fallback ke peaks broadband biasa daripada bikin
    // seluruh proses upload audio gagal cuma gara-gara fitur tambahan ini.
    let bassPeaks: number[];
    try {
      const bassBuffer = await renderBassBand(audioBuffer);
      bassPeaks = computeBassBarsFromBuffer(bassBuffer, barCount);
    } catch {
      bassPeaks = peaks;
    }

    return { duration: audioBuffer.duration, peaks, bassPeaks };
  } finally {
    ctx.close().catch(() => {});
  }
}
