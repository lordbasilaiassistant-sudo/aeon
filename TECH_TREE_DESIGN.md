# AEON — Research Tree System (Design Doc)

**Owner:** Eli (Integrator) · **Dept:** 4 Core Mechanics (`sim/tech.js`, `sim/culture.js`) ↔ 3 Statecraft (`game/governance.js`)
**Grounded in:** `ARCHITECTURE.md` (WORKSTREAM A + GovernanceAPI), `GAME_RULES.md` (two scales, policy levers, war), and the **already-built** `src/sim/tech.js`, `src/sim/tribe.js`, `src/sim/culture.js`, `src/sim/brain.js`.

> **The lens (from CLAUDE.md):** progress is *emergent* — no player clicks a node. Population, culture, settlements, and **what the agents actually DO** drive research. The trees are the legible Layer‑2 memetic skin over the real evolved brains; they NEVER touch a genome. They only raise tribe‑wide **caps** (multipliers + ability flags) and set **policy ranges**, which the sim reads in its hot paths and injects back into agents as *will* senses. That round‑trip — actions → cheaper nodes → new caps → bent behavior — is the whole engine.

---

## 0. Why two trees (Civ VI, adapted)

Civ VI runs **two parallel trees on one shared era timeline**:

| Civ VI | Resource | Unlocks | AEON analogue |
|---|---|---|---|
| **Tech / Science tree** | Science (🔬) | units, buildings, *abilities* (Sailing, Flight, Iron Working…) | **TECH tree** → `tribe.caps` ability flags & multipliers (water/air travel, metals, etc.) |
| **Civics / Culture tree** | Culture (🎭) | **governments**, **policy cards**, diplomacy, wonders | **CIVICS tree** → unlocks **governments + policy cards = AEON politics** |
| **Eurekas / Inspirations** | "advance by doing" | ~40–50% discount on the matching node | **AEON eurekas** → action‑driven discount, the emergence hook |
| **Era Score → Golden/Dark Age** | historic moments | era‑wide bonus/penalty + recovery | **AEON age loop** → `caps.ageMul` + heroic recovery |

AEON keeps the **9‑era spine already in `tech.js`**: `Stone → Bronze → Iron → Classical → Medieval → Renaissance → Industrial → Modern → Information`. Both trees climb the SAME eras; a tribe's `era` is `max(highest tech era, highest civic era)`.

The TECH tree already exists and is good (`TECHS`). This doc (a) **specifies the CIVICS tree to mirror it**, (b) defines **emergent accrual + eurekas** for both, (c) maps **governments + policy cards onto the symmetric GovernanceAPI**, (d) adds the **golden/dark age loop**, and (e) gives **exact `tech.js` revision steps**.

---

## 1. The two trees — full node lists

### 1A. TECH / SCIENCE tree (already in `tech.js` — KEEP, plus one gap fill)

Unchanged nodes (id → era, prereqs, key cap effect — capabilities that gate **real agent abilities**):

| id | era | prereqs | unlocks (capability) |
|---|---|---|---|
| `Fire` | Stone | — | foodYield, healthRegen |
| `StoneTools` | Stone | — | combat, foodYield |
| `Agriculture` | Stone | Fire, StoneTools | **foodYield 1.5** (farming) |
| `AnimalHusbandry` | Stone | Agriculture | **moveMul (horses)**, foodYield |
| `Pottery` | Stone | Agriculture | **storage** |
| `Wheel` | Bronze | AnimalHusbandry | moveMul |
| `Writing` | Bronze | Pottery | researchMul |
| `Bronzeworking` | Bronze | Pottery, StoneTools | **combat (first metals)** |
| `Sailing` | Bronze | Pottery, Writing | **`seafaring=true` → WATER TRAVEL** |
| `Mathematics` | Iron | Writing | researchMul |
| `Currency` | Iron | Writing, Bronzeworking | researchMul, foodYield |
| `IronWorking` | Iron | Bronzeworking | **combat (iron metals)** |
| `Masonry` | Iron | Bronzeworking | storage, combat (walls) |
| `Engineering` | Classical | Mathematics, Masonry, Wheel | moveMul, storage, combat |
| `Medicine` | Classical | Mathematics | **healthRegen** |
| `Compass` | Medieval | Sailing, Mathematics | seafaring, moveMul (open sea) |
| `Gunpowder` | Medieval | IronWorking, Engineering | combat |
| `Printing` | Renaissance | Writing, Engineering | researchMul |
| `ScientificMethod` | Renaissance | Printing, Mathematics | **researchMul 2.0 (SCIENCE)** |
| `Steam` | Industrial | ScientificMethod, IronWorking | moveMul, foodYield, combat |
| `Electricity` | Industrial | ScientificMethod | researchMul, healthRegen |
| `Industrialization` | Industrial | Steam | foodYield, storage, combat |
| `Combustion` | Modern | Industrialization, Electricity | moveMul |
| `Plastics` | Modern | Industrialization, Electricity | **storage, foodYield** |
| `Flight` | Modern | Combustion | **`flight=true` → AIR TRAVEL (cross any tile)** |
| `Computing` | Information | Plastics, Electricity, ScientificMethod | researchMul, storage |

