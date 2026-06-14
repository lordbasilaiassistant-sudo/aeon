// A single creature. Pooled (reused on death) to avoid GC churn at scale.
import { gene, randomGenome, N_CTX } from './brain.js';
import { personName } from './names.js';

let _nextId = 1;

export class Agent {
  constructor() { this.alive = false; this.id = 0; this.reset0(); }

  reset0() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.genome = null;
    this.energy = 0; this.health = 1; this.age = 0; this.maxAge = 1;
    this.tribeId = 0;
    this.generation = 0;
    this.fitness = 0;     // lifetime score (food + offspring + survival)
    this.offspring = 0;
    this.name = '';
    this.parentA = 0; this.parentB = 0;
    this.cooldownBreed = 0;
    this.lastAct = 0;     // for render fx (eat/attack flashes)
    this.signal = 0;      // 'speak' output, decays — culture substrate
    // ---- RECURRENT MEMORY (Elman context) — short-term mind/intention. ----
    // ctx = last tick's memory fed back into the brain; ctxNext receives this
    // tick's. Both are reset to 0 on spawn and cleared on kill so a recycled
    // pooled body never inherits a dead creature's train of thought. We keep two
    // buffers and SWAP them each tick (sim.js) to stay allocation-free.
    this.ctx = new Float32Array(N_CTX);
    this.ctxNext = new Float32Array(N_CTX);
    // ---- inner affect (sensed/used by the brain via sim.js fills) ----
    this.fear = 0;        // 0..1 smoothed danger level (rises near threats, decays) — for render + danger sense
    // cached directional senses (expensive tile scan, refreshed every few ticks)
    this.sFoodDx = 0; this.sFoodDy = 0; this.sFoodDist = 1;
    this.sWaterDx = 0; this.sWaterDy = 0; this.senseAge = 999;
    this.carryType = -1; this.carryAmt = 0; // resource being hauled home (-1 = none)
    this.hydration = 1;                     // thirst need (0..1)
    this.vehicle = 0;                       // 0 none · 1 boat (crosses water) · 2 plane (crosses any)
    this.ordX = 0; this.ordY = 0; this.ordered = false; // player move/attack order (RTS command)
    // MOVE-fix order/hold state: a commanded unit is a persistent, path-following unit.
    // The integrator (sim.js) advances pathCursor/consumes the path; we own the fields + defaults.
    this.path = null; this.pathCursor = 0;   // waypoint list {x,y}[] + index of current target
    this.holdX = null; this.holdY = null;     // hold-position anchor (null = not holding)
    this.orderState = null;                   // null | "move" | "hold"
    // cached expressed traits
    this.size = 1; this.speed = 1; this.metabolism = 1; this.fertility = 1;
    this.aggression = 0.5; this.vision = 4; this.diet = 0; this.resilience = 0.5;
    this.hue = 120;
  }

  spawn(x, y, genome, tribeId, rng, generation = 0) {
    this.alive = true;
    this.id = _nextId++;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.genome = genome;
    this.tribeId = tribeId;
    this.generation = generation;
    this.fitness = 0; this.offspring = 0;
    this.age = 0;
    this.cooldownBreed = 40;
    this.signal = 0;
    this.fear = 0;
    // fresh mind: zero the recurrent memory so a reused pooled body starts blank
    this.ctx.fill(0); this.ctxNext.fill(0);
    this.name = personName(rng);
    this.stamina = 1;       // combat/work fatigue (0..1); rest to recover
    this.hydration = 1;     // thirst need (0..1); drink at water or die
    this.vehicle = 0;       // crafted craft: 0 none, 1 boat, 2 plane
    this.ordered = false; this.ordX = 0; this.ordY = 0; // direct player order
    this.clearOrder(); // recycled pooled agents must not carry a dead unit's path/hold
    this.carryType = -1; this.carryAmt = 0;
    this.expressTraits();
    this.energy = 0.6;
    this.health = 1;
    return this;
  }

  // decode genome genes -> physical/behavioral traits (visible evolution)
  expressTraits() {
    const g = this.genome;
    this.hue = gene(g, 'hue') * 360;
    this.size = 0.6 + gene(g, 'size') * 1.1;        // 0.6 .. 1.7
    this.speed = (0.5 + gene(g, 'speed') * 1.2) / this.size; // big = slower
    this.metabolism = 0.5 + gene(g, 'metabolism') * 1.2;
    this.fertility = 0.3 + gene(g, 'fertility') * 1.4;
    this.aggression = gene(g, 'aggression');
    this.maxAge = 600 + gene(g, 'lifespan') * 2400;  // ticks
    this.vision = 2 + gene(g, 'vision') * 5;          // 2 .. 7 tiles
    this.diet = gene(g, 'diet');                       // 0 herb .. 1 predator
    this.resilience = gene(g, 'resilience');
    // role defaults to civilian; Sim.assignRoles() promotes a fraction to
    // warriors/rangers each year, sized by the nation's militarism (policy) and
    // biased by individual martial/keen propensity — so a society stays mostly
    // civilian and the player's aggression slider controls the army size.
    if (this.role === undefined) this.role = 0;
  }

  get strength() {
    return this.size * (0.5 + this.aggression) * (0.4 + this.health) * (0.3 + this.diet);
  }

  // ---- player order / hold state (MOVE-fix) ------------------------------
  // Make a unit a persistent path-follower. Also lights the legacy `ordered`
  // flag (with ordX/ordY = first waypoint) so the existing integrator path in
  // sim.js drives it even before it's taught to walk the full waypoint list.
  setOrder(path) {
    this.path = (path && path.length) ? path : null;
    this.pathCursor = 0;
    this.orderState = this.path ? 'move' : null;
    this.holdX = null; this.holdY = null;
    if (this.path) {
      const wp = this.path[0];
      this.ordered = true; this.ordX = wp.x; this.ordY = wp.y;
    }
    return this;
  }

  // Park a unit at a spot and have it stay put (guard/garrison).
  setHold(x, y) {
    this.holdX = x; this.holdY = y;
    this.orderState = 'hold';
    this.path = null; this.pathCursor = 0;
    this.ordered = true; this.ordX = x; this.ordY = y; // legacy march-to-spot, then holds
    return this;
  }

  // Drop every order: free-willed again.
  clearOrder() {
    this.path = null; this.pathCursor = 0;
    this.holdX = null; this.holdY = null;
    this.orderState = null;
    this.ordered = false;
    return this;
  }

  kill() {
    this.alive = false;
    this.genome = null;
    this.fear = 0;
    if (this.ctx) this.ctx.fill(0);          // wipe the mind so the pool can't
    if (this.ctxNext) this.ctxNext.fill(0);  // resurrect a dead creature's intent
    this.clearOrder(); // dead/recycled agents must not leak a path or hold anchor
  }
}

// simple object pool
export class AgentPool {
  constructor(cap) {
    this.cap = cap;
    this.agents = new Array(cap);
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) {
      this.agents[i] = new Agent();
      this.free.push(this.agents[i]);
    }
    this.count = 0;
  }

  alloc() {
    const a = this.free.pop();
    if (a) this.count++;
    return a; // undefined if at cap
  }

  release(a) {
    a.kill();
    this.free.push(a);
    this.count--;
  }
}
