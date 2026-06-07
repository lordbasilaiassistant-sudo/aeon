# AEON — Beta Report & Prioritized Fix List

_Compiled by lead design from four veteran-gamer beta tests + a full code audit (2026-06-07)._

---

## Verdict: it is a simulation with a HUD, not a game (yet)

All four testers independently landed on the same score band (2–3/10 "plays as a game") and the
same root cause, and the user is right: **you cannot move units, you cannot build/develop, and you
cannot attack a nation.** The engine underneath is genuinely impressive — every creature is a real
evolving neural net, there's a tech tree, civics, territory, diplomacy, even working conquest code —
but **none of the three verbs a strategy player reaches for on minute one actually closes the loop.**
What's there is a beautiful ant farm with sliders. A Civ player sits down, tries to do the three
things they know how to do, all three silently fail, and they correctly conclude "this isn't a game."

The brutal part: **the code is ~80% of the way to each verb and stops one connection short.**
Conquest is fully implemented (`territory.js:60–81`) but armies never arrive to trigger it. City
founding has an intent field (`tribe.foundIntent`) that is **written and never read** by anything
(`governance.js:185`, zero consumers). The strong RTS move-order exists (`a.ordered`, `sim.js:464`)
but clears itself the instant a unit gets within 1.6 tiles and has no pathfinding, so units bounce off
the first lake and wander home. Each verb is a dangling wire. That's actually good news: this is
finishing work, not a rewrite.

### Audit corrections to the tester notes (so we fix the *current* code, not a stale build)
- The `⚔ Command` button (`index.html:83`) now calls `game.musterArmy()` → RTS command mode
  (`game.js:193`), i.e. the *stronger* `a.ordered` path — **not** `marchArmy`/`warRally` as the
  `military` tester saw. The weak 0.95 `warRally` nudge (`sim.js:472–475`) still exists and is what
  the **AI** uses (`governance.js:456`). So we now have the inverse of the tester's complaint: the
  better path is surfaced, but it's an invisible toggle and **still broken** (one-shot orders + no
  pathfinding), so it fails anyway. Both paths need to collapse into one that works.
- `foundSettlement` is only ever called by the AI (`governance.js:462`); **no UI path calls it** —
  the human has zero founding agency, confirmed. `foundIntent` is dead (`governance.js:185`).
- Player tribe is exempt from extinction cull (`sim.js:298 && !tr.isPlayer`), so a wiped nation
  lingers at 0 members forever; `game.js:291` only ascends if the tribe is *removed* from the map,
  which never happens → **soft-lock with no game-over**, confirmed.
- Combat feedback is a single 1-frame red ring on `lastAct===2` (`renderer.js:158`). No health bars,
  no counts, no siege marker. Confirmed.
- Research gain is `sqrt(pop)*0.11/yr` (`tech.js:227`); at ~50 pop ≈ 0.8 pts/yr vs ~50–130 pt techs.
  Player-scale nations effectively never tech. Confirmed.

---

## The single prioritized fix list (ordered by impact → "a playable game like Civ 6")

Ordering principle: **a strategy game is verbs → meaningful choices → legibility.** You can't make
choices meaningful if the verbs don't work, and feedback on a non-functioning verb is wasted. So:
Group A (make the verbs actually work) comes first, then B (make the choices matter), then C (make it
readable/fair/teachable). Within each group, highest-leverage first.

---

### GROUP A — Make it controllable NOW (the verbs must close their loop)

**1. Persistent orders + real pathfinding so "move units" actually works.**
This is the #1 complaint from every tester and the user. Two bugs, one fix:
- _Orders are one-shot:_ `sim.js:467` sets `a.ordered = false` the moment a unit is within 1.6 tiles,
  then the brain resumes foraging and the formation scatters. Make orders **persistent**: hold the
  ordered tile (a `stop`/`hold` state) and don't release until the player countermands. Add an
  explicit "Stop/Hold" so a held position is a state, not an accident.
- _No pathfinding:_ `sim.js:490–491` just reflects velocity (`a.vx *= -0.5`) off water/mountains, so
  units crab sideways and end up *farther* from a cross-water target. Add an A* or flow-field path
  toward `ordX,ordY` (a coarse tile-level grid over `world.walkable` is enough; cache per-order).
- _Files:_ `src/sim/sim.js` ordered block (L462–478); new `src/sim/pathfind.js`; `src/sim/agent.js`
  (order/hold fields, current-path cursor); `src/game/game.js` `issueOrder` (L217).