**One gap fill (add to `TECHS`)** so the Information era isn't a single node and the late game has reach:

```js
{ id: 'Electronics', name: 'Electronics', era: 7, prereqs: ['Electricity', 'Plastics'], cost: 510,
  desc: 'Transistors and radio — the nervous system of the modern age.',
  effect: { researchMul: 1.25, healthRegen: 1.1 } },
{ id: 'Rocketry', name: 'Rocketry', era: 8, prereqs: ['Computing', 'Combustion'], cost: 720,
  desc: 'Escape the ground entirely — orbit and beyond.',
  effect: { flight: true, moveMul: 1.8 } },
{ id: 'Robotics', name: 'Robotics', era: 8, prereqs: ['Computing', 'Electronics'], cost: 780,
  desc: 'Machines that labor without rest.',
  effect: { foodYield: 1.5, storage: 1.4, combat: 1.2 } },
```

### 1B. CIVICS / CULTURE tree (NEW — `CIVICS` array, mirrors `TECHS` shape)

Same def shape as a tech, plus an `unlocks` field naming the governments and/or policy cards it grants. Civics accrue from a **separate culture pool** (`tribe.civ.points`). Effects fold into the SAME `caps` (so governments/policies are just more cap contributors) and may carry `lever` hints used by Statecraft.

| id | era | prereqs | unlocks (govt / cards) | effect |
|---|---|---|---|---|
| `CodeOfConduct` | Stone | — | govt `Chiefdom` (default), card `KinBonds` | loyalty 1.1 |
| `OralTradition` | Stone | — | card `Storytellers` | cultureMul 1.3 |
| `Craftsmanship` | Stone | CodeOfConduct | card `Toolmakers` | foodYield 1.05, combat 1.05 |
| `TribalAssembly` | Bronze | CodeOfConduct | card `Settlers`, +settleBonus | cultureMul 1.1, storage 1.1 |
| `WarBands` | Bronze | Craftsmanship | card `Raiders` | combat 1.1 |
| `Rites` | Bronze | OralTradition | card `Shamans`, +religion fervor | healthRegen 1.1, cultureMul 1.1 |
| **`Statecraft`** | **Iron** | TribalAssembly, WarBands | **govts `Autocracy`, `Council`** (the "Political Philosophy" pivot) | loyalty 1.15 |
| `WrittenLaw` | Iron | Statecraft | card `Magistrates` | researchMul 1.1, loyalty 1.1 |
| `Militarism` | Iron | WarBands | card `Conscription` | combat 1.15 |
| `Theology` | Classical | Rites, Statecraft | **govt `Theocracy`**, card `Crusade` | cultureMul 1.2, healthRegen 1.1 |
| `CivilService` | Classical | WrittenLaw | card `Bureaucracy`, +1 slot | researchMul 1.15, foodYield 1.1 |
| `Vassalage` | Classical | Militarism | card `Levy` | combat 1.1, loyalty 1.1 |
| `Guilds` | Medieval | CivilService | card `Artisans`, card `Caravans` | storage 1.2, foodYield 1.1 |
| `Chivalry` | Medieval | Vassalage | card `Knights` | combat 1.2, moveMul 1.05 |
| `DivineRight` | Medieval | Theology | **govt `Monarchy`** | loyalty 1.2, cultureMul 1.1 |
| `Republicanism` | Renaissance | Guilds | **govt `Republic`**, card `Charters` | researchMul 1.15, cultureMul 1.1 |
| `Mercantilism` | Renaissance | Guilds | card `TradeFleets` | foodYield 1.15, storage 1.15 |
| `Reformation` | Renaissance | DivineRight | card `Reform` | cultureMul 1.2 |
| `Nationalism` | Industrial | Republicanism | card `Mobilization` | combat 1.15, loyalty 1.1 |
| `Capitalism` | Industrial | Mercantilism | card `FreeMarket` | foodYield 1.2, storage 1.2 |
| `Suffrage` | Industrial | Nationalism | **govt `Democracy`**, card `Franchise` | researchMul 1.15, cultureMul 1.15 |
| **`Ideology`** | **Modern** | Nationalism, Capitalism | **govts `Communism`, `Fascism`** (+ Democracy via Suffrage) | loyalty 1.1 |
| `MassMedia` | Modern | Ideology | card `Propaganda` | cultureMul 1.25 |
| `Urbanization` | Modern | Capitalism | card `Metropolis`, +settleBonus | foodYield 1.15, storage 1.2 |
| `DigitalNetworks` | Information | MassMedia | card `Networks` | researchMul 1.2, cultureMul 1.2 |
| `Globalization` | Information | Urbanization, Ideology | card `Diplomats`, +wildcard slot | researchMul 1.15, cultureMul 1.15 |

