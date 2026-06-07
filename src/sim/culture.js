// WORKSTREAM C — Culture. The light first pass at Layer 2: the part of a
// civilization that is LEARNED and TRANSMITTED within lifetimes, not encoded in
// the genome (see DESIGN.md §3, the honest two-layer mind). Two cheap, legible
// systems live here:
//
//   1. Language — every tribe owns a distinct, seeded phoneme set, so its
//      people's and places' names read as one tongue. The set drifts slowly,
//      so a long-lived people's language is observably its own.
//   2. Religion — a faith can ARISE in a large, cultured tribe and then SPREAD
//      to neighbours by contact (capital-to-capital proximity), carrying a
//      "fervor" that feeds back into the tribe's culture (cohesion).
//
// Performance contract: everything here loops over TRIBES (a few dozen), NEVER
// over agents. It self-gates so cultural logic runs only a few times per
// sim-second, making it effectively free against the per-agent hot path.
//
// Determinism (sim rule): no global Math.random anywhere. We use a dedicated
// RNG seeded from the sim seed (so culture never perturbs the agent-evolution
// RNG stream) plus the rng passed into initTribe during seeding.
import { RNG } from '../core/rng.js';

// ---- phoneme pools (module-level, read-only) -----------------------------
// A tribe samples a small subset of each, giving it a recognisable sound.
const ONSETS = [
  'k', 't', 'p', 'b', 'd', 'g', 'm', 'n', 's', 'sh', 'th', 'v', 'z', 'r', 'l',
  'f', 'h', 'j', 'w', 'kr', 'dr', 'gr', 'st', 'sk', 'vr', 'thr', 'br', 'tr',
  'ny', 'ly', 'x', 'q', 'ph', 'rh', 'sy', 'kh',
];
const VOWELS = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'au', 'ai', 'ou', 'y', 'ia', 'io',
  'eo', 'ua', 'ye',
];
const CODAS = [
  '', 'n', 'r', 's', 'l', 'th', 'k', 'm', 'x', 'rn', 'ld', 'st', 'ng', 'rk',
  'sh', 'll', 'nd', 'rth',
];

// ---- how a faith is named once a root word is coined ----------------------
const FAITH_FORMS = [
  (w) => `the ${w} Faith`,
  (w) => `the Cult of ${w}`,
  (w) => `the Way of ${w}`,
  (w) => `the ${w} Mysteries`,
  (w) => `the Children of ${w}`,
  (w) => `${w}ism`,
  (w) => `the Order of ${w}`,
  (w) => `the Path of ${w}`,
];

