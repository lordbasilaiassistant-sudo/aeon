# Research: Hybrid Agency Model + Great-Graphics-on-$0

Supplemental sweep (2 domains, 8 agents, all load-bearing claims adversarially fact-checked). Sources cited inline. Generated 2026-06-07.

---

## DOMAIN A — The dual god+participant agency model (the core differentiator)

### Verdict on the pillar: VALIDATED, and largely unfilled.
"Let me play AS a civilization / control a unit" is **top-tier WorldBox community demand, confirmed independently** (not a hunch):
- WorldBox IdeaBox "Ability to Control Units" → status **"Planned"**, **122 comments**, duplicate "Power to control units" merged in. Asks for a god *avatar* / possession + controlling a king to declare war/peace and command a kingdom. (`ideabox.featureupvote.com/suggestions/254831`)
- Separate "**Kingdom Mode / Empire Mode: Play as a Civilization**" suggestion ("Under consideration") proposes **asymmetric multiplayer**: 1 player as Titan/God generating events while others lead mortal nations (PvP/PvE/civs-vs-god). (`/suggestions/254863`)
- Demand strong enough that **mods already ship it**: KingBox (control humans/dwarves/elves/orcs + wizard/demon-lord, cast spells, rule kingdoms), Super RPG Mod (control one person or a whole army with squads + WASD combat), Ruler Mod, Inherited Kingdoms. (`nexusmods.com/superworldbox/mods/17`, `gamebanana.com/mods/323418`, `gamebanana.com/mods/410814`)

→ **The core pillar is something WorldBox players are actively begging for and the dev hasn't shipped. That's the gap.**

### The "two modes in one world" precedent — and what's actually unsolved
- **Dwarf Fortress** is the closest proof the model works: fortress overseer + adventurer in ONE persistent procedural world. BUT modes are **mutually exclusive** — must retire/abandon to switch, timeline jumps ~2 weeks, and adventure mode became the **under-adopted, under-polished niche**. (Confirmed independently.)
- **CORRECTION from fact-check:** the *switching mechanic itself* is NOT unsolved — SpellForce, Warcraft III, Warlords Battlecry, Bellwright, Mount & Blade II all let you fluidly switch in-session between a top-down command layer and a directly-controlled character with no world reset. **What's genuinely unmatched is the DEPTH PAIRING**: a deep colony/civ *simulation* overseer + a deep *embodiment* inside a single continuously-simulated persistent world. State the differentiator as the depth-on-both-sides combo, not "nobody can switch fluidly."

