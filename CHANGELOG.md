# AEON — Changelog (timestamped progress log)

Newest first. Timestamps are local (America/New_York). Kept per drlor's request to
timestamp work for velocity tracking without losing quality.

## 2026-06-07
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
