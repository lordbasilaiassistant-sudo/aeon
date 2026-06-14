// DEPT 3 STATECRAFT — Governance. THE SYMMETRIC HUMAN/AI INTERFACE: a nation is
// run by one fixed set of levers, identical for a human (via the UI) and an AI
// nation (via aiTurn). One system, two drivers (ARCHITECTURE.md contract 4,
// GAME_RULES.md §1 Macro / §3 nation decision-space).
//
// Every method takes (sim, tribe, ...) and operates through the SAME setters the
// human UI calls, so nothing a player can do is impossible for an AI and vice
// versa. The class holds only a dedicated, sim-seeded RNG for the AI's choices —
// seeded off the world seed so AI decisions never perturb the agent-evolution rng
// stream (same discipline as culture.js). All randomness flows through it; there
// is no global Math.random.
//
// Diplomacy (stances, war pressure, grievances) lives in sim.diplomacy; this layer
// reads it and calls its mutators. Tech priority is realised by steerResearch(),
// which walks a chosen tech's prereq chain and claims the next affordable step from
// the tribe's banked research points each year (a real bias, not a flag).
import { TECHS, TECH_BY_ID } from '../sim/tech.js';
import { gene } from '../sim/brain.js';
import { RNG } from '../core/rng.js';
import { value as itemValue, isResource, itemsOfType } from '../sim/items.js';

const TAU = Math.PI * 2;

// AI decision tuning
const WAR_THRESHOLD = 0.9;    // base pressure to declare war (lowered by aggression)
const ALLY_PRESSURE = 0.12;   // mutual pressure under which a nation seeks allies
const MAX_SETTLEMENTS = 6;    // = settlement.js MAX_PER_TRIBE (expansion ceiling)
const RALLY_TTL = 4;          // years a peaceful rally point lingers before clearing
const BASE_TREASURY_UPLIFT = 0.6; // +60% gold income at full mercantile focus (integrator contract)

const POLICY_KEYS = { aggression: 1, expansion: 1, breed: 1, research: 1 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function eraOf(t) {
  const tt = t && t.tech;
  return (tt && typeof tt === 'object' && typeof tt.era === 'number') ? tt.era : 0;
}

// ---- helpers reused by destinies ------------------------------------------
function totalMembers(sim) {
  let n = 0;
  for (const t of sim.tribes.values()) if (t && t.members > 0) n += t.members;
  return n;
}
function livingOthers(sim, tribe) {
  let n = 0;
  for (const t of sim.tribes.values()) if (t && t.id !== tribe.id && t.members > 0) n++;
  return n;
}
function alliesCount(sim, tribe) {
  const d = sim.diplomacy;
  if (!d) return 0;
  let c = 0;
  for (const t of sim.tribes.values()) {
    if (!t || t.id === tribe.id || t.members === 0) continue;
    if (d.stanceBetween(sim, tribe, t) === 'ally') c++;
  }
  return c;
}
// tribes (incl. self) holding a faith this tribe originated
function faithSpread(sim, tribe) {
  let c = 0;
  for (const t of sim.tribes.values()) {
    if (!t || t.members === 0) continue;
    if (t.religion && t.religion.originId === tribe.id) c++;
  }
  return c;
}
function cityCount(sim, tribe) {
  const list = sim.settlements;
  if (!list) return 0;
  let c = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.tribeId === tribe.id && s.tier >= 3) c++;
  }
  return c;
}

// ---- DESTINIES — opt-in win goals (the Civ victory loop) -------------------
// Each: progress(sim,tribe)->0..1  and  done(sim,tribe)->bool.
export const DESTINIES = [
  {
    id: 'ascendant', name: 'The Ascendant People',
    desc: 'Grow your nation to 200 souls.',
    progress: (s, t) => clamp01(t.members / 200),
    done: (s, t) => t.members >= 200,
  },
  {
    id: 'enlightened', name: 'The Enlightenment',
    desc: 'Carry your people into the Information Age.',
    progress: (s, t) => clamp01(eraOf(t) / 8),
    done: (s, t) => eraOf(t) >= 8,
  },
  {
    id: 'conqueror', name: 'Dominion',
    desc: 'Become the last nation left standing.',
    progress: (s, t) => { const tot = totalMembers(s); return tot > 0 ? clamp01(t.members / tot) : 0; },
    done: (s, t) => t.members > 0 && livingOthers(s, t) === 0,
  },
  {
    id: 'faithful', name: 'One True Faith',
    desc: 'Spread your religion to three other nations.',
    progress: (s, t) => clamp01(faithSpread(s, t) / 4),
    done: (s, t) => faithSpread(s, t) >= 4,
  },
  {
    id: 'builders', name: 'The Great Builders',
    desc: 'Raise three Cities.',
    progress: (s, t) => clamp01(cityCount(s, t) / 3),
    done: (s, t) => cityCount(s, t) >= 3,
  },
  {
    id: 'concord', name: 'The Grand Concord',
    desc: 'Hold an alliance with every other living nation.',
    progress: (s, t) => { const lo = livingOthers(s, t); return lo === 0 ? 0 : clamp01(alliesCount(s, t) / lo); },
    done: (s, t) => { const lo = livingOthers(s, t); return lo >= 1 && alliesCount(s, t) >= lo; },
  },
  {
    id: 'eternal', name: 'The Eternal Nation',
    desc: 'Endure for 300 years.',
    progress: (s, t) => clamp01(((s.year ? s.year() : 0) - (t.foundedYear || 0)) / 300),
    done: (s, t) => ((s.year ? s.year() : 0) - (t.foundedYear || 0)) >= 300,
  },
];

