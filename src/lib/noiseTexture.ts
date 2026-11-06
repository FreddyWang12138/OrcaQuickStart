/**
 * Generates a small, tileable 3D noise volume used by the nebula raymarcher.
 *
 * A 3D texture is dramatically cheaper than evaluating fractal noise per step:
 * the shader can take 3–4 trilinear samples per march step and still look
 * volumetric. Each channel stores a different flavour of noise:
 *
 *   R — soft 5-octave fbm (the body of the cloud)
 *   G — ridged noise (thin filaments and bright edges)
 *   B — high frequency fbm (fine detail)
 *   A — low frequency fbm (large scale density variation)
 *
 * All lattices wrap, so the texture repeats seamlessly.
 */

const SIZE = 64;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mod = (n: number, m: number) => ((n % m) + m) % m;

function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 0x27d4eb2d) ^
    Math.imul(y, 0x165667b1) ^
    Math.imul(z, 0x1b873593) ^
    Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x3c79ac49);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Value noise on a periodic lattice. x/y/z are normalised [0,1). */
function periodicNoise(
  x: number,
  y: number,
  z: number,
  freq: number,
  seed: number,
): number {
  const fx = x * freq;
  const fy = y * freq;
  const fz = z * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const tz = fade(fz - iz);

  const x0 = mod(ix, freq);
  const y0 = mod(iy, freq);
  const z0 = mod(iz, freq);
  const x1 = mod(ix + 1, freq);
  const y1 = mod(iy + 1, freq);
  const z1 = mod(iz + 1, freq);

  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x1, y0, z0, seed);
  const c010 = hash3(x0, y1, z0, seed);
  const c110 = hash3(x1, y1, z0, seed);
  const c001 = hash3(x0, y0, z1, seed);
  const c101 = hash3(x1, y0, z1, seed);
  const c011 = hash3(x0, y1, z1, seed);
  const c111 = hash3(x1, y1, z1, seed);

  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  const y0i = lerp(x00, x10, ty);
  const y1i = lerp(x01, x11, ty);
  return lerp(y0i, y1i, tz);
}

function fbm(
  x: number,
  y: number,
  z: number,
  octaves: number,
  baseFreq: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(x, y, z, freq, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function ridged(
  x: number,
  y: number,
  z: number,
  octaves: number,
  baseFreq: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(x, y, z, freq, seed + o * 197);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += amp * ridge * ridge;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface NoiseVolume {
  data: Uint8Array;
  size: number;
}

/**
 * Builds the volume in slices, yielding to the event loop so the loading UI can
 * paint progress. Takes roughly 0.5–1s on a laptop.
 */
export async function generateNoiseVolume(
  size = SIZE,
  onProgress?: (progress: number) => void,
): Promise<NoiseVolume> {
  const data = new Uint8Array(size * size * size * 4);
  const inv = 1 / size;
  const chunk = 8;

  for (let z = 0; z < size; z++) {
    const zf = z * inv;
    for (let y = 0; y < size; y++) {
      const yf = y * inv;
      for (let x = 0; x < size; x++) {
        const xf = x * inv;
        const body = fbm(xf, yf, zf, 5, 3, 11);
        const fil = ridged(xf, yf, zf, 4, 4, 23);
        const detail = fbm(xf, yf, zf, 3, 8, 37);
        const macro = fbm(xf, yf, zf, 3, 2, 51);

        const i = ((z * size + y) * size + x) * 4;
        data[i] = body * 255;
        data[i + 1] = fil * 255;
        data[i + 2] = detail * 255;
        data[i + 3] = macro * 255;
      }
    }
    if ((z & (chunk - 1)) === chunk - 1) {
      onProgress?.((z + 1) / size);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return { data, size };
}
