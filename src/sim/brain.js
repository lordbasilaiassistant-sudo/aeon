// The mind of every creature: a tiny RECURRENT multi-layer perceptron.
//
// Design choice (see research/03 tech-feasibility): FIXED TOPOLOGY + weight
// evolution, not NEAT. Reasons: (1) every genome is the same length so any two
// can interbreed and be compared/averaged; (2) the forward pass is a few flat
// loops over a Float32Array — cheap enough to run thousands per tick on the CPU,
// leaving the GPU free for rendering; (3) stable for always-on runtime evolution.
//
// MEMORY (2026-06-13, cognition dept): the hidden layer is now an ELMAN context
// network. A small slice of last tick's hidden activations is fed back in as
// extra inputs, giving every creature a short-term memory / persistent intent —
// it can pursue a multi-step goal (walk to water THEN drink, flee THEN regroup)
// instead of reacting identically to identical instantaneous senses. The context
// lives on the agent (agent.js: ctx/ctxNext), is reset to 0 on spawn and cleared
// on death so no stale mind leaks through the pool.
//
// A genome is ONE Float32Array: [ ...brainWeights, ...bodyGenes ].
// Body genes are expressed as visible/physical traits so evolution is SEEN,
// not just inferred (research fun-factor: make evolution legible).

// ---- network shape -------------------------------------------------------
// Inputs (what a creature senses about its tiny world).
// APPEND-ONLY: never reorder/insert — sim.js fills senses BY INDEX, so shifting
// an index silently corrupts every creature's perception. New senses simply read
// 0 until the integrator wires their fill (see INTEGRATION NOTES at end of file).
export const SENSE = [
  'bias',        // 0  constant 1
  'energy',      // 1  own energy 0..1
  'age',         // 2  own age 0..1 (toward lifespan)
  'health',      // 3  0..1
  'food_here',   // 4  food on current tile 0..1
  'food_dx',     // 5  direction to nearest food x (-1..1)
  'food_dy',     // 6  direction to nearest food y
  'food_dist',   // 7  0 near .. 1 far
  'water_dx',    // 8  direction to nearest water
  'water_dy',    // 9
  'kin_dx',      // 10 direction to nearest same-tribe creature
  'kin_dy',      // 11
  'kin_density', // 12 crowding by own tribe 0..1
  'foe_dx',      // 13 direction to nearest other-tribe creature
  'foe_dy',      // 14
  'foe_density', // 15 nearby foes 0..1
  'foe_threat',  // 16 strength of nearest foe relative to self -1..1
  'elevation',   // 17 terrain height here 0..1
  'temperature', // 18 climate here 0..1
  'crowding',    // 19 total local crowding 0..1
  'reproduce_rdy', // 20 1 if energy>threshold & adult
  'will_aggression', // 21 nation-policy injected drive (-1..1)
  'will_expansion',  // 22 nation-policy injected drive (-1..1)
  'will_breed',      // 23 nation-policy injected drive (-1..1)
  'res_dx',        // 24 direction to nearest harvestable resource node
  'res_dy',        // 25
  'res_dist',      // 26 0 near .. 1 far (1 = none in sight)
  'carrying',      // 27 1 if hauling a resource, else 0
  'home_dx',       // 28 direction to home (settlement/capital) to deposit
  'home_dy',       // 29
  'thirst',        // 30 0 sated .. 1 parched (drives seeking water)
  // ---- APPENDED 2026-06-13 (cognition): world-integrated perception. ----
  // Each new index reads 0 until sim.js fills it; see INTEGRATION NOTES.
  'predator_dx',   // 31 dir x to nearest wild PREDATOR (fear cue) — 0 if none
  'predator_dy',   // 32 dir y to nearest wild predator
  'predator_dist', // 33 0 close .. 1 far (1 = none in range): FEAR proximity
  'prey_dx',       // 34 dir x to nearest wild PREY (food for carnivores) — 0 if none
  'prey_dy',       // 35 dir y to nearest prey
  'prey_dist',     // 36 0 close .. 1 far (1 = none): only fill for high-diet hunters
  'stamina',       // 37 own fatigue 0 spent .. 1 fresh (lets it choose to rest)
  'danger',        // 38 fused threat 0..1 = max(predator-close, foe-threat>0, low-health)
  'at_war',        // 39 1 if the nation is at war / rallying for battle, else 0
  'home_dist',     // 40 0 home .. 1 far: magnitude (haulers judge "full, head back")
  'kin_signal',    // 41 nearest/avg kin 'speak' signal 0..1 — CLOSES the speak->hear loop
  'kin_need',      // 42 nearest kin distress 0..1 (1-energy or hurt) — targets 'share'/rescue
  'has_target',    // 43 1 if a foe OR predator is actually in range, else 0 (a real "something is here" flag; the dir senses read 0 both when nothing is near AND when it's dead-ahead, so this disambiguates)
];

