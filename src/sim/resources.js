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

// which raw item id a node-type's extracted output banks into tribe.stock as.
// (matches items.js resource ids; stone/ore/wood already exist on tribe.stock.)
const RES_ITEM = ['wood', 'stone', 'ore'];

// which improvement KIND extracts each node type (mine on ore, quarry on stone,
// lumber on forest). Used by buildMine() so callers can talk in items.js terms.
const KIND_FOR_TYPE = ['lumber', 'quarry', 'mine'];
const TYPE_FOR_KIND = { lumber: RES.WOOD, quarry: RES.STONE, mine: RES.ORE };

// per-type tuning: starting amount, regrow per year (0 = finite), spawn weight
const TYPE = {
  [RES.WOOD]:  { max: 24, regen: 1.4 },
  [RES.STONE]: { max: 36, regen: 0.4 },
  [RES.ORE]:   { max: 22, regen: 0.0 }, // metal is finite — drives expansion & war
};

// REGIONAL CLUSTERING: the map is split into a coarse 3×3 grid of regions; each
// region is randomly assigned a resource "vocation" (an ore belt, a timber
// region, a quarry country, or plain). A node's spawn chance is then biased UP
// for the region's vocation and DOWN against it — so nations on the ore belt are
// metal-rich while a timber nation must TRADE for ore. Deterministic from the
// world rng (consumed once at spawn into a fixed bias table).
const REGION_DIV = 3;                 // 3×3 regions
const VOCATIONS = ['plain', RES.WOOD, RES.STONE, RES.ORE];

// extraction tuning: an improvement pulls this fraction of a node's CURRENT
// amount per year (capped), into the owning tribe's stock. Mines on finite ore
// extract slower (it's precious & hard) than lumber/quarry on renewables.
const EXTRACT_RATE = { [RES.WOOD]: 3.0, [RES.STONE]: 2.2, [RES.ORE]: 1.4 };
const EXTRACT_MAX  = { [RES.WOOD]: 6,   [RES.STONE]: 5,   [RES.ORE]: 3 };
// an improvement only feeds settlements within this radius of the node.
const IMPROVE_R  = 14;
const IMPROVE_R2 = IMPROVE_R * IMPROVE_R;

export class Resources {
  constructor() {
    this.nodes = [];
    this.grid = new Map();   // cell index -> node[]
    this.gcols = 0;
    this.improvements = [];  // claimed nodes: {node, kind, type, tribeId} — built by nations
    this._region = null;     // Int8Array of per-region vocation index (REGION_DIV²)
    this._w = 0; this._h = 0;
  }

  _cell(x, y) {
    const cx = (x / NCELL) | 0, cy = (y / NCELL) | 0;
    return cy * this.gcols + cx;
  }

  // the regional vocation at a world tile (one of VOCATIONS) — drives biased
  // spawn so nations differ in what land gives them. 'plain' = no bias.
  _vocationAt(x, y) {
    if (!this._region) return 'plain';
    const rx = Math.min(REGION_DIV - 1, (x * REGION_DIV / this._w) | 0);
    const ry = Math.min(REGION_DIV - 1, (y * REGION_DIV / this._h) | 0);
    return VOCATIONS[this._region[ry * REGION_DIV + rx]];
  }

