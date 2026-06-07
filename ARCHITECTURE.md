# AEON — Architecture & Integration Contract

## DEPARTMENT MODEL (drlor 2026-06-07: "we need all diff levels of work")
Work is organized into DEPARTMENTS — each a parallel workflow owning a whole vertical.
They never edit each other's files. They integrate ONLY through the contracts below,
which the Integrator (Eli) owns and guards. Shared files (sim.js, game.js) = Integrator.

```
                          ┌─────────────────── INTEGRATOR (Eli) ───────────────────┐
                          │  owns sim.js + game.js; defines & guards all contracts  │
                          └───────────────────────────┬─────────────────────────────┘
        ┌──────────────────────────┬──────────────────┼───────────────────┬──────────────────────────┐
 DEPT 1 COGNITION           DEPT 2 FRONTEND      DEPT 3 STATECRAFT     DEPT 4 CORE MECHANICS
 (neural networks)          (graphics/UI/anim)   (politics/diplo/lore) (world sim substrate)
 owns: sim/brain.js,        owns: render/*,       owns: sim/politics.js, owns: sim/world.js,
   sim/cognition.js           css/*, ui visuals     sim/diplomacy.js,      sim/resources.js,
                                                    game/governance.js,    sim/needs.js,
                                                    data/lore.js           sim/territory.js,
                                                                           sim/settlement.js,
                                                                           sim/tech.js, culture.js
```

### Inter-department contracts (the ONLY coupling allowed)
1. **Perception** (Mechanics → Cognition): each tick the sim fills a flat `Float32Array`
   of senses per agent (defined in brain.js `SENSE[]`). Mechanics writes it; Cognition reads it.
2. **Action** (Cognition → Mechanics): the brain emits a flat `Float32Array` of action drives
   (brain.js `ACT[]`). Cognition writes it; Mechanics interprets/executes it.
3. **WorldView** (Mechanics → Frontend): Frontend only READS sim state (world tiles, pooled
   agents, settlements, territory, nations, fx). Frontend never mutates sim.
4. **GovernanceAPI** (Statecraft ↔ everyone) — THE SYMMETRIC HUMAN/AI INTERFACE:
   a nation is run by a fixed set of decisions/levers, identical for human and AI:
   `setPolicy(nation, k, v)`, `prioritizeTech(nation, techId)`, `foundSettlement(...)`,
   `declareWar/makePeace/proposeAlliance(a, b)`, `setStance(a, b, stance)`, `trade(a, b, ...)`,
   `rally/migrate(nation, x, y)`, `decree(nation, edict)`. The HUMAN calls these via UI;
   an AI nation calls the SAME functions via its `aiTurn(nation)` brain/heuristic. One system,
   two drivers. This is what makes "human and AI run their countries almost the same" true.
5. **Events/Lore** (Statecraft → Frontend): named events, dialogue, lore strings surfaced
   to the UI via `sim.emit(...)` and a lore lookup; Frontend renders them.

### Sequencing rule (so parallel departments don't build on sand)
Integrate the in-flight foundation build FIRST (Tech/Settlements/Culture/Visuals) to stabilize
the base + the contracts; THEN launch the department workflows against stable interfaces. Each
department writes NEW files; the Integrator wires them via the contracts and tests after each.

---

The hierarchy that lets us build moving parts in PARALLEL and snap them together.
**Rule: each workstream owns DISJOINT files. Shared files (sim.js, renderer.js,
tribe.js, game.js, ui.js) are edited only by the INTEGRATOR (Eli), using the
integration notes each module returns.** This is how parallel construction avoids
clobbering.

```
Game (orchestrator)                         game/game.js        [integrator]
├─ Sim  (authoritative world state)         sim/sim.js          [integrator wires modules]
│   ├─ World    terrain/biome/climate/food  sim/world.js        [exists]
│   ├─ Agent    NN brain + survival         sim/agent.js,brain  [exists]
│   ├─ Tribe    nation + policy + tech/caps sim/tribe.js        [integrator adds fields]
│   ├─ Tech     progression / eras          sim/tech.js         [WORKSTREAM A] ← NEW
│   ├─ Settle   camps→villages→cities       sim/settlement.js   [WORKSTREAM B] ← NEW
│   └─ Culture  language/religion/memes     sim/culture.js      [WORKSTREAM C] ← NEW
├─ Render (view)                            render/renderer.js  [integrator calls visuals]
│   ├─ Visuals  terrain/agents/settle/post  render/visuals.js   [WORKSTREAM D] ← NEW
│   └─ FX       particles/juice             render/fx.js        [exists]
├─ Modes  god / nation / avatar             game/game.js        [exists]
└─ UI     HUD / inspector / tech panel      game/ui.js          [integrator]
```