const DESTINY_BY_ID = new Map();
for (let i = 0; i < DESTINIES.length; i++) DESTINY_BY_ID.set(DESTINIES[i].id, DESTINIES[i]);

export class Governance {
  constructor() {
    this._rng = null; // lazily seeded from the world seed on first AI turn
    this.DESTINIES = DESTINIES; // expose to the UI via game.gov.DESTINIES
  }

  _ensureRng(sim) {
    if (!this._rng) this._rng = new RNG((((sim.rng.seed >>> 0) ^ 0xA1CE0001) >>> 0));
  }

  // guarantee the policy shape (adds the research lever to legacy tribes)
  ensurePolicy(tribe) {
    if (!tribe.policy) tribe.policy = { aggression: 0, expansion: 0, breed: 0, research: 0 };
    else if (typeof tribe.policy.research !== 'number') tribe.policy.research = 0;
  }

  // ============================ THE LEVERS ================================
  // policy: aggression | expansion | breed | research, each clamped to [-1,1].
  setPolicy(sim, tribe, key, value) {
    if (!tribe || !POLICY_KEYS[key]) return;
    this.ensurePolicy(tribe);
    let v = +value;
    if (!Number.isFinite(v)) v = 0;
    tribe.policy[key] = clamp(v, -1, 1);
  }

  // bias the tribe's research toward a target tech (null/unknown clears it).
  prioritizeTech(sim, tribe, techId) {
    if (!tribe) return;
    if (techId == null) { tribe.techPriority = null; return; }
    if (!TECH_BY_ID.has(techId)) return;
    tribe.techPriority = techId;
  }

  // set a rally point the nation's people are drawn toward (movement bias).
  rally(sim, tribe, x, y) {
    if (!tribe) return;
    const w = sim.world;
    const cx = clamp(x, 0, w.w - 1);
    const cy = clamp(y, 0, w.h - 1);
    tribe.rally = { x: cx, y: cy, year: sim.year ? sim.year() : 0 };
  }

  // ARMY COMMAND: march the nation's soldiers to (x,y) — front line / siege target.
  // x===null recalls the army. Human (via UI) and AI (in aiTurn) use the same call.
  marchArmy(sim, tribe, x, y) {
    if (!tribe) return;
    if (x == null) { tribe.warRally = null; return; }
    const w = sim.world;
    tribe.warRally = { x: clamp(x, 0, w.w - 1), y: clamp(y, 0, w.h - 1) };
  }

  // intent to settle: rally the people to a spot; a Camp forms when they cluster.
  foundSettlement(sim, tribe, x, y) {
    if (!tribe) return;
    this.rally(sim, tribe, x, y);
    tribe.foundIntent = { x: tribe.rally.x, y: tribe.rally.y, year: tribe.rally.year };
    if (sim.emit) sim.emit('rally', `${tribe.name} sets out to settle new land`, tribe.rally.x, tribe.rally.y, tribe.hue);
  }

  // diplomacy levers — delegate to the shared per-pair store.
  setStance(sim, a, b, stance) { return sim.diplomacy ? sim.diplomacy.setStance(sim, a, b, stance) : false; }
  // declareWar keeps its (sim,a,b) signature; an OPTIONAL 4th arg names the war
  // GOAL (border|raze|vassalize|plunder) — the stakes recorded on the war record.
  declareWar(sim, a, b, goal) { return sim.diplomacy ? sim.diplomacy.declareWar(sim, a, b, goal) : false; }
  makePeace(sim, a, b) { return sim.diplomacy ? sim.diplomacy.makePeace(sim, a, b) : false; }
  proposeAlliance(sim, a, b) { return sim.diplomacy ? sim.diplomacy.proposeAlliance(sim, a, b) : false; }

  // ===================== WAR GOALS + CLOSURE MODEL =======================
  // The legible STAKES around a war: who started it, what they want, and the
  // running kill tally on each side. Human and AI read the SAME records.

  // set/replace the aggressor's aim on an active war (border|raze|vassalize|plunder).
  setWarGoal(sim, a, b, goal) { return sim.diplomacy ? sim.diplomacy.setWarGoal(sim, a, b, goal) : false; }

  // The active war record between two nations, or null if they are not at war.
  // Shape: { attacker, defender, goal, startedYear, killsA, killsB } where
  // killsA = the ATTACKER's kills and killsB = the DEFENDER's kills (so it reads
  // the same regardless of argument order). Drives the UI war panel.
  warStatus(sim, aId, bId) {
    const dip = sim.diplomacy;
    if (!dip || typeof dip.activeWars !== 'function') return null;
    const a = (aId && typeof aId === 'object') ? aId.id : aId;
    const b = (bId && typeof bId === 'object') ? bId.id : bId;
    if (a == null || b == null || a === b) return null;
    const wars = dip.activeWars(sim, a);
    for (let i = 0; i < wars.length; i++) {
      const w = wars[i];
      if (w.foe !== b) continue;
      // w.kills/theirKills are from `a`'s perspective; re-key by belligerent role
      const killsAtt = w.isAttacker ? w.kills : w.theirKills;
      const killsDef = w.isAttacker ? w.theirKills : w.kills;
      return {
        attacker: w.attacker, defender: w.defender, goal: w.goal,
        startedYear: w.since, killsA: killsAtt, killsB: killsDef,
      };
    }
    return null;
  }

