// Animals — a living wilderness alongside the people. PREY (deer) graze the land
// and flee danger; PREDATORS (wolves) hunt prey and menace lone folk. They breed,
// starve and die on their own — an ambient ecosystem, not decoration. Cheap
// utility-AI (no neural nets); updates on a stagger so hundreds run for nearly free.
//
// Deterministic: uses its OWN rng (seeded from the world seed) so animal motion
// never perturbs the agents' evolution stream — same pattern as culture.js.
import { RNG } from '../core/rng.js';
import { rollDrops } from './items.js';

export const ANIMAL = { PREY: 0, PREDATOR: 1 };
const KIND_NAME = ['prey', 'predator'];     // ANIMAL index -> drop-table kind

const MAX = 420;
const SIGHT = 7;            // tiles an animal perceives
const SIGHT2 = SIGHT * SIGHT;

// DROP-ON-DEATH attribution radius: a carcass within this many tiles of one of a
// nation's settlements is harvested by that nation (its hunters/foragers), and the
// loot lands in tribe.stock. Beyond any settlement, drops fall to the ground pile.
const HARVEST_R = 9;
const HARVEST_R2 = HARVEST_R * HARVEST_R;

export class Animals {
  constructor() {
    this.list = [];          // active animals
    this.rng = null;
    // GROUND LOOT: drops from animals that died with no nation nearby to harvest
    // them. A capped pile keyed by item id — claimable later (forage hook) or just
    // an ambient resource record. Bounded so it can never grow without limit.
    this.ground = new Map(); // itemId -> qty
  }

  spawn(sim, nPrey = 180, nPred = 26) {
    this.rng = new RNG(((sim.rng.seed >>> 0) ^ 0x5eed0a17) >>> 0);
    const W = sim.world;
    const place = (type) => {
      for (let t = 0; t < 60; t++) {
        const x = this.rng.int(2, W.w - 2), y = this.rng.int(2, W.h - 2);
        if (W.walkable(x, y) && W.fert[W.idx(x, y)] > 0.2) {
          this.list.push({ type, x: x + 0.5, y: y + 0.5, vx: 0, vy: 0, energy: 0.7, age: 0, alive: true, cd: 0 });
          return;
        }
      }
    };
    for (let i = 0; i < nPrey; i++) place(ANIMAL.PREY);
    for (let i = 0; i < nPred; i++) place(ANIMAL.PREDATOR);
  }

