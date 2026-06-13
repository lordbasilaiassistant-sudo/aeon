// DEPT 3 STATECRAFT — Diplomacy. The per-pair relationship substrate that makes
// war a legible CONSEQUENCE of world state rather than a die roll, identical for
// human- and AI-run nations (GAME_RULES.md §2).
//
// It owns, for every ordered/unordered pair of tribes:
//   - a STANCE  (ally | neutral | rival | war)         — symmetric, default neutral
//   - a GRIEVANCE  (A holds toward B)                   — directional, decays yearly
//   - a WAR record (since-year, exhaustion)            — drives auto-resolution
// and the single function `warPressure(A->B)` that every actor reads.
//
// Performance / determinism contract (matches culture.js / settlement.js):
//   - tick(sim) self-gates to once per sim-year and loops over TRIBES (dozens),
//     never over agents — it is effectively free against the per-agent hot path.
//   - warPressure() is PURE (no rng, no mutation) so the UI may poll it per frame
//     and the AI may call it freely; nothing it does perturbs agent evolution.
//   - No global Math.random anywhere; stance drift is deterministic from pressure.
//   - hostile(sim,a,b) is the ONLY method on the per-agent hot path (foe test): a
//     single Map lookup + two compares.
import { gene, distance } from './brain.js';

const YEAR = 60;                 // = TICKS_PER_YEAR (kept local to avoid a sim.js cycle)

// pair-key base. Tribe ids are small positive ints; 1e7 leaves vast headroom and
// keeps both the undirected and directed keys safely < 2^53.
const MUL = 10000000;

// --- tuning ---------------------------------------------------------------
const FRICTION_RANGE   = 70;     // tiles: capitals nearer than this feel border friction
const NEIGHBOR_RANGE   = 90;     // tiles: how far a nation "sees" its neighbours
const GRIEVANCE_DECAY  = 0.85;   // grievance retained per year (history fades)
const GRIEVANCE_MAX    = 3;      // cap so old hatred can't dominate forever
const WAR_GRIEVANCE    = 0.15;   // grievance both sides gain per year of war
const DECLARE_GRIEVANCE = 0.30;  // grievance from the act of declaring war
const EXHAUST_RATE     = 0.16;   // war-weariness gained per year at war
const EXHAUST_CAP      = 1.0;    // weariness that forces an exhausted peace
const PEACE_FLOOR      = 0.25;   // both sides below this pressure -> peace
const RIVAL_THRESHOLD  = 0.55;   // pressure that drifts neutral AI pairs to rival
const FRIENDLY_THRESHOLD = 0.15; // pressure that cools rival AI pairs back to neutral

const VALID_STANCES = { ally: 1, neutral: 1, rival: 1, war: 1 };
// war STAKES — what the aggressor is fighting to achieve (legible closure model).
const VALID_WAR_GOALS = { border: 1, raze: 1, vassalize: 1, plunder: 1 };
const DEFAULT_WAR_GOAL = 'border';

