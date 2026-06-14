# AEON — Current Status

_Last updated: 2026-06-14 (end of Day 2)_

## Reality check (drlor): a real leap today — ~6.5–7/10 "plays as a game", aiming S+
Day 2 turned a flat top-down sim into a **beautiful, animated 3D game you can win or lose and learn to
play**: a WebGL2 3D world (figures, procedural buildings, day-night) live in-game, an onboarding tutorial
+ universal tooltips, a leader-AI that keeps a hands-off nation alive, and a real fail-state — a
game-breaking false-defeat bug was caught **on the live build** and fixed. The ECONOMY (items/drops/mines/
farms/trade) and DEEPER BRAINS (richer senses/acts + recurrent memory) are LANDED but DORMANT: committed,
headless-green, awaiting their `sim.js` wiring (the first job next session). Still NOT S+: hard-seed
survival balance is unsolved, the economy + brains aren't switched on yet, and victory/end-screen + audio
+ roads/traffic + mobile polish remain. Keep grinding, report plainly. (Sprint 1 detail is below.)

**AEON** = a browser god-game/civ-sim where every creature is a real, evolving neural network. God +
nation + avatar agency. Local-only, no servers, open source, zero deps.
Run: `npm run serve` → http://localhost:8123 (or open `index.html` via any static host).

## What works now (verified against the code + headless test)

