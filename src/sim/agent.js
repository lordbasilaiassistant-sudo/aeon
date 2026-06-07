// A single creature. Pooled (reused on death) to avoid GC churn at scale.
import { gene, randomGenome } from './brain.js';
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
    // cached directional senses (expensive tile scan, refreshed every few ticks)
    this.sFoodDx = 0; this.sFoodDy = 0; this.sFoodDist = 1;
    this.sWaterDx = 0; this.sWaterDy = 0; this.senseAge = 999;
    this.carryType = -1; this.carryAmt = 0; // resource being hauled home (-1 = none)
    this.hydration = 1;                     // thirst need (0..1)
    this.vehicle = 0;                       // 0 none · 1 boat (crosses water) · 2 plane (crosses any)
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
    this.name = personName(rng);
    this.stamina = 1;       // combat/work fatigue (0..1); rest to recover
    this.hydration = 1;     // thirst need (0..1); drink at water or die
    this.vehicle = 0;       // crafted craft: 0 none, 1 boat, 2 plane
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

  kill() {
    this.alive = false;
    this.genome = null;
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
