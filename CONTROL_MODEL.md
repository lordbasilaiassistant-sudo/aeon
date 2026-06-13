# AEON — Control Model: Legislator, not Puppeteer

_North-star (drlor, 2026-06-13): "Think of the player as the one who sets laws and rules the AI must
follow — not controlling their actions. If they get out of line they go to jail / get fined. Other
nations start wars on their own. If no human controls a nation, control goes to a DIFFERENT type of
AI that runs it like I would — it has its own training / nets / params." Tracked as issue #10._

## The two AI layers (this is the architecture)
AEON has **two distinct kinds of mind**, not one:

1. **Citizen layer — per-agent evolving survival NNs.** Every creature is its own tiny neural net
   that mutates and evolves across generations (the existing brains; the "Free Guy" individuals, #7).
   They live their own lives: forage, breed, gather, fight, worship — and **can break the law.**

2. **Leader layer — a per-nation LEADER AI (separate net / params).** A *different type* of AI that
   rules a nation the way a human ruler would: sets laws, policy, diplomacy, war, economy. It is NOT
   one of the citizen brains — different training, different inputs/outputs, different parameters.

**The player slots into the LEADER layer.** When a human leads a nation, the human IS its leader AI.
When no human is there, the leader AI takes over and **runs it like the player would.** Human and
leader-AI are interchangeable at this layer — the existing symmetric GovernanceAPI, now with a real
distinct brain behind the AI side.

> Leader-AI versions: **v0 = the heuristic auto-ruler** (today's `aiTurn` / the new `autopilotTurn`,
> wired in #8). **v1 = a trained leader net** with its own params, learning to rule. v0 ships now;
> v1 is the research arc.

## The player rules by LAW, not by hand
You do **not** puppeteer citizens. You **legislate** — set the rules of the society — and the
NN-driven citizens live within (or around) them. This is what makes the per-agent brains matter at
civ scale: laws reshape their incentives, and they **evolve to comply or to evade.**

- **Laws / edicts the leader sets** (examples): no violence within borders, taxation/tribute level,
  conscription (draft into the army), open vs closed borders, state religion, property/theft rules,
  rationing, work mandates. (Policies = emphasis dials; laws = hard rules with consequences.)
- **Enforcement / justice:** citizens who break the law face **jail, fines, or fees** (and worse for
  worse crimes). Enforcement is a real loop: detect violation → punish → the punishment is a *signal*
  the citizen's brain senses, so over generations a people learns the law (or learns to dodge it).
- **Crime exists:** because citizens are real minds, some will steal, dodge tax, desert, or turn
  violent — emergent, not scripted. The justice system is how a ruler channels that.

## The world runs itself (autonomy)
Other nations are run by their own leader-AIs and **act on their own** — they form alliances, trade,
and **start wars themselves** based on their leader's reading of the board (pressure, grievance,
opportunity). The player is one ruler among many autonomous rulers, not the world's puppeteer.

## How this reshapes current work
- **#8 (survival / fail-state):** the "autopilot when the player is passive" IS the leader-AI v0 —
  exactly this model. Default the player's nation to leader-AI control; it stands down when the human
  legislates/acts. A nation is never unmanaged. (Validates the #8 direction.)
- **#7 (living agents):** laws + enforcement are the bridge from citizen inner life to civ behavior —
  a citizen senses laws + punishment and weighs them against hunger/fear/greed.
- **Verbs:** keep high-level leader actions (declare war, set war goals, found cities, conscript,
  legislate, judge); de-emphasize per-unit micromanagement. Direct army command stays for wartime,
  but the SOUL of play is ruling, not clicking units.
- **Governance / ARCHITECTURE:** formalizes the GovernanceAPI as the leader-layer interface and adds
  a **Law/Justice system** (coremech + statecraft) + a **leader-AI** (a new brain, cognition/statecraft).

## Build order (after the current 3D + #8 wave)
1. Leader-AI v0 as the explicit auto-ruler for every un-played nation (extends #8 autopilot).
2. A first LAW the player can set + an ENFORCEMENT loop (e.g. "no raiding kin" → fines) so citizens
   sense + respond to it. Prove the loop end-to-end headlessly.
3. Expand the law set + crime types + justice (jail/fines/fees), surfaced legibly per the design law
   ([[feedback-balance-and-ux]]).
4. Leader-AI v1: a trained nation-leader net with its own params (the research arc).

Pairs with [[project-aeon-vision]] (Free Guy citizens), ECONOMY_DESIGN.md (#6, taxes/upkeep are laws
with teeth), and the symmetric GovernanceAPI in ARCHITECTURE.md.