**2. Make "the army" a real, persistent, one-click-selectable group.**
Today `assignRoles()` (`sim.js:696`) **re-rolls who is a soldier every single year** via
`hash2(a.id,7,yr)`, so there is no stable unit to command — "your army" is just whichever dots you
happened to lasso last, and they revert next year. Fix:
- Make soldier role **sticky** (assign once, persist; only top up to the militarism target), so a
  commanded unit stays a unit.
- Add a **Select-All-Army** hotkey/button so the player isn't forced to drag a box over dots at
  strategic zoom (impossible when zoomed out). Track `game.army` as the standing selection.
- _Files:_ `src/sim/sim.js` `assignRoles`; `src/game/game.js` `musterArmy`/`boxSelect` (L193–214),
  add `selectArmy()`; `src/game/ui.js` nation HUD button; `index.html` nation bar.

**3. Add a real "Found City" verb (the headline city-builder action that's entirely missing).**
Mirror the working `armyMode` click-flow: a **Found City** button enters a placement mode; clicking a
valid tile **immediately drops a Camp there and deducts a cost** (pop + stockpile/gold). Critically,
make the settlement system **consume `tribe.foundIntent`** (currently dead, written at
`governance.js:185`, read nowhere) so founding is deterministic placement, not "hope 8 agents cluster
for a year." Add validity feedback (reject unwalkable tiles instead of silently accepting them).
- _Files:_ `src/sim/settlement.js` (new branch in `update()` that instantiates a `Settlement` at
  `foundIntent` and clears it); `src/game/governance.js` `foundSettlement` (L182, deduct cost + keep
  intent); `src/game/game.js` (new `foundMode` like `commandMode`); `src/game/input.js` (route click
  in found mode); `src/game/ui.js` + `index.html` (button).

**4. Make command/found modes DISCOVERABLE — stop the silent no-ops.**
The single biggest reason testers never found the working path: command mode is an **invisible
toggle** — no cursor change, no banner, and a click with nothing selected does nothing. Add:
- A persistent **"⚔ COMMANDING — drag to select, click to send"** banner + cursor change while the
  mode is on (and the equivalent for Found mode).
- A one-time **coach mark** the first time the player leads a nation (the existing `_showOnboard`
  in `ui.js:743` never mentions army/found — extend it into a 3-step "select → order → found").
- _Files:_ `src/game/game.js` `musterArmy` (L193); `src/game/ui.js` onboarding/banner; `css/style.css`.

**5. Make conquest reachable + give war a result.**
The conquest mechanic is **already built and correct** (`territory.js:60–81`: an overwhelming
besieger flips `settlement.tribeId`, re-flags land, loots stockpile, emits `conquest`). It just never
fires because armies never arrive (fixed by #1–2) and the enemy out-breeds all losses. Once #1–2 land:
- Verify/tune the capture threshold (`best > defense*1.4`) so a real siege resolves in-session.
- **Cap enemy out-breeding while at war** (the `strategy-ux` tester scored 693 kills while the foe
  *grew* 109→546) — e.g. a war-attrition penalty to `breed` for nations under active siege.
- Add **war goals + a peace-terms readout** so a war has stakes and closure (`makePeace` is currently
  a silent toggle, `governance.js:192`).
- _Files:_ `src/sim/territory.js` (threshold + capture event already there); `src/sim/sim.js`
  (wartime breed cap); `src/game/governance.js` (`makePeace`/war-goal state); `src/game/ui.js` (war panel).

---

### GROUP B — Make decisions meaningful (cause → effect the player can learn)

**6. Player-nation viability + a real fail state (kill the soft-lock).**
A passive player nation goes extinct in ~40 yrs (6/10 seeds in the survivability sweep), and when it
dies you're soft-locked at 0 members with no game-over (`sim.js:298` exempts the player from the cull;
`game.js:291` never triggers). Either give the player a light auto-management safety net (the AI's
`aiTurn` growth logic currently **skips** `isPlayer`, `governance.js:352`) **or** a clear "your nation
is collapsing" prompt — and **trigger a proper defeat/victory screen** when the player hits 0 (or a
destiny completes). Right now the game both wins itself (destiny met by ~yr 13 with zero input) and
can't be lost in a way that ends — both ends of the loop are broken.
- _Files:_ `src/sim/sim.js` (L298 cull, economy/carrying-capacity); `src/game/game.js` (ascend-on-death
  path L291); `src/game/governance.js` (optional player safety net); `src/game/ui.js` + `index.html`
  (defeat/victory modal tied to `checkDestinies`, `governance.js:235`).

