// Civics — the CULTURE tree (parallel to the science/tech tree, à la Civ VI).
// Fuelled by a nation's accumulated culture, it unlocks civics that grant
// GOVERNMENTS (Chiefdom → Confederacy / Monarchy → Theocracy / Republic →
// Democracy / Autocracy) and society-wide bonuses. Effects are MULTIPLIERS folded
// onto tribe.caps each year AFTER TechSystem.recompute (so tech sets the base and
// civics/government modify it). Deterministic; uses the passed rng only.

export const GOVERNMENTS = {
  chiefdom:    { name: 'Chiefdom',     eff: {} },
  confederacy: { name: 'Confederacy',  eff: { foodYield: 1.1, moveMul: 1.08, researchMul: 1.05 } },
  monarchy:    { name: 'Monarchy',     eff: { combat: 1.2, healthRegen: 1.1, storage: 1.1 } },
  theocracy:   { name: 'Theocracy',    eff: { healthRegen: 1.15, researchMul: 1.1, combat: 1.05 } },
  republic:    { name: 'Republic',     eff: { researchMul: 1.18, foodYield: 1.12 } },
  democracy:   { name: 'Democracy',    eff: { researchMul: 1.3, foodYield: 1.12, healthRegen: 1.1 } },
  autocracy:   { name: 'Autocracy',    eff: { combat: 1.3, moveMul: 1.1, storage: 1.15 } },
};

// id, name, era (shared 9-era spine), prereqs, culture cost, optional government
// it establishes, and a caps effect multiplier.
export const CIVICS = [
  { id: 'kinship',     name: 'Kinship',           era: 0, prereqs: [], cost: 6,   gov: 'chiefdom', eff: { foodYield: 1.05 } },
  { id: 'oral_lore',   name: 'Oral Tradition',    era: 0, prereqs: ['kinship'], cost: 14, eff: { researchMul: 1.06 } },
  { id: 'customs',     name: 'Customs & Ritual',  era: 0, prereqs: ['kinship'], cost: 18, eff: { healthRegen: 1.06 } },
  { id: 'warrior_code',name: 'Warrior Code',      era: 1, prereqs: ['customs'], cost: 30, eff: { combat: 1.12 } },
  { id: 'confederacy', name: 'Confederacy',       era: 1, prereqs: ['oral_lore'], cost: 36, gov: 'confederacy', eff: {} },
  { id: 'code_of_law', name: 'Code of Law',       era: 2, prereqs: ['confederacy'], cost: 60, gov: 'monarchy', eff: { storage: 1.1 } },
  { id: 'mysticism',   name: 'Mysticism',         era: 2, prereqs: ['customs'], cost: 64, gov: 'theocracy', eff: { researchMul: 1.08 } },
  { id: 'philosophy',  name: 'Philosophy',        era: 3, prereqs: ['code_of_law'], cost: 100, eff: { researchMul: 1.15 } },
  { id: 'guilds',      name: 'Guilds',            era: 3, prereqs: ['code_of_law'], cost: 110, eff: { foodYield: 1.12, storage: 1.1 } },
  { id: 'citizenship', name: 'Citizenship',       era: 4, prereqs: ['philosophy'], cost: 170, gov: 'republic', eff: {} },
  { id: 'feudalism',   name: 'Feudalism',         era: 4, prereqs: ['code_of_law'], cost: 160, eff: { combat: 1.15 } },
  { id: 'enlightenment', name: 'Enlightenment',   era: 5, prereqs: ['citizenship'], cost: 260, eff: { researchMul: 1.2 } },
  { id: 'nationalism', name: 'Nationalism',       era: 6, prereqs: ['enlightenment'], cost: 360, gov: 'autocracy', eff: { combat: 1.12 } },
  { id: 'democracy',   name: 'Democracy',         era: 7, prereqs: ['enlightenment'], cost: 480, gov: 'democracy', eff: {} },
];
export const CIVIC_BY_ID = new Map(CIVICS.map((c) => [c.id, c]));

export class Civics {
  constructor() { this._cand = []; }

  initTribe(tribe) {
    if (!tribe.civics || !(tribe.civics.known instanceof Set)) {
      tribe.civics = { points: 0, known: new Set() };
    }
    if (!tribe.government) tribe.government = 'chiefdom';
  }

  _prereqMet(known, c) {
    for (let i = 0; i < c.prereqs.length; i++) if (!known.has(c.prereqs[i])) return false;
    return true;
  }

  // accrue culture-points and unlock affordable civics (culture is the fuel)
  accrue(tribe, dt, rng) {
    this.initTribe(tribe);
    const pop = tribe.members > 0 ? tribe.members : 0;
    const culture = tribe.culture > 0 ? tribe.culture : 0;
    const cm = (tribe.caps && tribe.caps.researchMul) ? (0.6 + 0.4 * tribe.caps.researchMul) : 1;
    tribe.civics.points += (Math.sqrt(pop) * 0.05 + Math.log2(1 + culture) * 0.5) * cm * dt;

    const known = tribe.civics.known;
    const unlocked = [];
    let guard = 0;
    while (guard++ < CIVICS.length) {
      const cand = this._cand; let n = 0;
      for (let i = 0; i < CIVICS.length; i++) {
        const c = CIVICS[i];
        if (c.cost > tribe.civics.points || known.has(c.id) || !this._prereqMet(known, c)) continue;
        cand[n++] = c;
      }
      if (n === 0) break;
      // pick the cheapest available (rng breaks ties lightly)
      let pick = cand[0];
      for (let i = 1; i < n; i++) if (cand[i].cost < pick.cost || (cand[i].cost === pick.cost && rng.next() < 0.3)) pick = cand[i];
      known.add(pick.id);
      tribe.civics.points -= pick.cost;
      if (pick.gov && GOVERNMENTS[pick.gov]) tribe.government = pick.gov;
      unlocked.push(pick);
    }
    return unlocked;
  }

  // fold civic + government multipliers onto tribe.caps (call AFTER tech.recompute)
  apply(tribe) {
    if (!tribe.caps || !tribe.civics) return;
    const mul = (k, m) => { if (tribe.caps[k] !== undefined) tribe.caps[k] *= m; };
    for (const id of tribe.civics.known) {
      const c = CIVIC_BY_ID.get(id);
      if (c && c.eff) for (const k in c.eff) mul(k, c.eff[k]);
    }
    const gov = GOVERNMENTS[tribe.government];
    if (gov && gov.eff) for (const k in gov.eff) mul(k, gov.eff[k]);
  }

  governmentName(tribe) {
    const g = GOVERNMENTS[tribe && tribe.government];
    return g ? g.name : 'Chiefdom';
  }
  available(tribe) {
    this.initTribe(tribe);
    return CIVICS.filter((c) => !tribe.civics.known.has(c.id) && this._prereqMet(tribe.civics.known, c));
  }
}