**Reading the two pivots (Civ‑VI faithful):**
- `Statecraft` (Iron) = AEON's **Political Philosophy** — the first node that unlocks *choosable* governments.
- `Ideology` (Modern) = the late fork that unlocks the **three modern ideologies** (Democracy/Communism/Fascism).

---

## 2. Emergent accrual — no player ever clicks a node

Research is **income per sim‑year**, not a click. `accrue` already runs once per tribe per sim‑year (cold path). We run **two accruals** — science into `tribe.tech.points`, culture into `tribe.civ.points` — then unlock everything affordable whose prereqs are met (weighted pick, low‑era/cheap first — the existing `_pick`).

### 2.1 Science income (keep existing, add age multiplier)

```
gain_sci = ( pop * 0.06
           + log2(1 + culture) * 0.4
           + settleBonus )
         * caps.researchMul
         * caps.ageMul          // NEW: golden/dark age (§4)
         * dt
```

### 2.2 Culture income (NEW — culture‑weighted, fervor‑fed)

Civics are driven by people TALKING and BELIEVING, not laboring — so culture and religion weigh heavier than raw pop:

```
gain_civ = ( pop * 0.03
           + log2(1 + culture) * 0.6        // 'speak' acts dominate
           + settleBonus * 0.5
           + religionFervor * 4 )            // a fervent faith fuels civics
         * caps.cultureMul
         * caps.ageMul
         * dt
```

