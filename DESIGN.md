# AEON — Design Brief

> A living world of evolving minds. Be the god that reshapes it; descend and play
> as one nation. Every creature thinks with a real, evolving neural network.
> Runs entirely in your browser. No servers. Open source.

This is the organizing spine of the project. It is grounded in a multi-agent
research sweep (41 agents across 11 domains, adversarially fact-checked — see
`research/`). Read this before touching code.

---

## 1. The one-line pitch (what no competitor can truthfully say)
**"Every person has a real brain that evolves across generations."**
WorldBox (the $31M+ solo-dev genre king, 96% positive) uses *scripted* agents and
explicitly refuses tech progression. The Bibites proves *evolvable per-creature NN
brains* are fun and shippable solo — but it's a petri-dish, "reads as a tech demo,
not a god-game." **The white space is the fusion: WorldBox's god-game loop + real
evolving brains + the depth WorldBox withholds (progression, permanence, agency).**

## 2. What the research VALIDATED (build with confidence)
- **The market is real and solo-dev-sized.** WorldBox: built in Unity by one person,
  ~$31.5M lifetime gross, "Overwhelmingly Positive." The Bibites: $9.99, 96% of ~200
  reviews, one dev. Both prove our two parents are commercially alive.
- **The #1 requested WorldBox feature is our core pillar.** "Play as a kingdom / control
  units" is dev-marked *Planned* with 122 comments; mods (KingBox, Super RPG) already
  ship it. We are building what the biggest audience in the genre is begging for.
- **Tiny evolved nets are cheap; LLM-per-agent is not.** Project Sid (LLM civ agents)
  broke past 1000 agents and costs money/servers. Our constraint (local-only, no
  servers) *forces the correct architecture*: tiny fixed-topology MLPs, thousands of
  them, on the player's CPU. **Validated in our own headless test: 3,200 agents all
  thinking every tick, evolving measurably (gen 16, traits shift under selection).**
- **Art direction is decided by the CPU-bound sim.** Stylized top-down (clean 2D / flat
  low-poly), GPU-instanced agent layer, NO skinned meshes. "Great graphics" on $0 =
  lighting + post + JUICE + cohesion + god-power VFX, not asset fidelity.

## 3. THE BIGGEST RISK — and our honest answer
The completeness critic's kill-finding (taken seriously, not buried):

> *Every real-NN sim that exists — Bibites, biosim4, ALIEN, Species — evolves only
> foraging/movement/metabolism. The only systems that produced civilization-scale
> emergence (Project Sid, JaxLife) used LLMs we can't afford. There is **zero precedent
> that a tiny evolved MLP can even represent a civ-level act** like "invent agriculture."
> The probable failure: ship real NNs, get Bibites-scale foraging dressed as a god-game,
> then quietly script the actual culture/tech — at which point "real evolving brain" is
> marketing veneer, not mechanical truth.*

**This is correct, and it dictates the architecture. We do NOT claim a 20-input MLP
outputs "found a religion." We use a deliberately honest TWO-LAYER mind:**

### Layer 1 — The Brain (genetic neuroevolution). *The real, evolved part.*
A per-creature MLP drives **individual life**: move, seek food/water, eat, fight, flee,
mate, share, signal. This is what neuroevolution provably does, and our test confirms
it works and visibly evolves. **No scripting. No fakery. Every creature runs its own
net every tick** — at our scale (low thousands) the "every person has a real brain"
claim is *literally true with zero LOD fakery*, which is our defensible honest edge.

### Layer 2 — The Culture (memetic, within-lifetime, socially transmitted). *Emergent, legible, NOT weight-mutation.*
Civilization (language drift, religion, tech, traditions, law) is **learned and spread
between brains within a lifetime** — exactly how it works in humans, and exactly what
weight-mutation across generations *cannot* do in watchable time. Mechanism: a small
set of **memes/techs as data tokens** that agents can acquire, mutate, and transmit on
the `speak`/contact channel; adoption is *biased by the evolved brain's drives and the
nation's policy*, so the two layers couple. Tech is **emergent-from-transmission, not a
bolted-on scripted tree** — a meme that raises survival spreads; lineages that adopt it
out-breed those that don't. This is the Layer-2 design the research said nobody specified.

**The marketing line stays true:** real evolved brains drive every creature; civilization
emerges from those brains interacting through a memetic layer. We never say the MLP
invents agriculture — we say minds spread ideas, and the fittest ideas and minds win.

