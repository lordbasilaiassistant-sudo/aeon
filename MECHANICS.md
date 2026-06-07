# AEON — Core Mechanics Spec (mechanics-first; NNs wired in after)

drlor's directive (2026-06-07): *"we need core game mechanics first and add to the
neural networks properly."* So we build a deep mechanical world as the SUBSTRATE,
then expand the brains' I/O to operate within it. The NN's job is to be smart about
a rich world — it cannot be rich if the world is thin.

Order of truth: **World → Needs → Resources → Refinement → Settlements/Territory/Nations
→ Tech (gates all) → THEN expand NN senses/actions to interface every system.**

---

## 1. NEEDS (per-agent survival drives) — what people need
Each creature carries needs that decay and must be met, or it suffers/dies. Needs are
the root selection pressure AND the first thing the NN must learn to manage.
| Need | Source to satisfy | Failure | Notes |
|---|---|---|---|
| **Hunger** (energy) | eat food / stored food | starve → health drain → death | exists |
| **Thirst** (hydration) ← NEW | drink at water tile / well / stored water | dehydrate → death (faster when hot) | adds a 2nd survival axis; water-sensing already exists |
| **Warmth** | warm biome / clothing tech / fire / shelter | cold → health drain | partial (temp stress exists); tech (clothing/fire) mitigates |
| **Health** | recover when fed+watered+safe | 0 → death | exists; Medicine tech boosts regen |
| **Safety** | avoid foes / be in territory / walls | attacked → damage | drives flee + settlement-seeking |
Two real needs (hunger+thirst) already force interesting behavior: agents must shuttle
between food and water — emergent pathing the NN learns.

## 2. RESOURCES — what's on the map, and discovering it
Resources live on tiles/deposits. Two classes:
- **Surface (always extractable):** Water (drink), Wild Food (forage), Wood (forests),
  Stone (hills/mountains). Basic survival + first buildings.
- **Buried / strategic (must DISCOVER + earn the tech to extract):** Copper, Tin, Iron,
  Coal, Gold, Oil. Seeded into deposits by biome (ores in mountains/hills; oil in marsh/
  desert/seabed). HIDDEN until a nation can find them.
**Discovery rule:** a deposit becomes known to a nation when (a) the nation has the
prerequisite tech/era to recognize it (e.g. can't perceive "iron ore" before Bronze-era
prospecting) AND (b) a citizen or settlement is near it. → discovery feels earned.
**Extraction rule:** gated by tool tech — Stone Tools → wood/stone; Bronzeworking →
copper/tin; Iron Tools → iron/coal; Industrial/Combustion → oil. So a deposit can be
*known but unminable* until you advance. This is the Civ "strategic resource" gate.

## 3. REFINEMENT — learning to turn raw into useful (the chains)
Raw resources are useless until refined, at a settlement, with the right building, by
labor. **A capability activates only when TECH + RESOURCE + BUILDING + LABOR all exist** —
that is literally "building up to it."
```
Wood            --(any)----------------> Lumber  -> houses, walls, ships(+Sailing)
Stone           --(Masonry)------------> Blocks  -> walls, temples, wonders
Copper + Tin    --(Bronzeworking+smithy)-> Bronze -> better tools/weapons (combat↑, mining↑)
Iron ore + Coal --(IronWorking+furnace)--> Iron/Steel -> strong tools/weapons, rails
Oil             --(Plastics+factory)----> Plastic -> cheap goods (storage↑, foodYield↑)
Knowledge       --(Writing/Printing/Science)-> Research -> faster tree (researchMul↑)
```
Refined goods accumulate in the **nation stockpile**; their presence is what flips the
matching `tribe.caps` on (e.g. Bronze in stock → combat/mining multiplier). No resource,
no bonus — even if the tech is researched. Tech = the recipe; resource+refinery = the dish.

## 4. SETTLEMENTS · TERRITORY · BORDERS · NATIONS
- **Settlements** (Camp→Village→Town→City, building now): the place where refinement,
  storage, and population growth happen. Buildings unlock per tech era (granary, well,
  smithy, furnace, market, factory, walls, temple…). Each building enables a chain step.