  // NOTE: warsOf(sim, tribe) — the active-war list for the HUD + integrator breed-cap
  // — lives further down (the canonical, enriched version), now carrying goal /
  // startedYear / isAttacker. Kept single-source there to avoid a shadowed method.

  // The concluded terms of the last war this pair fought (null if none on record).
  // { attacker, defender, goal, killsA, killsB, victor, since, until }.
  warTerms(sim, aId, bId) {
    const dip = sim.diplomacy;
    return (dip && typeof dip.lastPeaceTerms === 'function') ? dip.lastPeaceTerms(sim, aId, bId) : null;
  }

  // ===================== TREASURY / INCOME LEVER =========================
  // A nation may CHOOSE to prioritize gold (mercantile focus). The intent is
  // stored on the tribe as tribe.econFocus (0 = off, 1 = full focus); the
  // integrator reads it in sim.js to bias the yearly gold income. We provide the
  // lever + the intent + a legible estimate; we do NOT write the gold ourselves.
  setTreasuryFocus(sim, tribe, on) {
    if (!tribe) return 0;
    // accept a boolean toggle OR an explicit 0..1 intensity
    let v;
    if (typeof on === 'number') v = clamp01(on);
    else v = on ? 1 : 0;
    tribe.econFocus = v;
    return v;
  }

  // legible "expected +N gold/yr" for the treasury UI. Mirrors the integrator's
  // base income (members*0.04 + settlements*1.5) and folds in the econFocus
  // uplift the integrator applies, so the number the player sees matches reality.
  // BASE_TREASURY_UPLIFT is the bonus fraction at full focus (econFocus === 1).
  incomeEstimate(sim, tribe) {
    if (!tribe || tribe.members === 0) return 0;
    const settles = (sim.settleSys && typeof sim.settleSys.countOf === 'function')
      ? sim.settleSys.countOf(tribe.id) : 0;
    const base = tribe.members * 0.04 + settles * 1.5;
    const focus = (typeof tribe.econFocus === 'number') ? clamp01(tribe.econFocus) : 0;
    return base * (1 + focus * BASE_TREASURY_UPLIFT);
  }

  // ---- TRADE: exchange gold / resources by mutual agreement -----------------
  // value of a trade bundle, in gold. gold is 1:1; resources/materials fall back
  // to the items.js economic value() (single source of truth with the market),
  // so the AI accept-test in proposeTrade and tradeTick's pricing agree. Signature
  // unchanged. (Legacy weights kept as overrides for the four classic stock keys
  // so prior trade behaviour is preserved exactly.)
  _tval(deal) { const W = { gold: 1, wood: 0.6, stone: 0.8, ore: 1.5, metal: 3 }; let v = 0; for (const k in deal) v += (deal[k] || 0) * (k in W ? W[k] : itemValue(k)); return v; }
  _owns(tribe, deal) { for (const k in deal) { const have = k === 'gold' ? (tribe.gold || 0) : ((tribe.stock && tribe.stock[k]) || 0); if (have < deal[k]) return false; } return true; }
  _shift(tribe, deal, sign) { for (const k in deal) { const amt = deal[k] * sign; if (k === 'gold') tribe.gold = (tribe.gold || 0) + amt; else tribe.stock[k] = (tribe.stock[k] || 0) + amt; } }
  // `from` offers `give` and requests `get` from `to`. Executes iff both own their
  // side and `to` agrees (an AI accepts a deal that gains it value; allies are kinder).
  proposeTrade(sim, from, to, give, get) {
    if (!from || !to || from === to) return false;
    const dip = sim.diplomacy;
    if (dip && dip.atWar(sim, from, to)) return false;           // no trade with an enemy
    if (!this._owns(from, give) || !this._owns(to, get)) return false;
    if (!to.isPlayer) {                                          // AI evaluates the offer
      const gain = this._tval(give), cost = this._tval(get);
      const bar = (dip && dip.stanceBetween(sim, from, to) === 'ally') ? 0.85 : 0.97;
      if (gain < cost * bar) return false;
    }
    this._shift(from, give, -1); this._shift(to, give, +1);      // from → to
    this._shift(to, get, -1); this._shift(from, get, +1);        // to → from
    if (sim.emit) sim.emit('trade', `${from.name} trades with ${to.name}`, from.capitalX, from.capitalY, from.hue);
    return true;
  }

  // ================= TRUE ECONOMICS: SURPLUS / NEED / MARKET ================
  // Nations differ in what their land gives them (regional resources) and what
  // their tech lets them refine. So each nation carries a SURPLUS of some items
  // and a NEED for others. Neighbours then trade surplus-for-need at supply/
  // demand prices (scarcer = pricier), so a resource-poor nation can still get
  // what it lacks — emergent specialization. Built on proposeTrade/_tval/_owns/
  // _shift (signatures unchanged); self-gated to once/sim-year via tradeTick.

  // The set of items trade reasons over: the raw resources a nation stockpiles
  // plus the refined material 'metal' the integrator produces (ore→metal). We
  // stay on the keys that actually live in tribe.stock so we never invent ghost
  // inventory; value() prices them, scarcity multiplies at deal time.
  static _TRADE_ITEMS = (() => {
    const seen = new Set();
    const out = [];
    for (const id of itemsOfType('resource')) if (!seen.has(id)) { seen.add(id); out.push(id); }
    if (!seen.has('metal')) { seen.add('metal'); out.push('metal'); } // integrator's refined ore
    return out;
  })();