// Outputs (what it decides to do).
// APPEND-ONLY for the same reason: sim.js executes acts BY INDEX. New acts are
// computed by the brain but IGNORED until the integrator wires their execution.
export const ACT = [
  'move_x',    // 0 -1..1 desired move x
  'move_y',    // 1 -1..1 desired move y
  'eat',       // 2 >0 -> try to eat here
  'attack',    // 3 >0 -> attack nearest foe
  'reproduce', // 4 >0 -> try to breed
  'share',     // 5 >0 -> give energy to nearby kin (altruism can evolve)
  'speak',     // 6 >0 -> emit a signal (culture/coordination substrate)
  'gather',    // 7 >0 -> harvest a resource node here, or deposit it at home
  // ---- APPENDED 2026-06-13 (cognition): the repertoire the world lacked. ----
  'flee',      // 8 >thr -> retreat: move directly AWAY from nearest foe/predator, skip attack
  'rest',      // 9 >thr -> hold position this tick + bonus stamina/health regen (deliberate recovery)
  'hunt',      // 10 >thr -> carnivore (diet-gated) kills nearest wild PREY animal for energy
  'socialize', // 11 >thr -> bias movement TOWARD nearest kin (cluster/herd, enables groups)
  'seek_water',// 12 >thr -> bias movement toward nearest water (explicit drink-seeking)
];

export const N_IN = SENSE.length;
export const N_HID = 20;
export const N_OUT = ACT.length;

// ---- recurrent memory (Elman context) -----------------------------------
// The hidden layer also receives the previous tick's first N_CTX hidden
// activations as extra inputs. So the effective input width is N_IN + N_CTX.
// We tap hidden[0..N_CTX-1] as next context (no extra readout matrix), which
// keeps the genome growth to just the context->hidden weight block W_CH.
export const N_CTX = 6;
export const N_INX = N_IN + N_CTX; // augmented input width seen by the hidden layer

// flat weight layout:  augmented-in -> hid  then  hid -> out
//   W_IH covers BOTH the N_IN real senses AND the N_CTX recurrent inputs,
//   laid out per hidden unit as [ ...N_IN sense weights, ...N_CTX ctx weights ].
export const W_IH = N_INX * N_HID;   // (N_IN + N_CTX) * N_HID
export const W_HO = N_HID * N_OUT;
export const BRAIN_LEN = W_IH + W_HO;

// ---- body genes (expressed traits) --------------------------------------
export const GENE = [
  'hue',        // 0..1 base color hue
  'size',       // 0..1 -> bigger = stronger, hungrier, slower
  'speed',      // 0..1 movement multiplier
  'metabolism', // 0..1 energy burn rate (fast = active but hungry)
  'fertility',  // 0..1 reproduction efficiency
  'aggression', // 0..1 innate temperament (modulates attack)
  'lifespan',   // 0..1 -> maps to max age
  'vision',     // 0..1 sensing radius
  'diet',       // 0..1 (0 herbivore .. 1 predator)
  'resilience', // 0..1 disease/cold resistance
];
export const N_GENE = GENE.length;
export const GENOME_LEN = BRAIN_LEN + N_GENE;

