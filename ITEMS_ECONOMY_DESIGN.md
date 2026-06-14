# AEON — Items & True-Economy Design

_ECONOMY department spec (drlor, 2026-06-13). The shared CONTRACT for the item
database, drop tables, extraction (mines), production (smithy/workshop), and the
surplus/need trade model. Companion to `ECONOMY_DESIGN.md` (costs & city needs);
this doc is the **substance layer** — *what* the economy is made of._

The FOUNDATION (items DB + drop-on-death) is **implemented** in `src/sim/items.js`
and wired in `src/sim/animals.js`. Mines / production / trade are specified here as
the contract the rest of the department + the integrator build against.

---

## 1. The item registry — `src/sim/items.js` (PURE: data + functions, no sim imports)

Every thing a nation can own, make, or strip off a corpse is an **Item**:

```
{ id, name, type, tier, value, material?, madeFrom?, madeBy?, tech? }
  type   : 'resource' | 'material' | 'tool' | 'weapon' | 'good'
  tier   : 0 raw .. higher = more processed/advanced
  value  : economic worth, wood = 1 (drives trade prices + loot value)
  material: 'stone'|'bronze'|'iron'|'steel'  (for tools/weapons)
  madeFrom: [itemId,...] consumed to craft it (recipe inputs)
  madeBy  : 'mine'|'quarry'|'lumber'|'farm'|'smithy'|'workshop'
  tech    : techId that must be known to make it (gates materials/products)
```

### Export surface (the contract)
| Export | Kind | Meaning |
|--------|------|---------|
| `ITEMS` | `Item[]` | the full registry (flat array, reads like a spreadsheet) |
| `ITEM_BY_ID` | `Map<id,Item>` | O(1) lookup |
| `value(id)` | `(id)=>number` | economic worth (0 for unknown ids — safe for trade math) |
| `isResource(id)` | `(id)=>boolean` | true for the raw, gatherable base resources |
| `itemsOfType(type)` | `(type)=>id[]` | all ids of a type |
| `rollDrops(kind, rng)` | `(kind,rng)=>[{id,qty}]` | loot from a slain creature/mob kind |
| `dropTable(kind)` | `(kind)=>def\|null` | read-only view of a drop table (docs/UI) |

### The item set (19 items today, extensible)
| Category | Items | Notes |
|----------|-------|-------|
| **Resources** (tier 0) | wood, stone, ore, food, hide, herbs | `value`: wood 1, food 0.8, stone 1.3, herbs 1.4, hide 1.6, ore 2.5 |
| **Materials** (tier 1–2) | bronze, iron, steel | refined at a **smithy**, **tech-gated** (Bronzeworking / IronWorking / Metallurgy); steel is `madeFrom:[iron]` |
| **Tools** (tier 1–2) | stone / bronze / iron tools | raise extraction & production yields (design hook) |
| **Weapons** (tier 1–3) | stone / bronze / iron / steel weapons | arm the army; value climbs steeply (4 → 22) |
| **Goods** (tier 1–2) | leather, medicine, pottery | crafted at a **workshop**; medicine/pottery tech-gated |

Pricing is relative to **wood = 1**: raw < refined < finished, and rarer raw
(ore) > common raw (wood). Scarcity multipliers are applied at *trade time*
(see §4), not baked into `value` — `value` is the intrinsic floor.

---

## 2. Drop tables & drop-on-death  (`items.js` + `animals.js`)

`rollDrops(kind, rng)` rolls a per-kind weighted table. Each entry
`{id, chance, min, max}` is rolled **independently** (a kill can yield several
items, or rarely none). Deterministic — it uses the **rng you pass in** (the
animal/world rng), never `Math.random`, so loot can't perturb agent evolution.

| kind | drops | rationale |
|------|-------|-----------|
| `prey` (deer/etc) | hide 85% ×1–2 · food(meat) 100% ×1–3 · herbs 20% ×1 | grazers give skins + meat |
| `predator` (wolf/etc) | hide(pelt) 70% ×1 · food(meat) 90% ×1–2 · ore(fang/bone) 15% ×1 | hunters give pelt + a scrap of hard material |

Extensible: add a `monster` kind with rare loot and `rollDrops` handles it for
free — no code change, just a new table entry.

### The drop-on-death HOOK (where + how) — `animals.js`
- **Where:** `Animals.update()` runs a tiny post-loop sweep each tick over animals
  flagged `alive === false && !looted`. It marks `looted = true` and calls
  `_resolveDrops(sim, a)` exactly once per carcass. This catches **every** death
  path uniformly — a wolf's hunt, starvation, or old age — without touching the
  three scattered `alive = false` sites.
