// Resources — harvestable nodes on the map (wood, stone, ore). Workers gather
// from a node they stand on, haul it home, and it lands in the nation stockpile.
// Nodes DEPLETE visibly; forests/quarries regrow slowly; metal ore is finite.
//
// Engineering notes: nodes are fixed once placed, so they live in a static coarse
// grid (cell = 8 tiles) — nearestTo() scans only the 3×3 cells around a point, so
// per-agent sensing stays cheap even with hundreds of nodes. Deterministic: uses
// the sim rng passed at spawn; no Math.random.
const NCELL = 8;

export const RES = { WOOD: 0, STONE: 1, ORE: 2 };
export const RES_NAME = ['wood', 'stone', 'ore'];

// per-type tuning: starting amount, regrow per year (0 = finite), spawn weight
const TYPE = {
  [RES.WOOD]:  { max: 24, regen: 1.4 },
  [RES.STONE]: { max: 36, regen: 0.4 },
  [RES.ORE]:   { max: 22, regen: 0.0 }, // metal is finite — drives expansion & war
};

export class Resources {
  constructor() {
    this.nodes = [];
    this.grid = new Map();   // cell index -> node[]
    this.gcols = 0;
  }

  _cell(x, y) {
    const cx = (x / NCELL) | 0, cy = (y / NCELL) | 0;
    return cy * this.gcols + cx;
  }

  spawn(world, rng) {
    this.nodes.length = 0; this.grid.clear();
    this.gcols = Math.ceil(world.w / NCELL);
    const W = world;
    for (let y = 1; y < W.h - 1; y++) {
      for (let x = 1; x < W.w - 1; x++) {
        if (W.isWater(x, y)) continue;
        const b = W.biome[W.idx(x, y)];
        let type = -1, p = 0;
        // forests → wood; hills/mountains → stone & ore (ore rarer)
        if (b === 4 /*FOREST*/) { type = RES.WOOD; p = 0.018; }
        else if (b === 6 /*MOUNTAIN*/ || b === 5 /*HILL*/) {
          const r = rng.next();
          if (r < 0.012) { type = RES.ORE; p = 1; }
          else if (r < 0.04) { type = RES.STONE; p = 1; }
        } else if (b === 3 /*GRASS*/) { type = RES.WOOD; p = 0.004; } // scattered groves
        if (type < 0) continue;
        if (rng.next() > p) continue;
        const t = TYPE[type];
        const n = { x: x + 0.5, y: y + 0.5, type, amount: t.max, max: t.max, regen: t.regen };
        this.nodes.push(n);
        const c = this._cell(x, y);
        let arr = this.grid.get(c); if (!arr) { arr = []; this.grid.set(c, arr); }
        arr.push(n);
      }
    }
  }

  // nearest non-empty node within radius (scans the 3×3 node cells around x,y)
  nearestTo(x, y, radius) {
    const cx = (x / NCELL) | 0, cy = (y / NCELL) | 0;
    let best = null, bd = radius * radius;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const arr = this.grid.get(gy * this.gcols + gx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const n = arr[k];
          if (n.amount <= 0) continue;
          const dx = n.x - x, dy = n.y - y, d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = n; }
        }
      }
    }
    return best;
  }

  harvest(node, amt) {
    const got = Math.min(node.amount, amt);
    node.amount -= got;
    return got;
  }

  // yearly regrowth (forests/quarries recover; ore does not)
  regen(dt) {
    const N = this.nodes;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.regen > 0 && n.amount < n.max) n.amount = Math.min(n.max, n.amount + n.regen);
    }
  }
}