  // per-capita target a nation "wants" to hold of an item (a soft demand floor).
  // Staples (food/wood) are wanted more per head; refined goods less. Scaled by
  // members so a big nation needs proportionally more before it counts as sated.
  _targetStock(tribe, id) {
    const m = tribe.members || 0;
    let perHead;
    switch (id) {
      case 'food':  perHead = 0.6; break;
      case 'wood':  perHead = 0.4; break;
      case 'stone': perHead = 0.3; break;
      case 'ore':   perHead = 0.25; break;
      case 'metal': perHead = 0.18; break;
      case 'hide':  perHead = 0.15; break;
      case 'herbs': perHead = 0.12; break;
      default:      perHead = 0.2; break;
    }
    return 4 + m * perHead; // a small flat base so tiny tribes still trade
  }

  _held(tribe, id) { return (tribe.stock && tribe.stock[id]) || 0; }

  // SURPLUS: items a nation holds well ABOVE its target — what it can export.
  // Returns { id: exportableQty } (only positive entries). Keeps a reserve: a
  // nation never trades away the buffer it wants for itself.
  surplusOf(sim, tribe) {
    const out = {};
    if (!tribe || tribe.members === 0) return out;
    const items = Governance._TRADE_ITEMS;
    for (let i = 0; i < items.length; i++) {
      const id = items[i];
      const have = this._held(tribe, id);
      const want = this._targetStock(tribe, id);
      const extra = have - want * 1.25;        // only the cushion above 125% of target is spare
      if (extra >= 1) out[id] = Math.floor(extra);
    }
    return out;
  }

  // NEED: items a nation holds BELOW its target — what it wants to import.
  // Returns { id: deficitQty } (only positive entries).
  needOf(sim, tribe) {
    const out = {};
    if (!tribe || tribe.members === 0) return out;
    const items = Governance._TRADE_ITEMS;
    for (let i = 0; i < items.length; i++) {
      const id = items[i];
      const have = this._held(tribe, id);
      const want = this._targetStock(tribe, id);
      const gap = want - have;
      if (gap >= 1) out[id] = Math.floor(gap);
    }
    return out;
  }

  // supply/demand price (in gold) a nation puts on ONE unit of an item, from ITS
  // OWN scarcity: the less it holds vs what it wants, the more it values a unit
  // (scarcer = pricier); abundance discounts it. Anchored to items.js value().
  _unitPrice(tribe, id) {
    const base = itemValue(id) || 0.5;
    const have = this._held(tribe, id);
    const want = this._targetStock(tribe, id) || 1;
    const ratio = have / want;                 // 0 = bare, 1 = sated, >1 = glut
    // scarcity multiplier in [0.6 .. 2.0]: steep when bare, gentle discount when glutted
    const mul = clamp(2.0 - 1.4 * clamp01(ratio), 0.6, 2.0);
    return base * mul;
  }

  // The mid price two nations settle on for `id`: the seller's (abundant, cheaper)
  // ask and the buyer's (scarce, dearer) bid meet in the middle. Always > 0.
  _marketPrice(seller, buyer, id) {
    const p = (this._unitPrice(seller, id) + this._unitPrice(buyer, id)) * 0.5;
    return p > 0.1 ? p : 0.1;
  }

  // Try ONE surplus-for-need exchange: `buyer` pays gold for `qty` of `id` from
  // `seller`. The price is the scarcity mid, but CLAMPED into the band where the
  // deal actually clears: it must not exceed what proposeTrade's accept-test
  // (_tval) says the goods are worth to the buyer (else the buyer-AI refuses),
  // and it stays >=1. Routes through proposeTrade so the AI gate + war check +
  // ownership all still guard it, and players are never forced. Returns true iff
  // the trade executed.
  _buyFrom(sim, buyer, seller, id, qty) {
    if (qty < 1) return false;
    if (this._held(seller, id) < qty) return false;         // seller hasn't the goods
    let price = Math.round(this._marketPrice(seller, buyer, id) * qty);
    // ceiling = the buyer-AI's own valuation of the goods (proposeTrade requires
    // gain >= cost*bar with bar<=1, so a price at/under _tval(goods) always clears).
    const ceil = Math.floor(this._tval({ [id]: qty }));
    if (ceil < 1) return false;                             // worthless to the buyer-AI
    if (price > ceil) price = ceil;
    if (price < 1) price = 1;
    if ((buyer.gold || 0) < price) return false;            // buyer can't afford it
    // buyer GIVES gold, GETS the item; from seller's view that's a value gain, so
    // proposeTrade(seller offers item, requests gold) lets seller's _tval judge it.
    return this.proposeTrade(sim, seller, buyer, { [id]: qty }, { gold: price });
  }