### How to "play as a nation" of autonomous NN agents — four proven, shippable models
All are **INDIRECT steering + optional possession — never puppeteering each agent** (puppeteering fights the NN premise AND tanks performance):
1. **Embodied avatar** — Populous shaman (god-in-training, physically weak, reincarnates, spell regen scales with followers), Black & White creature (an RL agent shaped by slap/pet, *not* directly commanded). One entity carries both agencies. *(Nuance: Populous DOES allow some direct follower orders — B&W's creature is the cleaner pure-indirect example.)*
2. **Delegation** — CK3 council (Chancellor/Steward/Marshal assigned tasks) + granting titles to vassals. You're ONE actor among thousands; your death is "a footnote," play continues through heirs.
3. **Priorities / policy + autonomy toggle** — RimWorld work matrix (priorities 1–4) + zones, direct control only in combat; The Sims free-will Off/Full.
4. **Per-function automation sliders** — Distant Worlds: automate any-or-all empire functions independently (automate 99% + pilot one ship, or run 90% manually + automate only taxation).

### Design lessons (actionable)
- **Two modes = two ALTITUDES of ONE camera/interface, not two screens.** Total War (campaign↔battle) and Spore (stage zoom) unify along a single zoom continuum. God mode = high altitude; nation/avatar mode = zoomed-in view of the SAME world + same camera rig. Switching reads as "zoom in to participate," not "load a different game."
- **Use an embodied AVATAR as the literal bridge** between god and participant — "the god descends into a body." This is the exact thing WorldBox players request and the most intuitive (diegetic) mode switch.
- **"Play as a nation" = INDIRECT steering**, layered by effort: set policy/laws/goals (NNs pursue them) → delegate to council → set priorities & zones → possess a specific actor when you want hands-on. NEVER force micromanaging thousands of free-willed agents.
- **Expose a granularity slider** (Distant Worlds model) so ONE player dials from full-god-observer → hands-on national leader → single embodied avatar, per function. Most flexible answer to the god-vs-avatar tension; turns one world into 3 playstyles.
- **The world NEVER pauses for the player's altitude change.** When you drop into a nation, the rest keeps simulating; when you pop back to god, your nation keeps running on its NN/policy. "Living world that doesn't need me" is the core feel.
- **Permanence-of-self model:** immortal god as default frame; participant mode needs continuity — reincarnation (Populous), dynastic succession (CK3, most emotionally sticky), or possess-anyone (Sims/WorldBox).

### Tech notes
- Whole world keeps simulating while zoomed in → **LOD-aware headless agent loop**: full-fidelity NN near player focus, cheaper policy approximations for distant agents (DF's adventure-mode lag warning: high agent density in one spot tanks perf).
- "Play as a nation" maps cleanly to **injecting player intent as INPUTS / reward-shaping into citizen NNs**, not overriding outputs: policy = a goal/utility bias all national NNs read; possession = player temporarily supplies the action for one agent while its NN observes (echoes B&W's slap/pet as a steering/training signal).
- **Mode switching = a permission/state layer over ONE ECS world, not two codebases.** God-powers and participant-powers are two permission sets acting on the same entities, gated by current altitude. Avoids Spore's "two bolted-together games."
- One camera rig, continuous zoom crossing **altitude bands** (orbital god → regional → settlement → over-the-shoulder avatar); only the contextual action verbs change per band.
- **Optional MP** (1 god + many nation-players, per the Kingdom-Mode suggestion) reuses the same deterministic-shared-world + per-player-altitude architecture; god = a client with elevated permissions. $0-feasible, but validate NN-agent network sync cost first.

### Fun factors
- The "**god who can also become one of them**" fantasy is exactly what WorldBox players ask for — shipping it well is *inherently* desirable, not speculative.
- **Emotional swing of the zoom**: god view = powerful/detached; possess one citizen = personal/attached (CK3's whole appeal). The switch is the hook.
- **Self-imposed restraint as drama**: as a nation you face disasters your god-self could erase — choosing to "play fair" as a mortal is the tension.
- Emergent stories only autonomous agents produce (DF/RimWorld "story generators"); player co-authors, doesn't script.
- Granularity-as-playstyle multiplies perceived content from one world.

### Pitfalls
- **The Spore trap**: don't glue together shallow modes (thin RTS + thin sandbox each loses to a dedicated game). ONE deep shared sim; modes are lenses that each add depth the other can't reach.
- **Mode-exclusivity kills the pitch.** A "save & reload as a nation" flow just rebuilds DF's limitation. The differentiator is fluid in-session switching with no world reset.
- **Dual-mode onboarding is hard.** Teach ONE mode first (god, the genre-familiar one), introduce participant mode diegetically later (possess a unit). Never dump two control schemes at once (B&W's under-guided onboarding is the cautionary tale).
- **Don't let possession trivialize the sim** (invincible/omniscient avatar = no stakes). Constrain the avatar (Populous shaman is weak, limited range).
- **Performance cliff where players most want to zoom in** — big battles, busy cities = highest agent density. Budget LOD for the worst case.

---

## DOMAIN B — Great graphics as a solo dev with $0

### The thesis (confirmed): "great graphics" here is an ART-DIRECTION + RENDERING-PIPELINE problem, NOT an asset-fidelity or money problem.
The decisive constraint: **the NN sim will be CPU-bound** (every shipped mass-agent sim — Songs of Syx, Sapiens, RimWorld, Factorio, Dwarf Fortress — is bottlenecked by single-threaded CPU simulation/pathfinding/AI, *confirmed independently*). So the art style must render **almost entirely on the GPU via instancing/batching**, leaving the CPU free for brains.

→ Favors: **clean pixel / stylized-2D** (WorldBox, made in Unity) or **flat-shaded low-poly diorama** (Bad North = 3 people, Townscaper = solo, Timberborn = ~7, Against the Storm = 5). These read as "premium" *because* they're simple, and they scale to thousands of tiny agents where realistic 3D becomes unreadable noise AND crushes the frame budget.

### Three confirmed load-bearing facts
1. **Never use skinned 3D meshes for the masses.** CPU skinning can't be GPU-instanced; submitted one-by-one (~300 skinned chars → ~15fps; three.js corroborates ~200 → sub-60fps). The renderable unit MUST be an **instanced quad (2D sprite) or instanced static mesh with animation baked to a texture (VAT), animated in the vertex shader**. Instanced approaches reach ~10k–100k animated 3D chars (GPU Gems 3: ~10k @ 34fps on *2007* hardware, 160 draw calls vs 59,726) and **~1M for 2D sprites** (Unity `DrawMeshInstancedIndirect` + ComputeBuffers on a modest RX 460; practical target ~300k under 2ms).
2. **The biggest $0 "great-graphics" multiplier is rendering/lighting/post + JUICE, not asset fidelity.** Flat-colored low-poly / clean pixel art + **baked lightmaps + directional sun + 2–3 indirect bounces + bloom + AO + warm-highlight/cool-shadow color grading + depth haze** reads as premium. Then **juice**: screenshake, ~0.1–0.2s hit-pause, particles, camera lerp, squash/stretch, knockback (Vlambeer "Art of Screenshake," Purho/Jonasson "Juice It or Lose It," Swink's *Game Feel*, arXiv 2208.06155 on impact feel). *Caveat (Wayline): juice can mask — not fix — broken core mechanics, and over-juicing harms readability at thousands-of-agents scale.*
3. **Resolve graphics-vs-mechanics by pushing ALL rendering to the GPU.** Graphics work that runs on the CPU (skinning, per-entity logic-side culling/sorting) directly steals from the NN budget; GPU work (shaders, post, instancing) is nearly free against it. *Caveat: rendering is never fully free — even CPU-bound Songs of Syx still forces players to lower Shadow Quality / Unit Detail in late-game megacities. GPU offload widens headroom, doesn't eliminate the competition.*

### Engine-specific rendering paths (all $0)
- **Unity 2D**: `Graphics.DrawMeshInstancedIndirect` + ComputeBuffers (transform/UV/color) → ~1M sprites @60fps. Bottlenecks: per-frame `SetBuffer` upload + overdraw → keep sprites small, frustum-cull, re-upload only changed data.
- **Godot**: `MultiMesh` draws thousands–millions cheaply. ⚠ 2D MultiMesh has NO depth culling (full overdraw of everything on screen); **3D MultiMesh + depth buffer + alpha-clip is far faster** — consider a 3D-billboard agent layer even for a 2D look. Drive `RenderingServer` directly for thousands of constantly-updated instances.
- **Bevy / WebGPU ($0 web path)**: auto-batches identical mesh+material (160k quads → 160 draw calls, ~3× fps), GPU-driven rendering + frustum culling, runs in Chrome 113+. Rust ECS pairs naturally with CPU-side NN agents.

### Free art pipeline
- **Kenney.nl** — 40k–60k+ **CC0** assets (2D, 3D low-poly, audio, fonts), one coherent style, unlimited commercial use, no attribution. **Cohesion > fidelity** for perceived quality — it's what makes a solo dev look like a studio.
- **Blender** (free, stylized low-poly), **MagicaVoxel** (free voxel editor, exports OBJ/PLY/VOX, no royalties; Teardown is the advanced reference).
- **Free stylized shaders**: Gerstner-wave water + Voronoi-noise foam + depth masking (Boujie Water Shader, godotshaders.com, ameye.dev); biome blending via vertex-colors/splatmaps; day/night + seasons via **global palette/color-grade swaps** (cheap, high "living world" payoff).
- **Procedural geometry w/ near-zero hand-art**: Townscaper-style irregular quad grid (relaxed hex) + Wave Function Collapse + marching squares/cubes (values on vertices).
- **AI art**: usable ONLY as a heavily hand-edited base — **fully-AI output gets NO US copyright** (US Copyright Office Jan 2025 + Thaler v. Perlmutter, Mar 2025; anyone can legally copy it) and style consistency drifts. Verify model license (SDXL/SD1.5 RAIL-M ok; SD3.5 community license free under $1M rev; some fine-tunes non-commercial).

### Design lessons
- **Choose the art style FOR the agent count, not the reverse.** Lock art-direction + readability rules (1–5 hues, strong value contrast, distinct silhouettes) BEFORE building the agent renderer — retrofitting silhouette/palette is the most expensive fix in stylized production.
- **Top-down / isometric stylized = the unifier for the dual-mode pillar**: ONE asset set serves both the god whole-world view and the participant close-up across two zoom levels. The camera lerp between them is itself a "graphics" feature players feel.
- **God-power VFX** (lightning, fire, meteors, floods, terrain destruction) = particle/shader spectacle that looks AAA for ~$0 and IS the WorldBox dopamine loop → highest-ROI graphics investment.
- **Whole-world "alive" aesthetics** (day/night, seasons, weather) = cheap palette/shader swaps, disproportionately sell "living world."
- **Build the agent layer on instancing from day one** — one GameObject/node/draw-call per agent is death by draw calls; can't be retrofitted.
- Color-code factions so the macro view (war fronts, migrations as moving color masses) is beautiful for free — graphics the simulation generates itself.

---

## Cross-cutting takeaways for the design brief
1. **The pillar is real and unmet** — WorldBox players are begging to "play as a kingdom"; the depth-paired god↔participant combo in a living NN world is the differentiator.
2. **Indirect steering + optional possession** is the answer to "play as a nation of autonomous NNs" — proven 4 ways, never puppeteer.
3. **Art direction is dictated by the CPU-bound sim**: stylized (clean 2D or flat low-poly), top-down/iso, GPU-instanced agent layer, NO skinned meshes. This satisfies "great graphics" AND protects the "mechanics matter hardcore" budget simultaneously.
4. **"Great graphics" on $0 = lighting + post + juice + cohesion + god-power VFX**, not fidelity. Lock readability rules first.