**7. Player-ordered build queue with FUNCTIONAL buildings.**
Buildings are currently pure cosmetic sprites (`settlement.js:309 _layout`) and the only "building"
verb is a 5-button focus enum (`growth/build/military/gold/research`, `sim.js:325–331`). Add a per-city
**build queue**: spend stockpile/gold to construct specific structures with real payoffs — granary
(+food/growth), walls (+defense, feeds the existing `s.defense` conquest term), barracks (unit
production you control), market (+gold), library (+research). Convert the cosmetic `_layout` entries
into the chooseable, effect-bearing ones and show progress + per-year yield in the inspector.
- _Files:_ `src/sim/settlement.js` (`_layout`→functional buildings, `bonusFor` reads them); new
  `governance.build(sim, tribe, settlement, type)`; `src/game/ui.js` `renderSettlement` (L326, replace
  the focus enum with a queue UI).

**8. Make the economy directable & every policy lever legible + monotonic.**
Two problems: the economy is uncontrollable (stockpile only fills if evolved NNs choose to gather — the
`build` focus silently no-ops at 0 stone, `sim.js:329`), and the sliders are non-monotonic noise (same
seed: `growFast=72` wins one seed, *loses* another — the player can't build a mental model). Fix:
- Add a **per-nation gather priority** (wood/stone/ore) so directing labor actually fills the
  stockpile, and surface a reason when an action is blocked ("need 2 stone to build walls").
- Make each slider produce an **immediate, quantified, on-HUD effect** ("Grow fast: +X births/yr,
  −energy"; "Science: +Y research/yr, next tech in N yrs"). Replace emergent jitter with a readable model.
- _Files:_ `src/game/governance.js` (new economic/gather-priority method on the GovernanceAPI — it
  currently has *no* production method at all); `src/sim/sim.js` (economy + city-focus L320–332);
  `src/game/ui.js` `buildPolicies` (L412) + `nation-stats` (L587) for live readouts.

**9. Rebalance tech so research is a live choice within a session.**
`sqrt(pop)*0.11/yr` (`tech.js:227`) means a 50-pop player nation gets ~0.8 pts/yr against 50–130 pt
techs — 30 focused years unlock *nothing*. Boost player-scale gain and/or cut early-tech costs so a
focused nation visibly advances an era in minutes, and surface **"next unlock in N years"** + an effect
preview in the Research tab (the picker exists, `ui.js:436`, but shows no ETA/payoff).
- _Files:_ `src/sim/tech.js` `accrue` gain formula + early `cost`s (L41–137, L227); `src/game/ui.js`
  `_refreshResearchLine` (L455).

---

### GROUP C — Polish (legibility, fairness, teaching) — high value, do after the verbs work

**10. Combat & siege readability (highest-impact polish — pairs with #5).**
Combat is invisible: colored dots blink out with a 1-frame ring (`renderer.js:158`). A Total
War/Civ player needs to see the fight. Add: **health bars** on engaged units, an **army-size/strength
readout** in the nation HUD, a **pulsing "Siege of <city>"** map marker, and **toasts** when your
forces engage or a city you own/attack changes hands (the `conquest` event already emits,
`territory.js:78` — just surface it for the player). _Files:_ `src/render/renderer.js` `drawAgents`
(L124) + new siege overlay; `src/game/ui.js` toasts/HUD; `src/sim/territory.js` (per-player events).

**Also in C (smaller, do alongside):**
- **Un-hide the dock in Survival.** `css/style.css:103` `body.mode-survival #dock { display:none }`
  removes Inspect/Possess entirely; they become undiscoverable keyboard-only. Keep
  inspect/possess/army/found as visible on-screen buttons; only hide the *god* tools. _File:_
  `css/style.css` + a survival-aware dock group in `index.html`.
- **Tactical verb slice on the selection:** Attack-target / Retreat / Defend-this-city buttons +
  a one-click "rally home to defend" for the human (the AI already has a defend branch,
  `governance.js:457`). _Files:_ `src/game/game.js`, `src/game/ui.js`.
- **Short interactive tutorial** teaching that policies are indirect, the command/found modes, and how
  to win (destinies). _File:_ `src/game/ui.js` onboarding.
- **STATUS.md honesty:** `COMBAT.md` designs morale/rout/walls but `STATUS.md` admits combat is "a
  stub." Keep the docs matched to shipped reality as these land.

---

## One-line framing for the team
**Stop building new systems. Connect the five dangling wires (move, group, found, conquer, fail-state),
then make the existing levers legible. Every fix above is a connection or a readout, not a new
subsystem — the engine is already here.**