  spawn(world, rng) {
    this.nodes.length = 0; this.grid.clear();
    this.improvements.length = 0;
    this.gcols = Math.ceil(world.w / NCELL);
    this._w = world.w; this._h = world.h;
    const W = world;
    // assign each region a vocation up front (deterministic from rng): bias the
    // mix toward resource regions so a clear ore belt / timber land emerges.
    this._region = new Int8Array(REGION_DIV * REGION_DIV);
    for (let i = 0; i < this._region.length; i++) {
      const r = rng.next();
      // 40% plain, 20% each timber/quarry/ore region
      this._region[i] = r < 0.40 ? 0 : r < 0.60 ? 1 : r < 0.80 ? 2 : 3;
    }
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
        // REGIONAL BIAS: boost the region's vocation, suppress the rest, so
        // resources cluster into belts instead of spreading evenly.
        const voc = this._vocationAt(x, y);
        if (voc !== 'plain') p *= (voc === type) ? 2.4 : 0.45;
        if (rng.next() > p) continue;
        const t = TYPE[type];
        const n = { x: x + 0.5, y: y + 0.5, type, amount: t.max, max: t.max, regen: t.regen, improved: false };
        this.nodes.push(n);
        const c = this._cell(x, y);
        let arr = this.grid.get(c); if (!arr) { arr = []; this.grid.set(c, arr); }
        arr.push(n);
      }
    }
  }

  // -------------------------------------------------------------------------
  // MINES / EXTRACTION — a nation claims a node as an IMPROVEMENT that pulls the
  // raw resource into tribe.stock each year (mine→ore, quarry→stone, lumber→wood).
  // -------------------------------------------------------------------------

  /** The improvement kind that works a node of `type` ('lumber'|'quarry'|'mine'). */
  kindForType(type) { return KIND_FOR_TYPE[type]; }

  /** The raw item id a node-type extracts into stock ('wood'|'stone'|'ore'). */
  itemForType(type) { return RES_ITEM[type]; }

  /**
   * Claim `node` as an extraction improvement for `tribeId`. `kind` is optional —
   * defaults to the natural kind for the node's type ('mine' on ore, etc). A node
   * can only be improved once. Returns the improvement record, or null.
   */
  buildMine(node, tribeId, kind) {
    if (!node || node.improved) return null;
    const want = kind || KIND_FOR_TYPE[node.type];
    // kind must match the node's resource (a mine needs ore, a quarry needs stone)
    if (TYPE_FOR_KIND[want] !== node.type) return null;
    node.improved = true;
    const imp = { node, kind: want, type: node.type, tribeId };
    this.improvements.push(imp);
    return imp;
  }

  /** Nearest UNIMPROVED node of a given type within radius (for AI siting). */
  nearestUnimproved(x, y, type, radius) {
    const cx = (x / NCELL) | 0, cy = (y / NCELL) | 0;
    let best = null, bd = radius * radius;
    for (let gy = cy - 2; gy <= cy + 2; gy++) {
      for (let gx = cx - 2; gx <= cx + 2; gx++) {
        const arr = this.grid.get(gy * this.gcols + gx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const n = arr[k];
          if (n.improved || n.amount <= 0 || (type != null && n.type !== type)) continue;
          const dx = n.x - x, dy = n.y - y, d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = n; }
        }
      }
    }
    return best;
  }

  /**
   * EXTRACTION TICK — call once per sim-year. Every improvement whose owning
   * tribe still has a settlement within IMPROVE_R of it yields its resource into
   * that tribe's stock. Renewable nodes (wood/stone) keep producing; finite ore
   * mines run dry and the improvement retires. Cheap: loops improvements only.
   *
   * `settleSys` is optional — when passed, an improvement must be near one of its
   * tribe's settlements to operate (a mine needs a town to work it). Without it,
   * every live improvement yields (useful for headless probes).
   * Returns the total amount extracted this year.
   */
  extractTick(sim, settleSys) {
    const imps = this.improvements;
    let total = 0, w = 0;
    for (let i = 0; i < imps.length; i++) {
      const imp = imps[i];
      const n = imp.node;
      const tr = sim.tribes.get(imp.tribeId);
      if (!tr || tr.members === 0) { n.improved = false; continue; } // owner gone → release
      if (n.amount <= 0) { n.improved = false; continue; }           // node exhausted → retire
      // require a settlement of this tribe in range, if we were given the system
      if (settleSys) {
        const sets = settleSys.getSettlements();
        let worked = false;
        for (let k = 0; k < sets.length; k++) {
          const s = sets[k];
          if (s.tribeId !== imp.tribeId) continue;
          const dx = s.x - n.x, dy = s.y - n.y;
          if (dx * dx + dy * dy <= IMPROVE_R2) { worked = true; break; }
        }
        if (!worked) { imps[w++] = imp; continue; } // keep it, just idle this year
      }
      const yld = Math.min(n.amount, EXTRACT_MAX[n.type], n.amount * EXTRACT_RATE[n.type] * 0.2 + 1);
      n.amount -= yld;
      const id = RES_ITEM[n.type];
      tr.stock[id] = (tr.stock[id] || 0) + yld;
      total += yld;
      imps[w++] = imp;
    }
    imps.length = w;
    return total;
  }

  /** How many improvements a tribe currently owns (for UI / AI budgeting). */
  improvementsOf(tribeId) {
    let c = 0;
    for (let i = 0; i < this.improvements.length; i++) if (this.improvements[i].tribeId === tribeId) c++;
    return c;
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