### The 20-line validation test (the one the critic said was missing)
Before building Layer 2 fully: seed ONE survival-relevant meme ("farm this tile type")
into a few agents; measure whether (a) it spreads along contact networks and (b)
meme-carriers out-survive non-carriers over N generations. If yes → memetic civilization
is real and legible. If no → fix the transmission/selection coupling before scaling.
*(Layer 1's equivalent test already PASSED: traits measurably evolve under the energy
economy — see `test/headless.mjs`.)*

## 4. Selection pressure (the critic's "what selects for anything?")
A goal-free sandbox still has an **implicit fitness function: the energy economy.**
Eat or starve; breed or vanish; out-compete neighbors for food and mates. Our test
proved this drives real directional evolution (diet → predation, size up, vision down
when food is dense). For civ-relevant pressure, Layer-2 memes that raise survival create
their own selection gradient. The player (as god or nation) can also *impose* pressure —
which is the game.

## 5. The dual-agency model (god + nation + avatar)
One world, one camera, a **continuous zoom** = the bridge between modes (Total War /
Spore lesson; never "two bolted-on games" = the Spore trap).
- **God (default, high altitude):** the divine hand — reshape land, grow forests, spawn
  life, bless, smite. WorldBox's proven dopamine loop. Spectacle = particle/shader VFX.
- **Nation (zoom in, "Play as"):** lead one tribe by **indirect steering** — set its
  *will* (aggression / expansion / breed) which is injected into citizens' neural inputs.
  You steer; their evolved brains decide. Never puppeteer (that fights the NN premise and
  the performance budget). [4 proven models: avatar / delegation / policy / automation.]
- **Avatar (descend further, "Possess"):** become one creature. You supply its movement;
  its brain still senses/eats/fights. The diegetic mode-bridge — "the god enters a body."
  Constrained (mortal, can die) so embodiment has stakes.
- **The world never pauses for your altitude change.** That "living world that doesn't
  need me" is the core feel.

## 6. Honest scope — what ships, in order (the MVP the critic demanded)
- **v0.1 "World Seed" (DONE — this build):** procedural world, Layer-1 evolved brains,
  energy economy, emergent tribes, god tools, nation policy, possession, brain inspector,
  juice, day/night. Runs in-browser, no deps. *The fun + the honest "real brains" core.*
- **v0.2 "First Word":** Layer-2 memetic layer (the 20-line test, then memes/tech spread),
  language drift, lineage/genealogy view, event feed, save/load (deterministic seed).
- **v0.3 "Ages":** tech eras as meme-clusters (the WorldBox white space), permanence of
  player creations, win/destiny conditions for nation mode (Civ-style goals, opt-in).
- **v0.4 "Witness":** timelapse capture/export (shareability — the YouTube/TikTok engine),
  WebGL instanced renderer to push agent count, audio.
- **Later:** modding hooks, asymmetric multiplayer (1 god vs N nations — also a WorldBox
  feature request), Steam/itch desktop builds (Godot or Tauri wrapper) if it earns it.

## 7. Known tuning items (tracked, not yet fixed)
- **Monoculture collapse:** tribes currently merge to 1 by ~yr 60 (one out-competes all).
  Need **tribe fission** (large/diverse tribes split) for lasting civ diversity.
- **Diversity-preserving selection:** add trait trade-offs / niche pressure so herbivory,
  small bodies, high vision stay viable (avoid the single-strategy attractor).
- **Perf at high speed:** ~15-18ms/tick at 3,200 agents (smooth at 1×, throttles
  gracefully above). Scale path: SoA + WebGL instancing + optional Web Worker sim thread.

## 8. Resolved engine/strategy conflicts (from the research)
- **Topology:** FIXED-topology + weight evolution (batchable, stable, interbreedable) —
  chosen over rt-NEAT mutable topology. We trade "visible complexification" for scale +
  the ability to crossover/average any two genomes. (Conflict the critic flagged: resolved.)
- **Live vs frozen evolution:** stay LIVE (it's the pitch). We avoid degeneracy via the
  energy economy + diversity pressure (§7), not by freezing.
- **Web-first vs Unity/Steam:** WEB-first (local-only, $0, easiest install, our constraint).
  Desktop/Steam is a later wrapper, not a rewrite.
- **"Every agent has a real brain" vs LOD:** at low-thousands we run ALL brains every tick —
  the claim is true now. LOD becomes relevant only if we push to 10k+, at which point we
  keep full brains on-screen/near the player and are honest about statistical distant masses.
