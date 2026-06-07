# AEON — Current Status

_Last updated: 2026-06-07 17:55 EDT_

## Reality check (drlor, 2026-06-07): ~5% to a truly playable game
The MECHANICS are scaffolded and the sim runs, but that is NOT a finished game. The felt
experience — controls/UX depth, balance, strategic depth, polish, fun, onboarding, bug-free
play, graphics quality — is the ~95% still ahead. The list below is "systems that exist," not
"a game that's done." Keep grinding, report plainly.

## Mechanics scaffolded so far
Every creature is an evolving neural net. On top of that now runs: Civ-first start (Survival/Creative
+ create-a-people), tech tree, civics tree → governments, anthropology (emergent ethos/customs),
permanent settler-founded cities, territory & country borders, a living map (farmland/urban cities
reshape the land), the full economy (resources → gather → haul → stockpile → refine to metal, run by
the evolved NNs), thirst as a 2nd survival need, combat & unit-roles (warrior/ranger, melee/ranged,
stamina, weapons from metal), diplomacy/war/destinies (AI nations self-run), animals (prey/predator
ecosystem), vehicles (Sailing→boats cross water, Flight→planes), universal clickable entities w/
context diplomacy, and an animated look (water shimmer, clouds, smoke, haulers carrying loads, idle
breathing). Headless ALL PASS throughout; verified in-browser at ~60 FPS with streaming
diplomacy/civics/extinction events. Full per-step log in CHANGELOG.md.


## Now plays like a Civ-first game (solo build session)
- **Start screen → mode select** (Survival / Creative) → **Create Your People** (name, banner, heritage
  traits applied to the founding genome) → lead that nation. God tools gated to Creative.
- **Click anything, context-aware**: zoomed out → click settlements/nations (foreign = ⚔War/☮Peace/🤝Ally
  via the shared GovernanceAPI; yours = control); zoomed in → click a creature (its live brain).
- **Country borders** drawn in nation colors; **nation HUD** (policies/research/diplomacy/destiny) +
  AI nations running their own statecraft (war pressure, stances, tech priorities, destinies).
- Headless ALL PASS (pop 3200, gen 28, 6.7ms/tick). Browser-verified end to end.


**AEON** = a browser god-game/civ-sim where every creature has a real evolving neural
network. God + nation + avatar agency. Local-only, no servers, open source, zero deps.
Run: `node serve.mjs` → http://localhost:8123  (or open index.html via a static host).

## What works NOW (verified)
- **Living, evolving world**: ~2,600 tiny-MLP creatures think every tick; traits measurably
  evolve under the energy economy (headless test reaches gen 21, life persists & stays stable).
- **Tech progression**: nations accrue research (sublinear in pop) and unlock a ~26-tech tree
  across 9 eras; unlocked caps change behavior (moveMul/foodYield/combat/healthRegen). Events
  fire: "X discovers Animal Husbandry — Stone Age Era".
- **Settlements**: dense clusters found Camps that grow Village→Town→City; rendered with
  rooftop clusters + names; events fire ("Gormire grows into a Town").
- **Culture**: per-tribe language + religions that can arise & spread (events fire).
- **Dual agency**: god tools (raise/lower/forest/spawn/food/smite), nation policy (will injected
  into citizens' NN inputs), possession (descend into a body, WASD). All functional via UI + debug API.
- **Visuals**: stylized terrain w/ coastlines + depth-shaded water + hillshade, readable agents,
  settlement buildings, subtle post (bloom/day-night/vignette), juice/FX. (v0.1 muddy/noisy issues fixed.)
- **Runs in browser** at playable FPS; no console errors; debug API (`window.AEON`) for beta-testing.

## Known tuning items (tracked, not blockers)
- Monoculture: tribes still merge toward 1–2 over time → needs tribe FISSION for lasting diversity.
- Settlements thin as tribes merge; settlement persistence needs work.
- Perf: ~13–16 ms/tick at 2,600 agents (smooth at 1×; SoA + WebGL instancing is the scale path).
- Tech still needs the Civ6-grounded revision (two-tree + eurekas + governments) — design ready
  in `TECH_TREE_DESIGN.md`.

## Docs (the design spine)
`GOAL.md` · `DESIGN.md` · `FEATURES.md` (WorldBox×Civ6) · `MECHANICS.md` (needs/resources/
refinement/borders/vehicles) · `GAME_RULES.md` (scales/war/decision-space) · `TECH_TREE_DESIGN.md`
(Civ6-grounded two-tree) · `ARCHITECTURE.md` (department model + contracts).

## Next (per task board)
Core mechanics wave (needs · resources · refinement · territory/borders · vehicles) → expand NN
I/O to the new mechanics → Statecraft (governance/war/diplomacy, symmetric human/AI) → Frontend
overhaul (graphics/UI/animation + nation-mode UX + tool info) → tech.js Civ6 revision.

## Department file ownership (parallel-safe)
- COGNITION: sim/brain.js, sim/cognition.js
- FRONTEND: render/*, css/*, ui visuals
- STATECRAFT: sim/politics.js, sim/diplomacy.js, game/governance.js, data/lore.js
- CORE MECHANICS: sim/world.js, resources.js, needs.js, territory.js, settlement.js, tech.js, culture.js, vehicles.js
- INTEGRATOR (Eli): sim/sim.js, game/game.js + all contracts
