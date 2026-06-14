// Settlements — visible civilization. Where a tribe's people cluster densely a
// Camp appears; with population + tech era it grows Camp -> Village -> Town ->
// City, gaining buildings (huts -> houses -> granary -> wall -> temple -> market
// -> workshop -> smithy -> tower -> factory). Tech era gates the higher tiers and
// the advanced buildings, so progress visibly changes the skyline.
//
// Design constraints honored here:
//  - update() self-gates to once per sim-year (tick % 60), so the O(agents) scan
//    is amortised; the per-agent inner work is a tiny fixed loop, no allocation.
//  - DETERMINISTIC: never touches sim.rng (that would perturb agent evolution and
//    break the seeded world) and never uses Math.random. Cosmetic layout is hashed
//    from the settlement id via hash2().
//  - No edits to shared files: it owns the contents of sim.settlements and exposes
//    getSettlements() / bonusFor() / countOf() for the renderer and Tech systems.
import { hash2 } from '../core/rng.js';
import { ITEMS } from './items.js';

export const TIERS = ['Camp', 'Village', 'Town', 'City'];

// ---------------------------------------------------------------------------
// PRODUCTION RECIPES — derived ONCE from the item registry (items.js is the
// single source of truth). We split the craftable items by which improvement
// makes them so produceTick can run each building's recipes in one cheap pass.
//   smithy   : materials + metal tools/weapons (tech-gated)
//   workshop : stone tools/weapons + crafted goods (leather/medicine/pottery)
// Each recipe: {id, from:[itemId,...], tech, value} — `from` are consumed 1:1
// per unit produced (a recipe makes `units` of `id`, consuming `units` of each
// input). Materials are cheap-tier so they flow; finished goods cost more value.
function buildRecipes() {
  const smithy = [], workshop = [];
  for (let i = 0; i < ITEMS.length; i++) {
    const it = ITEMS[i];
    if (!it.madeBy || !it.madeFrom) continue;
    const rec = { id: it.id, from: it.madeFrom, tech: it.tech || null, value: it.value, type: it.type };
    if (it.madeBy === 'smithy') smithy.push(rec);
    else if (it.madeBy === 'workshop') workshop.push(rec);
  }
  // make cheaper items first so a smithy refines ORE→bronze/iron before it tries
  // to forge a weapon that needs that very metal this same year.
  const byVal = (a, b) => a.value - b.value;
  smithy.sort(byVal); workshop.sort(byVal);
  return { smithy, workshop };
}
const RECIPES = buildRecipes();

const SETTLE_INTERVAL = 60;   // = TICKS_PER_YEAR; settlements resolve once per year
const SETTLE_CELL     = 8;    // tiles per coarse block used to detect NEW clusters
const CLAIM_RADIUS    = 11;   // an agent within this of a town counts as its resident
const CLAIM_R2        = CLAIM_RADIUS * CLAIM_RADIUS;
const CAMP_MIN        = 8;    // residents needed to FOUND a camp (and dense-block min)
const ABANDON_MIN     = 5;    // below this a settlement starves (hysteresis vs CAMP_MIN)
const MAX_STARVE      = 3;    // years of starvation before it is abandoned
const MAX_PER_TRIBE   = 6;    // cap settlements per tribe (bounds work + render cost)
const DRIFT           = 0.15; // how fast a town re-centers on where its people are
const MAX_HOMES       = 16;   // cap dwellings so building lists stay bounded

// minimum spacing between a FOUNDED city and any existing settlement. ~5 tiles:
// a player can plant a second city a few tiles from home, but cities never stack.
const FOUND_MIN_SPACE  = 5;
const FOUND_MIN_SPACE2 = FOUND_MIN_SPACE * FOUND_MIN_SPACE;  // 25

const VILLAGE_POP = 18;
const TOWN_POP    = 38;
const CITY_POP    = 64;

const TAU = Math.PI * 2;

