// Helper bersama buat fitur "potong audio" (trim/geser/cut klip) di
// Editor.tsx — dipakai KEDUA engine export (WebCodecs & FFmpeg.wasm) biar
// hasil potongan di preview ikut kepakai juga di video final, bukan cuma
// tampil di editor doang.
//
// Model klip: tiap AudioClipExport nunjuk ke satu rentang di file audio
// ASLI (trimStart..trimEnd, dalam detik source asli) yang "ditempel" di
// detik `offset` pada timeline utama. Durasi total timeline TIDAK berubah
// gara-gara potong/trim — cuma isinya yang berubah (ada jeda/silence di
// bagian yang kepotong/gak ketutup klip manapun).

export type AudioClipExport = {
  trimStart: number;
  trimEnd: number;
  offset: number;
};

// Cek apakah klip-klip ini masih "utuh" (belum pernah dipotong/digeser/
// ditrim user) — kalau iya, engine export boleh skip semua kerja remap
// & langsung pakai file audio asli apa adanya (lebih cepat, lebih aman).
export function clipsAreTrivial(
  clips: AudioClipExport[] | undefined | null,
  sourceDuration: number,
): boolean {
  if (!clips || clips.length === 0) return true;
  if (clips.length !== 1) return false;
  const c = clips[0];
  return (
    Math.abs(c.trimStart) < 0.02 &&
    Math.abs(c.offset) < 0.02 &&
    c.trimEnd >= sourceDuration - 0.02
  );
}

// Bikin AudioBuffer baru sepanjang buffer asli (durasi & sampleRate sama),
// diam (silence) di semua titik, lalu tempelin tiap klip di posisi
// `offset`-nya masing-masing dengan isi dari `trimStart..trimEnd` buffer
// asli. Ini yang bikin hasil potong/geser/trim user di preview kepakai
// juga pas export (bukan cuma efek visual timeline doang).
export function buildRemappedAudioBuffer(
  ctx: BaseAudioContext,
  original: AudioBuffer,
  clips: AudioClipExport[],
): AudioBuffer {
  const out = ctx.createBuffer(
    original.numberOfChannels,
    original.length,
    original.sampleRate,
  );
  const sr = original.sampleRate;
  for (let ch = 0; ch < original.numberOfChannels; ch++) {
    const srcData = original.getChannelData(ch);
    const dstData = out.getChannelData(ch); // mulai dari nol (silence)
    for (const clip of clips) {
      const srcStart = Math.max(0, Math.floor(clip.trimStart * sr));
      const srcEnd = Math.min(srcData.length, Math.floor(clip.trimEnd * sr));
      const dstStart = Math.max(0, Math.floor(clip.offset * sr));
      const len = Math.min(srcEnd - srcStart, dstData.length - dstStart);
      if (len <= 0) continue;
      dstData.set(srcData.subarray(srcStart, srcStart + len), dstStart);
    }
  }
  return out;
}

// Encoder WAV (PCM 16-bit) sederhana — dipakai engine FFmpeg.wasm buat
// nulis hasil remap AudioBuffer ke file yang bisa dibaca ffmpeg (WAV
// dipilih karena lossless & gampang ditulis manual tanpa dependency
// tambahan, ffmpeg.wasm sendiri yang nanti nge-encode ulang ke AAC).
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