where `religionFervor = tribe.religion ? tribe.religion.fervor : 0` (already on the tribe from `culture.js`), `culture = tribe.culture` (accumulates from agents' `speak` act), `pop = tribe.members`, `settleBonus = tribe.tech.settleBonus` (set by the Settlement system).

**This is the coupling loop from `GAME_RULES.md` made literal:** millions of local agent decisions (`speak`, work, mate) aggregate into `members`/`culture`/`settleBonus`, which fund both trees, which raise caps + set policy ranges, which inject back as `will_*` senses. Bottom‑up emergence, top‑down steering, no scripting.

### 2.3 Eurekas / Inspirations — "advance by doing" (THE emergence hook)

Each node may carry an optional `eureka: { action, count }`. The sim already knows what agents do (the `ACT[]` vocabulary: `move/eat/attack/reproduce/share/speak`) and what the world does (births, settlements founded, resources mined, wars won). **Mechanics calls `tech.noteAction(tribe, key, n)` when those happen.** When a tribe's running counter for a node crosses `count`, the node becomes **boosted** for that tribe → its effective cost drops by `BOOST`.

```
effectiveCost(def, tribe) =
    def.cost * (tribe boosted(def.id) ? (1 - BOOST) : 1)

BOOST = 0.5      // 50% discount, Civ-VI-faithful
```

`noteAction` is O(matching nodes), runs only on discrete events (cheap), and only counts nodes not yet known. Trigger map (Mechanics fires these; both trees):

| eureka key (event) | fired when | boosts |
|---|---|---|
| `eat` | agents eat ≥ N times (counter) | `Agriculture`, `Pottery` |
| `speak` | agents `speak` ≥ N times | `Writing`, `OralTradition`, `CodeOfConduct` |
| `share` | agents `share` ≥ N times | `Craftsmanship`, `CivilService` |
| `kill` | combat kills ≥ N | `StoneTools`, `Bronzeworking`, `IronWorking`, `WarBands`, `Militarism` |
| `birth` | births ≥ N | `AnimalHusbandry`, `TribalAssembly` |
| `mine_iron` | iron resource extracted ≥ N | `IronWorking` |
| `tame` | animal hunted/herded ≥ N | `AnimalHusbandry` |
| `coast_settle` | a coastal settlement founded | `Sailing`, `Compass` |
| `cross_water` | an agent crosses water (post‑Sailing) | `Compass` |
| `settle` | any settlement founded / tier‑up | `Masonry`, `TribalAssembly`, `Urbanization` |
| `pop_milestone` | tribe passes a pop threshold | `Currency`, `Statecraft` |
| `faith_found` | religion arises (from `culture.js`) | `Theology`, `Rites` |
| `convert` | another tribe converted | `Theology`, `Reformation` |
| `war_won` | war won / settlement razed | `Militarism`, `Nationalism`, `Vassalage` |
| `era_up` | enters a new era | next‑era root civic |

Default thresholds scale with era so they stay meaningful (`count ≈ 8 * (1 + era)` for action‑spam keys; `1–3` for discrete world events). Tune in playtest.

---

## 3. Governments + policy cards = AEON politics (on the symmetric GovernanceAPI)

This is the **civics tree's payload** and it plugs straight into the **GovernanceAPI** from `ARCHITECTURE.md` §4 — the one interface a HUMAN (UI) and an AI (`aiTurn(nation)`) both drive. Nothing here is human‑only.

### 3.1 Policy levers (extend `tribe.policy`)

`tribe.policy` today is `{aggression, expansion, breed}` in `[-1,1]`, injected into brains as `will_aggression/expansion/breed`. **Add `research`** (GAME_RULES already lists "aggression/expansion/breed/research" as the four levers). A government does NOT set the levers — it sets the **allowed range** for each, and how many **policy‑card slots** exist. The human/AI then picks levers within range and slots cards.

```js
tribe.policy = { aggression: 0, expansion: 0, breed: 0, research: 0 };   // each in [-1,1]
tribe.gov    = { id: 'Chiefdom', slots: [...], cards: [null,...] };       // current government
```

> Add a 4th will sense `will_research` to `brain.SENSE[]` (Dept 1) so the research lever actually bends behavior (citizens bias toward `speak`/work that feeds research). Until then `research` only multiplies accrual.

### 3.2 Governments (`GOVERNMENTS` table)

Each: `unlockedBy` (civic id), `era`, **slot layout** `{mil, eco, dip, wild}`, an **inherent cap bonus**, and **lever ranges** (a government can *force* a lever band — e.g. Fascism pins aggression high).

| id | unlockedBy | slots M/E/D/W | inherent | lever ranges |
|---|---|---|---|---|
| `Chiefdom` *(default)* | CodeOfConduct | 1/1/0/0 | — | all `[-1,1]` |
| `Autocracy` | Statecraft | 2/1/0/1 | combat ×1.10 | aggression `[0,1]` |
| `Council` | Statecraft | 1/1/0/1 | researchMul ×1.10 | all `[-1,1]` |
| `Theocracy` | Theology | 1/1/0/2 | cultureMul ×1.15, healthRegen ×1.10 | breed `[0,1]` |
| `Monarchy` | DivineRight | 2/2/0/0 | storage ×1.15, loyalty ×1.15 | breed `[0,1]` |
| `Republic` | Republicanism | 1/2/1/1 | researchMul ×1.15 | aggression `[-1,0.5]` |
| `Democracy` | Suffrage (+Ideology) | 1/2/2/2 | researchMul ×1.20, cultureMul ×1.20 | aggression `[-1,0.5]` |
| `Communism` | Ideology | 3/2/0/1 | foodYield ×1.20, combat ×1.10 | expansion `[0,1]` |
| `Fascism` | Ideology | 4/1/0/0 | combat ×1.25 | aggression `[0.5,1]` |

**War interplay (GAME_RULES §2):** a government's inherent `combat` and forced `aggression` band feed directly into `aggression_policy` and `opportunity` in `warPressure(A→B)`. A Fascist or Autocratic neighbor is *structurally* more warlike; a Republic/Democracy is biased peaceful — emergent, legible, identical for human and AI.

### 3.3 Policy cards (`POLICY_CARDS` table — the actual "politics" knobs)

Cards are slotted into the current government's slots (by type). Each: `slot` (mil/eco/dip/wild), `unlockedBy` (civic), and an effect that either **biases a lever** and/or **multiplies a cap**. Representative set:

| id | slot | unlockedBy | effect |
|---|---|---|---|
| `KinBonds` | wild | CodeOfConduct | loyalty ×1.1 |
| `Storytellers` | wild | OralTradition | cultureMul ×1.15 |
| `Toolmakers` | eco | Craftsmanship | foodYield ×1.1 |
| `Settlers` | eco | TribalAssembly | expansion +0.3 bias, settleBonus +1 |
| `Raiders` | mil | WarBands | combat ×1.1, aggression +0.2 |
| `Shamans` | wild | Rites | healthRegen ×1.15 |
| `Magistrates` | eco | WrittenLaw | researchMul ×1.1, loyalty ×1.05 |
| `Conscription` | mil | Militarism | combat ×1.15, aggression +0.2 |
| `Crusade` | mil | Theology | combat ×1.1 vs other‑faith |
| `Bureaucracy` | eco | CivilService | researchMul ×1.15 |
| `Knights` | mil | Chivalry | combat ×1.15, moveMul ×1.05 |
| `Caravans` | eco | Guilds | storage ×1.15, foodYield ×1.05 |
| `FreeMarket` | eco | Capitalism | foodYield ×1.2 |
| `Mobilization` | mil | Nationalism | combat ×1.2 |
| `Propaganda` | dip | MassMedia | cultureMul ×1.2, loyalty ×1.1 |
| `Diplomats` | dip | Globalization | reduces incoming warPressure (kinship/alliance term) |

### 3.4 The symmetric API surface (Statecraft wires these; both drivers call them)

Extend the GovernanceAPI with the civics/government verbs, mirroring the existing `prioritizeTech`:

```js
prioritizeCivic(nation, civicId)     // weight the next civic pick (UI or aiTurn)
setGovernment(nation, govId)         // only if civic unlock satisfied; resets slots
slotCard(nation, cardId, slotIndex)  // place a policy card into a typed slot
unslotCard(nation, slotIndex)
setPolicy(nation, lever, v)          // clamps v into the government's lever range
```

- **Human:** clicks these in the nation/politics panel (Dept 2 UI).
- **AI:** `aiTurn(nation)` calls the *same* functions via heuristics (e.g. high `warPressure` → pick `Autocracy`/`Fascism` + military cards; crowded → `expansion` lever up + `Settlers`).

`tech.js` owns the **data + validation** (`availableGovernments(tribe)`, `availableCards(tribe, slotType)`, `canAdopt(tribe, govId)`); `game/governance.js` owns the **verbs** and calls into them. This keeps the rule "Statecraft and Mechanics integrate only through contracts."

---

## 4. Eras + light golden / dark‑age loop

The era index already derives as `max(tech.era, civic.era)` across known nodes. On top we add a **light Era‑Score loop** (Civ VI's historic‑moments system, trimmed to one number + one multiplier).

### 4.1 Era Score from historic moments

Per tribe, `tribe.age = { score, status, prevDark }`. `tech.noteMoment(tribe, kind)` adds score on notable events (fired by Mechanics/Statecraft from the same hooks as eurekas):

| moment | points |
|---|---|
| unlock any node | +1 |
| **first** tribe in the world to unlock a given node | +3 |
| found settlement / tier‑up | +2 |
| found a religion | +3 · convert a tribe | +2 |
| win a war / raze a settlement | +3 |
| adopt a new government | +2 |

### 4.2 Age evaluation at each era transition

When a tribe's era increments, compare the score earned **this era** to a moving threshold and reset:

```
T(era)   = 12 + era * 6                  // moving target — later eras demand more
score    = tribe.age.score (this era)

score >= T * 1.5  → GOLDEN  (or HEROIC if prevDark)
score <  T * 0.5  → DARK
else              → NORMAL

then: tribe.age.prevDark = (status === DARK); tribe.age.score = 0
```

### 4.3 Age effects (one multiplier + the recovery loop)

| status | `caps.ageMul` | extra |
|---|---|---|
| `GOLDEN` | **1.25** | +loyalty, small agent energy/will lift |
| `HEROIC` | **1.40** | golden right after a dark age — the comeback |
| `NORMAL` | 1.00 | — |
| `DARK` | **0.80** | loyalty penalty; raises secession/unrest pressure |

`ageMul` multiplies BOTH accrual formulas (§2.1, §2.2) and folds into `caps` so it lightly touches yields/combat too. The **dark → heroic** path is the feedback loop: a struggling civ that rallies in its next era gets the strongest bonus in the game — a built‑in comeback mechanic, fully emergent, no player input.

---

## 5. EXACT revisions to `src/sim/tech.js`

The file is solid. Keep its spine; bolt on civics, eurekas, governments, ages. All additive; existing `accrue/recompute/available` callers keep working.

### 5.1 KEEP as‑is
- `ERAS`, `TECHS`, `TECH_BY_ID`.
- `TechSystem` shape and its scratch arrays.
- `recompute` (extend, don't rewrite), `available`, `eraName`, `_prereqMet`, `_pick`.
- The accrual *structure* (cold path, weighted unlock loop, returns newly‑unlocked defs).

### 5.2 ADD — data
```js
// 1. Tech gap fillers (§1A): Electronics, Rocketry, Robotics → push into TECHS.

// 2. Eureka tags on relevant techs (optional field; §2.3):
//    e.g. Agriculture: eureka:{action:'eat',   count:60}
//         Sailing:     eureka:{action:'coast_settle', count:1}
//         IronWorking: eureka:{action:'mine_iron', count:20}  ...etc per §2.3 table.

// 3. CIVICS array (§1B) — same def shape + `unlocks:[...]` + optional eureka.
export const CIVICS = [ ... ];
export const CIVIC_BY_ID = new Map(); // built like TECH_BY_ID

// 4. GOVERNMENTS (§3.2): { id, era, unlockedBy, slots:{mil,eco,dip,wild},
//                          caps:{...}, ranges:{aggression:[lo,hi], ...} }
export const GOVERNMENTS = { Chiefdom:{...}, ... };

// 5. POLICY_CARDS (§3.3): { id, slot, unlockedBy, caps:{...}, lever:{aggression:+0.2,...} }
export const POLICY_CARDS = { ... };

const BOOST = 0.5;
```

### 5.3 ADD — caps fields
Extend `freshCaps()` with: `cultureMul:1, ageMul:1, loyalty:1`. (Civics/governments/cards/ages reuse the existing multiplicative fold.)

### 5.4 ADD — tribe contract (`initTribe`)
Also init: `tribe.civ = { points:0, known:new Set(), boosts:new Set(), eu:new Map() }`, mirror `tribe.tech.boosts`/`tribe.tech.eu`, and `tribe.age = { score:0, status:'NORMAL', prevDark:false }`. Ensure `tribe.policy.research` and `tribe.gov = { id:'Chiefdom', slots:[...], cards:[...] }` exist (Statecraft may also set these).

### 5.5 ADD — methods on `TechSystem`
```js
// Culture pool: same loop as accrue but with the §2.2 formula, over CIVICS,
// honoring boosts + ageMul. Returns newly-unlocked civic defs (for toasts +
// to fire government-unlock notifications).
accrueCivics(tribe, dt, rng) { ... }

// Eureka/inspiration progress. Called by Mechanics on discrete events.
// Increments counters for matching unknown nodes in BOTH trees; on crossing
// the threshold, adds id to the right `boosts` set + emits a discovery hint.
noteAction(tribe, key, n = 1) { ... }

// Era-score + golden/dark age (§4). noteMoment adds score; advanceAge runs at
// era transition (call it from accrue/accrueCivics when era increments).
noteMoment(tribe, kind) { ... }
_advanceAge(tribe) { ... }   // sets tribe.age.status + caps.ageMul via recompute

// Government + card validation (data side of GovernanceAPI; §3.4).
availableGovernments(tribe) { ... }   // govs whose unlockedBy civic is known
canAdopt(tribe, govId) { ... }
availableCards(tribe, slotType) { ... }
availableCivics(tribe) { ... }        // mirror of available() over CIVICS
```

### 5.6 MODIFY — `accrue` and `recompute`
- **`accrue`:** multiply `gain` by `tribe.caps.ageMul`; replace the affordability check `d.cost > pts` with `this._effectiveCost(d, tribe) > pts` and subtract the effective cost (eureka discount). When `era` increments, call `_advanceAge`.
- **`recompute`:** after folding tech effects, ALSO fold (a) known **civic** effects, (b) current **government** `caps`, (c) slotted **policy‑card** `caps`, (d) `caps.ageMul` from `tribe.age.status`. Set `tribe.tech.era = max(tech era, civic era)`. New cap fields reset to 1 at the top like the others.

### 5.7 Integration notes to hand back to the Integrator
- `sim.step()` (per sim‑year, where `accrue` is already called): also call `accrueCivics(tribe, dt, rng)`.
- Wire `noteAction(tribe, key)` at the existing event sites: eat/share/speak counters (agent action resolution), `kill`/`war_won` (combat & war resolution), `birth` (reproduction), `settle`/`coast_settle`/`tier-up` (Settlement system), `faith_found`/`convert` (`culture.js` already emits these — add the call there), `mine_iron`/`tame` (Resource system when built).
- Wire `noteMoment(tribe, kind)` at the same sites (first‑in‑world check: a `sim`‑level `Set` of globally‑claimed node ids).
- `game/governance.js` implements the verbs in §3.4 by calling `canAdopt`/`availableCards` and mutating `tribe.gov`/`tribe.policy`, then `tech.recompute(tribe)`.
- Dept 1: add `will_research` to `brain.SENSE[]`; sim injects `tribe.policy.research` like the other wills.
- Renderer/UI (Dept 2): a **two‑column research panel** (Tech | Civics) with era bands + a boost spark on eureka'd nodes, a **government/policy‑cards panel**, and an **age badge** (Golden/Dark/Heroic) per nation.

---

## 6. One‑screen summary

- **Two trees, shared 9 eras:** `TECHS` (science → abilities/caps; *keep*, +3 nodes) ‖ `CIVICS` (culture → governments + policy cards; *new*).
- **Emergent accrual:** science from pop+culture+settlements; culture from culture+religion fervor; **eurekas** give a 50% discount when agents actually DO the matching thing. No clicks.
- **Politics = governments + policy cards** on the **symmetric GovernanceAPI** — `Chiefdom→Autocracy/Council→Theocracy/Monarchy→Republic→Democracy/Communism/Fascism`, with typed card slots and lever‑range constraints that feed `warPressure`.
- **Age loop:** Era Score → Golden/Dark, with a **Dark→Heroic** comeback multiplier (`caps.ageMul`).
- **`tech.js` plan:** keep the spine; add `CIVICS`, `GOVERNMENTS`, `POLICY_CARDS`, eureka boosts, age loop; extend `accrue`/`recompute`/`initTribe`; add `accrueCivics/noteAction/noteMoment/availableGovernments/availableCards`.