  // ----------------------------- THE MARKET TICK ---------------------------
  // Integrator calls tradeTick(sim) ONCE per sim-year (after aiTurn, alongside
  // checkDestinies). For each living nation with unmet needs, it shops its
  // peaceful neighbours for their biggest matching surplus and buys what it can
  // afford, dearest-need first. Mutually beneficial: the buyer fills a gap, the
  // seller turns a glut into gold. O(nations × neighbours × items) per YEAR only.
  tradeTick(sim) {
    if (!sim || !sim.tribes) return 0;
    const dip = sim.diplomacy;
    let deals = 0;
    // precompute surplus/need once per nation this year (cheap, yearly)
    const surplus = new Map(), need = new Map();
    for (const t of sim.tribes.values()) {
      if (!t || t.members === 0) continue;
      surplus.set(t.id, this.surplusOf(sim, t));
      need.set(t.id, this.needOf(sim, t));
    }
    for (const buyer of sim.tribes.values()) {
      if (!buyer || buyer.members === 0) continue;
      let myNeed = need.get(buyer.id);
      if (!myNeed) continue;
      // address the most valuable shortfall first
      const wants = Object.keys(myNeed).sort((a, b) => itemValue(b) - itemValue(a));
      if (!wants.length || (buyer.gold || 0) < 1) continue;
      const neigh = dip ? dip.neighborsOf(sim, buyer) : [];
      for (let w = 0; w < wants.length; w++) {
        const id = wants[w];
        let stillNeed = myNeed[id];
        if (stillNeed < 1) continue;
        for (let n = 0; n < neigh.length && stillNeed >= 1 && (buyer.gold || 0) >= 1; n++) {
          const seller = neigh[n];
          if (!seller || seller.members === 0) continue;
          if (dip && dip.atWar(sim, buyer, seller)) continue;   // no trade with an enemy
          const sSurp = surplus.get(seller.id);
          const spare = sSurp ? (sSurp[id] || 0) : 0;
          if (spare < 1) continue;
          const qty = Math.min(stillNeed, spare);
          if (this._buyFrom(sim, buyer, seller, id, qty)) {
            deals++;
            stillNeed -= qty;
            sSurp[id] = spare - qty;                            // seller's glut shrinks
          }
        }
      }
    }
    return deals;
  }

  // destiny (opt-in goal)
  setDestiny(sim, tribe, id) {
    if (!tribe) return;
    if (id == null) { tribe.destiny = null; tribe._destinyDone = false; return; }
    if (!DESTINY_BY_ID.has(id)) return;
    tribe.destiny = id;
    tribe._destinyDone = false;
  }

  // current destiny status for the UI progress bar (null if none chosen).
  checkDestiny(sim, tribe) {
    if (!tribe || !tribe.destiny) return null;
    const d = DESTINY_BY_ID.get(tribe.destiny);
    if (!d) return null;
    return { id: d.id, name: d.name, desc: d.desc, progress: clamp01(d.progress(sim, tribe)), done: d.done(sim, tribe) };
  }

  // yearly sweep that emits a one-time toast when any nation fulfils its destiny.
  checkDestinies(sim) {
    for (const tr of sim.tribes.values()) {
      if (!tr || tr.members === 0 || !tr.destiny) continue;
      const d = DESTINY_BY_ID.get(tr.destiny);
      if (!d) continue;
      if (!tr._destinyDone && d.done(sim, tr)) {
        tr._destinyDone = true;
        if (sim.emit) sim.emit('destiny', `${tr.name} achieve their destiny: ${d.name}`, tr.capitalX, tr.capitalY, tr.hue);
      }
    }
  }