function idOf(x) { return (x && typeof x === 'object') ? x.id : x; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function eraOf(t) {
  const tt = t && t.tech;
  return (tt && typeof tt === 'object' && typeof tt.era === 'number') ? tt.era : 0;
}
// undirected pair key (min*MUL+max) — for stance & war records
function pairKey(a, b) { return a < b ? a * MUL + b : b * MUL + a; }
// directed key (a*MUL+b) — for grievance A->B
function dirKey(a, b) { return a * MUL + b; }

export class Diplomacy {
  constructor() {
    this._stance = new Map();    // pairKey -> 'ally'|'rival'|'war'  (neutral omitted)
    this._grievance = new Map(); // dirKey  -> number 0..GRIEVANCE_MAX
    this._wars = new Map();      // pairKey -> { since, exhaust, attacker, defender, goal, kills }
    this._peace = new Map();     // pairKey -> last concluded peace terms (for the chronicle)
    this._scratch = [];          // reused tribe snapshot (no per-year garbage)
  }

  _resolve(sim, x) {
    if (x == null) return null;
    if (typeof x === 'object') return x;
    return sim.tribes.get(x) || null;
  }

  // crude military strength: numbers x metal/tech bonus x era. Used for the
  // opportunity multiplier and by the AI to judge a winnable war.
  strength(sim, t) {
    const tr = this._resolve(sim, t);
    if (!tr) return 1;
    const m = tr.members > 0 ? tr.members : 0;
    const combat = (tr.caps && typeof tr.caps.combat === 'number') ? tr.caps.combat : 1;
    return Math.max(1, m) * combat * (1 + eraOf(tr) * 0.12);
  }

  // settlements owned (carrying-capacity / wealth proxy)
  _settles(sim, tr) {
    return (sim.settleSys && typeof sim.settleSys.countOf === 'function')
      ? sim.settleSys.countOf(tr.id) : 0;
  }

  // living tribes within range of `tribe`, nearest first (capital distance).
  neighborsOf(sim, tribe, range = NEIGHBOR_RANGE) {
    const out = [];
    const r2 = range * range;
    for (const tr of sim.tribes.values()) {
      if (!tr || tr.id === tribe.id || tr.members === 0) continue;
      const dx = tr.capitalX - tribe.capitalX, dy = tr.capitalY - tribe.capitalY;
      if (dx * dx + dy * dy <= r2) out.push(tr);
    }
    out.sort((a, b) => {
      const da = (a.capitalX - tribe.capitalX) ** 2 + (a.capitalY - tribe.capitalY) ** 2;
      const db = (b.capitalX - tribe.capitalX) ** 2 + (b.capitalY - tribe.capitalY) ** 2;
      return da - db;
    });
    return out;
  }

  // --- stance queries -------------------------------------------------------
  stanceBetween(sim, a, b) {
    const idA = idOf(a), idB = idOf(b);
    if (idA === idB) return 'neutral';
    return this._stance.get(pairKey(idA, idB)) || 'neutral';
  }

  atWar(sim, a, b) {
    const idA = idOf(a), idB = idOf(b);
    if (idA === idB) return false;
    return this._stance.get(pairKey(idA, idB)) === 'war';
  }

  // --- active-war enumeration + per-war kill tallies ------------------------
  // Every ACTIVE war `tribeId` is fighting, with the foe, this nation's kills,
  // the foe's kills, and the year it began. Powers governance.warsOf and the
  // integrator's wartime breed-cap (so a nation winning a war can out-breed its
  // foe and actually finish a conquest). Pure read — no rng, no mutation.
  // Returns [] when the tribe has no wars (the common case), so callers may
  // treat a non-empty result as "this nation is at war".
  activeWars(sim, tribeId) {
    const id = idOf(tribeId);
    const out = [];
    if (id == null) return out;
    for (const [key, war] of this._wars) {
      if (!war) continue;
      const a = Math.floor(key / MUL), b = key % MUL;
      let foe;
      if (a === id) foe = b;
      else if (b === id) foe = a;
      else continue;
      // a stance flip can outpace _wars cleanup mid-year; trust the stance map.
      if (this._stance.get(key) !== 'war') continue;
      // kills are stored directionally on the war record, keyed by tribe id, so
      // the same record serves both belligerents symmetrically.
      const myKills = (war.kills && war.kills[id]) || 0;
      const theirKills = (war.kills && war.kills[foe]) || 0;
      out.push({
        foe, kills: myKills, theirKills, since: war.since || 0,
        attacker: war.attacker, defender: war.defender,
        goal: war.goal || DEFAULT_WAR_GOAL,
        isAttacker: war.attacker === id,
      });
    }
    return out;
  }

  // INTEGRATOR HOOK — combat resolution calls this when an agent of killerTribeId
  // slays an agent of victimTribeId. Increments the killer's tally on the shared
  // war record IFF the two nations are actually at war (kills outside a declared
  // war don't count toward war progress). Returns true if a war kill was recorded.
  recordKill(sim, killerTribeId, victimTribeId) {
    const k = idOf(killerTribeId), v = idOf(victimTribeId);
    if (k == null || v == null || k === v) return false;
    const key = pairKey(k, v);
    if (this._stance.get(key) !== 'war') return false; // not a war kill
    const war = this._wars.get(key);
    if (!war) return false;
    if (!war.kills) war.kills = {};
    war.kills[k] = (war.kills[k] || 0) + 1;
    return true;
  }

  // hot-path foe test: at-war OR rival. Single Map lookup.
  hostile(sim, a, b) {
    const idA = idOf(a), idB = idOf(b);
    if (idA === idB) return false;
    const s = this._stance.get(pairKey(idA, idB));
    return s === 'war' || s === 'rival';
  }

  grievanceBetween(sim, a, b) {
    return this._grievance.get(dirKey(idOf(a), idOf(b))) || 0;
  }

  // --- THE war-pressure function (GAME_RULES §2), directional A -> B ---------
  // border_friction + resource/era need + crowding + aggression + grievance
  //   + ideology_gap - kinship/alliance, the whole thing x opportunity.
  // Pure: no rng, no mutation.
  warPressure(sim, a, b) {
    const A = this._resolve(sim, a), B = this._resolve(sim, b);
    if (!A || !B || A === B || A.members === 0 || B.members === 0) return 0;
    const idA = A.id, idB = B.id;

    // border friction — adjacency proxied by capital proximity
    const dx = A.capitalX - B.capitalX, dy = A.capitalY - B.capitalY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const friction = Math.max(0, 1 - dist / FRICTION_RANGE);            // 0..1

    // resource / era need — A covets B's advancement & land
    const eraNeed = Math.max(0, eraOf(B) - eraOf(A)) * 0.12;
    const setA = this._settles(sim, A), setB = this._settles(sim, B);
    const landNeed = Math.max(0, setB - setA) * 0.05;

    // crowding — A's population over its carrying capacity
    const capA = 30 + setA * 30;
    const crowd = Math.max(0, A.members / capA - 1);

    // aggression — national policy + the people's innate temperament
    const pol = (A.policy && typeof A.policy.aggression === 'number') ? A.policy.aggression : 0;
    const innate = A.founder ? (gene(A.founder, 'aggression') * 2 - 1) : 0; // -1..1
    const aggr = pol * 0.5 + innate * 0.25;

    // grievance — accumulated history A holds toward B
    const grv = this._grievance.get(dirKey(idA, idB)) || 0;

    // ideology gap — a differing faith chafes; a shared one soothes
    const rA = A.religion, rB = B.religion;
    let ideo = 0;
    if (rA && rB) ideo = (rA.id === rB.id) ? -0.15 : 0.30;
    else if (rA || rB) ideo = 0.10;

    // kinship / alliance — shared lineage, shared faith, formal alliance subtract
    let kin = 0;
    if (A.founder && B.founder) kin += Math.max(0, 1 - distance(A.founder, B.founder) * 1.2);
    if (rA && rB && rA.id === rB.id) kin += 0.20;
    if (sim.anthro) kin += sim.anthro.affinity(A, B) * 0.7; // kindred cultures keep the peace
    if (this._stance.get(pairKey(idA, idB)) === 'ally') kin += 2.0;

    let p = friction * 0.6
      + (eraNeed + landNeed)
      + crowd * 0.5
      + aggr * 0.7
      + grv
      + ideo * 0.4
      - kin * 0.7;

    // opportunity — scale by relative strength (attack when winnable)
    const sA = this.strength(sim, A), sB = this.strength(sim, B);
    const opp = 0.35 + 1.3 * (sA / (sA + sB)); // 0.35..1.65, =1.0 at parity
    return p * opp;
  }

  // --- stance mutation ------------------------------------------------------
  setStance(sim, a, b, stance) {
    const idA = idOf(a), idB = idOf(b);
    if (idA === idB || !VALID_STANCES[stance]) return false;
    const key = pairKey(idA, idB);
    const prev = this._stance.get(key) || 'neutral';
    if (stance === prev) return false;
    if (stance === 'neutral') this._stance.delete(key);
    else this._stance.set(key, stance);
    // war-record bookkeeping (powers exhaustion / auto-peace). The record carries
    // STAKES (attacker/defender/goal) so a war has a legible aim & closure; the
    // ids default to the pair's lower/higher id and are corrected by declareWar,
    // which alone knows who actually opened hostilities.
    if (stance === 'war' && prev !== 'war') {
      const year = sim && sim.year ? sim.year() : 0;
      this._wars.set(key, { since: year, exhaust: 0, attacker: idA, defender: idB, goal: DEFAULT_WAR_GOAL });
    } else if (prev === 'war' && stance !== 'war') {
      this._wars.delete(key);
    }
    return true;
  }

  // set/replace the aggressor's war aim on an active war record. `goal` is one of
  // VALID_WAR_GOALS; unknown goals are ignored. Returns true if a war was stamped.
  setWarGoal(sim, a, b, goal) {
    const key = pairKey(idOf(a), idOf(b));
    const war = this._wars.get(key);
    if (!war || !VALID_WAR_GOALS[goal]) return false;
    war.goal = goal;
    return true;
  }

  declareWar(sim, a, b, goal) {
    const A = this._resolve(sim, a), B = this._resolve(sim, b);
    if (!A || !B || A === B) return false;
    if (this._stance.get(pairKey(A.id, B.id)) === 'war') return false;
    this.setStance(sim, A.id, B.id, 'war');
    // stamp the true belligerent roles + the war aim on the fresh record
    const war = this._wars.get(pairKey(A.id, B.id));
    if (war) { war.attacker = A.id; war.defender = B.id; war.goal = VALID_WAR_GOALS[goal] ? goal : DEFAULT_WAR_GOAL; }
    this.addGrievance(sim, A.id, B.id, DECLARE_GRIEVANCE);
    this.addGrievance(sim, B.id, A.id, DECLARE_GRIEVANCE * 0.5);
    if (sim.emit) sim.emit('war', `${A.name} declares war on ${B.name}`, A.capitalX, A.capitalY, A.hue);
    return true;
  }

  // last concluded peace per pair, for the UI / chronicle (overwritten each war).
  // { attacker, defender, goal, killsA, killsB, victor, since, until }.
  lastPeaceTerms(sim, a, b) {
    if (!this._peace) return null;
    return this._peace.get(pairKey(idOf(a), idOf(b))) || null;
  }

  makePeace(sim, a, b) {
    const A = this._resolve(sim, a), B = this._resolve(sim, b);
    if (!A || !B || A === B) return false;
    const key = pairKey(A.id, B.id);
    const s = this._stance.get(key);
    if (s !== 'war' && s !== 'rival') return false;
    // capture the closing terms BEFORE setStance deletes the war record
    const war = this._wars.get(key);
    let terms = null;
    if (war) {
      const kA = (war.kills && war.kills[A.id]) || 0;
      const kB = (war.kills && war.kills[B.id]) || 0;
      const victor = kA > kB ? A.id : (kB > kA ? B.id : null); // null = stalemate
      terms = {
        attacker: war.attacker, defender: war.defender, goal: war.goal || DEFAULT_WAR_GOAL,
        killsA: war.attacker === A.id ? kA : kB,
        killsB: war.attacker === A.id ? kB : kA,
        victor, since: war.since || 0, until: sim && sim.year ? sim.year() : 0,
      };
      if (!this._peace) this._peace = new Map();
      this._peace.set(key, terms);
    }
    this.setStance(sim, A.id, B.id, 'neutral');
    // war-weariness buys lasting calm: shed most accumulated grievance
    this._softenGrievance(A.id, B.id, 0.4);
    this._softenGrievance(B.id, A.id, 0.4);
    if (sim.emit) {
      let msg = `${A.name} and ${B.name} make peace`;
      if (terms && terms.victor != null) {
        const win = terms.victor === A.id ? A : B;
        msg = `${A.name} and ${B.name} make peace — ${win.name} prevail`;
      }
      sim.emit('peace', msg, A.capitalX, A.capitalY, A.hue);
    }
    return true;
  }

  // Returns whether the alliance was accepted (low mutual pressure, not at war).
  proposeAlliance(sim, a, b) {
    const A = this._resolve(sim, a), B = this._resolve(sim, b);
    if (!A || !B || A === B) return false;
    const key = pairKey(A.id, B.id);
    const s = this._stance.get(key);
    if (s === 'ally') return true;
    if (s === 'war') return false;
    const pAB = this.warPressure(sim, A, B), pBA = this.warPressure(sim, B, A);
    if (pAB < RIVAL_THRESHOLD && pBA < RIVAL_THRESHOLD) {
      this.setStance(sim, A.id, B.id, 'ally');
      if (sim.emit) sim.emit('alliance', `${A.name} and ${B.name} forge an alliance`, A.capitalX, A.capitalY, A.hue);
      return true;
    }
    return false;
  }

  addGrievance(sim, a, b, amt) {
    const k = dirKey(idOf(a), idOf(b));
    const v = (this._grievance.get(k) || 0) + amt;
    this._grievance.set(k, v > GRIEVANCE_MAX ? GRIEVANCE_MAX : v);
  }

  _softenGrievance(a, b, factor) {
    const k = dirKey(a, b);
    const v = this._grievance.get(k);
    if (v) this._grievance.set(k, v * factor);
  }

  // --- yearly maintenance (self-gated) --------------------------------------
  tick(sim) {
    if (!sim || (sim.tick % YEAR) !== 0) return;

    // 1) grievances fade with time
    for (const [k, v] of this._grievance) {
      const nv = v * GRIEVANCE_DECAY;
      if (nv < 0.01) this._grievance.delete(k); else this._grievance.set(k, nv);
    }

    // 2) resolve active wars: weariness, fresh grievance, auto-peace
    const warKeys = Array.from(this._wars.keys());
    for (let i = 0; i < warKeys.length; i++) {
      const key = warKeys[i];
      const war = this._wars.get(key);
      if (!war) continue;
      const a = Math.floor(key / MUL), b = key % MUL;
      const A = sim.tribes.get(a), B = sim.tribes.get(b);
      if (!A || !B || A.members === 0 || B.members === 0) {
        this.setStance(sim, a, b, 'neutral'); // a side crushed/gone — war ends
        continue;
      }
      war.exhaust += EXHAUST_RATE;
      this.addGrievance(sim, a, b, WAR_GRIEVANCE);
      this.addGrievance(sim, b, a, WAR_GRIEVANCE);
      const pAB = this.warPressure(sim, A, B);
      const pBA = this.warPressure(sim, B, A);
      if ((pAB < PEACE_FLOOR && pBA < PEACE_FLOOR) || war.exhaust >= EXHAUST_CAP) {
        this.makePeace(sim, A, B);
      }
    }

    // 3) drift AI<->AI stances by pressure (never touch the player's relations)
    const list = this._scratch; list.length = 0;
    for (const tr of sim.tribes.values()) if (tr && tr.members > 0) list.push(tr);
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (A.isPlayer || B.isPlayer) continue;
        const cur = this._stance.get(pairKey(A.id, B.id)) || 'neutral';
        if (cur === 'war' || cur === 'ally') continue; // wars handled above; alliances persist
        const m = Math.max(this.warPressure(sim, A, B), this.warPressure(sim, B, A));
        if (cur === 'neutral' && m > RIVAL_THRESHOLD) this.setStance(sim, A.id, B.id, 'rival');
        else if (cur === 'rival' && m < FRIENDLY_THRESHOLD) this.setStance(sim, A.id, B.id, 'neutral');
      }
    }

    // 4) drop entries that reference tribes that no longer exist
    for (const k of Array.from(this._stance.keys())) {
      const a = Math.floor(k / MUL), b = k % MUL;
      if (!sim.tribes.has(a) || !sim.tribes.has(b)) { this._stance.delete(k); this._wars.delete(k); if (this._peace) this._peace.delete(k); }
    }
    for (const k of Array.from(this._grievance.keys())) {
      const a = Math.floor(k / MUL), b = k % MUL;
      if (!sim.tribes.has(a) || !sim.tribes.has(b)) this._grievance.delete(k);
    }
  }
}