- **Territory / borders ← NEW (you asked for country borders):** each settlement claims
  a radius of tiles; a nation's territory = union of its claims, drawn as a colored
  **border outline** (Civ-style). Territory = the deposits/tiles you may exploit. Overlap
  = friction → contested borders → war.
- **Nation = Tribe + territory + settlements + stockpile + tech + policy (+ emergent leader).**
  The leader/agenda is not scripted — it's the nation's policy + dominant evolved traits.

## 4b. VEHICLES & CREWS — capabilities are CRAFTED & OPERATED, not innate (drlor 2026-06-07)
Creatures do NOT walk on water or fly by themselves. Water/air travel = a CRAFTED VEHICLE
operated by an individual (a soldier or civilian crew). This is closer to Civ units / WorldBox.
- **Tech unlocks the RECIPE** (Sailing → can build Boat; Shipbuilding → Ship; later Submarine;
  Flight → propeller plane; Jet Engine → fighter jet / airliner).
- **A vehicle is a UNIT/ITEM** that must be BUILT at a settlement (resources + refinement +
  labor) and **CREWED by an agent** who then can traverse water (boat/sub) or sky (plane/jet).
  Bigger craft (airliner, warship) need trained/assigned crew; small civ craft (canoe) are simple.
- So crossing an ocean = an agent boards a boat the nation built; flight = an agent pilots a
  plane. No vehicle, no crossing — even with the tech. `tribe.caps.seafaring/flight` therefore
  means "this nation CAN build such craft," NOT "its people walk on water."
- START STATE: basic humans, fire, a few people; grow into horses/husbandry → crafting →
  metals → boats → … → flight. The tech eras are that primitive→advanced spine.
- INTEGRATION NOTE: until the Vehicles system exists, water/air stay impassable (no walk-on-water
  shipped). Vehicles is its own task (see task board). [Water-impassability bug fixed 2026-06-07:
  collision now floors coords so oceans are actually solid.]

### Travel domains (each tech+resource+vehicle gated; discovery takes TIME) — drlor 2026-06-07
| Domain | Gating (tech → resource → crafted vehicle + crew) | Notes |
|---|---|---|
| **LAND** | innate (default); horses/wheel → faster; rails (Steam+iron) → fast freight | the only free domain |
| **WATER** | Sailing→raft/boat · Shipbuilding→ship · (Iron)→ironclad · Combustion→sub | cross seas, fish, naval war |
| **AIR** | Flight→propeller plane · Jet Engine→jet/airliner | scout, fast travel, bombing; needs trained pilots |
| **SPACE** | Rocketry→rockets · Spaceflight→spacecraft (late-game) | orbit/escape; the far endgame after rockets |
Progression is deliberately SLOW: a people must DISCOVER enough resources to unlock enough of the
tech tree to reach each domain — coastal peoples drift toward Water early, resource-rich/large ones
toward Air and eventually Space. No shortcuts; the world earns its capabilities over many generations.

## 4c. ENTITIES & THE ECONOMY LOOP (drlor 2026-06-07)
The world is made of clickable ENTITIES; an economy of gather → haul → stockpile → use connects them.

### Entity taxonomy (different types of people, animals, resources)
- **People** (tribe members, NN-brained) come in evolving ROLES/JOBS — emergent or assigned:
  gatherer/forager, hunter, **worker/builder**, **soldier**, breeder/elder, (later) crafter, trader,
  leader. Role biases an agent's behavior + which actions pay off; the player (nation mode) can shift
  the role mix via policy, AI nations via aiTurn. Species/subspecies variety comes from the genome
  (humans first; elves/dwarves/orcs later via trait clusters).
- **Animals / wildlife (NEW)** — fauna as their own entities, not tribes: prey (deer/rabbits → food
  for hunters), predators (wolves → threat), and tameable LIVESTOCK (unlocked by Animal Husbandry →
  herds that give steady food). Animals have simple brains/utility-AI (cheaper than full civic NN).