### Sprint 1 fixes (2026-06-13, all verified in-tree)
- **~29x render perf** (#4, CLOSED). `src/render/renderer.js` adds viewport culling, a dpr/quality
  governor (`_applyQuality('auto')`), a renderScale clamp, and LOD/particle thinning. Measured
  **~33.9 ms → ~1.2 ms/frame at zoom 8.2** (~29x); live-verified ~6.8 ms at zoom 8 with ~2,200 agents.
  This is what fixed the GitHub Pages load on dpr 2–3 devices. Closed by `d672faa`.
- **Found-a-City is now reachable** (#1, CLOSED). `src/sim/territory.js` sets `TREASURY_RESERVE = 12`;
  auto border-expansion only spends gold *above* that floor, so a young nation banks past the 10g found
  cost instead of sitting at 0–2 forever (reaches ~12 gold by year 3; live build showed 28.6 gold).
  Closed by `d672faa`.
- **Found rejections now explain themselves** (#2, CLOSED). `src/sim/settlement.js` relaxes min-spacing
  `8 → 5` tiles (`FOUND_MIN_SPACE = 5`) and sets `lastFoundReason` to `'water'` / `'occupied'` /
  `'too_close'`, surfaced as a toast in `src/game/game.js`. You now learn *why* a tile was rejected.
  Closed by `d672faa`.
- **Pathfinding wired into orders** (#3, still OPEN — see below). `src/sim/pathfind.js` (flow-field;
  exports `buildField` / `stepFrom`) is imported in `src/sim/sim.js` and drives the order block for
  foot units (replacing the old 6-angle deflector). An ordered unit now routes around water/mountains
  and **arrives in isolation** (probe 48.6 → 1.2 tiles). Landed in `d672faa` as `Refs #3`; issue kept
  OPEN on purpose because real-play long marches still fail (coupled to #8).
- **CI invariant gate** (INFRA). `.github/workflows/ci.yml` runs `node test/headless.mjs` on every
  push/PR to main and exits non-zero on regression. `package.json` adds `test` and `serve` scripts.
  Currently **GREEN** (life persists, evolution to gen ~27, population stable). Landed in `87a13d6`.

### The living world (pre-existing, still true)
- **Every creature is an evolving neural net.** Tiny MLPs think every tick; traits measurably evolve
  under the energy economy. Headless test confirms life persists and evolves.
- **Civ-first loop**: Survival/Creative start, create-a-people (name/banner/heritage genome), tech tree,
  civics → governments, emergent anthropology/ethos, permanent settler-founded cities, territory/borders,
  a living map, full resource economy (gather → haul → stockpile → refine), thirst, combat/unit-roles,
  diplomacy/war/destinies (AI nations self-run), animals, vehicles, universal clickable entities.
- **Dual agency**: god tools, nation policy injected into citizens' NN inputs, possession, all via UI +
  `window.AEON` debug API.

## What is still broken / the next priority (honest)

1. **#8 (P0) — the player nation passively COLLAPSES and there is no fail-state.** Population trends
   ~52 → 26 by year 30 and toward extinction. The cull exempts `isPlayer`, so there is also **no
   game-over / defeat screen** (recon fail-state score 1.5/10). No FAILSTATE/ENDSCREEN code exists yet.
   This is the **#1 next priority** — it blocks AEON being winnable or losable.
2. **#8 (P0) — MARCH-SURVIVE.** Ordered units do **not** forage or rest mid-march, so on a long march
   they run down and stall. In real play a 3-soldier army ordered 35 tiles closed only ~28% in 400
   ticks, even though isolated pathfinding probes arrive. Pathfinding is correct in isolation; the
   survival/order coupling is the broken link. This is why **#3 stays OPEN** and command does not yet
   FEEL good over long distances.
3. **#5 (P1) — command/found modes are not discoverable.** They are silent toggles with no
   banner/cursor/coach-mark. Nothing shipped for this in Sprint 1.

## In flight (landed but NOT shipped/wired — next slices)
- **3D renderer (#9)** — direction locked to WebGL2 (Citystate-referenced) in `GRAPHICS_3D_DESIGN.md`
  (committed `f0d77a2`). A real spike exists in the working tree — `src/render/gl3d.js` (`class GL3D`
  with an `isSupported()` probe) plus `src/render/iso25.js` — but these are **untracked, uncommitted,
  and not wired into `renderer.js`.** Treat #9 as "direction locked + local spike," not shipped.
- **Statecraft war-GOAL / peace-TERMS / treasury lever** — `setWarGoal` / `warStatus` / `warTerms` /
  `setTreasuryFocus` / `setWarRally` and the `_wars`/`_peace` record model landed in
  `src/game/governance.js` + `src/sim/diplomacy.js` (VALID_WAR_GOALS = border/raze/vassalize/plunder).
  They are **dormant**: zero references in `game.js`/`ui.js`. (Basic declareWar/makePeace *are* wired
  via the UI War/Peace buttons; the goal/terms/treasury layer is not.)
- **Cognition order/hold state** — `src/sim/agent.js` gained `path`/`pathCursor`, `holdX`/`holdY`,
  `orderState`, `setOrder()`/`clearOrder()`; `brain.js` forward pass refactored with reusable scratch
  buffers, documented bit-identical (evolution unchanged). Landed, partially exercised by movement.

## Design directions (specs only — no gameplay code yet)
- `ECONOMY_DESIGN.md` (#6) — things cost currency + founded cities have ongoing needs.
- `AGENT_LIFE_DESIGN.md` (#7) — the "Free Guy" principle: agents with feelings/hunger/community.
- `GRAPHICS_3D_DESIGN.md` (#9) — WebGL2 true-3D renderer; every car/citizen a real mind.
- `SPRINT_PLAN.md` — the sprint backlog and sequencing.

## Tracking
- **CI**: `.github/workflows/ci.yml` runs `node test/headless.mjs` (the life-persists + evolution
  invariant) on every push/PR to main; non-zero exit blocks regressions. Currently GREEN.
- **GitHub issues #1–#9** are the source of truth for what shipped vs. what's open:
  - **CLOSED**: #1 (Found reachable), #2 (Found reasons), #4 (render perf ~29x).
  - **OPEN**: #3 (real-play marches still fail, coupled to #8), #5 (discoverability), #6 (economy
    depth, spec only), #7 (living agents, spec only), **#8 (P0 — survival/fail-state, the #1 priority)**,
    #9 (3D renderer, direction locked + local spike).

## Docs (the design spine)
`GOAL.md` · `DESIGN.md` · `FEATURES.md` · `MECHANICS.md` · `GAME_RULES.md` · `TECH_TREE_DESIGN.md` ·
`ARCHITECTURE.md` · `ECONOMY_DESIGN.md` · `AGENT_LIFE_DESIGN.md` · `GRAPHICS_3D_DESIGN.md` ·
`SPRINT_PLAN.md`. Per-step history in `CHANGELOG.md`; outside-in playtest in `BETA_REPORT.md`.