const geneOffset = (name) => BRAIN_LEN + GENE.indexOf(name);
export function gene(genome, name) {
  // genes stored raw; squashed to 0..1 on read
  return 0.5 + 0.5 * Math.tanh(genome[geneOffset(name)]);
}
// Push a gene's raw (pre-tanh) value — used to express a people's heritage traits
// onto their founding genome (e.g. a Martial people starts more aggressive).
export function nudgeGene(genome, name, delta) {
  const i = GENE.indexOf(name);
  if (i >= 0) genome[BRAIN_LEN + i] += delta;
}

// ---- genome construction & evolution -------------------------------------
// Region boundaries (computed, so they track any shape change automatically):
//   [0, W_IH)            sense+context -> hidden weights
//   [W_IH, BRAIN_LEN)    hidden -> output weights
//   [BRAIN_LEN, GENOME_LEN)  body genes
// The recurrent (context) sub-block of W_IH, per hidden unit, lives at the tail
// N_CTX of each N_INX-wide row. We jitter it a touch hotter at birth so memory
// circuits actually form instead of staying near-zero.
export function randomGenome(rng) {
  const g = new Float32Array(GENOME_LEN);
  // brain weights: small random -> near-blank slate that evolution shapes
  for (let i = 0; i < BRAIN_LEN; i++) g[i] = rng.gauss(0, 0.6);
  // give the recurrent context weights a slightly larger seed so the memory
  // loop has signal to work with from generation 0 (region-targeted jitter).
  for (let h = 0; h < N_HID; h++) {
    const ctxBase = h * N_INX + N_IN;
    for (let c = 0; c < N_CTX; c++) g[ctxBase + c] = rng.gauss(0, 0.5);
  }
  // genes: centered, varied
  for (let i = 0; i < N_GENE; i++) g[BRAIN_LEN + i] = rng.gauss(0, 0.8);
  return g;
}

// sexual reproduction: per-locus crossover + SPLIT mutation rates so behavior
// (brain weights) can explore a touch hotter than the body genes, which stay
// stable so a lineage's physique doesn't thrash. Defaults keep aggregate
// mutation near the historical rate, so the invariant holds.
export function breed(a, b, rng, brainMut = 0.06, brainScale = 0.35, geneMut = 0.05, geneScale = 0.3) {
  const child = new Float32Array(GENOME_LEN);
  // brain region: explore behavior
  for (let i = 0; i < BRAIN_LEN; i++) {
    child[i] = rng.bool() ? a[i] : b[i];
    if (rng.next() < brainMut) child[i] += rng.gauss(0, brainScale);
    if (rng.next() < 0.004) child[i] += rng.gauss(0, 1.2); // rare big jump
  }
  // body region: keep physique stable
  for (let i = BRAIN_LEN; i < GENOME_LEN; i++) {
    child[i] = rng.bool() ? a[i] : b[i];
    if (rng.next() < geneMut) child[i] += rng.gauss(0, geneScale);
    if (rng.next() < 0.004) child[i] += rng.gauss(0, 1.2);
  }
  return child;
}

// asexual reproduction (lone survivor) — clone + heavier mutation, also split.
export function clone(a, rng, brainMut = 0.09, brainScale = 0.4, geneMut = 0.07, geneScale = 0.32) {
  const child = new Float32Array(GENOME_LEN);
  for (let i = 0; i < BRAIN_LEN; i++) {
    child[i] = a[i];
    if (rng.next() < brainMut) child[i] += rng.gauss(0, brainScale);
    if (rng.next() < 0.005) child[i] += rng.gauss(0, 1.2);
  }
  for (let i = BRAIN_LEN; i < GENOME_LEN; i++) {
    child[i] = a[i];
    if (rng.next() < geneMut) child[i] += rng.gauss(0, geneScale);
    if (rng.next() < 0.005) child[i] += rng.gauss(0, 1.2);
  }
  return child;
}

