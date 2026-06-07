// Headless sim validation: does the world LIVE and EVOLVE without a browser?
// Run: node test/headless.mjs
import { Sim } from '../src/sim/sim.js';
import { gene } from '../src/sim/brain.js';

const sim = new Sim({ w: 240, h: 150, seed: 42, cap: 3200 });
console.log(`World ${sim.world.w}x${sim.world.h}, seeded pop=${sim.population()}, tribes=${sim.tribes.size}`);

const SNAP = 600;            // ticks between snapshots
const TOTAL = 6000;          // ~100 sim-years
const t0 = Date.now();
let peakPop = 0;
const popHistory = [];

for (let t = 1; t <= TOTAL; t++) {
  sim.step();
  peakPop = Math.max(peakPop, sim.population());
  if (t % SNAP === 0) {
    const pop = sim.population();
    popHistory.push(pop);
    // measure average trait of population to see evolution in action
    let n = 0, avgSize = 0, avgVis = 0, avgDiet = 0, avgAgg = 0;
    for (const a of sim.pool.agents) {
      if (!a.alive) continue;
      n++; avgSize += gene(a.genome, 'size'); avgVis += gene(a.genome, 'vision');
      avgDiet += gene(a.genome, 'diet'); avgAgg += gene(a.genome, 'aggression');
    }
    if (n) { avgSize /= n; avgVis /= n; avgDiet /= n; avgAgg /= n; }
    // most-advanced tribe (era + tech count) and settlement count
    let topEra = 0, topTechs = 0, topName = '—';
    for (const tr of sim.tribes.values()) {
      if (tr.tech && tr.tech.era >= topEra) {
        if (tr.tech.era > topEra || tr.tech.known.size > topTechs) {
          topEra = tr.tech.era; topTechs = tr.tech.known.size; topName = tr.name;
        }
      }
    }
    console.log(
      `yr ${String(sim.year()).padStart(3)} | pop ${String(pop).padStart(4)} | ` +
      `tribes ${String(sim.activeTribes()).padStart(2)} | gen ${String(sim.maxGen).padStart(3)} | ` +
      `era ${topEra}/${topTechs}tech | settle ${String(sim.settlements.length).padStart(2)} | ` +
      `traits sz=${avgSize.toFixed(2)} vis=${avgVis.toFixed(2)} diet=${avgDiet.toFixed(2)}`
    );
  }
}

const ms = Date.now() - t0;
const perStep = ms / TOTAL;
console.log('\n--- VERDICT ---');
console.log(`ran ${TOTAL} ticks in ${ms}ms  (${perStep.toFixed(2)} ms/tick, ~${(1000 / perStep).toFixed(0)} ticks/sec headless)`);
console.log(`final pop ${sim.population()}, peak pop ${peakPop}, max generation ${sim.maxGen}`);
console.log(`births ${sim.births}, deaths ${sim.deaths}`);

// PASS criteria: population survived, reproduction happened across many generations
const survived = sim.population() > 5;
const evolved = sim.maxGen >= 5;
const stable = popHistory.slice(-3).every((p) => p > 5);
console.log(`\nLIFE PERSISTS: ${survived ? 'PASS' : 'FAIL'}`);
console.log(`EVOLUTION (gens>=5): ${evolved ? 'PASS' : 'FAIL'}  (reached gen ${sim.maxGen})`);
console.log(`POPULATION STABLE late-game: ${stable ? 'PASS' : 'FAIL'}`);
console.log(survived && evolved && stable ? '\n✅ ALL PASS — the world lives and evolves.' : '\n❌ needs tuning.');
