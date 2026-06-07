# Project Goal (set 2026-06-07 by drlor)

Build a simulation game that is:

1. **Playable like Civ** — you can take a role inside the world: control your own country/civilization/people and play to win/survive/grow.
2. **Sandbox like WorldBox** — you can also act as the god-hand: change terrain, spawn things, intervene, watch the world run itself.
3. **A sincere simulation of humanity** — simulated people/civs driven by real neural networks that evolve across generations (culture, war, religion, trade, language drift emerge, not scripted).
4. **Great graphics** — visual quality is a hard requirement, not optional polish.
5. **Mechanics matter hardcore** — depth of simulation and game mechanics are the core value, never sacrificed for spectacle.

## The hybrid-agency pillar (key differentiator)
The player is BOTH god and participant. You can zoom out and reshape the world, or zoom in and *be* one of its nations — possibly fluidly switching. (Precedents to study: Dwarf Fortress fortress/adventure modes, Black & White god+creature, Crusader Kings playing-a-dynasty-in-a-living-world, Distant Worlds' automation slider, WorldBox's most-requested missing feature: "let me play as a kingdom.")

## REFRAME (2026-06-07): Civ-first, two modes — see GAMEPLAY_FLOW.md
Gameplay leans **more Civ 6 than WorldBox**. Two modes, Minecraft-style:
- **SURVIVAL** (primary): the player **creates/selects a people FIRST**, then AI peoples spawn and
  interact. You play as ONE nation by the world's rules — **no god/terrain editing** — Civ-style
  (explore/expand/research/build/trade/diplomacy/war) via indirect steering of NN citizens + possession.
- **CREATIVE**: the WorldBox god sandbox (terrain editing, spawn, smite, watch/shape).
Both are options; the start screen chooses. God tools are Creative-only.

## Constraints
- Solo dev (Anthony) + Claude. $0 budget — free engines/tools, free distribution first (itch.io/web), Steam later if it earns it.
- Fun first: must be a game, not a tech demo or screensaver.
- **LOCAL-ONLY. No servers, ever.** The game runs entirely on the player's PC — their hardware is the only compute. (set 2026-06-07)
- **Open source.** Public GitHub repo is fine — drlor wants to share it. Build for an easy one-click/one-installer setup for non-technical players.

## What "no servers" forces (the architecture is now decided in broad strokes)
- **NN brains MUST be tiny local nets (evolved MLPs / NEAT), NOT LLM-per-agent.** LLM-agent civs (Project Sid, Stanford Smallville) require API calls = servers = cost = banned here. They stay as *reference for what emergent behavior looks like*, not as the shipping architecture.
- Everything — worldgen, evolution, inference, save files — happens client-side. This is GOOD: it's free to distribute, scales with the player's own machine, and has zero ops burden (fits the "autonomous after deploy / no peopling" wiring).
- Distribution: public GitHub repo + a downloadable build (itch.io free, GitHub Releases) and/or a browser build (WebGPU/WASM on GitHub Pages — literally a URL, the easiest possible "install"). All $0.
- Engine choice must produce an easy redistributable build (Godot exports tiny self-contained binaries for free with no royalties; web build = no install at all).

## Status
- Research phase: multi-agent sweep running (9 domains + hybrid-agency + graphics-on-budget supplement). Findings land in `research/`.
