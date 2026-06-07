// Deterministic PRNG (mulberry32) + helpers.
// Determinism matters: it lets a world be reproduced from a single seed
// (save/replay of evolved populations) — see research/03 tech-feasibility.

export class RNG {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  // raw 32-bit -> [0,1)
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    // inclusive min, exclusive max
    return Math.floor(this.float(min, max));
  }

  bool(p = 0.5) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // standard normal via Box–Muller (cached)
  gauss(mean = 0, std = 1) {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return mean + std * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * mul;
    return mean + std * (u * mul);
  }

  fork(salt = 0) {
    return new RNG((this.next() * 4294967296) ^ salt);
  }
}

// global hashing for stable per-coordinate randomness
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