// place-name syllables (dead-language flavor, matching names.js)
const P_ON = ['Aer', 'Bryn', 'Cael', 'Dun', 'Eld', 'Fyr', 'Gor', 'Hald', 'Ilv',
  'Jor', 'Kel', 'Lyr', 'Mor', 'Nyr', 'Oth', 'Pyr', 'Quel', 'Rond', 'Syl', 'Tor',
  'Ulv', 'Var', 'Wyn', 'Yse', 'Zar', 'Brae', 'Cor', 'Dro'];
const P_END = ['gard', 'heim', 'hold', 'mark', 'fell', 'vale', 'reach', 'spire',
  'mire', 'crest', 'thorpe', 'wick', 'burg', 'stad', 'moor', 'haven'];

let _nextSettlementId = 1;

function placeName(id) {
  const a = P_ON[(hash2(id, 11, 3) * P_ON.length) | 0];
  const b = P_END[(hash2(id, 23, 5) * P_END.length) | 0];
  return a + b;
}

// read tech era defensively: works with the new {points,known,era} shape, and
// degrades to era 0 if Tech isn't wired yet or tribe.tech is still old-numeric.
function eraOf(tribe) {
  const t = tribe && tribe.tech;
  if (t && typeof t === 'object' && typeof t.era === 'number') return t.era;
  return 0;
}

// tier from population AND tech era — era caps the ceiling so you can't raise a
// City in the Stone Age (era 0 -> Village max, era 1 -> Town max, era 2+ -> City).
function tierFor(pop, era) {
  let t = 0;
  if (pop >= VILLAGE_POP) t = 1;
  if (pop >= TOWN_POP) t = 2;
  if (pop >= CITY_POP) t = 3;
  const cap = era <= 0 ? 1 : (era === 1 ? 2 : 3);
  return t < cap ? t : cap;
}

export class Settlement {
  constructor(id, tribeId, x, y) {
    this.id = id;
    this.tribeId = tribeId;
    this.x = x;
    this.y = y;
    this.tier = 0;            // 0 Camp .. 3 City
    this.pop = 0;
    this.buildings = [];      // [{ type, dx, dy }] — offsets in tiles from x,y
    this.name = placeName(id);
    this.hue = 0;             // tribe banner hue (kept fresh for the renderer)
    this.era = 0;
    this.radius = 1;          // footprint radius in tiles (render hint)
    this.foundedYear = 0;
    this.starve = 0;          // years below ABANDON_MIN
    this.focus = 'growth';    // player/AI city production: growth|build|military|gold|research
    this.defense = 0;         // fortification (build focus) — helps hold the city vs conquest
    // per-year accumulators (filled during the agent scan, then consumed)
    this._pop = 0; this._sx = 0; this._sy = 0;
    // building-layout cache keys (rebuild only when one of these changes)
    this._lt = -1; this._le = -1; this._lb = -1;
  }
}

export class SettlementSystem {
  constructor() {
    this.sim = null;
    this._list = null;             // -> sim.settlements
    this._index = new Map();       // tribeId -> Settlement[]  (rebuilt each year)
    this._cmap = new Map();        // (tribe,block) key -> cluster record
    this._recPool = [];            // pooled cluster records (reused across years)
    this._recN = 0;
    this._clusters = [];           // sorted cluster array (reused)
    this.byTribe = new Map();      // tribeId -> { count, pop, tierSum }  aggregate
  }

  getSettlements() {
    return this._list || (this.sim ? this.sim.settlements : []);
  }