// genetic distance — used to split populations into species/subspecies
export function distance(a, b) {
  let d = 0;
  for (let i = 0; i < GENOME_LEN; i++) {
    const x = a[i] - b[i];
    d += x * x;
  }
  return Math.sqrt(d / GENOME_LEN);
}

// ---- forward pass (hot path) --------------------------------------------
// Reusable scratch so we don't allocate per-creature per-tick. The forward pass
// is run thousands of times per tick, so it is written to do ZERO allocation and
// keep the typed arrays in locals (registers) for the inner accumulation loops.
//
// RECURRENCE: the hidden layer reads N_IN real senses from `input` followed by
// N_CTX recurrent values from `ctx` (last tick's memory). After computing the
// hidden activations we copy hidden[0..N_CTX-1] into `ctxOut` to become next
// tick's context. Both ctx/ctxOut are caller-owned Float32Arrays on the agent,
// so the pass stays allocation-free. The augmented input is staged into a
// module-level scratch (_inx) once per call — N_INX writes, no allocation.
const _hid = new Float32Array(N_HID);
const _inx = new Float32Array(N_INX); // staged [ ...senses, ...ctx ]
const _NIN = N_IN;
const _NCTX = N_CTX;
const _NINX = N_INX;
const _NHID = N_HID;
const _NOUT = N_OUT;
const _WIH = W_IH;
const _NINX4 = _NINX - (_NINX & 3); // largest multiple of 4 <= N_INX
const _NHID4 = _NHID - (_NHID & 3);

export function think(genome, input, output, ctx, ctxOut) {
  // input: Float32Array(N_IN), output: Float32Array(N_OUT)
  // ctx:   Float32Array(N_CTX) previous memory (may be undefined on a fresh call)
  // ctxOut:Float32Array(N_CTX) receives this tick's memory for next time
  const g = genome, hid = _hid, inx = _inx;
  // stage augmented input: [ N_IN senses | N_CTX recurrent context ]
  for (let i = 0; i < _NIN; i++) inx[i] = input[i];
  if (ctx) { for (let c = 0; c < _NCTX; c++) inx[_NIN + c] = ctx[c]; }
  else { for (let c = 0; c < _NCTX; c++) inx[_NIN + c] = 0; }

  // layer 1: augmented-input -> hidden (tanh)
  let base = 0;
  for (let h = 0; h < _NHID; h++) {
    let sum = 0;
    let i = 0;
    // unrolled by 4 — same add order, just fewer loop-condition checks
    for (; i < _NINX4; i += 4) {
      const b = base + i;
      sum += g[b]     * inx[i];
      sum += g[b + 1] * inx[i + 1];
      sum += g[b + 2] * inx[i + 2];
      sum += g[b + 3] * inx[i + 3];
    }
    for (; i < _NINX; i++) sum += g[base + i] * inx[i];
    hid[h] = Math.tanh(sum);
    base += _NINX;
  }
  // carry forward the memory: first N_CTX hidden units become next ctx
  if (ctxOut) { for (let c = 0; c < _NCTX; c++) ctxOut[c] = hid[c]; }

  // layer 2: hidden -> output (tanh, callers interpret >0 as "do it")
  base = _WIH;
  for (let o = 0; o < _NOUT; o++) {
    let sum = 0;
    let h = 0;
    for (; h < _NHID4; h += 4) {
      const b = base + h;
      sum += g[b]     * hid[h];
      sum += g[b + 1] * hid[h + 1];
      sum += g[b + 2] * hid[h + 2];
      sum += g[b + 3] * hid[h + 3];
    }
    for (; h < _NHID; h++) sum += g[base + h] * hid[h];
    output[o] = Math.tanh(sum);
    base += _NHID;
  }
  return output;
}
