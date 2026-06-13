# AEON — a living world of evolving minds

A god-game **and** civilization simulator where **every creature thinks with its own tiny
neural network** — a real brain that mutates and evolves across generations. Nobody is
scripted. They learn to survive, find water, gather, build, band into nations, research,
trade, worship, and war over land. It's **WorldBox meets Civilization**, with a soul.

**Runs 100% in your browser. No servers. Nothing is sent anywhere. Free and open source.**

---

## Two ways to play (Minecraft-style)

- **Survival** — *play like Civ.* Create a people (name, banner, heritage), then lead that one
  nation in a living world of rival peoples. Set policy, prioritize research, do diplomacy
  (ally / trade / war), **muster and march your army**, choose a destiny — all by *steering*
  your neural-net citizens, not micromanaging them. No god powers; you live by the world's rules.
- **Creative** — *play like WorldBox.* The divine hand: raise mountains, carve seas, grow
  forests, spawn life, smite. Shape the world and watch civilizations rise and fall.

## What actually simulates

- **Real evolving brains** — a tiny fixed-topology MLP per creature; genomes mutate &
  interbreed; selection shapes behavior. Traits (size, speed, diet, aggression, vision…) are
  heritable and *visible*. Click any creature to see its mind.
- **Needs** — hunger and thirst (drink at the water's edge or perish → peoples settle near water).
- **Economy** — wood / stone / ore nodes that deplete & regrow; creatures *evolve into gatherers*
  who haul resources home to the national stockpile; ore is **refined into metal** (tech + a town).
- **Tech tree** (science) **+ Civics tree** (culture → governments: Chiefdom → Monarchy →
  Republic → Democracy…). Capabilities are **earned**: no water travel until **Sailing → boats**,
  no flight until **Flight → planes**.
- **Settlements** — settlers found permanent cities that grow Camp → Village → Town → City and
  **reshape the land** (farmland, urban sprawl).
- **Territory & borders** — cities claim land that **expands outward** and persists; spend **gold**
  to claim faster; lose it to an enemy who **conquers** what you can't defend.
- **Combat & unit roles** — civilians, **warriors** (melee), **rangers** (ranged); army size set by
  your aggression policy; stamina, home-defense bonus, weapons powered by your metal reserve.
- **Diplomacy** — stances, alliances, grievances, a transparent war-pressure model; the same
  GovernanceAPI drives both you and the AI nations.
- **Anthropology** — each people grows an emergent **ethos** (Militaristic / Communal / Devout /
  Industrious / Scholarly / Free) and customs from how they actually live; kindred cultures keep peace.
- **A wilderness** — prey & predator ecosystem living alongside the people.
- **A world that breathes** — day/night, seasons of weather, shimmering water, drifting clouds,
  chimney smoke, creatures that walk, haul loads and breathe.

## Status & roadmap

AEON is **early** and under active development — the simulation runs, but the *game* around it is
still coming together. Be skeptical of anything that sounds finished; here's the honest state.

**Landed in Sprint 1 (2026-06-13):**
- **Found-a-City is now reachable** — a nation banks enough gold to actually pay the found cost,
  and rejected tiles now explain *why* (too close / water / occupied) instead of silently failing.
- **Ordered foot units pathfind** — a flow-field routes them around water and mountains; an isolated
  unit now arrives at its target instead of stalling on the first obstacle.
- **~29× faster rendering** — viewport culling, level-of-detail, and a quality/dpr governor took a
  heavy frame from ~34 ms down to ~1 ms in the probe (fixes the slow GitHub Pages load on high-dpr
  devices).

**Known broken / next up (tracked as GitHub issues):**
- **The player nation passively declines** and there is **no win/defeat screen yet** — the core
  survival loop and fail-state are the headline gap (#8, P0).
- **Long marches don't finish in real play** — ordered units don't forage or rest mid-march, so they
  run down before arriving even though the pathfinding itself is correct (#8, #3).
- **Command / Found modes aren't discoverable** — they're silent toggles with no banner or cursor
  cue (#5).

**Planned directions (designed, not built — see the design docs):**
- **Deeper economy** — actions cost currency and founded cities carry ongoing needs (#6,
  `ECONOMY_DESIGN.md`).
- **Living agents ("Free Guy" principle)** — feelings, hunger, community and personal behavior, not
  just survival drives (#7, `AGENT_LIFE_DESIGN.md`).
- **A true-3D WebGL2 renderer** — direction is locked and a local spike exists, but it is **not wired
  in or shipped** (#9, `GRAPHICS_3D_DESIGN.md`).

A GitHub Actions check runs the headless "life persists & evolves" invariant on every push, and all
work is tracked as GitHub issues (#1–#9) with a `SPRINT_PLAN.md`.

## Run it

It's plain ES-module JavaScript — **no build step, no dependencies.**

```bash
# any static server works; this repo ships a tiny zero-dep one:
node serve.mjs        # → http://localhost:8123

# run the headless invariant (life persists & evolves) — same check CI runs:
npm test              # → node test/headless.mjs
```

Or just open `index.html` through any static file server (ES modules need http, not `file://`).

## Controls

- **Scroll** zoom (one continuous space from orbit to the ground) · **Drag** pan
- **Click** a creature (zoomed in) or a nation/city (zoomed out) → context info & options
- **Space** pause · **1–5** speed · **☰** menu · **? ** intro
- In a nation: **Policies / Research / Diplomacy / Destiny** tabs · **⚔ Army** to march your soldiers
- Creative tools (left dock): raise / lower / forest / spawn / bless / smite / possess

## Architecture

Local-first, dependency-free, no build:
- `src/sim/` — the simulation: `world`, `brain` (the NN), `agent`, `sim` (the loop), `tech`,
  `civics`, `culture`, `anthropology`, `settlement`, `territory`, `resources`, `animals`,
  `diplomacy`, `heritage`.
- `src/render/` — `renderer` + `visuals` (stylized canvas), `camera`, `fx`.
- `src/game/` — `game` (controller), `governance` (the symmetric human/AI nation API), `ui`, `input`.
- `test/headless.mjs` — runs the sim with no browser to verify life persists & evolves.

Design docs (the full thinking): `DESIGN.md`, `MECHANICS.md`, `GAME_RULES.md`, `FEATURES.md`,
`COMBAT.md`, `TECH_TREE_DESIGN.md`, `GAMEPLAY_FLOW.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.

## License

MIT — do anything, no warranty. Make worlds.
