// The simulation core. Owns the world, the population, the tribes, and the
// per-tick loop: sense -> think (neural net) -> act -> live/die -> evolve.
import { World, BIOME } from './world.js';
import { AgentPool } from './agent.js';
import { Tribe } from './tribe.js';
import { TechSystem } from './tech.js';
import { SettlementSystem } from './settlement.js';
import { Culture } from './culture.js';
import { Diplomacy } from './diplomacy.js';
import { Governance } from '../game/governance.js';
import { HERITAGE_BY_ID } from './heritage.js';
import { Territory } from './territory.js';
import { Resources, RES_NAME } from './resources.js';
import { Civics } from './civics.js';
import { Anthropology } from './anthropology.js';
import { Animals } from './animals.js';
import { buildField, stepFrom } from './pathfind.js';
import {
  think, breed, clone, randomGenome, distance,
  N_IN, N_OUT, SENSE, ACT,
} from './brain.js';
import { RNG, hash2 } from '../core/rng.js';

const I = {}; SENSE.forEach((s, i) => (I[s] = i));
const O = {}; ACT.forEach((a, i) => (O[a] = i));

export const TICKS_PER_YEAR = 60;

const BREED_ENERGY = 0.68;   // min energy to reproduce
const BREED_COST   = 0.42;   // energy spent making a child
const CELL = 6;              // spatial-grid cell size in tiles

export class Sim {
  constructor({ w = 240, h = 150, seed = 12345, cap = 3000 } = {}) {
    this.rng = new RNG(seed);
    this.world = new World(w, h, seed);
    this.pool = new AgentPool(cap);
    this.tribes = new Map();
    this.tick = 0;
    this.maxGen = 0;
    this.peakFitness = 0;
    this.births = 0;
    this.deaths = 0;

    // civilization systems (each self-gates / runs once per sim-year)
    this.tech = new TechSystem();          // gated tech progression + eras
    this.settlements = [];                 // visible settlements (camps→cities)
    this.settleSys = new SettlementSystem();
    this.culture = new Culture();          // language drift + religion
    // statecraft: symmetric human/AI nation layer (per-pair diplomacy + governance)
    this.diplomacy = new Diplomacy();      // stances, war pressure, grievances, auto-resolution
    this.governance = new Governance();    // GovernanceAPI levers + AI yearly turns
    this.territory = new Territory(this.world); // tile ownership + country borders
    this.resources = new Resources();           // harvestable wood/stone/ore nodes
    this.resources.spawn(this.world, this.rng);
    this.civics = new Civics();                 // culture tree → governments + society bonuses
    this.anthro = new Anthropology();           // emergent cultural identity (ethos + customs)
    this.animals = new Animals();               // wilderness ecosystem (prey + predators)
    this.animals.spawn(this);

    // spatial grid
    this.gcols = Math.ceil(w / CELL);
    this.grows = Math.ceil(h / CELL);
    this.grid = Array.from({ length: this.gcols * this.grows }, () => []);

    // scratch
    this.input = new Float32Array(N_IN);
    this.output = new Float32Array(N_OUT);

    // listeners for narrative events (births of nations, extinctions, wars)
    this.onEvent = null;

    // possession: when set, the player supplies this agent's movement intent
    // (its brain still senses, eats, fights, breeds — the player just walks it).
    this.controlled = null;
    this.controlVec = { x: 0, y: 0 };

    this.seedLife();
  }

  emit(type, msg, x, y, color) {
    if (this.onEvent) this.onEvent({ type, msg, x, y, color, tick: this.tick });
  }

  // --- seeding -------------------------------------------------------------
  seedLife(nTribes = 5, perTribe = 40) {
    for (let t = 0; t < nTribes; t++) {
      const spot = this.findLand();
      if (!spot) continue;
      const founder = randomGenome(this.rng);
      const hue = (t * 67 + this.rng.int(0, 30)) % 360;
      const tribe = new Tribe(this.rng, hue, founder);
      tribe.foundedYear = 0;
      this.tribes.set(tribe.id, tribe);
      this.tech.initTribe(tribe); this.civics.initTribe(tribe); this.anthro.initTribe(tribe);              // tribe.tech + tribe.caps
      this.culture.initTribe(tribe, this.rng); // language + faith seed
      for (let k = 0; k < perTribe; k++) {
        const a = this.pool.alloc();
        if (!a) break;
        const g = clone(founder, this.rng, 0.05, 0.3);
        const x = Math.max(1, Math.min(this.world.w - 2, spot.x + this.rng.gauss(0, 4)));
        const y = Math.max(1, Math.min(this.world.h - 2, spot.y + this.rng.gauss(0, 4)));
        a.spawn(x, y, g, tribe.id, this.rng, 0);
      }
    }
  }

  findLand(tries = 200) {
    for (let i = 0; i < tries; i++) {
      const x = this.rng.int(2, this.world.w - 2);
      const y = this.rng.int(2, this.world.h - 2);
      if (this.world.walkable(x, y) && this.world.fert[this.world.idx(x, y)] > 0.4) {
        return { x, y };
      }
    }
    return null;
  }