  nearestPrey(x, y) {
    let best = null, bd = SIGHT2;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive || a.type !== ANIMAL.PREY) continue;
      const dx = a.x - x, dy = a.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }
  nearestPredator(x, y) {
    let best = null, bd = SIGHT2;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive || a.type !== ANIMAL.PREDATOR) continue;
      const dx = a.x - x, dy = a.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  update(sim, dt) {
    const W = sim.world, rng = this.rng, L = this.list;
    const stagger = sim.tick % 2;        // half the herd each tick (cheap)
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive) continue;
      if ((i & 1) !== stagger) { this._move(W, a); continue; }

      a.age++;
      a.energy -= a.type === ANIMAL.PREDATOR ? 0.0026 : 0.003;

      if (a.type === ANIMAL.PREY) {
        // graze the food layer
        const got = W.consumeFood(a.x, a.y, 0.05);
        if (got > 0) a.energy = Math.min(1.2, a.energy + got * 2);
        // flee the nearest predator (slower than a wolf's chase, so hunts succeed)
        const pr = this.nearestPredator(a.x, a.y);
        if (pr) { const dx = a.x - pr.x, dy = a.y - pr.y, d = Math.hypot(dx, dy) || 1; a.vx = (dx / d) * 0.46; a.vy = (dy / d) * 0.46; }
        else if (rng.next() < 0.25) { a.vx = rng.gauss(0, 0.18); a.vy = rng.gauss(0, 0.18); }
      } else {
        // predator: chase nearest prey (faster than prey flee), eat if caught
        const prey = this.nearestPrey(a.x, a.y);
        if (prey) {
          const dx = prey.x - a.x, dy = prey.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 < 1.6) { prey.alive = false; a.energy = Math.min(1.6, a.energy + 0.9); }
          else { const d = Math.sqrt(d2) || 1; a.vx = (dx / d) * 0.62; a.vy = (dy / d) * 0.62; }
        } else if (rng.next() < 0.2) { a.vx = rng.gauss(0, 0.16); a.vy = rng.gauss(0, 0.16); }
      }

      // breed when well-fed (capped). Prey breed cautiously; predators when fed.
      a.cd = Math.max(0, a.cd - 1);
      const breedAt = a.type === ANIMAL.PREDATOR ? 0.7 : 0.95;
      if (a.energy > breedAt && a.cd === 0 && L.length < MAX) {
        a.energy -= 0.4; a.cd = a.type === ANIMAL.PREDATOR ? 110 : 170;
        L.push({ type: a.type, x: a.x, y: a.y, vx: 0, vy: 0, energy: 0.6, age: 0, alive: true, cd: 60 });
      }
      // death
      const maxAge = a.type === ANIMAL.PREDATOR ? 2600 : 1800;
      if (a.energy <= 0 || a.age > maxAge) a.alive = false;

      this._move(W, a);
    }

    // DROP-ON-DEATH: any animal that just died (from a hunt, starvation, or age)
    // leaves a carcass. Roll its loot table once (marked with .looted so it's never
    // double-counted) and bank it — into the nearest nation's stock if a settlement
    // is within HARVEST_R (its hunters claim the kill), else onto the ground pile.
    // Cheap: only touches animals flagged dead-this-tick, before they're compacted.
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.alive || a.looted) continue;
      a.looted = true;
      this._resolveDrops(sim, a);
    }

    // compact the list so dead animals don't accumulate
    if (sim.tick % 120 === 0) {
      let w = 0;
      for (let i = 0; i < L.length; i++) if (L[i].alive) L[w++] = L[i];
      L.length = w;
    }
    // population floor: top both species up to a healthy minimum (a game wants a
    // living wilderness, not a fragile Lotka-Volterra crash). Checked every 5 yrs.
    if (sim.tick % 300 === 0) {
      let prey = 0, pred = 0;
      for (let i = 0; i < L.length; i++) { if (!L[i].alive) continue; (L[i].type === ANIMAL.PREY ? prey++ : pred++); }
      if (prey < 70) this.spawnSome(W, ANIMAL.PREY, 70 - prey);
      if (pred < 14) this.spawnSome(W, ANIMAL.PREDATOR, 14 - pred);
    }
  }

  spawnSome(W, type, n) {
    for (let k = 0; k < n && this.list.length < MAX; k++) {
      const x = this.rng.int(2, W.w - 2), y = this.rng.int(2, W.h - 2);
      if (W.walkable(x, y)) this.list.push({ type, x: x + 0.5, y: y + 0.5, vx: 0, vy: 0, energy: 0.7, age: 0, alive: true, cd: 0 });
    }
  }

  // Bank a slain animal's loot. Attributes it to the nation whose settlement is
  // nearest (within HARVEST_R) — its hunters/foragers harvest the carcass into
  // tribe.stock — else it falls to the ambient ground pile. Deterministic: rolls
  // on this.rng (the animal rng), so loot never perturbs agent evolution.
  _resolveDrops(sim, a) {
    const drops = rollDrops(KIND_NAME[a.type], this.rng);
    if (!drops.length) return;

    // nearest settlement (few of them) decides the harvesting nation
    let tribe = null, bd = HARVEST_R2;
    const S = sim.settlements;
    if (S) {
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        const dx = s.x - a.x, dy = s.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; tribe = sim.tribes.get(s.tribeId) || null; }
      }
    }

    if (tribe && tribe.members > 0) {
      const stock = tribe.stock || (tribe.stock = {});
      for (let i = 0; i < drops.length; i++) stock[drops[i].id] = (stock[drops[i].id] || 0) + drops[i].qty;
    } else {
      // ground pile (bounded): drops with no harvester accumulate in the wild
      const g = this.ground;
      for (let i = 0; i < drops.length; i++) {
        const cur = g.get(drops[i].id) || 0;
        if (cur < 9999) g.set(drops[i].id, cur + drops[i].qty);
      }
    }
  }

  _move(W, a) {
    a.vx *= 0.8; a.vy *= 0.8;
    let nx = a.x + a.vx, ny = a.y + a.vy;
    if (!W.walkable(nx, a.y)) { a.vx = -a.vx * 0.5; nx = a.x; }
    if (!W.walkable(nx, ny)) { a.vy = -a.vy * 0.5; ny = a.y; }
    a.x = Math.max(0.5, Math.min(W.w - 1.5, nx));
    a.y = Math.max(0.5, Math.min(W.h - 1.5, ny));
  }
}
