// Tech progression — the headline mechanic: a gated tech tree with eras a civ
// must "build up to." Water travel needs Sailing, air travel needs Flight,
// metals need Iron Working, science needs the Scientific Method, and so on.
//
// This is LAYER-2 in the DESIGN two-layer mind: techs are data tokens a tribe
// accrues from its population + culture (which itself emerges from the evolved
// brains' `speak` acts). Tech does NOT touch a creature's neural net — it raises
// tribe-wide CAPS (multipliers + ability flags) that the sim reads in its hot
// paths. So "every person has a real brain" stays literally true; civilization
// is the legible memetic layer on top.
//
// Pure data + functions. No imports from sim internals — the sim passes in the
// tribe and its own deterministic rng. `accrue` runs once per tribe per sim-year
// (not per tick), so it is not a hot path; the hot-path cost is just property
// reads of tribe.caps in sim.step().

// Era names, indexed by tech.era (0..8).
export const ERAS = [
  'Stone Age',     // 0
  'Bronze Age',    // 1
  'Iron Age',      // 2
  'Classical Era', // 3
  'Medieval Era',  // 4
  'Renaissance',   // 5
  'Industrial Age',// 6
  'Modern Era',    // 7
  'Information Age',// 8
];

// The tree. Ordered roughly by era then dependency. Each def:
//   id      stable string key (referenced by prereqs / tribe.tech.known)
//   name    human-readable label (for toasts / the tech panel)
//   era     index into ERAS — also drives the tribe's current era
//   prereqs array of tech ids that must be known first ([] = root tech)
//   cost    research points to unlock
//   desc    one-line flavor for the UI
//   effect  caps it contributes (see recompute for how they combine):
//             foodYield, moveMul, combat, researchMul, healthRegen, storage
//               -> multiplicative (default 1)
//             seafaring, flight -> boolean OR (default false)
export const TECHS = [
  // --- Stone Age (0) ------------------------------------------------------
  { id: 'Fire', name: 'Fire', era: 0, prereqs: [], cost: 8,
    desc: 'Tame fire — warmth, cooking, protection.',
    effect: { foodYield: 1.1, healthRegen: 1.1 } },
  { id: 'StoneTools', name: 'Stone Tools', era: 0, prereqs: [], cost: 10,
    desc: 'Knapped stone — sharper tools and weapons.',
    effect: { combat: 1.12, foodYield: 1.08 } },
  { id: 'Agriculture', name: 'Agriculture', era: 0, prereqs: ['Fire', 'StoneTools'], cost: 30,
    desc: 'Farm the land instead of foraging it.',
    effect: { foodYield: 1.5 } },
  { id: 'AnimalHusbandry', name: 'Animal Husbandry', era: 0, prereqs: ['Agriculture'], cost: 38,
    desc: 'Tame horses and herds — ride and haul.',
    effect: { moveMul: 1.25, foodYield: 1.15 } },
  { id: 'Pottery', name: 'Pottery', era: 0, prereqs: ['Agriculture'], cost: 34,
    desc: 'Fired clay — store food and water against lean times.',
    effect: { storage: 1.4 } },

  // --- Bronze Age (1) -----------------------------------------------------
  { id: 'Wheel', name: 'The Wheel', era: 1, prereqs: ['AnimalHusbandry'], cost: 50,
    desc: 'Wheel and cart — move people and goods.',
    effect: { moveMul: 1.2 } },
  { id: 'Writing', name: 'Writing', era: 1, prereqs: ['Pottery'], cost: 52,
    desc: 'Record knowledge — ideas outlive their thinkers.',
    effect: { researchMul: 1.3 } },
  { id: 'Bronzeworking', name: 'Bronze Working', era: 1, prereqs: ['Pottery', 'StoneTools'], cost: 58,
    desc: 'Alloy copper and tin — the first metal age.',
    effect: { combat: 1.25, storage: 1.05 } },
  { id: 'Sailing', name: 'Sailing', era: 1, prereqs: ['Pottery', 'Writing'], cost: 64,
    desc: 'Boats and sails — CROSS THE WATER.',
    effect: { seafaring: true, moveMul: 1.05 } },

  // --- Iron Age (2) -------------------------------------------------------
  { id: 'Mathematics', name: 'Mathematics', era: 2, prereqs: ['Writing'], cost: 80,
    desc: 'Number and proof — the language of science.',
    effect: { researchMul: 1.25 } },
  { id: 'Currency', name: 'Currency', era: 2, prereqs: ['Writing', 'Bronzeworking'], cost: 78,
    desc: 'Coined money — trade, surplus and specialists.',
    effect: { researchMul: 1.15, foodYield: 1.1 } },
  { id: 'IronWorking', name: 'Iron Working', era: 2, prereqs: ['Bronzeworking'], cost: 92,
    desc: 'Smelt iron — harder tools, deadlier arms.',
    effect: { combat: 1.4 } },
  { id: 'Masonry', name: 'Masonry', era: 2, prereqs: ['Bronzeworking'], cost: 84,
    desc: 'Cut stone — walls, granaries, monuments.',
    effect: { storage: 1.3, combat: 1.1 } },

  // --- Classical Era (3) --------------------------------------------------
  { id: 'Engineering', name: 'Engineering', era: 3, prereqs: ['Mathematics', 'Masonry', 'Wheel'], cost: 120,
    desc: 'Roads, aqueducts and the machines of war.',
    effect: { moveMul: 1.12, storage: 1.2, combat: 1.1 } },
  { id: 'Medicine', name: 'Medicine', era: 3, prereqs: ['Mathematics'], cost: 115,
    desc: 'Herbal craft and surgery — heal the sick.',
    effect: { healthRegen: 1.4 } },

  // --- Medieval Era (4) ---------------------------------------------------
  { id: 'Compass', name: 'The Compass', era: 4, prereqs: ['Sailing', 'Mathematics'], cost: 150,
    desc: 'Navigate the open sea with confidence.',
    effect: { seafaring: true, moveMul: 1.08 } },
  { id: 'Gunpowder', name: 'Gunpowder', era: 4, prereqs: ['IronWorking', 'Engineering'], cost: 165,
    desc: 'Black powder — cannon and gun.',
    effect: { combat: 1.5 } },

  // --- Renaissance (5) ----------------------------------------------------
  { id: 'Printing', name: 'The Printing Press', era: 5, prereqs: ['Writing', 'Engineering'], cost: 210,
    desc: 'The press — knowledge spreads to everyone.',
    effect: { researchMul: 1.4 } },
  { id: 'ScientificMethod', name: 'The Scientific Method', era: 5, prereqs: ['Printing', 'Mathematics'], cost: 260,
    desc: 'Hypothesis and experiment — SCIENCE itself.',
    effect: { researchMul: 2.0, healthRegen: 1.1 } },

  // --- Industrial Age (6) -------------------------------------------------
  { id: 'Steam', name: 'Steam Power', era: 6, prereqs: ['ScientificMethod', 'IronWorking'], cost: 330,
    desc: 'The steam engine — tireless mechanical power.',
    effect: { moveMul: 1.3, foodYield: 1.2, combat: 1.1 } },
  { id: 'Electricity', name: 'Electricity', era: 6, prereqs: ['ScientificMethod'], cost: 350,
    desc: 'Harness the current — light, motor, telegraph.',
    effect: { researchMul: 1.3, healthRegen: 1.2 } },
  { id: 'Industrialization', name: 'Industrialization', era: 6, prereqs: ['Steam'], cost: 400,
    desc: 'The factory — mass production at scale.',
    effect: { foodYield: 1.4, storage: 1.5, combat: 1.2 } },

  // --- Modern Era (7) -----------------------------------------------------
  { id: 'Combustion', name: 'Combustion Engine', era: 7, prereqs: ['Industrialization', 'Electricity'], cost: 470,
    desc: 'The engine — automobiles and armor.',
    effect: { moveMul: 1.5, combat: 1.2 } },
  { id: 'Plastics', name: 'Plastics', era: 7, prereqs: ['Industrialization', 'Electricity'], cost: 490,
    desc: 'Synthetic materials — preserve and store everything.',
    effect: { storage: 1.6, foodYield: 1.3 } },
  { id: 'Flight', name: 'Powered Flight', era: 7, prereqs: ['Combustion'], cost: 540,
    desc: 'Powered flight — CROSS ANY TERRAIN BY AIR.',
    effect: { flight: true, moveMul: 1.6 } },

  // --- Information Age (8) -------------------------------------------------
  { id: 'Computing', name: 'Computing', era: 8, prereqs: ['Plastics', 'Electricity', 'ScientificMethod'], cost: 660,
    desc: 'The computer — automate thought itself.',
    effect: { researchMul: 1.6, storage: 1.2 } },
];

