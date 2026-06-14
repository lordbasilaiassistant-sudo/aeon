# AEON — Changelog (timestamped progress log)

Newest first. Timestamps are local (America/New_York). Kept per drlor's request to
timestamp work for velocity tracking without losing quality.

## 2026-06-14 — Day 2: the game goes 3D, animated, teachable, and savable
A big push beyond Sprint 1: AEON went from a flat top-down sim to a beautiful, animated 3D game you can
win or lose and learn to play. Tracked as issues #1–#17. Honest framing — a real leap, but NOT S+ yet:
the economy + deeper brains are LANDED but DORMANT (sim.js wiring is the next session), hard-seed
survival balance is unsolved, and victory/end-screen + audio + roads/traffic + polish remain.

- **SHIPPED — WebGL2 3D renderer, live in the game (#9, CLOSED).** A true-3D heightmap-mesh renderer
  (`Renderer3D`, raw WebGL2, zero-dep) with figures, instanced procedural buildings, nation-border overlay,
  and raycast picking — wired into the live game behind a Canvas2D fallback + a ◳3D toggle. Tap to select,
  drag pan, scroll zoom, Shift-drag orbit. ~0.4ms/frame. Commits 44d7ca0 → 0b1469a.
- **SHIPPED — the 3D world is ANIMATED.** Walk cycles + carry/combat/death poses, drifting cloud shadows,
  ~5k swaying trees, chimney smoke, a full day→night sun arc (golden hour + lit night windows). Commit 9b4e4bd.
- **SHIPPED — UX/onboarding so it's obvious how to play (#5, CLOSED).** Universal hover tooltips, a first-time
  Survival tutorial (leads with the leader/lawgiver control model), legible policy sliders with live effect
  labels, a Found-banner + gold-gated Found button, and a How-to-Play modal on the ? button. Commit 55b11db.
- **SHIPPED — LEADER-AI v0 + a real fail-state (#8 progress, #10).** A hands-off player nation is now ruled
  by a conservative leader-AI (it stands down the moment you legislate), so it no longer passively collapses
  on most seeds; a real DEFEAT fires when your nation hits 0 souls. Commit ddcbe5d.
- **FIXED — false "defeat" at Survival start.** `members` reads 0 for one frame after `createPlayerPeople`
  and the tutorial pauses before the first tick, so the fail-state declared an instant defeat the moment you
  started a game — and it was LIVE on Pages. Now guarded by `_playerEverLived`; caught by the pushed-build
  smoke test (the "test what you ship" rule earned its keep). Commit d08cf87.
- **LANDED (dormant — sim.js wiring next) — the ECONOMY (#11).** `sim/items.js` (item DB + drop tables),
  ACTIVE mob/animal loot drops, regional resources + buildable mines/quarries/lumber/farms + extraction,
  production (forge tools/weapons), and surplus↔need inter-nation trade. Commit 51d0a09.
- **LANDED (dormant — sim.js wiring next) — DEEPER BRAINS (#12).** +13 senses (predator/prey/stamina/danger/
  kin/home/at-war) + 5 acts (flee/rest/hunt/socialize/seek-water) appended (existing indices intact) + a
  recurrent memory state. Headless still PASS (gen 16), ~15ms/tick. Commit 2d3ad9d.
- **PROCESS.** Design north-stars written (CONTROL_MODEL #10, AGENT_LIFE #7, ECONOMY #6, GRAPHICS_3D #9,
  S+ mission). Issues #1–#17 tracked; #1/#2/#3/#4/#5/#9 closed. CI green throughout. Repo SEO live
  (description, 20 topics, meta/llms/sitemap). Run as a parallel multi-department studio (disjoint files).

## 2026-06-13 — Sprint 1 (verbs + perf + process)
A focused sprint to make the core verbs reachable and the build run smoothly, tracked as GitHub issues #1–#9.
Honest framing: perf, found, and pathfinding-wiring landed; the survival/fail-state loop (#8) is still the
headline gap — the game is closer to "plays as a game" but NOT there yet. (Recon graded the pre-sprint build
4.5/10; this sprint did not re-grade — see remaining gaps below.)

- **SHIPPED — FOUND reachable (#1, CLOSED)** — `sim/territory.js` `TREASURY_RESERVE = 12`: auto border-
  expansion only spends gold SURPLUS above the 12 floor, so a young nation banks past the 10g found cost
  instead of being stuck at 0–2 gold forever (gold reaches ~12 by ~year 3). Verified on the live Pages
  build (~28.6 gold). Commit d672faa (Fixes #1).
- **SHIPPED — FOUND reasons (#2, CLOSED)** — settlement min-spacing relaxed 8 → 5 tiles
  (`sim/settlement.js` `FOUND_MIN_SPACE = 5`); `settleSys.lastFoundReason` (water/too_close/occupied) now
  set on `foundAt()` and surfaced in the `game.js` toast so a rejected found-spot explains itself.
  Commit d672faa (Fixes #2).
- **SHIPPED — MOVE pathfinding WIRED (#3, still OPEN)** — `sim/pathfind.js` (flow-field, exports
  buildField/stepFrom) imported into `sim/sim.js` and used in the order block for foot units
  (vehicle === 0), replacing the old 6-angle deflector. An ordered foot unit now routes around
  water/mountains and ARRIVES in isolation (probe 48.6 → 1.2 tiles). Committed as Refs #3 in d672faa —
  issue intentionally LEFT OPEN because real-play long marches still fail (coupled to #8 starvation), so
  command does not fully FEEL good yet.
- **SHIPPED — PERF ~29× (#4, CLOSED)** — `render/` got viewport culling + LOD + particle thinning +
  dpr clamp + an auto quality governor (`_applyQuality('auto')`). Render at zoom 8.2 fell ~33.9ms →
  ~1.2ms/frame (~29×); verified live (~6.8ms at zoom 8, ~2200 agents). Fixes the GitHub Pages load
  bottleneck. Commit d672faa (Fixes #4).
- **SHIPPED — CI + issue-tracked process** — GitHub Actions (`.github/workflows/ci.yml`) runs the headless
  "life persists + evolves" invariant (`node test/headless.mjs`) on every push/PR to main and exits non-zero
  on regression; `package.json` adds `npm test` + `npm run serve`. Currently GREEN (pop 3200, gen 27).
  Work is now tracked as GitHub issues #1–#9. Commit 87a13d6.
- **LANDED (dormant — not yet wired to UI/AI)** — statecraft war-GOAL/peace-TERMS/treasury-lever layer:
  `game/governance.js` + `sim/diplomacy.js` gained VALID_WAR_GOALS {border,raze,vassalize,plunder} +
  setWarGoal/warStatus/warTerms/setTreasuryFocus/setWarRally and _wars/_peace records. These have ZERO
  references in game.js/ui.js yet (basic declareWar/makePeace buttons remain the only live war controls).
  Cognition: `sim/agent.js` gained order/hold state (path/pathCursor, holdX/holdY, orderState, setOrder/
  clearOrder); `sim/brain.js` forward pass refactored onto reusable scratch buffers — documented bit-
  identical, evolution unchanged. Landed in d672faa.
- **DESIGN ONLY (specs written, no gameplay code)** — `ECONOMY_DESIGN.md` (#6 things cost currency + cities
  have needs), `AGENT_LIFE_DESIGN.md` (#7 the "Free Guy" principle — agents with feelings/hunger/community),
  `GRAPHICS_3D_DESIGN.md` (#9 WebGL2 true-3D, Citystate-referenced; direction locked in commit f0d77a2),
  `SPRINT_PLAN.md`. (#9 also has an uncommitted local WebGL2 spike in the working tree — NOT shipped.)
- **STILL BROKEN / NEXT (honest)** —
  - **#8 (P0, OPEN) — the headline gap.** The player nation passively COLLAPSES (pop ~52 → 26 by year 30,
    trending to extinction) and there is NO game-over/defeat screen (the cull exempts isPlayer; no
    failstate/end-screen code exists). Also MARCH-SURVIVE: ordered units do NOT forage/rest mid-march, so
    a long march runs them down and stalls (a 3-soldier army ordered 35 tiles closed only ~28% in real
    play). Pathfinding is correct in isolation; the survival/order coupling is the broken part. This blocks
    both the command verb feeling good AND the game being winnable/losable.
  - **#5 (P1, OPEN) — command/found modes are not discoverable** (silent toggles, no banner/cursor/coach-
    mark). Untouched this sprint.

## 2026-06-07
- **18:11 EDT** — PLAYABILITY + PUBLISH (solo). PACE: 1× was 30 ticks/sec (frantic) → now 6/sec (calm,
  Civ-watchable), speeds 1–5× = 6–30/sec. ARMY COMMAND: nations set a war-rally; soldiers (warrior/ranger)
  march to it while civilians stay home; player "⚔ Army" button → click to march; AI marches to the enemy
  capital when winning, recalls on peace; pulsing march marker. TERRITORY rewritten: borders are PERSISTENT
  and EXPAND outward from fixed cities (no more "moving"), GOLD funds faster claims, and an overwhelming
  besieger CONQUERS a city (its land + 40% stockpile/gold transfer). Treasury (gold) income per year.
  Regression ALL PASS (gen 23). PUBLISHED: public repo github.com/lordbasilaiassistant-sudo/aeon (MIT) +
  GitHub Pages → lordbasilaiassistant-sudo.github.io/aeon (zero-install play). README/LICENSE added.
- **17:51 EDT** — VEHICLES & TRAVEL (solo) — water/air travel is EARNED. A seafaring people (Sailing tech
  + wood + a coastal town) launches BOATS crewed by shoreline folk; Flight + metal builds PLANES (cross
  any terrain, fast). On foot you stay land-locked; a boat crosses water, a plane crosses anything. Verified
  120yr: 2 nations researched Sailing → 56 boats, 33 crews out on the open sea (peoples now colonize across
  oceans). Boats/planes drawn (hull+mast / wings). Idle creatures now BREATHE. Regression ALL PASS (gen 24).
  → ALL 14 task-board mechanics complete.
- **17:45 EDT** — ANIMALS + GRAPHICS-ANIMATION PASS (solo). ANIMALS (`sim/animals.js`): a wilderness
  ecosystem — prey graze & flee, predators hunt (faster than prey flee), both breed/starve/die; tuned +
  a population floor so neither goes extinct (stable ~400 prey / ~12 predators, people unaffected). Drawn
  distinctly (tan deer / grey wolves). GRAPHICS (during test-waits, per drlor): animated water shimmer,
  drifting clouds with ground shadows, chimney smoke from cities (more plumes per tier), and haulers now
  carry a colored load on their back (wood/stone/ore/metal) — the economy made visible on the creatures.
- **17:30 EDT** — NEEDS: THIRST + REFINEMENT (solo). THIRST: a second survival need — `agent.hydration`
  decays (faster when hot), refilled by drinking at the water's edge, death if it runs dry; added a
  `thirst` brain sense so creatures EVOLVE to seek the water they already perceive (peoples cluster near
  water, emergent). Headless: pop 3200, gen 27, ALL PASS — life survives a 2nd need. REFINEMENT: ore +
  metalworking tech (Bronze/Iron) + a town → refined METAL (consumes ore); refined metal arms fighters
  far better than raw ore — the tech+resource+building "build up to it" gate. `tribe.stock.metal` + ⚒ HUD chip.
- **17:25 EDT** — CIVICS + ANTHROPOLOGY (solo). CIVICS (`sim/civics.js`): a culture-fuelled second tree
  (parallel to tech) unlocking GOVERNMENTS (Chiefdom→Confederacy/Monarchy→Theocracy/Republic→Democracy/
  Autocracy) + society bonuses, folded onto caps each year AFTER tech.recompute (idempotent — verified
  caps finite, not runaway). ANTHROPOLOGY (`sim/anthropology.js`): each people grows an emergent ETHOS
  (Militaristic/Communal/Devout/Industrious/Scholarly/Free) + customs from how they actually live;
  cultural AFFINITY folded into diplomacy warPressure (kindred cultures keep the peace). Government +
  ethos + customs shown in the inspector/HUD. Headless: nations reached Theocracy/Devout w/ ancestor-
  worship customs; economy+civics regression ALL PASS (gen 19).
- **17:13 EDT** — ECONOMY + LIVING MAP (solo, big one): (1) Settlements are now PERMANENT (removed the
  drift — Civ towns don't wander). (2) `sim/resources.js` — wood/stone/ore nodes on a coarse grid, deplete
  visibly, sustainable regrow (ore finite). (3) Widened the BRAIN (+6 senses: res dir/dist, carrying, home
  dir; +1 action: gather) so creatures EVOLVE into gatherers — verified 300 agents hauling, stockpiles
  growing (wood/stone/ore). (4) `tribe.stock` + nation-HUD chips 🪵🪨⛏; ore reserve boosts combat (metals
  matter). (5) Cities reshape the land: `world.dev` urban core + farmland (farmland raises food), rendered
  in the terrain bake; resource nodes drawn (shrink as mined). Headless: pop 2500, gen 22, map changed
  (805 farm / 225 urban tiles). Browser-verified. Tasks #3 (resources) + #6 (NN I/O) done.
- **14:57 EDT** — COMBAT & UNIT-ROLES (solo): roles (civilian/warrior/ranger) assigned yearly by
  `Sim.assignRoles` — army size scales with the nation's aggression POLICY (Peace folk = all civilian;
  warlike = ~20-40% fighters), role TYPE from traits (keen+light → ranger). Combat reworked: melee
  (adjacent ~1.7t, risky counter-attack) vs ranged (rangers, ~5.5t, safe), HP damage = power−defense,
  +35% home-territory defense bonus, STAMINA drains per attack & recovers resting, wounded/exhausted
  units rout. Weapon kits drawn (spear/bow). Headless ALL PASS; browser-verified army mix 18civ/11war/4rng.
  Task #14 done.
- **14:47 EDT** — UNIVERSAL CLICKABILITY + context options (solo): zoom-aware selection (strategic zoom
  → settlements/nations; tactical → creatures), `sim.settlementAt`, territory-owner fallback. Inspector is
  now context-aware: YOUR nation → control; FOREIGN nation → ⚔War/☮Peace/🤝Ally (via GovernanceAPI) + stance
  badge + territory size; settlement inspector (tier/owner/era/structures). Browser-verified: foreign click
  shows 3 diplo buttons + 523-tile territory; tactical click shows the brain. Task #10 done.
- **14:42 EDT** — Built TERRITORY & COUNTRY BORDERS (solo): `sim/territory.js` — settlements (by tier)
  + capitals claim land, nearest-wins; `Visuals.drawBorders` renders crisp nation-hued border outlines.
  Wired into sim (per-year `territory.update`) + renderer. Headless ALL PASS (pop 3200, gen 28, 6.71ms/tick,
  zero regression). Browser-verified borders rendering. Task #5 done.
- **14:36 EDT** — Built the CIV-FIRST START FLOW myself (solo, no workflow): polished start screen
  (Survival vs Creative), Create-Your-People (name + 🎲, banner palette, heritage trait picker — choose 2),
  `sim.createPlayerPeople()` applies heritage onto the founding genome + policy lean + plants a homeland
  far from rivals (coastal if Seafaring), `game.startSurvival/startCreative`, god tools gated to Creative
  (dock hidden + applyTool/setTool guarded), Survival "ascend" just drops out of a body. Headless smoke:
  "the Aurelian Kin" (martial+scholarly) grew to 391/era1 in 30yr. Browser-verified end-to-end: start →
  create → lead the Tindral Host, dock hidden, 6 nations live. Tasks #12/#13 done.
- **14:22 EDT** — Integrated STATECRAFT (governance + diplomacy) into the sim + game: AI nations now
  run yearly turns (set policy/stances/tech-priority/rally), `warPressure`/stances/wars form, foreign
  creatures are foes ONLY if at war or rival (neutrals/allies safe), rally-pull, destinies. Browser-
  verified: game.gov + diplomacy live, 7 destinies, allies forming, playAsTribe + setDestiny work.
  Headless ALL PASS (gen 28, 9.15ms/tick). Marked tasks #7/#8 done.
- **14:22 EDT** — REFRAME locked (GAMEPLAY_FLOW.md): Civ-first, TWO MODES (Survival = play a people,
  no god-editing; Creative = god sandbox), CREATE-YOUR-PEOPLE start. Launched deep Civ-series expert
  research → CIV_GAMEPLAY.md (5 researchers). New tasks #12 (start flow) #13 (gate god tools) #14 (combat/unit roles).
- **14:06 EDT** — Fixed the "creatures float across oceans" bug: `world.isWater()` now floors
  float coords before indexing the biome array (a float index returned `undefined` → read as
  walkable). Headless re-verify: ALL PASS, gen 21, **4 tribes persist to yr 100** (water now
  separates populations → diversity bonus), tech era 5 @ yr100 (good slow pace), 10ms/tick (faster).
- **~14:00 EDT** — Captured design for travel domains (land/water/air/space), combat & conflict
  model (COMBAT.md), entity taxonomy + economy loop + universal clickability (MECHANICS §4c).
- **~13:50 EDT** — Launched PLAYABILITY wave (3 parallel workstreams): governance+diplomacy
  (statecraft), UI/controls overhaul (functional menu, Nations panel, nation HUD, tool tooltips),
  creature+world visuals polish. Files landed; governance/diplomacy integration pending.
- **~13:40 EDT** — Agents now render as little CREATURES (head+body+walk bob), not dots.
- **~13:30 EDT** — Tuned visuals (killed haze + food-noise); sublinear tech pacing.
- **~13:25 EDT** — Integrated FOUNDATION build (Tech tree + Settlements + Culture + Visuals) into
  the sim; tech progression, settlements founding/growing, culture/religion all live + event feed.
  Kept creatures land-locked (no walk-on-water) per the vehicles-not-innate rule.
- **~13:00 EDT** — Civ6 tree research → TECH_TREE_DESIGN.md (two-tree + eurekas + governments).
- **~12:40 EDT** — Foundation parallel build (tech/settlement/culture/visuals modules) shipped.
- **~12:00 EDT** — Core engine built + validated headless: world/brains/evolution/tribes; the
  world LIVES and EVOLVES (traits shift under selection). Runs in browser, debug API.
- **~11:30 EDT** — Research sweeps (WorldBox/Civ/colony-sims/NN-evolution/feasibility/fun/market
  + hybrid-agency + graphics-on-$0); design spine docs written.

## Conventions
- After each meaningful change: `node test/headless.mjs` must keep "LIFE PERSISTS + EVOLUTION" PASS;
  browser smoke test via `window.AEON`. Then append a timestamped line here.
