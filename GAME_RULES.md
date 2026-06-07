# AEON — Game Rules: scales, war, and the friction-free decision space

Answers drlor's three rules questions (2026-06-07):
(1) what params dictate war between players (AI or human)?
(2) how do individuals act vs the whole country?
(3) what decisions does everyone need so the world runs with NO FRICTION?

---

## 1. THE TWO SCALES — individual vs nation (and how they couple)
The game runs on two decision layers. Keeping them clean is what makes it coherent.

### Micro — the INDIVIDUAL (every agent, driven by its evolving NN)
Acts moment-to-moment on LOCAL information. It never decides grand strategy; it executes
locally, biased by its nation's "will." Per-tick decisions (NN outputs):
- **Move** — direction (toward food/water/home/away from threat).
- **Consume** — eat / drink (meet hunger & thirst).
- **Work** — gather resource / haul to settlement / build / refine (if at a workshop).
- **Social** — mate / share food / help kin / speak (spread culture) / convert.
- **Conflict** — attack THIS foe / flee.
Inputs include the NATION'S WILL (aggression/expansion/breed/research) injected as senses,
so national policy bends millions of small choices without scripting any of them.

### Macro — the NATION (run identically by HUMAN or AI via GovernanceAPI)
Slow, strategic decisions for the whole country. The human uses the UI; an AI nation uses
`aiTurn(nation)` — both call the SAME functions (symmetric). Periodic decisions:
- **Expand** — found/where to settle; migrate the people.
- **Advance** — which tech to prioritize (focuses research).
- **Govern** — set policy levers (aggression/expansion/breed/research) + edicts/laws.
- **Diplomacy** — stance toward each other nation (ally/neutral/rival/war); trade; peace.
- **Military** — rally/defend a point; pick an attack target; raze/capture.
- **Economy** — resource & refinement priorities (what to mine/build).

### The coupling loop (bottom-up emergence + top-down steering)
```
NATION decisions ──(injected as NN will + rules: "at war with X", "settle here")──▶ INDIVIDUALS
INDIVIDUALS' aggregate (pop, territory held, resources gathered, culture, battles) ──▶ enable/limit NATION options
```
A nation can't research IronWorking's payoff without citizens who mined iron; citizens fight
harder when the nation is at war and has metal tools. Neither layer puppeteers the other.

---

## 2. WHAT DICTATES WAR (between AI and/or human nations)
War is PRESSURE-driven, never random. A single legible function governs every pair of nations,
and it's the same whether the nation is human- or AI-run:
```
warPressure(A→B) =
    border_friction      // adjacency + overlapping territory claims
  + resource_need        // A lacks a strategic resource B holds (iron/oil/land)
  + crowding             // A's population exceeds its territory's carrying capacity
  + aggression_policy    // A's policy (human-set) + mean aggression trait of A's people
  + grievance(A,B)       // accumulated history: past raids, broken alliances, razed towns
  + ideology_gap         // different religion/culture → friction multiplier
  − kinship/alliance     // shared lineage, alliance, or trade ties REDUCE pressure
  × opportunity          // relative strength (tech era, metals, numbers) — attack when winnable
```
- **AI nation:** declares war when `warPressure` crosses its threshold (modulated by its
  aggression policy and a confidence check on `opportunity`).
- **Human nation:** sees the same `warPressure`/diplo state in the UI and may `declareWar`,
  `makePeace`, `proposeAlliance`, `trade` via the same levers — no special-casing.
- **War resolution:** at war, the two nations' members treat each other as foes (existing
  combat), settlements can be razed/captured, territory flips. War ENDS on: peace deal,
  exhaustion (losses/low energy), one side crushed, or pressure dropping below a floor
  (e.g. resource need met, grievance decayed).
- This makes war a CONSEQUENCE of the world state, readable and fair for human and AI alike.

---

## 3. THE FRICTION-FREE DECISION SPACE (no stuck/undefined states)
"No friction" = at every scale, every actor ALWAYS has a defined, sensible decision for any
situation. We guarantee this by enumerating the space and giving every axis a default/fallback.

### Individual — must always be able to resolve:
| Situation | Decision available | Fallback (NN ambiguous) |
|---|---|---|
| hungry/thirsty | seek+consume food/water | drift toward nearest known source |
| threatened | fight or flee (by strength sense) | flee from stronger, fight weaker |
| idle & safe & fed | work / mate / socialize / explore | wander within territory |
| at a workshop w/ resources | refine / build | contribute to nearest need |
| carrying a resource | haul to settlement | drop if endangered |
| out of territory | return / claim / forage | move toward nation capital |

### Nation — must always have a defined stance/strategy:
| Axis | Always-defined value | Default |
|---|---|---|
| stance to each other nation | ally / neutral / rival / war | neutral |
| tech focus | a prioritized next tech | cheapest available |
| expansion | settle / hold / migrate | hold if stable, settle if crowded |
| military posture | defend / raid / conquer / withdraw | defend home |
| economy | which resource/refine to prioritize | the scarcest need |
| policy levers | always have a value in [-1,1] | 0 (balanced) |

### The principle (enforced by the Integrator)
- Every NEED has at least one satisfying ACTION reachable from any state.
- Every NATION always holds a defined stance toward every other nation (default neutral).
- No deadlock states: if an actor can't act on its first choice, a fallback fires.
- Human and AI use the IDENTICAL decision set (GovernanceAPI) — so nothing a human can do
  is impossible for an AI nation, and vice-versa. That symmetry is what removes "friction"
  between the player's country and the world's countries.

---
These rules feed: DEPT 3 STATECRAFT (war/diplomacy/governance), DEPT 1 COGNITION (individual
decision senses/actions), and the Integrator (coupling + fallbacks). See ARCHITECTURE.md.
