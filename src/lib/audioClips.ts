// Helper bersama buat fitur "potong audio" (trim/geser/cut klip) di
// Editor.tsx — dipakai engine export (WebCodecs) biar hasil potongan di
// preview ikut kepakai juga di video final, bukan cuma tampil di editor
// doang.
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

