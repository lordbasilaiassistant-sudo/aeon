// The world: a tile grid with elevation, climate, biomes and a living food layer.
// All data lives in flat typed arrays so the sim and renderer stay cache-friendly.
import { Noise } from '../core/noise.js';

export const BIOME = {
  DEEP:   0, // deep ocean
  WATER:  1, // shallow water
  SAND:   2,
  GRASS:  3,
  FOREST: 4,
  HILL:   5,
  MOUNTAIN: 6,
  SNOW:   7,
};

// base biome palette (stylized, limited hues — research: 1-5 hues, value contrast)
export const BIOME_COLOR = {
  [BIOME.DEEP]:    [40, 78, 120],
  [BIOME.WATER]:   [74, 130, 175],
  [BIOME.SAND]:    [221, 205, 156],
  [BIOME.GRASS]:   [126, 174, 95],
  [BIOME.FOREST]:  [78, 132, 78],
  [BIOME.HILL]:    [150, 150, 110],
  [BIOME.MOUNTAIN]:[140, 138, 140],
  [BIOME.SNOW]:    [236, 240, 246],
};

export class World {
  constructor(w, h, seed) {
    this.w = w;
    this.h = h;
    this.size = w * h;
    this.seed = seed;

    this.elev = new Float32Array(this.size);  // 0..1
    this.temp = new Float32Array(this.size);   // 0..1 (1 hot)
    this.moist = new Float32Array(this.size);  // 0..1
    this.biome = new Uint8Array(this.size);
    this.food = new Float32Array(this.size);   // current food 0..1
    this.fert = new Float32Array(this.size);   // max food capacity / regrow rate
    this.dev = new Uint8Array(this.size);      // 0 wild · 1 farmland · 2 urban (cities reshape the land)
    this.dirty = true; // tells renderer to rebake the terrain texture

    this.seaLevel = 0.42;
    this.generate(seed);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  generate(seed) {
    const eN = new Noise(seed);
    const mN = new Noise(seed ^ 0x9e3779b9);
    const tN = new Noise(seed ^ 0x85ebca6b);
    const cx = this.w / 2, cy = this.h / 2;
    const maxR = Math.min(cx, cy);
    const scale = 5.5 / this.w;

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        let e = eN.fbm(x * scale, y * scale, 6, 2, 0.5);
        // ridged mountains layered in
        e = e * 0.7 + eN.ridged(x * scale * 1.6, y * scale * 1.6, 4) * 0.3;
        // radial falloff -> island-ish continents, water frame
        const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        const d = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - Math.pow(d, 2.4));
        e = e * 0.78 + falloff * 0.34 - 0.06;
        e = Math.max(0, Math.min(1, e));
        this.elev[i] = e;

        // temperature: hotter near equator (mid latitude), colder high/up
        const lat = 1 - Math.abs((y / this.h) - 0.5) * 2; // 1 at equator
        let t = lat * 0.7 + 0.15 + (tN.value(x * scale * 2, y * scale * 2) - 0.5) * 0.3;
        t -= Math.max(0, e - this.seaLevel) * 0.9; // altitude cooling
        this.temp[i] = Math.max(0, Math.min(1, t));

        // moisture
        this.moist[i] = mN.fbm(x * scale * 1.3 + 99, y * scale * 1.3 + 99, 5);
      }
    }
    this.classify();
  }

  classify() {
    for (let i = 0; i < this.size; i++) {
      this.biome[i] = this._biomeFor(this.elev[i], this.temp[i], this.moist[i]);
      this.fert[i] = this._fertFor(i);
      // seed initial food proportional to fertility
      this.food[i] = this.fert[i] * 0.6;
    }
    this.dirty = true;
  }

  _biomeFor(e, t, m) {
    const sl = this.seaLevel;
    if (e < sl - 0.08) return BIOME.DEEP;
    if (e < sl) return BIOME.WATER;
    if (e < sl + 0.03) return BIOME.SAND;
    if (e > 0.82) return t < 0.35 ? BIOME.SNOW : BIOME.MOUNTAIN;
    if (e > 0.7) return BIOME.HILL;
    if (t < 0.18) return BIOME.SNOW;
    if (m > 0.55 && t > 0.3) return BIOME.FOREST;
    return BIOME.GRASS;
  }

  _fertFor(i) {
    const b = this.biome[i];
    if (b === BIOME.GRASS) return 1.0;
    if (b === BIOME.FOREST) return 0.85;
    if (b === BIOME.HILL) return 0.4;
    if (b === BIOME.SAND) return 0.15;
    if (b === BIOME.MOUNTAIN || b === BIOME.SNOW) return 0.05;
    return 0; // water
  }

  isWater(x, y) {
    if (!this.inBounds(x, y)) return true;
    // floor coords — agents move in floats; a float index into the typed biome
    // array returns undefined and would (wrongly) read as walkable (the
    // "creatures float across oceans" bug, fixed 2026-06-07).
    const b = this.biome[this.idx(x | 0, y | 0)];
    return b === BIOME.WATER || b === BIOME.DEEP;
  }

  walkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return !this.isWater(x, y);
  }

  // --- food dynamics: regrow on fertile land, faster when warm & moist ---
  growFood(dt) {
    const f = this.food, fert = this.fert, temp = this.temp;
    for (let i = 0; i < this.size; i++) {
      const cap = fert[i];
      if (cap <= 0) continue;
      if (f[i] < cap) {
        const rate = 0.06 * dt * (0.5 + temp[i]);
        f[i] = Math.min(cap, f[i] + rate * cap);
      }
    }
  }

  consumeFood(x, y, amount) {
    const i = this.idx(x | 0, y | 0);
    const got = Math.min(this.food[i], amount);
    this.food[i] -= got;
    return got;
  }

  // --- divine edits ---------------------------------------------------------
  raise(cx, cy, r, delta) {
    this._brush(cx, cy, r, (i, fall) => {
      this.elev[i] = Math.max(0, Math.min(1, this.elev[i] + delta * fall));
    });
    this._reclassRegion(cx, cy, r);
  }

  plantForest(cx, cy, r) {
    this._brush(cx, cy, r, (i) => {
      if (this.biome[i] === BIOME.GRASS || this.biome[i] === BIOME.HILL) {
        this.moist[i] = Math.min(1, this.moist[i] + 0.4);
      }
    });
    this._reclassRegion(cx, cy, r);
  }

  blessFood(cx, cy, r) {
    this._brush(cx, cy, r, (i, fall) => {
      if (this.fert[i] > 0) this.food[i] = Math.min(this.fert[i], this.food[i] + fall);
    });
  }

  _brush(cx, cy, r, fn) {
    const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(this.w - 1, (cx + r) | 0);
    const y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(this.h - 1, (cy + r) | 0);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const fall = 1 - Math.sqrt(d2) / r;
        fn(this.idx(x, y), fall);
      }
    }
  }

  _reclassRegion(cx, cy, r) {
    const x0 = Math.max(0, (cx - r - 1) | 0), x1 = Math.min(this.w - 1, (cx + r + 1) | 0);
    const y0 = Math.max(0, (cy - r - 1) | 0), y1 = Math.min(this.h - 1, (cy + r + 1) | 0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.idx(x, y);
        this.biome[i] = this._biomeFor(this.elev[i], this.temp[i], this.moist[i]);
        this.fert[i] = this._fertFor(i);
        if (this.food[i] > this.fert[i]) this.food[i] = this.fert[i];
      }
    }
    this.dirty = true;
  }
}
