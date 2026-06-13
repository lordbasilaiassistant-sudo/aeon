# AEON — 3D Renderer Direction (WebGL2) + Art Reference

_Decision (drlor, 2026-06-13): the flat top-down look undersells the world. Going **true 3D** —
Candidate B (raw WebGL2, zero-dep, no-build, local-only). Reference: **Citystate: Metropolis**
(Steam 2828020) for the graphical + civic feel. Tracked as issue #9. Pairs with #4 (perf), #7
(living agents), #6 (city economy)._

## The framing that defines us
*Citystate Metropolis* is a gorgeous 3D city-builder: procedural buildings, 35–40 road types,
visible **traffic/cars on streets**, dynamic water, socioeconomic depth (zoning, income disparity,
gentrification, taxes/budget/growth). **But its citizens are crowd-simulated — "the simulation
happens at the level of households and buildings... not individually simulated like in Skylines."**

That is the EXACT inverse of AEON. Our one differentiator: **every creature is a real, evolving
neural net.** So the north star is:

> **Citystate's living 3D city — but every car and citizen you see is a real mind (the Free Guy
> principle, [[project-aeon-vision]]). A living 3D world where nobody is faked.**

No city-builder can truthfully claim that. The 3D view is what finally lets the player SEE the minds
living their lives.

## Art direction (adopt from Citystate, render in WebGL2)
- **Camera:** tilted 3D (Civ 6 / Citystate ~45–60°), orbit + pan + zoom; orthographic or gentle perspective.
- **Terrain:** heightmap MESH from the world elevation, per-vertex normals, directional **sun + ambient**,
  biome/height vertex colors, **dynamic water** plane at sea level (translucent, moving shimmer),
  forests as instanced billboards, distance **fog/atmosphere** for depth.
- **Settlements as procedural 3D buildings:** extrude blocks by city tier/era (huts → houses → towers),
  vary height/width/color procedurally (Citystate's customizable structures), cluster into a skyline;
  walls/temples/markets as distinct 3D forms. Lit + shadowed.
- **The living layer (the whole point — "cars on streets"):** **GPU-instanced moving agents** rendered as
  3D billboards/sprites, positioned at `(x, terrainHeight, y)`, colored by tribe hue, *visibly traveling
  the world* — haulers carrying loads, marching armies, boats crossing water, citizens about their day.
  Each casts a soft shadow. Instancing keeps thousands cheap (the perf win, #4).
- **Future: roads/streets.** Paths between cities that agents/vehicles travel along — literally "cars
  driving on streets." (New mechanic; coremech + render.)
- **Day/night + weather** lighting already partly in the 2D post; carry the sun cycle into the 3D light.

## Civic legibility (adopt Citystate's depth, keep AEON's per-agent truth)
Territory/zones shaded in nation colors on the 3D terrain; click a building → city panel (pop, needs
#6, focus); click a moving agent → the **life card** (#7: mood, hunger, what they're doing & why).
Socioeconomic readouts (growth, income, happiness) surfaced legibly — per the design law
([[feedback-balance-and-ux]]): readable, not a wall of numbers.

## Why WebGL2 (Candidate B) over Canvas 2.5D (Candidate A)
- **Real depth** (true mesh + camera), not a faked oblique projection.
- **GPU instancing** scales to AEON's thousands of per-agent minds far better than Canvas2D — the 3D
  path is *faster* at scale, not slower. Reinforces #4.
- Still zero-dep / no-build / local-only: raw WebGL2 shaders, no three.js, no CDN.
- Fallback: keep the optimized Canvas2D renderer as a low-end/compat option (auto quality, #4).

## Build path
1. Verify the Candidate B WebGL2 spike works (Eli previews in Chrome).
2. Harden B into a production renderer: terrain mesh + water + lighting → procedural buildings →
   instanced living agents → camera/controls → civic overlays. (Graphics dept, isolated new files;
   integrator swaps it behind a renderer interface so the live game keeps working + Canvas2D fallback.)
3. Re-verify on the pushed Pages URL (test what you ship). Then layer roads/traffic + the life-card.

## Sources
- Citystate: Metropolis — Steam (app 2828020): https://store.steampowered.com/app/2828020/Citystate_Metropolis/
- Citystate II — Steam (app 1352850): https://store.steampowered.com/app/1352850/Citystate_II/
- Dev blog (first screenshots): https://www.citystategame.com/post/citystate-metropolis-development-update-and-first-screenshots
