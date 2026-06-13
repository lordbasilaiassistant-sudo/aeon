# AEON — Sprint Plan (next dev cycle)

**Sprint goal:** Connect the five dangling verbs (move, group, found, conquer, fail-state) into real, legible loops — wire the existing-but-unused pathfinder, give the player win/lose closure, stop founded cities from self-destructing, and make combat + city focus readable — so AEON plays like a small Civ 6 instead of a sandbox that can never be won or lost.

**Overall score:** 4.5 / 10 — the systems exist and are crash-free (robustness 8.5), but the player loop is broken at both ends: there is no fail-state (1.5), the economy is barely directable (3.5), and the marquee verbs (move across water, found a city) currently HURT the player. Most of the gap is wiring and legibility, not net-new systems.

> **Key correction to the audit:** `src/sim/pathfind.js` **already exists** as a complete, pure A*/BFS-flow-field module (`findPath` / `buildField` / `stepFrom`) and `world.walkable(x,y)` / `world.inBounds(x,y)` already provide exactly the interface it needs — but **nothing imports it**. The greedy 6-angle deflector at `sim.js:472-478` is still the live mover. The single biggest movement fix is therefore an **integrator wiring task**, not a new coremech module. Likewise `diplomacy.js` now has war-goal scaffolding (`declareWar(goal)`, `lastPeaceTerms`, peace `terms`), so the war work is veto + surfacing, not net-new engine.

---

## Backlog