// ---- tuning ---------------------------------------------------------------
const CULTURE_PERIOD   = 30;   // run cultural logic every N ticks (self-gate)
const CONTACT_R        = 30;   // tiles: capital-to-capital "in contact" range
const CONTACT_R2       = CONTACT_R * CONTACT_R;
const FOUND_MIN_POP    = 20;   // a faith needs a sizable people to arise
const FOUND_MIN_CULTURE = 25;  // ...and an accumulated culture
const FOUND_RATE       = 0.12; // scales the per-check founding probability
const FERVOR_GAIN      = 0.06; // how fast fervor tracks a people's vigor
const FAITH_CULTURE    = 0.4;  // culture added per cultural tick from fervor
const SPREAD_MIN_FERVOR = 0.4; // a faith must be this fervent to proselytise
const SPREAD_RATE      = 0.25; // scales the per-pair conversion probability
const DRIFT_RATE       = 0.02; // chance per tribe per cultural tick to shift a phoneme

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Sample `n` distinct entries from `pool` using `r` (allocation only at
// init/drift time, never in the hot path).
function sample(pool, n, r) {
  const copy = pool.slice();
  const out = [];
  n = Math.min(n, copy.length);
  for (let i = 0; i < n; i++) {
    const j = r.int(0, copy.length); // inclusive min, exclusive max
    out.push(copy.splice(j, 1)[0]);
  }
  return out;
}

// Swap one member of `subset` for a fresh draw from `pool` (slow language drift).
function replaceOne(subset, pool, r) {
  if (subset.length === 0) return;
  const idx = r.int(0, subset.length);
  for (let t = 0; t < 6; t++) {
    const cand = r.pick(pool);
    if (subset.indexOf(cand) < 0) { subset[idx] = cand; return; }
  }
}

export class Culture {
  // `seed` optional — if omitted the RNG is lazily seeded from the sim on the
  // first tick (the integrator constructs this as `new Culture()`).
  constructor(seed) {
    this._rng = (seed !== undefined) ? new RNG(seed >>> 0) : null;
    this._list = [];      // reused snapshot array (no per-tick iterator garbage)
    this._faithSeq = 0;   // monotonic id so a faith stays identifiable as it spreads
  }

  // Give a tribe a language style (distinct phoneme subset) and an empty faith
  // slot. Called by the integrator in seedLife/godSpawnLife with the sim rng;
  // also self-healed from tick() for any tribe that slipped through.
  initTribe(tribe, rng) {
    if (!tribe) return null;
    const r = rng || this._rng || (this._rng = new RNG(0xC0FFEE));
    tribe.lang = {
      onset: sample(ONSETS, 6, r),
      vowel: sample(VOWELS, 4, r),
      coda: sample(CODAS, 5, r),
      salt: (r.next() * 0x7fffffff) | 0, // per-tribe flavour for derived names
    };
    if (tribe.religion === undefined) tribe.religion = null;
    return tribe.lang;
  }

  // The syllable set, so a name generator can speak the tribe's tongue.
  language(tribe) {
    return tribe && tribe.lang ? tribe.lang : null;
  }

  // Convenience: coin an in-tongue word for a given tribe (optional helper for
  // name generation / UI). Deterministic in the rng you pass.
  nameFor(tribe, rng, syllables = 2) {
    const lang = tribe && tribe.lang;
    if (!lang) return '';
    return this._word(lang, rng, syllables);
  }

  // Cheap, self-gated. Runs every CULTURE_PERIOD ticks; loops over tribes only.
  tick(sim, dt) {
    if (!sim || (sim.tick % CULTURE_PERIOD) !== 0) return;

    // dedicated, sim-seeded RNG so culture never shifts the agent rng stream
    if (!this._rng) {
      this._rng = new RNG((((sim.rng.seed >>> 0) ^ 0x9e3779b1) >>> 0));
    }
    const r = this._rng;

    // snapshot living tribes into the reused array
    const list = this._list;
    list.length = 0;
    for (const tr of sim.tribes.values()) {
      if (!tr) continue;
      if (!tr.lang) this.initTribe(tr, r); // safety net
      if (tr.members > 0) list.push(tr);
    }
    const n = list.length;

    // 1) per-tribe: language drift + faith emergence + fervor dynamics  (O(T))
    for (let i = 0; i < n; i++) this._evolveTribe(sim, list[i], r);

    // 2) religion spread by contact (capital proximity)  (O(T^2), T ~ dozens)
    for (let i = 0; i < n; i++) {
      const src = list[i];
      const rel = src.religion;
      if (!rel || rel.fervor < SPREAD_MIN_FERVOR) continue;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dst = list[j];
        const drel = dst.religion;
        // skip tribes already holding this faith, or a comparably strong one
        if (drel && (drel.id === rel.id || drel.fervor >= rel.fervor * 0.85)) continue;
        const dx = src.capitalX - dst.capitalX;
        const dy = src.capitalY - dst.capitalY;
        const d2 = dx * dx + dy * dy;
        if (d2 > CONTACT_R2) continue;
        const closeness = 1 - Math.sqrt(d2) / CONTACT_R;     // 0..1
        const zeal = rel.fervor - (drel ? drel.fervor : 0);  // how much stronger
        const p = clamp01(closeness * zeal) * SPREAD_RATE;
        if (r.next() < p) this._convert(sim, dst, rel, drel);
      }
    }
  }

  // ---- internals ----------------------------------------------------------
  _evolveTribe(sim, tr, r) {
    // a tongue shifts slowly over the ages
    if (r.next() < DRIFT_RATE) {
      const which = r.int(0, 3);
      if (which === 0) replaceOne(tr.lang.onset, ONSETS, r);
      else if (which === 1) replaceOne(tr.lang.vowel, VOWELS, r);
      else replaceOne(tr.lang.coda, CODAS, r);
    }

    const rel = tr.religion;
    if (rel) {
      // fervor tracks the people's vigor (size + culture); a dwindling people
      // loses faith, a thriving one deepens it
      const vigor = clamp01(tr.members / 50) * 0.5 + clamp01(tr.culture / 200) * 0.5;
      rel.fervor += (vigor - 0.5) * FERVOR_GAIN;
      if (rel.fervor > 1) rel.fervor = 1;
      if (rel.fervor <= 0.02) {
        sim.emit('religion', `${rel.name} fades among ${tr.name}`, tr.capitalX, tr.capitalY, tr.hue);
        tr.religion = null;
        return;
      }
      // shared belief is cohesion — it feeds back into culture
      tr.culture += rel.fervor * FAITH_CULTURE;
    } else {
      // a faith can arise in a large, cultured people; an older civ (higher
      // tech era, if Tech is wired) is likelier to formalise one
      if (tr.members >= FOUND_MIN_POP && tr.culture >= FOUND_MIN_CULTURE) {
        const era = (tr.tech && typeof tr.tech === 'object') ? (tr.tech.era | 0) : 0;
        const p = clamp01((tr.culture - FOUND_MIN_CULTURE) / 400)
          * clamp01(tr.members / 50)
          * (1 + era * 0.25)
          * FOUND_RATE;
        if (r.next() < p) this._found(sim, tr, r);
      }
    }
  }

  _found(sim, tr, r) {
    const name = this._faithName(tr.lang, r);
    tr.religion = {
      id: ++this._faithSeq,
      name,
      fervor: 0.32,
      foundedYear: sim.year ? sim.year() : 0,
      originId: tr.id,
    };
    tr.culture += FAITH_CULTURE * 4; // a founding surge of zeal
    sim.emit('religion', `${tr.name} embrace ${name}`, tr.capitalX, tr.capitalY, tr.hue);
  }

  _convert(sim, dst, rel, drel) {
    const adopting = !drel;
    dst.religion = {
      id: rel.id,
      name: rel.name,
      fervor: Math.max(0.2, rel.fervor * 0.5), // a transmitted faith starts cooler
      foundedYear: sim.year ? sim.year() : 0,
      originId: rel.originId,
    };
    dst.culture += FAITH_CULTURE * 2;
    if (adopting) {
      sim.emit('religion', `${dst.name} take up ${rel.name}`, dst.capitalX, dst.capitalY, dst.hue);
    } else {
      sim.emit('religion', `${dst.name} convert to ${rel.name}`, dst.capitalX, dst.capitalY, dst.hue);
    }
  }

  // Coin an in-tongue root word from a tribe's phoneme set.
  _word(lang, r, syllables = 2) {
    let w = '';
    for (let i = 0; i < syllables; i++) {
      w += r.pick(lang.onset) + r.pick(lang.vowel);
      if (r.bool(0.5)) w += r.pick(lang.coda);
    }
    return cap(w);
  }

  _faithName(lang, r) {
    const root = this._word(lang, r, r.bool(0.5) ? 2 : 3);
    return FAITH_FORMS[r.int(0, FAITH_FORMS.length)](root);
  }
}