// Fast id -> def lookup (UI toasts, prereq checks, event rendering).
export const TECH_BY_ID = new Map();
for (let i = 0; i < TECHS.length; i++) TECH_BY_ID.set(TECHS[i].id, TECHS[i]);

// Default caps for a tribe with zero techs. Cloned per-tribe so each owns its own.
function freshCaps() {
  return {
    foodYield: 1,
    moveMul: 1,
    combat: 1,
    researchMul: 1,
    seafaring: false,
    flight: false,
    healthRegen: 1,
    storage: 1,
  };
}

export class TechSystem {
  constructor() {
    // reusable scratch so the per-year unlock loop allocates nothing
    this._cand = new Array(TECHS.length);     // candidate defs this pass
    this._w = new Float64Array(TECHS.length); // their pick-weights
  }

  // Ensure a tribe carries the contract shape, then derive its caps.
  // Safe to call repeatedly; only (re)inits when the shape is missing/legacy.
  initTribe(tribe) {
    const t = tribe.tech;
    if (!t || typeof t !== 'object' || !(t.known instanceof Set)) {
      tribe.tech = { points: 0, known: new Set(), era: 0 };
    } else {
      if (typeof t.points !== 'number') t.points = 0;
      if (typeof t.era !== 'number') t.era = 0;
    }
    if (!tribe.caps) tribe.caps = freshCaps();
    this.recompute(tribe);
    return tribe;
  }

