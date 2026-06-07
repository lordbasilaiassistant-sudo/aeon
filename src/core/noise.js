// Value-noise + fBm for terrain generation. Seeded, deterministic, no deps.
import { hash2 } from './rng.js';

function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10); // quintic
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Noise {
  constructor(seed = 1337) {
    this.seed = seed | 0;
  }

  // value noise in [0,1]
  value(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1, y1 = y0 + 1;
    const sx = smooth(x - x0), sy = smooth(y - y0);
    const n00 = hash2(x0, y0, this.seed);
    const n10 = hash2(x1, y0, this.seed);
    const n01 = hash2(x0, y1, this.seed);
    const n11 = hash2(x1, y1, this.seed);
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
  }

  // fractal Brownian motion
  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // ridged noise — good for mountain ranges
  ridged(x, y, octaves = 5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.value(x * freq, y * freq) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
