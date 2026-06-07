// The mind of every creature: a tiny multi-layer perceptron.
//
// Design choice (see research/03 tech-feasibility): FIXED TOPOLOGY + weight
// evolution, not NEAT. Reasons: (1) every genome is the same length so any two
// can interbreed and be compared/averaged; (2) the forward pass is a few flat
// loops over a Float32Array — cheap enough to run thousands per tick on the CPU,
// leaving the GPU free for rendering; (3) stable for always-on runtime evolution.
//
// A genome is ONE Float32Array: [ ...brainWeights, ...bodyGenes ].
// Body genes are expressed as visible/physical traits so evolution is SEEN,
// not just inferred (research fun-factor: make evolution legible).

// ---- network shape -------------------------------------------------------
// Inputs (what a creature senses about its tiny world):
export const SENSE = [
  'bias',        // constant 1
  'energy',      // own energy 0..1
  'age',         // own age 0..1 (toward lifespan)
  'health',      // 0..1
  'food_here',   // food on current tile 0..1
  'food_dx',     // direction to nearest food x (-1..1)
  'food_dy',     // direction to nearest food y
  'food_dist',   // 0 near .. 1 far
  'water_dx',    // direction to nearest water
  'water_dy',
  'kin_dx',      // direction to nearest same-tribe creature
  'kin_dy',
  'kin_density', // crowding by own tribe 0..1
  'foe_dx',      // direction to nearest other-tribe creature
  'foe_dy',
  'foe_density', // nearby foes 0..1
  'foe_threat',  // strength of nearest foe relative to self -1..1
  'elevation',   // terrain height here 0..1
  'temperature', // climate here 0..1
  'crowding',    // total local crowding 0..1
  'reproduce_rdy', // 1 if energy>threshold & adult
  'will_aggression', // nation-policy injected drive (-1..1)
  'will_expansion',  // nation-policy injected drive (-1..1)
  'will_breed',      // nation-policy injected drive (-1..1)
  'res_dx',        // direction to nearest harvestable resource node
  'res_dy',
  'res_dist',      // 0 near .. 1 far (1 = none in sight)
  'carrying',      // 1 if hauling a resource, else 0
  'home_dx',       // direction to home (settlement/capital) to deposit
  'home_dy',
  'thirst',        // 0 sated .. 1 parched (drives seeking water, which it already senses)
];

// Outputs (what it decides to do):
export const ACT = [
  'move_x',    // -1..1 desired move x
  'move_y',    // -1..1 desired move y
  'eat',       // >0 -> try to eat here
  'attack',    // >0 -> attack nearest foe
  'reproduce', // >0 -> try to breed
  'share',     // >0 -> give energy to nearby kin (altruism can evolve)
  'speak',     // >0 -> emit a signal (culture/coordination substrate)
  'gather',    // >0 -> harvest a resource node here, or deposit it at home
];

export const N_IN = SENSE.length;
export const N_HID = 18;
export const N_OUT = ACT.length;

// flat weight layout: in->hid (N_IN*N_HID) + hid->out (N_HID*N_OUT)
export const W_IH = N_IN * N_HID;
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
export function randomGenome(rng) {
  const g = new Float32Array(GENOME_LEN);
  // brain weights: small random -> near-blank slate that evolution shapes
  for (let i = 0; i < BRAIN_LEN; i++) g[i] = rng.gauss(0, 0.6);
  // genes: centered, varied
  for (let i = 0; i < N_GENE; i++) g[BRAIN_LEN + i] = rng.gauss(0, 0.8);
  return g;
}

// sexual reproduction: per-gene crossover + mutation
export function breed(a, b, rng, mutRate = 0.06, mutScale = 0.35) {
  const child = new Float32Array(GENOME_LEN);
  for (let i = 0; i < GENOME_LEN; i++) {
    child[i] = rng.bool() ? a[i] : b[i];
    if (rng.next() < mutRate) {
      child[i] += rng.gauss(0, mutScale);
    }
    // rare large mutation — opens new behavior, keeps lineages from stalling
    if (rng.next() < 0.004) child[i] += rng.gauss(0, 1.2);
  }
  return child;
}

// asexual reproduction (lone survivor) — clone + heavier mutation
export function clone(a, rng, mutRate = 0.09, mutScale = 0.4) {
  const child = new Float32Array(GENOME_LEN);
  for (let i = 0; i < GENOME_LEN; i++) {
    child[i] = a[i];
    if (rng.next() < mutRate) child[i] += rng.gauss(0, mutScale);
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
// Reusable scratch so we don't allocate per-creature per-tick.
const _hid = new Float32Array(N_HID);

export function think(genome, input, output) {
  // input: Float32Array(N_IN), output: Float32Array(N_OUT)
  // layer 1: input -> hidden (tanh)
  for (let h = 0; h < N_HID; h++) {
    let sum = 0;
    const base = h * N_IN;
    for (let i = 0; i < N_IN; i++) sum += genome[base + i] * input[i];
    _hid[h] = Math.tanh(sum);
  }
  // layer 2: hidden -> output (tanh, callers interpret >0 as "do it")
  const ho = W_IH;
  for (let o = 0; o < N_OUT; o++) {
    let sum = 0;
    const base = ho + o * N_HID;
    for (let h = 0; h < N_HID; h++) sum += genome[base + h] * _hid[h];
    output[o] = Math.tanh(sum);
  }
  return output;
}