  // Rebuild tribe.caps from tribe.tech.known by combining each known tech's
  // effect: multipliers multiply, ability flags OR together.
  recompute(tribe) {
    if (!tribe.tech || !(tribe.tech.known instanceof Set)) this.initTribe(tribe);
    const caps = tribe.caps || (tribe.caps = freshCaps());
    caps.foodYield = 1;
    caps.moveMul = 1;
    caps.combat = 1;
    caps.researchMul = 1;
    caps.healthRegen = 1;
    caps.storage = 1;
    caps.seafaring = false;
    caps.flight = false;
    let era = 0;
    for (const id of tribe.tech.known) {
      const def = TECH_BY_ID.get(id);
      if (!def) continue;
      if (def.era > era) era = def.era;
      const e = def.effect;
      if (!e) continue;
      if (e.foodYield) caps.foodYield *= e.foodYield;
      if (e.moveMul) caps.moveMul *= e.moveMul;
      if (e.combat) caps.combat *= e.combat;
      if (e.researchMul) caps.researchMul *= e.researchMul;
      if (e.healthRegen) caps.healthRegen *= e.healthRegen;
      if (e.storage) caps.storage *= e.storage;
      if (e.seafaring) caps.seafaring = true;
      if (e.flight) caps.flight = true;
    }
    tribe.tech.era = era;
    return caps;
  }

  // Accrue research and unlock whatever the tribe can now afford. Call once per
  // sim-year per living tribe with dt = years elapsed (normally 1) and the sim's
  // deterministic rng. Returns the array of newly-unlocked tech defs so the
  // caller can emit discovery events.
  accrue(tribe, dt, rng) {
    if (!tribe.tech || !(tribe.tech.known instanceof Set)) this.initTribe(tribe);
    if (!tribe.caps) this.recompute(tribe);

    // research income: population does the work; culture (emergent from `speak`)
    // and any settlement bonus add to it; writing/printing/science multiply it.
    const pop = tribe.members > 0 ? tribe.members : 0;
    const culture = tribe.culture > 0 ? tribe.culture : 0;
    const settle = (tribe.tech.settleBonus > 0) ? tribe.tech.settleBonus : 0;
    // Sublinear in population so a huge tribe doesn't blitz the tree — progression
    // should feel like "building up to it" over many generations (drlor 2026-06-07).
    let gain = (Math.sqrt(pop) * 0.11 + Math.log2(1 + culture) * 0.3 + settle) * tribe.caps.researchMul * dt;
    if (gain > 0) tribe.tech.points += gain;

    const unlocked = [];
    const known = tribe.tech.known;
    const cand = this._cand;
    // unlock as many as are affordable this pass; guard bounds the loop to the
    // tree size so it always terminates even on a huge points windfall.
    let guard = 0;
    while (guard++ < TECHS.length) {
      const pts = tribe.tech.points;
      let n = 0;
      for (let i = 0; i < TECHS.length; i++) {
        const d = TECHS[i];
        if (d.cost > pts) continue;
        if (known.has(d.id)) continue;
        if (!this._prereqMet(known, d)) continue;
        cand[n++] = d;
      }
      if (n === 0) break;
      const chosen = this._pick(cand, n, rng);
      known.add(chosen.id);
      tribe.tech.points -= chosen.cost;
      if (chosen.era > tribe.tech.era) tribe.tech.era = chosen.era;
      unlocked.push(chosen);
    }
    if (unlocked.length) this.recompute(tribe);
    return unlocked;
  }

  // Techs the tribe could research next (prereqs met, not yet known) — for UI.
  available(tribe) {
    const out = [];
    if (!tribe.tech || !(tribe.tech.known instanceof Set)) return out;
    const known = tribe.tech.known;
    for (let i = 0; i < TECHS.length; i++) {
      const d = TECHS[i];
      if (known.has(d.id)) continue;
      if (this._prereqMet(known, d)) out.push(d);
    }
    return out;
  }

  eraName(era) {
    const i = era < 0 ? 0 : (era >= ERAS.length ? ERAS.length - 1 : era | 0);
    return ERAS[i];
  }

  // --- internals ----------------------------------------------------------
  _prereqMet(known, def) {
    const p = def.prereqs;
    for (let i = 0; i < p.length; i++) {
      if (!known.has(p[i])) return false;
    }
    return true;
  }

  // Weighted pick over cand[0..n): biased toward lower-era / cheaper techs so a
  // civ climbs the tree in a believable order rather than skipping ahead.
  _pick(cand, n, rng) {
    if (n === 1) return cand[0];
    const w = this._w;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = cand[i];
      const weight = 1 / (d.cost * (1 + d.era));
      w[i] = weight;
      total += weight;
    }
    let r = rng.float(0, total);
    for (let i = 0; i < n; i++) {
      r -= w[i];
      if (r <= 0) return cand[i];
    }
    return cand[n - 1];
  }
}