- **How (attribution):** `_resolveDrops` rolls the kill's loot, then finds the
  **nearest settlement within `HARVEST_R` (9 tiles)**. If one exists and its tribe
  is alive, the loot is banked into that nation's `tribe.stock[id]` — its hunters /
  foragers harvested the carcass. Otherwise the loot falls to `Animals.ground`
  (a bounded `Map<itemId, qty>`) — an ambient wilderness pile, claimable later by
  a forage hook or read as an ecology stat.
- **Why this hook:** agents and animals don't fight directly in the current sim
  (no agent→animal combat path), so "killer tribe" is realized as *"the nation
  whose town is close enough to work the kill."* It is **cheap** (scans the handful
  of settlements, not all agents), self-contained in the animals dept's own file,
  and adds new item ids (hide/food/herbs) to `tribe.stock` without disturbing the
  existing wood/stone/ore/metal keys (`stock` is a plain object).

---

## 3. Regional resources, mines & production  (contract for the rest of the dept)

### Regional resources — `src/sim/resources.js`
Today nodes are scattered by biome. The **regional** upgrade: bias placement into
**clusters** so nations differ in endowment — an *ore belt*, a *forest*, *fertile
valleys*. Implementation: seed a few cluster centers per resource type from the
world rng and raise spawn probability near them (keep the existing 8-tile coarse
grid + `nearestTo()` untouched, so per-agent sensing stays cheap).

### Mines / extraction — `resources.js` + `settlement.js`
A nation builds an **improvement on a node** that extracts into `tribe.stock` over
time. One API the integrator calls **once per sim-year**:
- `buildMine(node, kind)` — `kind` ∈ `mine|quarry|lumber|farm`; tags a node as worked.
- `extractTick(sim)` — for each worked node, move yield into the owning
  `tribe.stock` (yield scales with city tier + tools held). Ore mines deplete
  (finite); lumber/farm/quarry regrow (existing `regen`).

### Production — `src/sim/settlement.js`
A **smithy/workshop** consumes resources (+tech) to forge **products** into
`tribe.stock`, generalizing the existing `ore → metal` line in `sim.js`. One API:
- `produceTick(sim)` — for each settlement with the right building+tech, run each
  affordable recipe from `madeBy` (smithy: materials/weapons; workshop: tools/goods),
  consuming `madeFrom` inputs and banking outputs. **Yield scales with city tier ×
  tech**. Gated by `Item.tech` (e.g. no bronze before Bronzeworking).

> Integrator note: the current `ore → metal` refinement in `sim.js` is the seed of
> `produceTick`; it stays valid (metal ≈ the legacy alias of bronze/iron output)
> until production migrates into `settlement.js`.

---

## 4. Trade — surplus/need at supply/demand prices  (`src/game/governance.js`)

Builds on the existing `proposeTrade` / `_tval` (kept signature-compatible).
Each nation computes, over the item/resource set, what it has spare vs what it
lacks; neighbors swap surplus-for-need at **scarcity-adjusted prices** (scarcer =
pricier). New surface (existing `declareWar` / `makePeace` / `proposeTrade`
signatures stay intact):

| API | Returns | Meaning |
|-----|---------|---------|
| `surplusOf(tribe)` | `{id: qty}` | items held **above** the nation's need threshold |
| `needOf(tribe)` | `{id: qty}` | items held **below** threshold (the deficit) |
| `tradeTick(sim)` | — | integrator calls **yearly**: each nation matches its top need against a peaceful neighbor's surplus and runs `proposeTrade` at a price set by `value(id) × scarcityMul`, where `scarcityMul` rises as the *seller's* stock of that item falls |

The AI accept-test (`_tval` value comparison, ally discount) is reused unchanged,
so a human and an AI evaluate the same deal the same way (the symmetric-interface
contract). `tradeTick` only proposes deals that pass that test, so it can never
force a losing trade.

---

## 5. Constraints honored
- **Cheap:** all heavy work self-gates to **once per sim-year**; the per-tick
  drop sweep only touches animals that died *this tick* (a handful), and scans
  settlements (few), never all items × all agents.
- **Headless-testable:** `items.js` is pure; `test/_econ_items.mjs` asserts the
  registry, lookups, drop tables, and (through a stepped Sim) that drops bank and
  **life still persists + evolves** (pop > 0 after 800 steps).
- **Invariant intact:** booting the Sim and stepping keeps life alive — verified
  by the canonical `seed:7` boot (pop = 989 @ 800 steps, unchanged by this work).
- **No forbidden edits:** only `items.js` (new), `animals.js`, and this doc were
  touched. `sim.js`, `game/*`, `render/*`, `index.html`, `css/*` untouched.