  // Found a city on command (player/AI "settler"): a permanent settlement at (x,y)
  // if it's land and not on top of another town. Returns the Settlement or null.
  foundAt(sim, tribeId, x, y) {
    const W = sim.world;
    const ix = x | 0, iy = y | 0;
    this.lastFoundReason = null;                       // cleared on a successful found
    // walkable() is false on water AND off-map; distinguish so the UI can say why.
    if (!W.walkable(ix, iy)) {
      this.lastFoundReason = (W.inBounds(ix, iy) && W.isWater(ix, iy)) ? 'water' : 'occupied';
      return null;
    }
    if (!sim.settlements) sim.settlements = [];
    for (let i = 0; i < sim.settlements.length; i++) {
      const s = sim.settlements[i];
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < FOUND_MIN_SPACE2) {      // too close to an existing town
        this.lastFoundReason = 'too_close';
        return null;
      }
    }
    const tr = sim.tribes.get(tribeId);
    const s = new Settlement(_nextSettlementId++, tribeId, ix + 0.5, iy + 0.5);
    s.foundedYear = sim.year ? sim.year() : 0;
    if (tr) { s.hue = tr.hue; s.era = eraOf(tr); }
    // a SETTLER PARTY — relocate some of the nation's people to populate the new
    // city (so it has real residents and doesn't instantly starve & vanish).
    let moved = 0;
    const A = sim.pool.agents;
    for (let i = 0; i < A.length && moved < 14; i++) {
      const a = A[i];
      if (!a.alive || a.tribeId !== tribeId) continue;
      a.x = ix + 0.5 + (moved % 4) - 1.5;
      a.y = iy + 0.5 + (((moved / 4) | 0) - 1.5);
      a.ordered = false; a.rally = null;
      moved++;
    }
    s.pop = moved;
    s.focus = 'growth';      // a new colony prioritises growing
    s.permanent = true;      // a founded city does not get abandoned (Civ cities persist)
    // make the site a FOOD MAGNET so people stay & breed here (the reason to settle):
    // tilled, fertile land + a stock of food right now.
    const R = 6;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const tx = ix + dx, ty = iy + dy;
      if (!W.inBounds(tx, ty) || W.isWater(tx, ty)) continue;
      if (dx * dx + dy * dy > R * R) continue;
      const k = W.idx(tx, ty);
      if (W.fert[k] > 0 && W.fert[k] < 1.2) W.fert[k] = Math.min(1.3, W.fert[k] + 0.5);
      W.food[k] = W.fert[k];
    }
    this._grow(sim, s, s.era);
    sim.settlements.push(s);
    if (sim.emit && tr) sim.emit('settle', `${s.name} is founded by ${tr.name}`, s.x, s.y, tr.hue);
    return s;
  }

  // settlements registered for a tribe (read by Tech / sim for bonuses)
  countOf(tribeId) {
    const a = this.byTribe.get(tribeId);
    return a ? a.count : 0;
  }

  // small civilization bonus a tribe earns from its settlements. food: granaries
  // / markets ease eating; research: towns & cities concentrate minds. Multipliers
  // (≥1) so Tech.accrue can fold research straight into its rate.
  bonusFor(tribeId) {
    const a = this.byTribe.get(tribeId);
    if (!a) return { count: 0, food: 1, research: 1 };
    return {
      count: a.count,
      food: 1 + a.count * 0.02 + a.tierSum * 0.01,
      research: 1 + a.tierSum * 0.06,
    };
  }

  // -------------------------------------------------------------------------
  // PRODUCTION — a nation's smithies/workshops forge items.js recipes from raw
  // resources (+tech) into tribe.stock. Extends the old ore→metal line into the
  // full item tree. Capacity scales with how many/large the producing buildings
  // are: a City smithy out-forges a Village one.
  // -------------------------------------------------------------------------

  // does tribe `tribeId` have at least one settlement carrying `building`?
  // returns a CAPACITY number (0 = none) = sum over qualifying settlements of
  // (tier+1), so bigger/more cities produce more. Mirrors _layout's gates.
  _buildingCapacity(tribeId, building) {
    const arr = this._index.get(tribeId);
    let cap = 0;
    const sets = arr ? arr : this.getSettlements();
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      if (s.tribeId !== tribeId) continue;
      const era = s.era | 0, tier = s.tier | 0;
      let has = false;
      if (building === 'workshop') has = (tier >= 1 && era >= 1);
      else if (building === 'smithy') has = (tier >= 2 && era >= 3);
      if (has) cap += tier + 1;
    }
    return cap;
  }

  /**
   * PRODUCTION TICK — call once per sim-year per tribe. Runs the tribe's smithy
   * and workshop recipes (from items.js) in cheap->expensive order, consuming
   * raw inputs from tribe.stock and banking the products back into tribe.stock.
   * Tech-gated (recipe.tech must be in tribe.tech.known); throughput scales with
   * building capacity (city tier). Returns a {id:qtyProduced} map of what it made.
   */
  produceTick(sim, tribe) {
    if (!tribe || tribe.members === 0 || !tribe.stock) return null;
    const known = (tribe.tech && tribe.tech.known) ? tribe.tech.known : null;
    const stock = tribe.stock;
    let out = null;
    const runLine = (recipes, building) => {
      const cap = this._buildingCapacity(tribe.id, building);
      if (cap <= 0) return;
      // per-recipe unit budget grows with capacity and a little with population.
      // MATERIALS (bronze/iron/steel) get a bigger budget so they pile up a
      // surplus; finished goods (tools/weapons) draw a SMALLER share, so a single
      // tool recipe can't starve the weapon recipe of the same metal — the
      // intermediate is shared across the products that depend on it.
      const matBudget  = Math.max(2, Math.round(cap * 3.0 + tribe.members * 0.03));
      const goodBudget = Math.max(1, Math.round(cap * 1.0 + tribe.members * 0.015));
      for (let r = 0; r < recipes.length; r++) {
        const rec = recipes[r];
        if (rec.tech && (!known || !known.has(rec.tech))) continue; // tech-gated
        // how many units can we afford? limited by the scarcest input AND by the
        // per-recipe budget (materials forge more freely than finished goods).
        let units = (rec.type === 'material') ? matBudget : goodBudget;
        for (let f = 0; f < rec.from.length; f++) {
          const have = stock[rec.from[f]] || 0;
          if (have < units) units = have | 0;
        }
        if (units <= 0) continue;
        for (let f = 0; f < rec.from.length; f++) stock[rec.from[f]] -= units;
        stock[rec.id] = (stock[rec.id] || 0) + units;
        if (!out) out = {};
        out[rec.id] = (out[rec.id] || 0) + units;
      }
    };
    runLine(RECIPES.smithy, 'smithy');     // materials first, then metal tools/weapons
    runLine(RECIPES.workshop, 'workshop'); // stone gear + crafted goods
    return out;
  }

  // Found an extraction improvement (mine/quarry/lumber) for a tribe on the best
  // nearby unworked node of its choosing — used by the AI/player to start mining.
  // Sites near the tribe's settlements so extractTick will work it. Returns the
  // improvement record or null.
  buildMineNear(sim, tribe, type) {
    if (!tribe || !sim.resources) return null;
    const arr = this._index.get(tribe.id) || this.getSettlements();
    let best = null;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (s.tribeId !== tribe.id) continue;
      const node = sim.resources.nearestUnimproved(s.x, s.y, type, 14);
      if (node) { best = node; break; }
    }
    if (!best) return null;
    return sim.resources.buildMine(best, tribe.id);
  }

  update(sim, dt) {
    // self-gate: resolve settlements once per sim-year
    if (sim.tick % SETTLE_INTERVAL !== 0) return;
    if (!sim.settlements) sim.settlements = [];
    this.sim = sim;
    this._list = sim.settlements;
    const list = this._list;
    const world = sim.world;
    const year = (sim.tick / SETTLE_INTERVAL) | 0;

    // --- build tribe -> settlements index + reset per-year accumulators --------
    const index = this._index;
    index.clear();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s._pop = 0; s._sx = 0; s._sy = 0;
      let arr = index.get(s.tribeId);
      if (!arr) { arr = []; index.set(s.tribeId, arr); }
      arr.push(s);
    }

    // --- single pass over agents: assign each to its tribe's nearest town, or ---
    // --- bucket the unclaimed into coarse blocks as candidate new clusters ------
    const cmap = this._cmap; cmap.clear();
    this._recN = 0;
    const bcols = Math.ceil(world.w / SETTLE_CELL);
    const brows = Math.ceil(world.h / SETTLE_CELL);
    const blocks = bcols * brows;
    const A = sim.pool.agents;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive) continue;
      const arr = index.get(a.tribeId);
      let best = null, bestD = CLAIM_R2;
      if (arr) {
        for (let j = 0; j < arr.length; j++) {
          const s = arr[j];
          const dx = s.x - a.x, dy = s.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) { bestD = d2; best = s; }
        }
      }
      if (best) {
        best._pop++; best._sx += a.x; best._sy += a.y;
      } else {
        const bx = (a.x / SETTLE_CELL) | 0;
        const by = (a.y / SETTLE_CELL) | 0;
        const key = a.tribeId * blocks + (by * bcols + bx);
        let rec = cmap.get(key);
        if (!rec) {
          rec = this._recPool[this._recN];
          if (!rec) { rec = { tid: 0, count: 0, sx: 0, sy: 0 }; this._recPool[this._recN] = rec; }
          this._recN++;
          rec.tid = a.tribeId; rec.count = 0; rec.sx = 0; rec.sy = 0;
          cmap.set(key, rec);
        }
        rec.count++; rec.sx += a.x; rec.sy += a.y;
      }
    }

    // --- grow / drift existing settlements -------------------------------------
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const tribe = sim.tribes.get(s.tribeId);
      s.pop = s._pop;
      // settlements are PERMANENT — founded once at a fixed spot and never move
      // (Civ-style: a settler founds a city and it stays put). If the population
      // drifts away the town starves and is eventually abandoned, but it never walks.
      if (tribe) { s.hue = tribe.hue; s.era = eraOf(tribe); }
      this._grow(sim, s, s.era);
      if (s.pop < ABANDON_MIN) s.starve++; else s.starve = 0;
    }

    // --- cities reshape the land: urban core + cultivated farmland --------------
    // (visible on the map, and farmland raises local food so cities feed bigger pops)
    let devChanged = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const r = Math.max(2, s.radius);
      const ri = r | 0;
      const cx = s.x | 0, cy = s.y | 0;
      const x0 = Math.max(0, cx - ri), x1 = Math.min(world.w - 1, cx + ri);
      const y0 = Math.max(0, cy - ri), y1 = Math.min(world.h - 1, cy + ri);
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (world.isWater(x, y)) continue;
          const dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const idx = world.idx(x, y);
          const want = d2 < 2.3 ? 2 : 1;   // urban core vs farmland ring
          if (world.dev[idx] < want) {
            world.dev[idx] = want; devChanged = true;
            if (want === 1 && world.fert[idx] > 0 && world.fert[idx] < 1.1) {
              world.fert[idx] = Math.min(1.2, world.fert[idx] + 0.3); // tilled land yields more
            }
          }
        }
      }
    }
    if (devChanged) world.dirty = true;

    // --- found new settlements from dense unclaimed clusters --------------------
    const clusters = this._clusters; clusters.length = 0;
    for (const rec of cmap.values()) if (rec.count >= CAMP_MIN) clusters.push(rec);
    // deterministic order: densest first, full tiebreak chain
    clusters.sort((p, q) =>
      (q.count - p.count) || (p.tid - q.tid) || (p.sx - q.sx) || (p.sy - q.sy));
    for (let i = 0; i < clusters.length; i++) {
      const rec = clusters[i];
      const tribe = sim.tribes.get(rec.tid);
      if (!tribe || tribe.members === 0) continue;
      let arr = index.get(rec.tid);
      if (arr && arr.length >= MAX_PER_TRIBE) continue;
      const cx = rec.sx / rec.count;
      const cy = rec.sy / rec.count;
      // don't found on top of an existing town of the same tribe
      let tooClose = false;
      if (arr) {
        for (let j = 0; j < arr.length; j++) {
          const s = arr[j];
          const dx = s.x - cx, dy = s.y - cy;
          if (dx * dx + dy * dy < CLAIM_R2) { tooClose = true; break; }
        }
      }
      if (tooClose) continue;
      if (!world.walkable(cx | 0, cy | 0)) continue;
      const s = new Settlement(_nextSettlementId++, rec.tid, cx, cy);
      s.pop = rec.count;
      s.hue = tribe.hue;
      s.era = eraOf(tribe);
      s.foundedYear = year;
      this._grow(sim, s, s.era);
      list.push(s);
      if (!arr) { arr = []; index.set(rec.tid, arr); }
      arr.push(s);
      sim.emit('settle', `${s.name} is founded by ${tribe.name}`, s.x, s.y, tribe.hue);
    }

    // --- dissolve: tribe gone, or starved out ----------------------------------
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const s = list[r];
      const tribe = sim.tribes.get(s.tribeId);
      const gone = !tribe || tribe.members === 0;
      if (gone || (s.starve > MAX_STARVE && !s.permanent)) {
        sim.emit('abandon', `${s.name} lies abandoned`, s.x, s.y, s.hue);
        continue; // drop
      }
      list[w++] = s;
    }
    list.length = w;

    // --- rebuild per-tribe aggregate for bonus reads ---------------------------
    const by = this.byTribe; by.clear();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      let a = by.get(s.tribeId);
      if (!a) { a = { count: 0, pop: 0, tierSum: 0 }; by.set(s.tribeId, a); }
      a.count++; a.pop += s.pop; a.tierSum += s.tier + 1;
    }
  }

  // set tier from pop+era, rebuild building layout if it changed, announce upgrades
  _grow(sim, s, era) {
    const oldTier = s.tier;
    const tier = tierFor(s.pop, era);
    s.tier = tier;
    const bracket = (Math.min(s.pop, MAX_HOMES * 6) / 8) | 0;
    if (tier !== s._lt || era !== s._le || bracket !== s._lb) {
      this._layout(s, tier, era, s.pop);
      s._lt = tier; s._le = era; s._lb = bracket;
    }
    if (tier > oldTier && oldTier >= 0) {
      sim.emit('grow', `${s.name} grows into a ${TIERS[tier]}`, s.x, s.y, s.hue);
    }
  }

  // deterministic building list for tier+era+pop. Offsets are hashed from the
  // settlement id so the skyline is stable frame-to-frame and unique per town.
  _layout(s, tier, era, pop) {
    const b = s.buildings; b.length = 0;
    const id = s.id;
    const homes = Math.min(MAX_HOMES, 3 + ((pop / 6) | 0));
    // dwelling style advances with era: hut -> house -> stone block
    const dwelling = era >= 4 ? 'block' : (era >= 2 ? 'house' : 'hut');
    const radius = 1.0 + tier * 1.3 + Math.sqrt(homes) * 0.35;
    s.radius = radius;
    let k = 0;
    const place = (type, ring) => {
      const ang = hash2(id, k, 7) * TAU;
      const u = hash2(id, k, 9);
      const rr = (ring === 2 ? 0.85 + u * 0.18
        : ring === 1 ? 0.35 + u * 0.45
          : u * 0.28) * radius;
      b.push({ type, dx: Math.cos(ang) * rr, dy: Math.sin(ang) * rr });
      k++;
    };
    for (let i = 0; i < homes; i++) place(dwelling, 1);
    // civic + defensive buildings by tier, advanced ones gated by era
    if (tier >= 1) place('granary', 1);
    if (tier >= 1 && era >= 1) place('workshop', 1);
    if (tier >= 2) { place('temple', 0); place('market', 1); place('wall', 2); }
    if (tier >= 2 && era >= 3) place('smithy', 1);
    if (tier >= 3) { place('keep', 0); place('tower', 2); place('tower', 2); }
    if (tier >= 3 && era >= 4) place('cathedral', 0);
    if (tier >= 3 && era >= 6) place('factory', 2);
  }
}
