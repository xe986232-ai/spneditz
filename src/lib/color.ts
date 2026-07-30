/** Ekstraksi warna dominan dari sebuah gambar (dipakai buat glow/shadow
 *  ambient di belakang canvas preview — mirip efek "Canvas" Spotify yang
 *  ngikutin warna cover lagu).
 *
 *  Bukan cuma rata-rata polos (itu hasilnya suka jadi abu-abu/kotor kalau
 *  fotonya kontras tinggi) — pixel-nya di-downscale dulu biar ringan,
 *  terus dikelompokkan ke "bucket" warna (quantized), tiap bucket dikasih
 *  skor = jumlah pixel × saturasi (biar warna yang CERAH & KELIHATAN yang
 *  menang, bukan cuma yang paling banyak tapi kusam), baru bucket
 *  terbaik itu di-rata-ratain jadi satu warna RGB final. */

const CACHE = new Map<string, Promise<string>>();

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

/** Ambil warna dominan (vivid) dari sebuah URL gambar, hasilnya string
 *  "r, g, b" (dipakai langsung di dalam rgba(...) CSS). Fallback ke abu2
 *  netral kalau gambar gagal dimuat/dianalisis (misal CORS). Di-cache per
 *  URL biar gak dihitung ulang tiap kali komponen re-render. */
export function getDominantColor(url: string): Promise<string> {
  const cached = CACHE.get(url);
  if (cached) return cached;

  const promise = new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const SIZE = 48;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no ctx");
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

        // Bucket per 24 unit tiap channel (256/24 ≈ 11 bucket/channel).
        const BUCKET = 24;
        const buckets = new Map<
          string,
          { r: number; g: number; b: number; count: number; score: number }
        >();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 200) continue; // skip transparan
          const { s, l } = rgbToHsl(r, g, b);
          // Skip yang nyaris putih/hitam murni — biasanya background
          // polos, bukan "warna" yang representatif buat glow.
          if (l < 0.06 || l > 0.94) continue;

          const key = `${Math.round(r / BUCKET)}_${Math.round(g / BUCKET)}_${Math.round(b / BUCKET)}`;
          const weight = 0.35 + s * 1.65; // saturasi tinggi lebih diprioritaskan
          const entry = buckets.get(key);
          if (entry) {
            entry.r += r;
            entry.g += g;
            entry.b += b;
            entry.count += 1;
            entry.score += weight;
          } else {
            buckets.set(key, { r, g, b, count: 1, score: weight });
          }
        }

        if (buckets.size === 0) {
          resolve("120, 120, 130");
          return;
        }

        let best: { r: number; g: number; b: number; count: number; score: number } | null = null;
        for (const entry of buckets.values()) {
          if (!best || entry.score > best.score) {
            best = entry;
          }
        }
        if (best) {
          const r = Math.min(255, Math.round(best.r / best.count));
          const g = Math.min(255, Math.round(best.g / best.count));
          const b = Math.min(255, Math.round(best.b / best.count));
          resolve(`${r}, ${g}, ${b}`);
        } else {
          resolve("120, 120, 130");
        }
      } catch {
        resolve("120, 120, 130");
      }
    };
    img.onerror = () => resolve("120, 120, 130");
    img.src = url;
  });

  CACHE.set(url, promise);
  return promise;
}
