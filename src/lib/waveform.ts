export type AudioAnalysis = {
  /** Durasi asli file audio (detik) — dipakai biar timeline & preview
   *  ngikutin panjang lagu beneran, bukan durasi template yang di-hardcode. */
  duration: number;
  /** Peak amplitude per bar, dinormalisasi 0-1, dipakai buat gambar
   *  batang waveform di layer audio (mengikuti frekuensi/amplitude asli). */
  peaks: number[];
};

/** Decode file/URL audio via Web Audio API, lalu ambil durasi asli +
 *  peak amplitude per segmen (buat waveform). Satu kali decode dipakai
 *  buat dua-duanya biar hemat. */
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

    return { duration: audioBuffer.duration, peaks };
  } finally {
    ctx.close().catch(() => {});
  }
}