| id | title | dept | type | pri | effort | files | accept |
|----|-------|------|------|-----|--------|-------|--------|
| FAILSTATE | Player defeat when nation hits 0 members | integrator | bug | P0 | M | src/game/game.js | After wiping all player agents and stepping, `game.update()` fires a `defeat` state once (flag set, sim paused); a node probe asserts `game.gameOver === 'defeat'` and `game.paused === true`. |
| ENDSCREEN | Victory/Defeat end screen + restart (no reload) | integrator | feature | P0 | M | src/game/ui.js, index.html | Forcing a player destiny then calling `ui.showEndScreen('victory',...)` renders `#endscreen` (not `.hidden`) with a Restart button whose handler calls `game.restart()` (not `location.reload`); probe asserts the node exists and is visible. |
| WIRE-PATHFIND | Wire pathfind.js flow-field into order/army march | integrator | bug | P0 | M | src/sim/sim.js | Foot unit ordered to a BFS-reachable land target 100+ tiles away ARRIVES (final dist < 2) instead of dying; probe: seed 7, order across a concave coast — `minDist < 2` and agent alive at end (replaces the greedy deflector at sim.js:464-482). |
| MARCH-SURVIVE | Ordered units forage/rest at low energy mid-march | cognition | bug | P0 | M | src/sim/agent.js | With a long order active, an agent below an energy threshold eats/drinks instead of marching; probe: lone agent ordered 100 tiles on walkable land survives the trip (alive at arrival), where today it starves. |
| FOUND-SUSTAIN | Founded city keeps settlers & doesn't crater the nation | coremech | bug | P0 | M | src/sim/settlement.js | After `foundAt` on nearby land, probe over 3 sim-years: `within11` stays > 0 and `tribe.members` does NOT fall below 60% of pre-found count (today it collapses 21→5). |
| GHOST-CITY | Abandon empty founded cities (min-pop floor) | coremech | bug | P0 | S | src/sim/settlement.js | A permanent city driven to pop 0 for > MAX_STARVE years emits `abandon` and is removed; probe: founded city forced to pop 0 is gone within 4 sim-years instead of persisting forever. |
| WAR-VETO | Skip isPlayer pairs in diplomacy auto-peace | statecraft | bug | P0 | S | src/sim/diplomacy.js | Player at war is NOT force-peaced by exhaustion; probe: declare player war, step 15 sim-years — stance stays `war` (today it auto-flips at ~year 7). AI↔AI wars still auto-resolve. |
| COMBAT-EVENTS | Emit battle/raid/siege/slain events from combat | coremech | feature | P0 | M | src/sim/sim.js | A fight between two tribes emits at least one `battle` (or `raid`/`slain`) event; probe greps the emit stream during a forced clash and finds ≥1 combat event (today: 0). |
| COMBAT-HUD | Health bars + under-attack/siege toasts | frontend | feature | P0 | M | src/render/visuals.js, src/render/fx.js | At zoom > 1.3 each agent draws a health bar from `a.health`; a `battle`/`siege` event triggers an FX marker; probe asserts `visuals.drawAgents` reads `a.health` and an fx method for the siege marker exists and is called. |
| SETCITYFOCUS-API | `setCityFocus` on the symmetric GovernanceAPI | statecraft | feature | P0 | S | src/game/governance.js | `governance.setCityFocus(sim, settlement, 'gold')` sets `s.focus` and is callable headlessly; probe sets each of the 5 focuses via the API and reads them back. AI `aiTurn` calls it so AI cities use non-default focus. |
| SETCITYFOCUS-WIRE | Route city-focus button + inspect through the verb | integrator | feature | P1 | S | src/game/game.js, src/game/ui.js | `game.setCityFocus(s, f)` exists and the inspect-panel focus buttons call it (not a raw `s.focus =` DOM mutation); probe drives the verb and confirms `s.focus` changed and a toast fired. |
| FUNC-BUILDINGS | Buildings give type-specific payoffs | coremech | feature | P1 | M | src/sim/settlement.js | `bonusFor` reads building TYPES: stripping a granary/market/library changes the returned food/gold/research bonus; probe asserts `bonusFor` output DIFFERS with vs without a market (today identical). |
| EMPTY-CITY-GATE | Depopulated city stops paying focus bonuses | coremech | bug | P1 | S | src/sim/world.js | Focus payout requires resident pop, not just any living tribe member; probe: city forced to pop 0 pays 0 gold/research/walls over 3 years (today it prints a free +3/yr). (Coremech exposes a `s.pop`-gated helper; integrator flips the sim.js switch to use it — see FOCUS-GATE-WIRE.) |
| FOCUS-GATE-WIRE | Gate sim focus switch on city pop | integrator | bug | P1 | S | src/sim/sim.js | The `switch (s.focus)` payout at sim.js:321-331 early-outs when `s.pop <= 0`; probe (paired with EMPTY-CITY-GATE) confirms no payout from an empty city. |
| AUTO-EMBARK | Cross-water orders route via coast / boat | coremech | feature | P1 | M | src/sim/pathfind.js | `findPath` (or a sibling export) returns a coast-hugging land route to the nearest crossing for a foot unit when the straight line crosses water; probe: path from A to across-bay B for a non-vehicle unit returns a land-only waypoint list or null (never an in-water step). |
| AUTO-EMBARK-WIRE | Apply embark routing in the order march | integrator | feature | P2 | M | src/sim/sim.js | Foot unit ordered across a bay walks the AUTO-EMBARK land route instead of jittering at the shore; probe: ordered cross-bay foot unit makes net progress toward target each phase and does not die at the coast. |
| TRIBE-FISSION | Emergent tribe fission via genome distance | cognition | feature | P1 | L | src/sim/brain.js, src/sim/agent.js | A drifted sub-group splits into a new tribe (a `fissionReady` signal derived from `distance()` over genomes); probe: two clusters with genome distance above a threshold report fission-eligible (today `distance()` is never used for speciation). Wiring the actual `tribeId` reassignment is a separate integrator item. |
| FISSION-WIRE | Spawn a new tribe on fission signal | integrator | feature | P2 | M | src/sim/sim.js | When a sub-group is fission-eligible (TRIBE-FISSION) and settled far from the capital, sim assigns it a new `tribeId`/tribe; probe: over a long run `activeTribes()` can INCREASE at least once (today it only ever decreases). |
| FOUND-BANNER | Persistent Found-mode banner + cursor (Esc cancel) | frontend | polish | P2 | S | css/style.css, index.html | Entering found-mode adds a `body.founding` class + a visible `#found-banner`; probe asserts the banner element exists in markup and the class is styled (mirrors command-mode). (Integrator toggles the class in FOUND-BANNER-WIRE.) |
| ROLE-POOL-RESET | Reset role on agent spawn/kill (no soldier babies) | cognition | bug | P2 | S | src/sim/agent.js | A recycled pool slot spawns with `role === 0`; probe: alloc → spawn role-1 → release → re-alloc → spawn → new agent has `role === 0` (today prints `1`). |
| SURVIVAL-ONBOARD | Survival coach-marks + correct first hint | integrator | feature | P2 | M | src/game/ui.js, index.html | Starting Survival shows a 3-verb coach (Found/Command/Ascend) and the onboard hint does NOT tell the player to pick a nation they already lead; probe: after `startSurvival`, `#onboard` text mentions Found/Command and not "pick a nation". |
| GATED-BTN-FEEDBACK | Disable Found until 10g; soldier count on Command | integrator | polish | P2 | S | src/game/ui.js | `🏛 Found` is disabled with a "need 10g (have Ng)" tooltip while gold < 10, and `⚔ Command` shows the live soldier count; probe asserts the button `disabled` flips at 10 gold and the label includes a count. |

---

## Department dispatch

Each department owns DISJOINT files — pick up your lane and work in parallel. Integrator items that depend on a department module are listed under integrator and name their dependency.

### cognition — `src/sim/brain.js`, `src/sim/agent.js`
- **MARCH-SURVIVE** (P0, M) — `agent.js`: under an active order, forage/drink/rest below an energy threshold so long marches stop being a death sentence.
- **TRIBE-FISSION** (P1, L) — `brain.js` + `agent.js`: expose a `fissionReady`/genome-cluster signal from the existing `distance()`; this is the pure detection only — reassignment is FISSION-WIRE (integrator).
- **ROLE-POOL-RESET** (P2, S) — `agent.js`: set `this.role = 0` in `spawn()` and clear it in `kill()` so recycled slots aren't born soldiers.