  // ACTIVE WARS this nation is fighting, enriched for the war HUD: foe identity,
  // our/their kill tallies, years elapsed, and who is ahead. Symmetric — the human
  // (war panel) and the AI (war assessment) read the same shape. Empty when at peace.
  warsOf(sim, tribe) {
    const out = [];
    if (tribe == null) return out;
    const d = sim.diplomacy;
    if (!d || typeof d.activeWars !== 'function') return out;
    // accept a tribe object OR a bare id
    const myId = (typeof tribe === 'object') ? tribe.id : tribe;
    const meTr = (typeof tribe === 'object') ? tribe : sim.tribes.get(myId);
    const year = sim.year ? sim.year() : 0;
    const raw = d.activeWars(sim, myId);
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i];
      const foe = sim.tribes.get(w.foe);
      if (!foe || foe.members === 0) continue; // foe gone — war is effectively over
      const net = w.kills - w.theirKills;
      out.push({
        foe: foe.id, name: foe.name, hue: foe.hue,
        kills: w.kills, theirKills: w.theirKills,
        net, winning: net > 0,
        // war STAKES + CLOSURE (the legible aim & who opened hostilities)
        goal: w.goal, startedYear: w.since, isAttacker: w.isAttacker,
        years: Math.max(0, year - w.since),
        pressure: meTr ? d.warPressure(sim, meTr, foe) : 0,
        theirPressure: meTr ? d.warPressure(sim, foe, meTr) : 0,
      });
    }
    out.sort((a, b) => b.theirKills - a.theirKills); // bloodiest front first
    return out;
  }

  // relations snapshot toward every other living nation (for the diplomacy HUD).
  relations(sim, tribe) {
    const out = [];
    const d = sim.diplomacy;
    for (const tr of sim.tribes.values()) {
      if (!tr || tr.id === tribe.id || tr.members === 0) continue;
      out.push({
        id: tr.id, name: tr.name, hue: tr.hue, era: eraOf(tr), members: tr.members,
        stance: d ? d.stanceBetween(sim, tribe, tr) : 'neutral',
        pressure: d ? d.warPressure(sim, tribe, tr) : 0,
        theirPressure: d ? d.warPressure(sim, tr, tribe) : 0,
      });
    }
    out.sort((a, b) => b.pressure - a.pressure);
    return out;
  }

  // ===================== TECH PRIORITY (real effect) =====================
  // Claim the next affordable step toward tribe.techPriority from banked points.
  // Call once per year per tribe (player included) BEFORE TechSystem.accrue.
  // Returns the newly-unlocked tech defs (for discovery toasts).
  steerResearch(sim, tribe) {
    const out = [];
    if (!tribe || !tribe.techPriority) return out;
    const t = tribe.tech;
    if (!t || !(t.known instanceof Set)) return out;
    const target = TECH_BY_ID.get(tribe.techPriority);
    if (!target) { tribe.techPriority = null; return out; }
    if (t.known.has(target.id)) { tribe.techPriority = null; return out; }

    this.ensurePolicy(tribe);
    const rp = tribe.policy.research;
    if (rp <= -0.8) return out;                         // research suppressed by policy
    let budget = 1 + Math.round(clamp01(rp) * 2);       // 1..3 path-steps per year

    let guard = 0;
    while (budget > 0 && guard++ < TECHS.length) {
      const step = this._nextStepToward(t.known, target);
      if (!step) break;                                  // path complete or blocked
      if (step.cost > t.points) break;                   // can't yet afford the next step
      t.known.add(step.id);
      t.points -= step.cost;
      if (step.era > t.era) t.era = step.era;
      out.push(step);
      budget--;
      if (step.id === target.id) { tribe.techPriority = null; break; }
    }
    if (out.length && sim.tech && typeof sim.tech.recompute === 'function') sim.tech.recompute(tribe);
    return out;
  }

  // cheapest unknown tech in target's prereq-closure whose own prereqs are all
  // met — i.e. the next legal step toward the goal. Deterministic, no rng.
  _nextStepToward(known, target) {
    const stack = [target];
    const seen = new Set();
    let best = null;
    while (stack.length) {
      const d = stack.pop();
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      if (known.has(d.id)) continue;
      let ready = true;
      for (let i = 0; i < d.prereqs.length; i++) {
        const pid = d.prereqs[i];
        if (!known.has(pid)) { ready = false; const pd = TECH_BY_ID.get(pid); if (pd) stack.push(pd); }
      }
      if (ready) {
        if (!best || d.cost < best.cost || (d.cost === best.cost && d.id < best.id)) best = d;
      }
    }
    return best;
  }

  // pick a target tech that serves a need: 'combat' | 'growth' | 'science'.
  _goalTech(tribe, kind) {
    const known = (tribe.tech && tribe.tech.known instanceof Set) ? tribe.tech.known : null;
    if (!known) return null;
    const era = eraOf(tribe);
    let best = null;
    for (let i = 0; i < TECHS.length; i++) {
      const d = TECHS[i];
      if (known.has(d.id) || d.era > era + 2) continue;
      const e = d.effect || {};
      let match;
      if (kind === 'combat') match = !!e.combat;
      else if (kind === 'growth') match = !!(e.foodYield || e.moveMul);
      else match = !!e.researchMul;
      if (!match) continue;
      if (!best || d.cost < best.cost || (d.cost === best.cost && d.id < best.id)) best = d;
    }
    if (!best) { // fallback: cheapest reachable unknown of any kind
      for (let i = 0; i < TECHS.length; i++) {
        const d = TECHS[i];
        if (known.has(d.id) || d.era > era + 2) continue;
        if (!best || d.cost < best.cost) best = d;
      }
    }
    return best ? best.id : null;
  }

  // ======================= THE AI NATION'S TURN ==========================
  // A competent yearly heuristic: read warPressure to neighbours + own needs,
  // then drive the SAME levers a human would. Skips the player tribe.
  aiTurn(sim, tribe) {
    if (!tribe || tribe.isPlayer || tribe.members === 0) return;
    this._ensureRng(sim);
    this.ensurePolicy(tribe);
    const r = this._rng;
    const dip = sim.diplomacy;
    const year = sim.year ? sim.year() : 0;

    // --- read the situation ------------------------------------------------
    const settles = (sim.settleSys && typeof sim.settleSys.countOf === 'function') ? sim.settleSys.countOf(tribe.id) : 0;
    const capacity = 30 + settles * 30;
    const crowd = Math.max(0, tribe.members / capacity - 1);     // 0..n
    const era = eraOf(tribe);
    const innateAgg = tribe.founder ? (gene(tribe.founder, 'aggression') * 2 - 1) : 0; // -1..1
    const neigh = dip ? dip.neighborsOf(sim, tribe) : [];

    let bestTarget = null, bestP = -Infinity;     // highest pressure (war candidate)
    let allyTarget = null, allyP = Infinity;       // lowest pressure (ally candidate)
    let warTarget = null, warP = -Infinity;        // current foe (peace candidate)
    let maxEnemyEra = era, avgSettles = 0;
    for (let i = 0; i < neigh.length; i++) {
      const nb = neigh[i];
      const ne = eraOf(nb); if (ne > maxEnemyEra) maxEnemyEra = ne;
      avgSettles += (sim.settleSys ? sim.settleSys.countOf(nb.id) : 0);
      const p = dip ? dip.warPressure(sim, tribe, nb) : 0;
      if (p > bestP) { bestP = p; bestTarget = nb; }
      if (p < allyP) { allyP = p; allyTarget = nb; }
      if (dip && dip.atWar(sim, tribe, nb) && p > warP) { warP = p; warTarget = nb; }
    }
    if (neigh.length) avgSettles /= neigh.length;
    const eraGap = maxEnemyEra - era;

    // --- set the policy levers --------------------------------------------
    // breed: grow when there's room, restrain when overcrowded
    let breed = crowd > 0.2 ? -0.3 - clamp01(crowd) * 0.5 : 0.5 - tribe.members / 300;
    // expansion: spread when crowded or out-settled, but not when tiny
    let expansion = (crowd > 0.1 ? 0.6 : 0.1)
      + (settles < avgSettles ? 0.3 : 0)
      + (tribe.members < 25 ? -0.4 : 0);
    // aggression: temperament + opportunity + being at war
    let aggression = innateAgg * 0.5 + (bestP > 0.5 ? 0.3 : 0) + (warTarget ? 0.4 : 0);
    if (bestTarget && dip) {
      const sA = dip.strength(sim, tribe), sB = dip.strength(sim, bestTarget);
      if (sA / (sA + sB) < 0.35) aggression -= 0.5;             // much weaker -> turtle
    }
    // research: everyone teches; harder when falling behind, easier when at peace
    let research = 0.4 + clamp01(eraGap * 0.25) + (crowd < 0.1 && !warTarget ? 0.2 : 0);
    // a little per-nation jitter so neighbours don't act identically
    aggression += r.gauss(0, 0.08); expansion += r.gauss(0, 0.08); research += r.gauss(0, 0.06);

    this.setPolicy(sim, tribe, 'breed', breed);
    this.setPolicy(sim, tribe, 'expansion', expansion);
    this.setPolicy(sim, tribe, 'aggression', aggression);
    this.setPolicy(sim, tribe, 'research', research);

    // --- choose what to research ------------------------------------------
    let kind;
    if (warTarget || tribe.policy.aggression > 0.3) kind = 'combat';
    else if (tribe.policy.expansion > 0.4 || crowd > 0.2) kind = 'growth';
    else kind = 'science';
    const goal = this._goalTech(tribe, kind);
    if (goal) this.prioritizeTech(sim, tribe, goal);

    // --- diplomacy ---------------------------------------------------------
    if (dip) {
      // sue for peace if a war is going badly
      if (warTarget) {
        const sA = dip.strength(sim, tribe), sB = dip.strength(sim, warTarget);
        if (sA / (sA + sB) < 0.4 || tribe.members < 12) dip.makePeace(sim, tribe, warTarget);
      }
      // declare a winnable war on the most-pressing neighbour
      if (bestTarget && !dip.atWar(sim, tribe, bestTarget)) {
        const stance = dip.stanceBetween(sim, tribe, bestTarget);
        if (stance !== 'ally') {
          const sA = dip.strength(sim, tribe), sB = dip.strength(sim, bestTarget);
          const opp = sA / (sA + sB);
          const thresh = WAR_THRESHOLD - 0.35 * Math.max(0, tribe.policy.aggression);
          if (bestP > thresh && opp > 0.52) dip.declareWar(sim, tribe, bestTarget);
        }
      }
      // seek an alliance with a peaceful, comparable neighbour
      if (allyTarget && tribe.policy.aggression < 0.15 && allyP < ALLY_PRESSURE) {
        if (dip.stanceBetween(sim, tribe, allyTarget) === 'neutral') dip.proposeAlliance(sim, tribe, allyTarget);
      }
      // TRADE: buy a resource we're short on from a peaceful neighbour with a surplus
      if (tribe.gold > 14) {
        const NEED = ['metal', 'ore', 'wood', 'stone'];
        const PRICE = { metal: 15, ore: 9, wood: 6, stone: 6 };
        for (let i = 0; i < neigh.length && tribe.gold > 14; i++) {
          const nb = neigh[i];
          if (dip.atWar(sim, tribe, nb)) continue;
          for (let j = 0; j < NEED.length; j++) {
            const r = NEED[j];
            if ((tribe.stock[r] || 0) < 6 && ((nb.stock && nb.stock[r]) || 0) >= 10) {
              if (this.proposeTrade(sim, tribe, nb, { gold: PRICE[r] }, { [r]: 8 })) break;
            }
          }
        }
      }
    }

    // --- military command + expansion -------------------------------------
    if (warTarget) {
      // march the ARMY (soldiers) to the enemy's capital if winning, else home to defend
      const sA = dip ? dip.strength(sim, tribe) : 1, sB = dip ? dip.strength(sim, warTarget) : 1;
      if (sA / (sA + sB) > 0.5) this.marchArmy(sim, tribe, warTarget.capitalX, warTarget.capitalY);
      else this.marchArmy(sim, tribe, tribe.capitalX, tribe.capitalY);
    } else {
      if (tribe.warRally) this.marchArmy(sim, tribe, null); // peace → recall the army home
      if (tribe.policy.expansion > 0.3 && crowd > 0.12 && settles < MAX_SETTLEMENTS) {
        const spot = this._openLand(sim, tribe, r);
        if (spot) this.foundSettlement(sim, tribe, spot.x, spot.y);
      } else if (tribe.rally && typeof tribe.rally.year === 'number' && (year - tribe.rally.year) > RALLY_TTL) {
        tribe.rally = null; // a stale peacetime rally point expires
      }
    }

    // --- adopt a destiny that fits this people (flavor; tracked like a human) --
    if (!tribe.destiny) {
      let pick = 'ascendant';
      if (innateAgg > 0.3) pick = 'conqueror';
      else if (tribe.religion) pick = 'faithful';
      else if (tribe.policy.research > 0.6) pick = 'enlightened';
      else if (tribe.policy.expansion > 0.5) pick = 'builders';
      this.setDestiny(sim, tribe, pick);
    }
  }

  // ===================== PLAYER SAFETY NET (autopilot) ===================
  // A LIGHT, opt-in caretaker the integrator calls for a player who enables it
  // (e.g. tribe.autopilot === true), so a passive nation does not silently die.
  // It runs the SAME levers a human would but stays DEFENSIVE: it grows, teches,
  // defends, sues for a losing peace, and seeks alliances — it never opens a new
  // war or pursues conquest on the player's behalf. Skips a tribe NOT flagged for
  // autopilot only if called directly without a flag; the integrator gates the call.
  autopilotTurn(sim, tribe) {
    if (!tribe || tribe.members === 0) return;
    this._ensureRng(sim);
    this.ensurePolicy(tribe);
    const r = this._rng;
    const dip = sim.diplomacy;
    const year = sim.year ? sim.year() : 0;

    const settles = (sim.settleSys && typeof sim.settleSys.countOf === 'function') ? sim.settleSys.countOf(tribe.id) : 0;
    const capacity = 30 + settles * 30;
    const crowd = Math.max(0, tribe.members / capacity - 1);
    const era = eraOf(tribe);
    const neigh = dip ? dip.neighborsOf(sim, tribe) : [];

    // current war (defensive focus) + a peaceful comparable ally candidate
    let warTarget = null, warP = -Infinity, allyTarget = null, allyP = Infinity, maxEnemyEra = era;
    for (let i = 0; i < neigh.length; i++) {
      const nb = neigh[i];
      const ne = eraOf(nb); if (ne > maxEnemyEra) maxEnemyEra = ne;
      const p = dip ? dip.warPressure(sim, tribe, nb) : 0;
      if (p < allyP) { allyP = p; allyTarget = nb; }
      if (dip && dip.atWar(sim, tribe, nb) && p > warP) { warP = p; warTarget = nb; }
    }
    const eraGap = maxEnemyEra - era;

    // --- policies: grow when there's room, restrain when crowded; always tech;
    //     stay calm (defensive) — autopilot never plays the aggressor. ---------
    const breed = crowd > 0.2 ? -0.3 - clamp01(crowd) * 0.5 : 0.5 - tribe.members / 300;
    const expansion = (crowd > 0.1 ? 0.5 : 0.1) + (tribe.members < 25 ? -0.4 : 0);
    // aggression rises only to defend an active war, never to start one
    const aggression = clamp(warTarget ? 0.3 : -0.2, -1, 1);
    const research = 0.4 + clamp01(eraGap * 0.25) + (!warTarget && crowd < 0.1 ? 0.2 : 0);
    this.setPolicy(sim, tribe, 'breed', breed);
    this.setPolicy(sim, tribe, 'expansion', expansion);
    this.setPolicy(sim, tribe, 'aggression', aggression);
    this.setPolicy(sim, tribe, 'research', research);

    // research toward defense if at war, else growth/science
    const kind = warTarget ? 'combat' : (crowd > 0.2 ? 'growth' : 'science');
    const goal = this._goalTech(tribe, kind);
    if (goal) this.prioritizeTech(sim, tribe, goal);

    // --- diplomacy: sue for peace in a losing war; seek a safe alliance -------
    if (dip) {
      if (warTarget) {
        const sA = dip.strength(sim, tribe), sB = dip.strength(sim, warTarget);
        if (sA / (sA + sB) < 0.5 || tribe.members < 14) dip.makePeace(sim, tribe, warTarget);
      }
      if (allyTarget && allyP < ALLY_PRESSURE && !warTarget) {
        if (dip.stanceBetween(sim, tribe, allyTarget) === 'neutral') dip.proposeAlliance(sim, tribe, allyTarget);
      }
    }

    // --- military + expansion: defend at home; expand only when crowded -------
    if (warTarget) {
      this.marchArmy(sim, tribe, tribe.capitalX, tribe.capitalY); // hold the home line
    } else {
      if (tribe.warRally) this.marchArmy(sim, tribe, null);
      if (crowd > 0.15 && settles < MAX_SETTLEMENTS) {
        const spot = this._openLand(sim, tribe, r);
        if (spot) this.foundSettlement(sim, tribe, spot.x, spot.y);
      } else if (tribe.rally && typeof tribe.rally.year === 'number' && (year - tribe.rally.year) > RALLY_TTL) {
        tribe.rally = null;
      }
    }
  }

  // a walkable spot out from the capital to settle toward. Deterministic in r.
  _openLand(sim, tribe, r) {
    const w = sim.world;
    const base = 14 + r.float(0, 10);
    for (let k = 0; k < 6; k++) {
      const ang = r.float(0, TAU);
      const x = tribe.capitalX + Math.cos(ang) * base;
      const y = tribe.capitalY + Math.sin(ang) * base;
      const ix = x | 0, iy = y | 0;
      if (ix < 1 || iy < 1 || ix >= w.w - 1 || iy >= w.h - 1) continue;
      if (w.walkable(ix, iy)) return { x: clamp(x, 1, w.w - 2), y: clamp(y, 1, w.h - 2) };
    }
    return null;
  }
}