- **Resources** — surface (water/wood/stone/wild food) + buried strategic (copper/tin/iron/coal/oil)
  as map NODES that **spawn and DEPLETE properly** (a mined node draws down and can exhaust; forests
  regrow, ore does not; food regrows on fertile land). Depletion forces migration/expansion/war —
  real pressure.

### The economy loop (gather → haul → stockpile → use)
1. A **gatherer/worker** harvests a resource node near home (gated by tech: stone tools → wood/stone;
   bronze → copper; etc.). The node depletes.
2. The agent **HAULS** the resource back to its **settlement / community stockpile** (the nation's
   shared store). This is a real NN action (carry → return → deposit).
3. The settlement **refines** raw → useful (per §3) and the stockpile **activates caps** (per §3).
4. Stockpiles feed building, breeding, military, vehicles. Scarcity → expand or take a neighbor's.

### Universal clickability (NEW — the player's read/control surface)
**Every entity on the map is clickable** → opens a context-aware panel:
- **Any creature** → identity, role, traits, live brain, lineage, vitals; + "Possess".
- **Your nation's units/settlements** → CONTROL options (set role focus, rally here, build, prioritize).
- **Another nation / its units/settlements** → OBSERVE + DIPLOMACY options (stance, declare war,
  make peace, ally, trade) — the context depends on whether it's yours.
- **A settlement** → tier, population, buildings, stockpile, production; control if yours.
- **An animal** → species, herd, threat/food value.
- **A resource node** → type, remaining amount, who controls it, extraction status.
This is the Frontend "click anything, get the right options" requirement; it sits on the GovernanceAPI
so the options shown match what a human (own nation) vs observer (foreign) can actually do.

## 5. TECH (gates everything) — building now (Tech workstream)
Tech unlocks: needs-mitigation (fire/clothing/medicine), resource discovery+extraction,
refinement recipes, buildings, and the movement/combat caps (horses, metals, sailing=water
travel, flight=air travel, plastics, computing). Research accrues from population + culture
+ settlements. Already specified in ARCHITECTURE.md WORKSTREAM A; resources now GATE the
payoff of each tech (integrator wires resource-gating into cap activation).

## 6. NN I/O EXPANSION — adding to the neural nets PROPERLY (after 1–5 exist)
Only once the mechanics are real do we widen the brain so evolution + the player have
civ-relevant things to optimize. Touches brain.js + sim.js (integrator does this, carefully,
because it's the hot path):
- **New SENSES:** thirst, nearest water (have), hunger (have), nearest food (have),
  nearest KNOWN deposit + type, carrying-resource?, on-own-territory?, nearest settlement
  dir/dist, tribe era/tech level, warmth/season, danger level, meme/belief carried.
- **New ACTIONS:** drink, gather (vs eat), haul/deposit-to-settlement, build/contribute,
  claim-territory, flee, follow-leader, adopt-meme/convert. (Plus existing move/eat/attack/
  reproduce/share/speak.)
- Net effect: brains evolve from "eat & breed" toward "find water, mine ore, haul it home,
  build, defend the border" — because those behaviors now pay off in the mechanical world.

## 7. Build order (revised per mechanics-first)
1. **(running)** Tech · Settlements · Culture · Visuals — integrate one at a time, test each.
2. **Needs:** add thirst (+warmth/fire) → richer survival. (sim + brain senses already 80% there.)
3. **Resources + discovery + extraction** (new module `sim/resources.js`).
4. **Refinement + stockpiles** (extend settlements/nations).
5. **Territory + borders** (new claim system + border renderer).
6. **NN I/O expansion** (§6) — wire brains into all the above.
7. **Nation-mode UX + tool info** (so the player can actually use it — your other ask).
8. Disasters, diplomacy, victory/destinies, polish, perf scale.

Each step ships behind `node test/headless.mjs` (life persists + evolves) + a browser smoke
test. We grow depth without breaking the working core.
