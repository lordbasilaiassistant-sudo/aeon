# AEON — Gameplay Flow (Civ-first; two modes)

drlor 2026-06-07: "think more Civ 6 than WorldBox in terms of gameplay." + "user selects/
creates a people first, then others spawn/interact." + "two modes like Minecraft survival
vs creative — both an option." This doc locks the FLOW; CIV_GAMEPLAY.md (in research) fills
the detailed Civ mechanics.

## The two modes (chosen at the start — Minecraft analogy)
### SURVIVAL  (the primary, Civ-first experience)
- You **create/select a people** and play as that ONE nation, inside the world's rules.
- **NO god powers / NO terrain editing.** You live by what your people can do: explore, settle,
  gather, research, build, trade, do diplomacy, war — Civ-style, via the GovernanceAPI + indirect
  steering of your NN citizens (and possession of one body when you want to be hands-on).
- AI peoples spawn around you and interact with your nation (the living, evolving rivals/allies).
- You pursue an opt-in **destiny** (victory goal) or just survive and grow. The challenge is real.

### CREATIVE  (the WorldBox god sandbox)
- Full **divine hand**: raise/lower terrain, grow forests, spawn life, bless, smite — shape and
  watch the world. No win goal; pure toy + experiment. (This is today's god mode.)
- Can still drop into a nation / possess a body to observe up close, but the draw is godly control.

> The god-vs-nation tension the research flagged is resolved by SEPARATING the two into explicit
> modes (instead of one confusing blend), which also fixes the dual-mode onboarding pitfall.

## The start flow
1. **Title / mode select** — Survival or Creative (clear, one choice).
2. **Survival → Create Your People**: name, banner color, a HOMELAND (pick/seed a starting region),
   and a few **leader/heritage traits** (e.g. seafaring, hardy, fertile, martial, curious — small
   bonuses that flavor the start, Civ leader-ability style). Then the world generates with AI peoples.
3. **Survival → Play**: camera starts on your homeland; the nation HUD (policies/research/diplomacy/
   destiny) is your control surface; the world runs in real time (pause/speed available).
4. **Creative → Play**: drop straight into the god sandbox with the full tool dock.

## What changes in the build
- **Mode gating:** the god tool dock (raise/lower/forest/spawn/food/smite) is **Creative-only**.
  In Survival the dock hides; the player's surface is the nation HUD + inspect + possess + a limited
  set of *nation* actions (found settlement, rally, set policy/research/diplomacy) — all via GovernanceAPI.
- **Start screen** replaces the current "drop into god mode + optional Play as": Survival makes
  leading a nation the DEFAULT, not an afterthought.
- **Real-time-but-Civ-feel:** soft era cadence (eras = the turn-equivalent milestones), pause/speed
  as the "take your time" lever, indirect control (you set the nation's will; NN citizens act),
  possession for hands-on moments. No per-unit micro grind.

## Open (answered by the running CIV_GAMEPLAY research)
- Exact unit/role roster + attack ranges + adjacency + worker-on-tile + fatigue (drlor's questions).
- The precise Survival action set (what a nation player can do each "era"/continuously).
- How much Civ structure (cities/districts/tiles) to translate vs let emerge from the NN sim.

## Status note
Today the game opens in god/sandbox mode with "Play as" optional. The Frontend dept will add the
**mode-select + create-a-people start** and **gate god tools to Creative** (new tasks). The governance/
diplomacy/destiny layer needed for Survival is already integrated and working.