### frontend — `src/render/*`, `css/style.css`, `index.html` (visual/markup only)
- **COMBAT-HUD** (P0, M) — `visuals.js` + `fx.js`: per-agent health bars at zoom > 1.3 from `a.health`; siege/battle FX marker (consumes COMBAT-EVENTS).
- **FOUND-BANNER** (P2, S) — `css/style.css` + `index.html`: `#found-banner` + `body.founding` styling to mirror command-mode (integrator toggles the class).

### statecraft — `src/sim/diplomacy.js`, `src/game/governance.js`, civics/anthropology/names/heritage
- **WAR-VETO** (P0, S) — `diplomacy.js`: skip `isPlayer` pairs in the `tick()` auto-peace loop (line ~383) the same way the stance-drift loop already does.
- **SETCITYFOCUS-API** (P0, S) — `governance.js`: add `setCityFocus(sim, settlement, focus)` to the symmetric API and call it in `aiTurn` so AI cities use non-default focus.

### coremech — `src/sim/world.js`, settlement/resources/territory/tech/culture/animals, `src/sim/pathfind.js`, `src/core/*`
- **FOUND-SUSTAIN** (P0, M) — `settlement.js`: pin/anchor the settler party (or strengthen the food magnet) so founding doesn't starve the colony or the nation.
- **GHOST-CITY** (P0, S) — `settlement.js`: add a min-pop floor so a long-empty permanent city CAN be abandoned (`s.starve > MAX_STARVE` no longer blanket-shielded).
- **COMBAT-EVENTS** (P0, M) — `sim.js`... *(note: sim.js is integrator-owned — see correction below)*.
- **FUNC-BUILDINGS** (P1, M) — `settlement.js`: make `bonusFor` read building TYPES (granary→food, market→gold, library→research).
- **EMPTY-CITY-GATE** (P1, S) — `world.js`: expose a pop-gated focus-payout helper (integrator flips the switch).
- **AUTO-EMBARK** (P1, M) — `pathfind.js`: coast-hugging land route to the nearest crossing for foot units (pure module extension).

> **Correction:** COMBAT-EVENTS edits `sim.js`, which is INTEGRATOR-owned. Reassigning COMBAT-EVENTS to **integrator** to honor disjoint ownership; coremech's combat-relevant change is FUNC-BUILDINGS. (Reflected in the table.)

### integrator — `src/sim/sim.js`, `src/game/game.js`, `src/game/ui.js`, `src/game/input.js`, `test/*`, docs (the wiring + shared files)
- **FAILSTATE** (P0, M) — `game.js`: defeat path when player members hit 0 (the `isPlayer` cull exemption means `game.js:327` never fires — detect 0-members directly).
- **ENDSCREEN** (P0, M) — `ui.js` + `index.html`: victory/defeat modal + `game.restart()` (no `location.reload`).
- **WIRE-PATHFIND** (P0, M) — `sim.js`: import `pathfind.js` and replace the greedy deflector at sim.js:464-482 with flow-field stepping. **Depends on the existing pathfind.js (already done).**
- **COMBAT-EVENTS** (P0, M) — `sim.js`: emit `battle`/`raid`/`slain`/`siege` from the per-fight resolution (feeds COMBAT-HUD).
- **SETCITYFOCUS-WIRE** (P1, S) — `game.js` + `ui.js`: `game.setCityFocus` verb; route inspect-panel buttons through it (replaces the raw `s.focus =` at ui.js:393). **Depends on SETCITYFOCUS-API.**
- **FOCUS-GATE-WIRE** (P1, S) — `sim.js`: gate the focus payout switch on `s.pop`. **Depends on EMPTY-CITY-GATE.**
- **AUTO-EMBARK-WIRE** (P2, M) — `sim.js`: apply AUTO-EMBARK routes in the order march. **Depends on AUTO-EMBARK + WIRE-PATHFIND.**
- **FISSION-WIRE** (P2, M) — `sim.js`: reassign `tribeId` / spawn a tribe on the fission signal. **Depends on TRIBE-FISSION.**
- **SURVIVAL-ONBOARD** (P2, M) — `ui.js` + `index.html`: Survival coach-marks + correct first hint.
- **GATED-BTN-FEEDBACK** (P2, S) — `ui.js`: disable Found until 10g, show soldier count on Command.
- **FOUND-BANNER-WIRE** (folded into FOUND-BANNER's integrator side) — `input.js`/`game.js` toggles `body.founding` + Esc-cancel; mirrors command-mode. **Depends on FOUND-BANNER (frontend markup/css).**

---

### Dependency summary (do bottom-up)
- WIRE-PATHFIND ← pathfind.js (already exists) → AUTO-EMBARK-WIRE ← AUTO-EMBARK
- COMBAT-EVENTS → COMBAT-HUD
- SETCITYFOCUS-API → SETCITYFOCUS-WIRE
- EMPTY-CITY-GATE → FOCUS-GATE-WIRE
- TRIBE-FISSION → FISSION-WIRE
- FOUND-BANNER (css/markup) → FOUND-BANNER-WIRE (input/game)
