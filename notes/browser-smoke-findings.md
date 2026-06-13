# Browser smoke-test findings — live build @ localhost:8123 (Eli, integrator lens)

_2026-06-13. First-hand play of the CURRENT build (not the stale BETA_REPORT). Pairs with the
headless recon workflow. Every claim below was verified via `window.AEON` debug API + screenshots._

## What's healthy (verified)
- Build loads clean — **zero console errors** on boot and through ~25 simulated years.
- Start screen + **"Found a People"** create-a-people flow are genuinely polished (name + dice,
  banner color, 7 heritage traits, "choose up to two", live summary line). Good first impression.
- Survival launches straight into a **Civ-shaped nation HUD**: Found / Command / Ascend, era +
  government chips, pop, policy sliders (Aggression/Expansion/Breed/Research), Research + Civic
  progress banners (top-left), minimap (bottom-left), `Nations` panel, speed control.
- World develops believably over ~25 yrs: **multi-nation territory borders** in nation colors,
  **named cities** (Lyracid, Kervale, Rondisad…), neighbors, religions ("the Xurhunxu Mysteries").
- **selectArmy() works** — returns a stable group (22 soldiers of 237 citizens, ~9–16%). The
  "your army" group is real and selectable. (Stickiness across years = recon `verb-army` owns it.)

## P0 / P1 bugs found first-hand
### 🔴 P0 — GOLD-STARVED → "Found a City" is unreachable in normal play
- `game.js:254` gates founding on `playerTribe.gold >= 10`.
- `sim.js:278` income = `members*0.04 + settlements*1.5` ≈ **~18 gold/yr** for a 237-pop, 6-city nation.
- BUT auto-spending drains it: territory expansion spends `min(gold,4)/yr` (`territory.js:32`),
  plus soldier training (`sim.js:330,743`) and other sinks. **Net treasury hovers at 0–2 gold**
  (traced: 0 → 0 → 1.58 → 1.24 across years). It never reaches 10 → the headline city-builder
  verb cannot be used by a new player. (Fix options: starting treasury, dedicated/raisable income,
  lower/scaling cost, or don't auto-spend the player's gold without consent.)

### 🔴 P1 — FOUND-STRICT → can't found near your homeland, and no reason given
- `settlement.js:120`: rejects any tile within **8 tiles** of an existing settlement (`dx²+dy² < 64`).
- With a dense homeland (player had 6–16 settlements clustered), the **first acceptable tile was
  ~radius 8 from the capital** — every closer walkable tile silently rejected. The UI toast only
  says "Can't found here" with no reason ("too close to <city>" / "needs land").

## Needs in-code confirmation (handed to recon)
- Command-mode **discoverability**: `ui.setCommandBanner` exists, but it was not visually obvious
  that command mode was engaged; canvas cursor is globally `crosshair`. Recon `ux` lens owns this.
- Terrain renders a bit muddy/soft at mid-zoom (pixel upscaling). Recon `frontend`/visuals.

## Repro harness (paste into devtools on localhost:8123 after starting Survival)
```js
const g = window.AEON.game, sim = g.sim, pt = g.playerTribe;
const tr=[]; for(let i=0;i<5;i++){ for(let t=0;t<60;t++) sim.step();
  tr.push({gold:+pt.gold.toFixed(2), members:pt.members, cities:sim.settleSys.countOf(pt.id)}); }
console.log(tr);  // watch gold fail to accumulate toward 10
```