  // A good homeland: fertile, and as FAR from existing peoples as possible (so the
  // player's nation isn't boxed in at the start). `coastal` prefers a shoreline.
  findStartSpot(coastal = false, samples = 260) {
    const W = this.world;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < samples; i++) {
      const x = this.rng.int(3, W.w - 3);
      const y = this.rng.int(3, W.h - 3);
      if (!W.walkable(x, y)) continue;
      const fert = W.fert[W.idx(x, y)];
      if (fert < 0.45) continue;
      // distance to nearest existing capital (want it large)
      let nearest = Infinity;
      for (const tr of this.tribes.values()) {
        if (tr.members === 0) continue;
        const dx = tr.capitalX - x, dy = tr.capitalY - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearest) nearest = d;
      }
      if (nearest === Infinity) nearest = W.w; // first people
      let score = nearest * 1.0 + fert * 30;
      if (coastal) {
        // bonus if water is within ~4 tiles
        let coast = false;
        for (let r = 1; r <= 4 && !coast; r++) {
          if (W.isWater(x + r, y) || W.isWater(x - r, y) || W.isWater(x, y + r) || W.isWater(x, y - r)) coast = true;
        }
        score += coast ? 40 : -60;
      }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best || this.findLand();
  }

  // Create the PLAYER's people (Survival mode "Create Your People"). Applies the
  // chosen heritage traits onto the founding genome, names + colors the nation,
  // plants it on a good homeland away from rivals, and seeds its first generation.
  createPlayerPeople({ name, hue = 210, traits = [], size = 52 } = {}) {
    const founder = randomGenome(this.rng);
    let coastal = false;
    const policyLean = {};
    for (const id of traits) {
      const h = HERITAGE_BY_ID.get(id);
      if (!h) continue;
      if (h.apply) h.apply(founder);
      if (h.coastal) coastal = true;
      if (h.policy) for (const k in h.policy) policyLean[k] = (policyLean[k] || 0) + h.policy[k];
    }
    const spot = this.findStartSpot(coastal) || { x: this.world.w / 2, y: this.world.h / 2 };
    const tribe = new Tribe(this.rng, hue, founder);
    if (name && name.trim()) tribe.name = name.trim();
    tribe.foundedYear = this.year();
    tribe.isHomeland = true;
    tribe.capitalX = spot.x; tribe.capitalY = spot.y; // anchor capital to the homeland NOW
    this.startSpot = { x: spot.x, y: spot.y };          // so the camera can center on it at launch
    this.tribes.set(tribe.id, tribe);
    this.tech.initTribe(tribe); this.civics.initTribe(tribe); this.anthro.initTribe(tribe);
    this.culture.initTribe(tribe, this.rng);
    this.governance.ensurePolicy(tribe);
    // LEADER-AI v0 (control model #10): a player's nation is NEVER unmanaged. Until the human
    // legislates/acts, a conservative auto-ruler keeps it viable (so it can't passively collapse).
    // game.js flips this off the moment the player touches a lever ("you take the throne").
    tribe.autopilot = true;
    for (const k in policyLean) tribe.policy[k] = Math.max(-1, Math.min(1, (tribe.policy[k] || 0) + policyLean[k]));
    for (let k = 0; k < size; k++) {
      const a = this.pool.alloc();
      if (!a) break;
      const px = Math.max(1, Math.min(this.world.w - 2, spot.x + this.rng.gauss(0, 4)));
      const py = Math.max(1, Math.min(this.world.h - 2, spot.y + this.rng.gauss(0, 4)));
      a.spawn(px, py, clone(founder, this.rng, 0.04, 0.25), tribe.id, this.rng, 0);
    }
    // a generous starting larder so a LED homeland isn't a death-trap on harsh seeds (balance:
    // a survivable start, but thriving/winning still takes good play — not too easy, not too hard).
    this.world.blessFood(spot.x, spot.y, 11);
    this.world.blessFood(spot.x, spot.y, 6);
    this.emit('born', `${tribe.name} take their first breath`, spot.x, spot.y, hue);
    return tribe;
  }

  // --- grid ---------------------------------------------------------------
  cellOf(x, y) {
    const cx = Math.min(this.gcols - 1, Math.max(0, (x / CELL) | 0));
    const cy = Math.min(this.grows - 1, Math.max(0, (y / CELL) | 0));
    return cy * this.gcols + cx;
  }

  rebuildGrid() {
    for (let i = 0; i < this.grid.length; i++) this.grid[i].length = 0;
    const A = this.pool.agents;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.alive) this.grid[this.cellOf(a.x, a.y)].push(a);
    }
  }

  // Visit nearby agents. `cap` bounds work in dense clusters: an agent only
  // needs its nearest kin/foe/mate, not every one of 50 neighbours. We stride
  // through crowded cells so the sample stays spatially representative.
  forNeighbors(a, fn, cap = 24) {
    const cx = Math.min(this.gcols - 1, Math.max(0, (a.x / CELL) | 0));
    const cy = Math.min(this.grows - 1, Math.max(0, (a.y / CELL) | 0));
    let seen = 0;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= this.grows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= this.gcols) continue;
        const cell = this.grid[gy * this.gcols + gx];
        const step = cell.length > cap ? Math.ceil(cell.length / cap) : 1;
        for (let k = 0; k < cell.length; k += step) {
          const b = cell[k];
          if (b !== a && b.alive) { fn(b); if (++seen >= cap) return; }
        }
      }
    }
  }

  // --- main step ----------------------------------------------------------
  step() {
    const dt = 1;
    this.tick++;
    if (this.tick % 4 === 0) this.world.growFood(4);
    this.rebuildGrid();

    for (const tr of this.tribes.values()) tr.beginFrame();

    const A = this.pool.agents;
    const W = this.world;

    for (let idx = 0; idx < A.length; idx++) {
      const a = A[idx];
      if (!a.alive) continue;
      this.senseThinkAct(a, W, dt);
      if (!a.alive) continue;
      const tr = this.tribes.get(a.tribeId);
      if (tr) {
        tr.noteMember(a.x, a.y);
        if (a.generation > this.maxGen) this.maxGen = a.generation;
        if (a.fitness > this.peakFitness) this.peakFitness = a.fitness;
      }
    }

    // finalize tribes; advance tech once per year; cull dead ones
    for (const [id, tr] of this.tribes) {
      tr.endFrame();
      if (this.tick % TICKS_PER_YEAR === 0 && tr.members > 0) {
        tr.tech.settleBonus = this.settleSys.bonusFor(tr.id).count * 0.6; // settlements speed research
        // tech priority: claim the next affordable step toward the chosen tech (player + AI)
        const steered = this.governance.steerResearch(this, tr);
        for (let si = 0; si < steered.length; si++) {
          const td = steered[si];
          this.emit('tech', `${tr.name} discovers ${td.name} — ${this.tech.eraName(td.era)} Era`, tr.capitalX, tr.capitalY, tr.hue);
        }
        const unlocked = this.tech.accrue(tr, 1, this.rng);
        for (let ui = 0; ui < unlocked.length; ui++) {
          const td = unlocked[ui];
          this.emit('tech', `${tr.name} discovers ${td.name} — ${this.tech.eraName(td.era)} Era`, tr.capitalX, tr.capitalY, tr.hue);
        }
        // civics (culture tree) → governments + society-wide bonuses
        const civU = this.civics.accrue(tr, 1, this.rng);
        for (let ci = 0; ci < civU.length; ci++) {
          const c = civU[ci];
          this.emit('civic', `${tr.name} adopts ${c.name}${c.gov ? ' — now a ' + this.civics.governmentName(tr) : ''}`, tr.capitalX, tr.capitalY, tr.hue);
        }
        this.tech.recompute(tr);   // clean caps base from tech (idempotent)
        this.civics.apply(tr);     // fold civic + government multipliers on top
        // treasury income — funds territorial expansion, trade & upkeep
        tr.gold += tr.members * 0.04 + this.settleSys.countOf(tr.id) * 1.5;
        // refinement: ore + metalworking tech + a town (smithy) → METAL. This is
        // the "build up to it" gate — raw ore barely helps; refined metal arms an army.
        const metalTech = tr.tech.known.has('Bronzeworking') || tr.tech.known.has('IronWorking');
        if (metalTech && this.settleSys.countOf(tr.id) > 0 && tr.stock.ore > 0) {
          const refined = Math.min(tr.stock.ore, 2 + tr.members * 0.02);
          tr.stock.ore -= refined; tr.stock.metal += refined;
        }
        // VEHICLES: a seafaring people (Sailing + wood + a town) launches boats so
        // its folk can finally cross the sea; Flight + metal builds planes. Crews are
        // citizens, who then explore/colonize/raid across water & sky.
        if (tr.caps && tr.caps.seafaring && this.settleSys.countOf(tr.id) > 0 && tr.stock.wood >= 4) {
          const can = Math.min(3, Math.floor(tr.stock.wood / 4));
          tr.stock.wood -= this.grantVehicles(tr, 1, can) * 4;
        }
        if (tr.caps && tr.caps.flight && tr.stock.metal >= 6) {
          const can = Math.min(2, Math.floor(tr.stock.metal / 6));
          tr.stock.metal -= this.grantVehicles(tr, 2, can) * 6;
        }
      }
      if (tr.members === 0 && !tr.isPlayer) {
        this.emit('extinct', `${tr.name} has died out`, tr.capitalX, tr.capitalY, tr.hue);
        this.tribes.delete(id);
      }
    }

    // visible civilization + culture + territory (all self-gate to once per sim-year)
    this.settleSys.update(this, 1);
    this.culture.tick(this, 1);
    this.anthro.tick(this, 1);     // emergent cultural identity (ethos + customs)
    this.animals.update(this, 1);  // wilderness ecosystem (prey graze, predators hunt)
    this.territory.update(this);
    if (this.tick % TICKS_PER_YEAR === 0) this.resources.regen(1); // forests/quarries recover

    // statecraft: diplomacy maintenance (self-gates to once/year) + each AI nation's yearly turn
    this.diplomacy.tick(this);
    if (this.tick % TICKS_PER_YEAR === 0) {
      for (const tr of this.tribes.values()) {
        if (tr.members === 0) continue;
        if (!tr.isPlayer) this.governance.aiTurn(this, tr);             // rival nations: their own leader-AI
        else if (tr.autopilot) this.governance.autopilotTurn(this, tr); // player's nation, hands-off: leader-AI v0 keeps it alive
      }
      this.governance.checkDestinies(this); // one-time toast when a nation fulfils its destiny
      this.assignRoles();                   // size each nation's army from its militarism
      // CITY PRODUCTION FOCUS — each city does what the player/AI set it to do
      for (let si = 0; si < this.settlements.length; si++) {
        const s = this.settlements[si];
        const tr = this.tribes.get(s.tribeId);
        if (!tr || tr.members === 0) continue;
        switch (s.focus) {
          case 'gold': tr.gold += 3; break;
          case 'research': tr.tech.points += 4; break;
          case 'growth': this.world.blessFood(s.x, s.y, 6); break;
          case 'build': if (tr.stock.stone >= 2) { tr.stock.stone -= 2; s.defense = Math.min(50, (s.defense || 0) + 3); } break;
          case 'military': this.trainSoldier(s, tr); break;
        }
      }
    }
  }

  senseThinkAct(a, W, dt) {
    const inp = this.input;
    inp.fill(0);
    inp[I.bias] = 1;
    inp[I.energy] = a.energy;
    inp[I.age] = a.age / a.maxAge;
    inp[I.health] = a.health;

    const ix = a.x | 0, iy = a.y | 0;
    const here = W.idx(ix, iy);
    inp[I.food_here] = W.food[here]; // always fresh (cheap single lookup)
    inp[I.elevation] = W.elev[here];
    inp[I.temperature] = W.temp[here];

    // Directional food/water scan is the hot path: O(vision^2) tiles per agent.
    // Food barely moves, so refresh it only every few ticks (staggered by id to
    // spread the cost across frames) and reuse the cached direction otherwise.
    a.senseAge++;
    if (a.senseAge >= 3 || (this.tick + a.id) % 3 === 0) {
      a.senseAge = 0;
      const vr = Math.round(a.vision);
      let bestFood = -1, fbx = 0, fby = 0;
      let bestWater = -1, wbx = 0, wby = 0;
      for (let dy = -vr; dy <= vr; dy++) {
        const ty = iy + dy;
        if (ty < 0 || ty >= W.h) continue;
        for (let dx = -vr; dx <= vr; dx++) {
          const tx = ix + dx;
          if (tx < 0 || tx >= W.w) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 > vr * vr) continue;
          const ti = ty * W.w + tx;
          if (W.food[ti] > 0.05 && (bestFood < 0 || d2 < bestFood)) { bestFood = d2; fbx = dx; fby = dy; }
          const b = W.biome[ti];
          if ((b === BIOME.WATER || b === BIOME.DEEP) && (bestWater < 0 || d2 < bestWater)) { bestWater = d2; wbx = dx; wby = dy; }
        }
      }
      if (bestFood >= 0) { const d = Math.sqrt(bestFood) || 1; a.sFoodDx = fbx / d; a.sFoodDy = fby / d; a.sFoodDist = Math.min(1, Math.sqrt(bestFood) / vr); }
      else { a.sFoodDx = 0; a.sFoodDy = 0; a.sFoodDist = 1; }
      if (bestWater >= 0) { const d = Math.sqrt(bestWater) || 1; a.sWaterDx = wbx / d; a.sWaterDy = wby / d; }
      else { a.sWaterDx = 0; a.sWaterDy = 0; }
    }
    inp[I.food_dx] = a.sFoodDx; inp[I.food_dy] = a.sFoodDy; inp[I.food_dist] = a.sFoodDist;
    inp[I.water_dx] = a.sWaterDx; inp[I.water_dy] = a.sWaterDy;

    // neighbor agents: nearest kin / foe, densities, threat
    let kinD = -1, kbx = 0, kby = 0, kinN = 0;
    let foeD = -1, xbx = 0, xby = 0, foeN = 0, foeStr = 0;
    let otherN = 0;
    let nearestFoe = null;
    let nearestKinMate = null, mateD = -1;
    const dip = this.diplomacy;
    this.forNeighbors(a, (b) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > a.vision * a.vision) return;
      if (b.tribeId === a.tribeId) {
        kinN++;
        if (kinD < 0 || d2 < kinD) { kinD = d2; kbx = dx; kby = dy; }
        if (b.energy > 0.5 && b.cooldownBreed === 0 && (mateD < 0 || d2 < mateD)) { mateD = d2; nearestKinMate = b; }
      } else if (dip && dip.hostile(this, a.tribeId, b.tribeId)) {
        // FOE only if our nations are at war or rivals — neutrals/allies are never attacked
        foeN++;
        if (foeD < 0 || d2 < foeD) { foeD = d2; xbx = dx; xby = dy; nearestFoe = b; }
      } else {
        otherN++; // neutral / allied stranger: counts toward crowding, never a target
      }
    });
    if (kinD >= 0) { const d = Math.sqrt(kinD) || 1; inp[I.kin_dx] = kbx / d; inp[I.kin_dy] = kby / d; }
    if (foeD >= 0) { const d = Math.sqrt(foeD) || 1; inp[I.foe_dx] = xbx / d; inp[I.foe_dy] = xby / d; }
    inp[I.kin_density] = Math.min(1, kinN / 8);
    inp[I.foe_density] = Math.min(1, foeN / 8);
    inp[I.crowding] = Math.min(1, (kinN + foeN + otherN) / 12);
    if (nearestFoe) inp[I.foe_threat] = Math.max(-1, Math.min(1, (nearestFoe.strength - a.strength)));
    inp[I.reproduce_rdy] = (a.energy > BREED_ENERGY && a.age > a.maxAge * 0.12 && a.cooldownBreed === 0) ? 1 : 0;

    // national will injected as drives (this is "playing as a nation")
    const tr = this.tribes.get(a.tribeId);
    if (tr) {
      inp[I.will_aggression] = tr.policy.aggression;
      inp[I.will_expansion] = tr.policy.expansion;
      inp[I.will_breed] = tr.policy.breed;
    }

    // resource + home senses for the gather → haul → stockpile economy
    inp[I.carrying] = a.carryType >= 0 ? 1 : 0;
    inp[I.thirst] = 1 - a.hydration;   // drives seeking water (which it already senses)
    let rnode = null;
    if (a.carryType < 0) {                              // free hands look for a node
      rnode = this.resources.nearestTo(a.x, a.y, a.vision + 2);
      if (rnode) { const dx = rnode.x - a.x, dy = rnode.y - a.y, d = Math.hypot(dx, dy) || 1; inp[I.res_dx] = dx / d; inp[I.res_dy] = dy / d; inp[I.res_dist] = Math.min(1, d / (a.vision + 2)); }
      else inp[I.res_dist] = 1;
    } else inp[I.res_dist] = 1;
    a._rnode = rnode;
    // home = nearest own settlement, else the nation capital (to deposit hauled goods)
    let home = null, hd = Infinity;
    const sl = this.settlements;
    for (let k = 0; k < sl.length; k++) {
      const s = sl[k];
      if (s.tribeId !== a.tribeId) continue;
      const dx = s.x - a.x, dy = s.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 < hd) { hd = d2; home = s; }
    }
    if (!home && tr) { home = tr; hd = (tr.capitalX - a.x) ** 2 + (tr.capitalY - a.y) ** 2; }
    if (home) { const hx = home.x !== undefined ? home.x : home.capitalX, hy = home.y !== undefined ? home.y : home.capitalY; const dx = hx - a.x, dy = hy - a.y, d = Math.hypot(dx, dy) || 1; inp[I.home_dx] = dx / d; inp[I.home_dy] = dy / d; }
    a._homeD2 = home ? hd : Infinity;

    // ---- THINK ----
    const out = think(a.genome, inp, this.output);

    // ---- ACT ----
    // movement (player overrides intent when possessing this body)
    let mx = out[O.move_x], my = out[O.move_y];
    if (a === this.controlled && (this.controlVec.x || this.controlVec.y)) {
      mx = this.controlVec.x; my = this.controlVec.y; // player is actively steering
    }
    // national rally pull: citizens drift toward their nation's rally/settle point
    // (indirect steering — the brain still chooses; this only biases the heading).
    if (tr && tr.rally && a !== this.controlled) {
      const rdx = tr.rally.x - a.x, rdy = tr.rally.y - a.y;
      const rd = Math.hypot(rdx, rdy);
      if (rd > 1.5) {
        const pull = 0.35 + Math.max(0, tr.policy.expansion) * 0.4;
        mx += (rdx / rd) * pull; my += (rdy / rd) * pull;
      }
    }
    // DIRECT ORDER: a unit the player hand-selected and sent somewhere overrides its
    // brain's wandering and marches to the spot (RTS command). Cleared on arrival.
    if (a.ordered && a !== this.controlled) {
      const odx = a.ordX - a.x, ody = a.ordY - a.y;
      const od = Math.hypot(odx, ody);
      if (od < 1.4) { a.ordered = false; a.orderState = null; }   // arrived
      else {
        let dx = odx / od, dy = ody / od;   // default heading (boats/planes, or fallback)
        // FLOW-FIELD PATHFINDING: foot units route AROUND water/mountains toward the
        // FINAL target. The field is BFS-flooded from the target and cached per-target
        // (4s TTL) — a whole box-selected army sharing one destination reuses one field,
        // so this is ~O(1) per unit/tick after the first build. Replaces the old greedy
        // 6-angle deflector that made units stall ~17 tiles short of the target (#3).
        if (a.vehicle === 0) {
          const field = buildField(W, a.ordX | 0, a.ordY | 0);
          const step = stepFrom(field, a.x | 0, a.y | 0);
          if (step) {
            const sx = (step.x + 0.5) - a.x, sy = (step.y + 0.5) - a.y;
            const sl = Math.hypot(sx, sy) || 1; dx = sx / sl; dy = sy / sl;
          }
          // step === null => already adjacent/at target OR genuinely unreachable on foot
          // (e.g. across open sea without a boat): keep the straight heading so a unit
          // nudges the shore rather than freezing; it simply cannot cross water on foot.
        }
        mx = dx * 1.4; my = dy * 1.4; // hard override — it obeys
      }
    }
    // ARMY COMMAND: soldiers (warriors/rangers) march to the war-rally the player or
    // AI set — this is how you direct your military toward a front / a rival's city.
    else if (tr && tr.warRally && (a.role === 1 || a.role === 2) && a !== this.controlled) {
      const rdx = tr.warRally.x - a.x, rdy = tr.warRally.y - a.y;
      const rd = Math.hypot(rdx, rdy);
      if (rd > 1.5) { mx += (rdx / rd) * 0.95; my += (rdy / rd) * 0.95; } // strong: the army obeys
    }
    const mlen = Math.hypot(mx, my) || 1;
    const sp = a.speed * 0.16 * (tr ? tr.caps.moveMul : 1) * (a.vehicle === 2 ? 2.2 : a.vehicle === 1 ? 1.1 : 1) * (a.ordered ? 2.1 : 1); // +craft +commanded-march speed
    mx = (mx / mlen) * sp; my = (my / mlen) * sp;
    a.vx = a.vx * 0.6 + mx * 0.4;
    a.vy = a.vy * 0.6 + my * 0.4;
    let nx = a.x + a.vx, ny = a.y + a.vy;
    // Crossing water/sky requires a crafted, crewed VEHICLE (the people earn it via
    // tech+resources). On foot you're land-locked; a BOAT lets you cross water; a
    // PLANE crosses any terrain. (tribe.caps.seafaring/flight = "can build such craft".)
    const veh = a.vehicle; // 0 none, 1 boat, 2 plane
    const passable = veh >= 1
      ? (px, py) => W.inBounds(px, py)        // boat/plane: water (and land) are passable
      : (px, py) => W.walkable(px, py);       // on foot: land only
    if (!passable(nx, a.y)) { a.vx *= -0.5; nx = a.x; }
    if (!passable(nx, ny)) { a.vy *= -0.5; ny = a.y; }
    a.x = Math.max(0.5, Math.min(W.w - 1.5, nx));
    a.y = Math.max(0.5, Math.min(W.h - 1.5, ny));

    const moveCost = (Math.abs(a.vx) + Math.abs(a.vy)) * 0.004;

    // eat (herbivory)
    if (out[O.eat] > 0.1) {
      const want = (1 - a.energy) * 0.5 + 0.05;
      const got = W.consumeFood(a.x, a.y, want) * (1 - a.diet * 0.7) * (tr ? tr.caps.foodYield : 1); // Agriculture/Plastics raise yield
      if (got > 0) { a.energy = Math.min(1.2, a.energy + got); a.fitness += got; a.lastAct = 1; }
    }

    // ---- combat: melee (warriors/civilians, adjacent) or ranged (rangers, at distance) ----
    // Too wounded or exhausted to fight → can only flee (the NN/movement handles retreat).
    const canFight = a.health > 0.25 && a.stamina > 0.12;
    if (out[O.attack] > 0.2 && nearestFoe && foeD >= 0 && canFight) {
      const ranger = a.role === 2;
      const reach = ranger ? Math.min(a.vision, 5.5) : 1.7; // tiles
      if (foeD < reach * reach) {
        const roleMul = a.role === 1 ? 1.35 : (a.role === 2 ? 0.9 : 0.7); // warrior / ranger / civilian
        const stam = 0.45 + 0.55 * a.stamina;
        // refined METAL arms fighters far better than raw ore (tech+town+ore gate)
        const metal = tr ? 1 + Math.min(0.7, tr.stock.metal * 0.006) + Math.min(0.12, tr.stock.ore * 0.0015) : 1;
        const power = a.strength * (tr ? tr.caps.combat : 1) * roleMul * stam * metal;
        // defender is stronger at home (territory defense bonus)
        const foeTr = this.tribes.get(nearestFoe.tribeId);
        let def = nearestFoe.strength * (foeTr ? foeTr.caps.combat : 1);
        if (this.territory.ownerAt(nearestFoe.x, nearestFoe.y) === nearestFoe.tribeId) def *= 1.35;
        a.lastAct = 2; nearestFoe.lastAct = 2;
        a.stamina -= ranger ? 0.09 : 0.13;
        const dmg = Math.max(0.12, power * (0.7 + this.rng.next() * 0.6) - def * 0.45);
        nearestFoe.health -= dmg;
        // melee is risky — the defender strikes back unless routed; ranged is safe at distance
        if (!ranger && nearestFoe.health > 0.25 && nearestFoe.stamina > 0.1) {
          a.health -= Math.max(0.05, def * 0.18 - power * 0.1);
        }
        if (nearestFoe.health <= 0) {
          const loot = 0.3 + nearestFoe.energy * (0.4 + a.diet * 0.5);
          a.energy = Math.min(1.2, a.energy + loot);
          a.fitness += loot + 0.4;
          if (foeTr) foeTr.deaths++;
          if (tr) tr.kills++;
          this.killAgent(nearestFoe);
        }
      }
    }

    // share energy with kin (altruism may or may not evolve)
    if (out[O.share] > 0.3 && nearestKinMate && a.energy > 0.6) {
      const give = 0.08;
      a.energy -= give; nearestKinMate.energy = Math.min(1.2, nearestKinMate.energy + give * 0.9);
    }

    // speak -> culture substrate (cooperation/tech proxy)
    if (out[O.speak] > 0.4) {
      a.signal = 1;
      if (tr) tr.culture += 0.002 * (1 + inp[I.kin_density]);
    } else a.signal *= 0.9;

    // gather / haul economy: harvest a node you're standing on, carry it, and
    // deposit it into the national stockpile when you reach home. Evolution +
    // the reward shape teach brains to become gatherers who supply their nation.
    if (out[O.gather] > 0.3) {
      if (a.carryType >= 0) {                         // hauling → try to deposit at home
        if (a._homeD2 < 9 && tr) {                    // within ~3 tiles of a town/capital
          tr.stock[RES_NAME[a.carryType]] += a.carryAmt;
          a.fitness += 0.3 + a.carryAmt * 0.2;
          a.carryType = -1; a.carryAmt = 0; a.lastAct = 1;
        }
      } else if (a._rnode && a._rnode.amount > 0) {   // free hands → harvest a node here
        const dx = a._rnode.x - a.x, dy = a._rnode.y - a.y;
        if (dx * dx + dy * dy < 2.6) {                // standing on / adjacent the node
          const got = this.resources.harvest(a._rnode, 2);
          if (got > 0) { a.carryType = a._rnode.type; a.carryAmt = got; a.fitness += 0.08; a.lastAct = 1; }
        }
      }
    }

    // reproduce
    if (out[O.reproduce] > 0.2 && a.energy > BREED_ENERGY && a.cooldownBreed === 0 &&
        a.age > a.maxAge * 0.12 && this.pool.free.length > 0) {
      this.reproduce(a, nearestKinMate);
    }

    // ---- LIVE / DIE ----
    a.cooldownBreed = Math.max(0, a.cooldownBreed - 1);
    if (a.stamina < 1) a.stamina = Math.min(1, a.stamina + 0.012); // rest restores fighting fitness
    a.age += dt;
    const baseCost = 0.0019 * a.metabolism * (0.6 + a.size * 0.5);
    a.energy -= baseCost + moveCost;
    a.fitness += 0.0008; // reward for simply surviving

    // climate stress
    const temp = W.temp[here];
    if (temp < 0.15) a.health -= (0.15 - temp) * (1 - a.resilience) * 0.05;
    // thirst: drink at the water's edge, else slowly parch (faster when hot). This
    // makes water a real need, so peoples settle near rivers/coasts (emergent).
    if (W.isWater(ix + 1, iy) || W.isWater(ix - 1, iy) || W.isWater(ix, iy + 1) || W.isWater(ix, iy - 1)) {
      a.hydration = 1;
    } else {
      a.hydration -= 0.0009 * (0.7 + temp);
      if (a.hydration < 0) a.hydration = 0;
    }
    if (a.hydration <= 0.05) a.health -= 0.012; // dying of thirst
    if (a.energy <= 0) { a.health -= 0.02; a.energy = 0; }
    else if (a.health < 1) a.health = Math.min(1, a.health + 0.004 * (tr ? tr.caps.healthRegen : 1)); // Medicine heals faster

    if (a.health <= 0 || a.age >= a.maxAge) {
      const t = this.tribes.get(a.tribeId);
      if (t) t.deaths++;
      this.killAgent(a);
    }
  }

  reproduce(a, mate) {
    const child = this.pool.alloc();
    if (!child) return;
    const tr = this.tribes.get(a.tribeId);
    const g = mate ? breed(a.genome, mate.genome, this.rng) : clone(a.genome, this.rng);
    const ang = this.rng.float(0, Math.PI * 2);
    const cx = Math.max(0.5, Math.min(this.world.w - 1.5, a.x + Math.cos(ang)));
    const cy = Math.max(0.5, Math.min(this.world.h - 1.5, a.y + Math.sin(ang)));
    child.spawn(cx, cy, g, a.tribeId, this.rng, a.generation + 1);
    child.parentA = a.id; child.parentB = mate ? mate.id : 0;
    a.energy -= BREED_COST;
    a.cooldownBreed = 90;
    a.offspring++; a.fitness += 0.5;
    if (mate) { mate.energy -= BREED_COST * 0.5; mate.cooldownBreed = 90; }
    if (tr) tr.births++;
    this.births++;
  }

  killAgent(a) {
    this.pool.release(a);
    this.deaths++;
  }

  // --- divine interventions ----------------------------------------------
  godSpawnLife(x, y, n = 16) {
    if (!this.world.walkable(x, y)) return null;
    const founder = randomGenome(this.rng);
    const hue = this.rng.int(0, 360);
    const tribe = new Tribe(this.rng, hue, founder);
    tribe.foundedYear = this.year();
    this.tribes.set(tribe.id, tribe);
    this.tech.initTribe(tribe); this.civics.initTribe(tribe); this.anthro.initTribe(tribe);
    this.culture.initTribe(tribe, this.rng);
    for (let k = 0; k < n; k++) {
      const a = this.pool.alloc();
      if (!a) break;
      const px = Math.max(1, Math.min(this.world.w - 2, x + this.rng.gauss(0, 2.5)));
      const py = Math.max(1, Math.min(this.world.h - 2, y + this.rng.gauss(0, 2.5)));
      a.spawn(px, py, clone(founder, this.rng, 0.06, 0.3), tribe.id, this.rng, 0);
    }
    this.emit('born', `A new people stirs: ${tribe.name}`, x, y, hue);
    return tribe;
  }

  godSmite(x, y, r) {
    let killed = 0;
    const A = this.pool.agents;
    const r2 = r * r;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive) continue;
      const dx = a.x - x, dy = a.y - y;
      if (dx * dx + dy * dy <= r2) {
        const t = this.tribes.get(a.tribeId);
        if (t) t.deaths++;
        this.killAgent(a); killed++;
      }
    }
    return killed;
  }

  // --- queries ------------------------------------------------------------
  year() { return Math.floor(this.tick / TICKS_PER_YEAR); }
  population() { return this.pool.count; }
  activeTribes() {
    let n = 0;
    for (const t of this.tribes.values()) if (t.members > 0) n++;
    return n;
  }

  agentAt(x, y, radius = 1.5) {
    let best = null, bd = radius * radius;
    const A = this.pool.agents;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive) continue;
      const dx = a.x - x, dy = a.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  tribeAt(x, y) {
    const a = this.agentAt(x, y, 3);
    return a ? this.tribes.get(a.tribeId) : null;
  }

  // Yearly role census: most citizens are civilians; a fraction become fighters,
  // sized by the nation's militarism (aggression policy), biased by who's martial.
  // Role TYPE (warrior melee vs ranger ranged) follows the individual's traits.
  assignRoles() {
    const yr = this.year();
    const A = this.pool.agents;
    // pass 1: current soldier count per tribe (soldiers are STICKY — a unit you
    // select stays your unit; we only promote civilians up to the policy target).
    const cnt = new Map();
    for (let i = 0; i < A.length; i++) {
      const a = A[i]; if (!a.alive) continue;
      let c = cnt.get(a.tribeId); if (!c) { c = { mem: 0, sol: 0 }; cnt.set(a.tribeId, c); }
      c.mem++; if (a.role === 1 || a.role === 2) c.sol++;
    }
    // pass 2: promote civilians toward each nation's target army size
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive || a.role === 1 || a.role === 2) continue; // keep existing soldiers
      const tr = this.tribes.get(a.tribeId);
      const c = cnt.get(a.tribeId); if (!c) continue;
      let fW = 0.07 + (tr ? Math.max(0, tr.policy.aggression) * 0.30 : 0);
      if (fW > 0.45) fW = 0.45;
      if (c.sol >= c.mem * fW) continue;                     // army already at target
      const prop = a.aggression * 0.5 + a.diet * 0.3 + ((a.size - 0.6) / 1.1) * 0.2;
      const draw = hash2(a.id, 7, yr) - (prop - 0.5) * 0.35;
      if (draw < fW) { a.role = (a.vision > 4.3 && a.size < 1.2) ? 2 : 1; c.sol++; }
    }
  }

  // 'military' city focus: arm a nearby civilian into a warrior each year (costs gold).
  trainSoldier(s, tr) {
    if (tr.gold < 2) return;
    const A = this.pool.agents, rr = (s.radius + 5) * (s.radius + 5);
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive || a.tribeId !== s.tribeId || a.role !== 0) continue;
      const dx = a.x - s.x, dy = a.y - s.y;
      if (dx * dx + dy * dy < rr) { a.role = 1; tr.gold -= 2; return; }
    }
  }

  // Crew up to `n` of a tribe's agents with a vehicle (1 boat / 2 plane). Boats go
  // to folk at the water's edge; planes to anyone. Returns how many were crewed.
  grantVehicles(tribe, type, n) {
    const A = this.pool.agents, W = this.world;
    let made = 0;
    for (let i = 0; i < A.length && made < n; i++) {
      const a = A[i];
      if (!a.alive || a.tribeId !== tribe.id || a.vehicle !== 0) continue;
      if (type === 1) { // boat — must be at the shoreline
        const ix = a.x | 0, iy = a.y | 0;
        if (!(W.isWater(ix + 1, iy) || W.isWater(ix - 1, iy) || W.isWater(ix, iy + 1) || W.isWater(ix, iy - 1))) continue;
      }
      a.vehicle = type; made++;
    }
    return made;
  }

  settlementAt(x, y, radius = 4) {
    let best = null, bd = radius * radius;
    const S = this.settlements;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const dx = s.x - x, dy = s.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }
}