## Shared state contract (fields the integrator guarantees on Tribe / Sim)
Each Tribe will carry (integrator adds these in tribe.js):
```js
tribe.tech = { points: 0, known: new Set(), era: 0 };   // research progress
tribe.caps = {            // DERIVED from known techs by Tech workstream; read by sim
  foodYield: 1,           // x multiplier on eating
  moveMul: 1,             // x movement (horses, wheel, flight)
  combat: 1,              // x strength (metals)
  researchMul: 1,         // x research accrual (writing, science)
  seafaring: false,       // can cross WATER tiles
  flight: false,          // can cross ANY tile, fast
  healthRegen: 1,         // medicine
  storage: 1,             // energy cap (pottery/granary)
};
sim.settlements = [];     // Settlement instances
sim.tech;                 // TechSystem instance
sim.culture;              // Culture instance
```

## WORKSTREAM A — Tech (`sim/tech.js`)  [the user's headline ask]
A real, gated progression tree with eras. Capabilities UNLOCK abilities, so a
civ must "build up to" water travel, flight, etc.
- Export `TECHS` (ordered defs: `{id,name,era,prereqs:[],cost,desc,effect}`) covering
  the arc the user named: Stone→Bronze→Iron→Classical→Medieval→Renaissance→Industrial
  →Modern→Information. Must include: Fire, StoneTools, Agriculture, AnimalHusbandry
  (horses), Pottery, Bronzeworking, IronWorking (metals), Writing, Sailing (WATER
  TRAVEL), Wheel, Currency, Mathematics, Masonry, Engineering, Medicine, Gunpowder,
  Printing, ScientificMethod (SCIENCE), Steam, Electricity, Industrialization,
  Combustion, Flight (AIR TRAVEL), Plastics, Computing.
- Export `class TechSystem`:
  - `accrue(tribe, dt)` — add research points from population + culture + settlements
    (× tribe.caps.researchMul); when a prereq-satisfied tech is affordable, unlock it
    (weighted pick among available), push id to `tribe.tech.known`, bump era, return
    array of newly unlocked tech defs (for event toasts).
  - `recompute(tribe)` — rebuild `tribe.caps` from `tribe.tech.known` (sum/most-of effects).
  - `eraName(n)` → string. `available(tribe)` → next researchable techs (for UI).
- Effects map to caps (foodYield, moveMul, combat, researchMul, seafaring, flight,
  healthRegen, storage). Pure data + functions; NO imports from sim internals.
- INTEGRATION NOTES to return: exactly where sim.step() should call `accrue`, and how
  movement/combat/eat should read `tribe.caps` (incl. seafaring water-crossing + flight).

## WORKSTREAM B — Settlements (`sim/settlement.js`)
Visible civilization: where a tribe's people cluster densely, a Camp appears; with
population + tech it grows Camp→Village→Town→City, gaining buildings.
- Export `class Settlement { id,tribeId,x,y,tier,pop,buildings:[] }` and
  `class SettlementSystem` with `update(sim, dt)` that: detects dense tribe clusters
  (reuse sim spatial grid), founds/dissolves settlements, grows tiers by pop+tech era,
  assigns building list per tier/era (huts→houses→walls→temple→market→workshop→tower…).
- Pure logic; reads sim.tribes + sim.pool via passed `sim`. Returns integration notes
  (where to call `update` in sim.step, and a `getSettlements()` for the renderer).

## WORKSTREAM C — Culture (`sim/culture.js`)
Layer-2 emergence, light first pass: per-tribe language (name-generator seed that
drifts), a religion that can arise/spread, and a MEME channel hook on the existing
`speak` act (a survival meme that spreads along contact and biases adoption). Export
`class Culture` with `tick(sim, dt)` + `language(tribe)` + integration notes. Keep it
cheap (no per-tick heavy loops); piggyback on tribe aggregates.

## WORKSTREAM D — Visuals (`render/visuals.js`)  [fix "graphics are crap"]
Pure rendering helpers the integrator calls from renderer.js. MUST fix the issues seen
in the v0.1 screenshot: muddy/washed terrain, food-speck noise, flat glow-dot agents,
hazy low-contrast post. Deliver:
- `bakeTerrain(world, ctx)` — crisp stylized terrain with COASTLINE outlines, depth-
  shaded water, biome dithering/texture, hillshade. (Replaces renderer.bakeTerrain.)
- `drawAgents(ctx, cam, sim)` — readable agents: soft drop shadow, body shaded by
  tribe hue + energy, facing, subtle size from trait; NO noisy per-agent glow spam.
- `drawSettlements(ctx, cam, sim)` — buildings by tier (stylized rooftops/blocks),
  scales with zoom; names at low zoom.
- `applyPost(ctx, cam, {timeOfDay})` — tasteful: gentle day/night, soft bloom on bright
  pixels, light vignette, color grade. Must NOT wash the map out (the v0.1 mistake).
- Replace food rendering: subtle, only near zoom-in, not a checkerboard of green squares.
Return integration notes (which renderer.js methods to swap to these).

## Integration order (integrator, after parallel build)
1. Add Tribe/Sim contract fields (tribe.js, sim.js). 2. Wire Tech (accrue + caps reads).
3. Wire Settlements. 4. Wire Visuals into renderer. 5. Wire Culture. 6. UI: tech/era
panel. After EACH: `node test/headless.mjs` + browser smoke test. Commit per integrated
module so we can bisect. Never integrate two unverified modules at once.
