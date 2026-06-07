# AEON — Feature Bible: WorldBox × Civ VI (the target)

What we're building toward. Left = the two reference games' core features; right = how
AEON adopts/adapts each, with the twist that **nobody is scripted — civ behavior emerges
from evolving NN brains + a memetic culture layer + the player's indirect steering.**

---

## A. WorldBox — core features (the god-sandbox half)
| WorldBox feature | AEON plan |
|---|---|
| **God powers / world editor** — terrain brushes (mountain/water/biome), spawn life | ✅ have (raise/lower/forest/spawn/food/smite); EXPAND brush set |
| **Disasters** — meteor, volcano, tornado, plague, fire, acid, lightning | ➕ add as god tools (high-ROI spectacle + selection pressure) |
| **Autonomous living world** — creatures act on their own, rise & fall | ✅ core (real NN brains, not scripts) — our differentiator |
| **Civilizations** — villages→towns→cities, kingdoms, borders | 🔨 building now (Settlements workstream) |
| **War & diplomacy** — kingdoms fight, ally, raid | ➕ partial (combat exists); add alliance/raid/diplomacy |
| **Multiple species** — humans/elves/dwarves/orcs + animals + monsters | ➕ later (genome already supports subspecies via traits) |
| **Genetics / traits / subspecies / mutation** | ✅ have (evolving genome → visible traits) |
| **Culture / language / religion / clans** | 🔨 building now (Culture workstream, light first pass) |
| **Sandbox, no forced goal** — pure toy, name & follow units | ✅ god mode is pure sandbox; goals are opt-in (nation mode) |
| **Zoom, pixel art, mobile+PC, modding** | ✅ continuous zoom; 🔨 art upgrade now; modding later |

## B. Civilization VI — core features (the deep-strategy half)
| Civ VI feature | AEON plan |
|---|---|
| **4X loop** (explore/expand/exploit/exterminate) | ➕ emerges via nation mode (lead a people to grow/survive/win) |
| **Tech tree (science)** | 🔨 building now (Tech workstream — your headline ask) |
| **Civics/culture tree** (2nd progression) | ➕ fold into Culture/memetics (policies, beliefs) |
| **Eras** (Ancient→Information) + golden/dark ages | 🔨 Tech eras now; golden/dark ages later |
| **Cities + DISTRICTS + Wonders** (Civ 6 signature) | 🔨 Settlements + buildings now; wonders later |
| **Tile yields** (food/production/science/gold/faith) + Builders | ➕ add: settlements work surrounding tiles for yields |
| **Leaders w/ unique abilities + AI agendas (personalities)** | ➕ EMERGENT: a tribe's "leader" = its policy + dominant evolved traits |
| **Religion** (found/spread/theological combat) | 🔨 Culture workstream (arise + spread) |
| **Diplomacy** (alliances, city-states, grievances, casus belli) | ➕ later: tribe-to-tribe stances driven by policy + history |
| **Combat** (unit types, promotions, generals, siege) | ➕ deepen: tech/era changes weapons; settlements have walls |
| **Victory conditions** (Science/Culture/Domination/Religion/Diplo) | ➕ nation-mode "destinies" (opt-in goals) — the Civ win-loop |
| **Resources** (strategic/luxury/bonus) + trade routes | ➕ later: resources gate techs (metals→tools, horses→cavalry) |
| **Fog of war / exploration** | ➕ optional per-nation (god sees all; nation sees explored) |

---

## C. The fusion thesis (what makes AEON neither, and better)
- **WorldBox gives the toy & the spectacle; Civ gives the depth & the goals; the NN gives the soul.**
- In Civ, the tech tree is a menu you click. In AEON, **research accrues from a living population
  and its culture, and a tech you unlock changes what your creatures' brains can actually DO**
  (sailing → they cross water; horses → they move/raid faster; metals → they win fights).
- In WorldBox, civs develop on rails. In AEON, **they develop because evolved brains + spreading
  memes + your steering pushed them there.** Same god-sandbox joy, real causation underneath.

## D. "We need more depth for the NNs to learn" — the I/O expansion (integrator task)
The current brain only senses/does survival. To learn CIV behavior it needs richer affordances.
**Expand brain.js I/O (done during integration, carefully — it touches the hot path):**
- New SENSES: nearest settlement dir/dist, on-own-territory?, tribe tech-era, food in storage,
  nearest resource & type, season/temperature trend, danger level, leader/policy signal, meme-carried?
- New ACTIONS: build/contribute-to-settlement, gather (vs eat), trade with kin, flee, follow,
  adopt-meme/convert, pray (culture). 
- This gives evolution + the player something civ-relevant to optimize — beyond eat & breed.

## E. The two UX gaps you hit (priority fixes, integrator/UI pass)
1. **"No info on tools."** → every god tool gets a hover tooltip (name + what it does + hotkey),
   a one-line description in the dock, and a first-use hint. Plus a proper help/legend panel.
2. **"Can't play as a nation."** → make it impossible to miss: a **Nations list** panel (click any
   nation → "Play as" / "Watch" / "Possess a citizen"), a clear prompt on first tribe click, and
   fix click-targets so selecting a creature/nation is reliable at any zoom. Nation mode then shows
   tech/era, settlements, policies, and an opt-in destiny (goal).

---

## F. Build order (so depth lands without breaking what works)
1. **(running now, parallel)** Tech tree · Settlements · Culture · Visuals.
2. Integrate them one at a time (test after each).
3. **Brain I/O expansion** (§D) — give NNs the civ-relevant senses/actions.
4. **Nation-mode UX** (§E.2) + **tool info/help** (§E.1) — make agency & tools discoverable.
5. Disasters, victory/destinies, diplomacy, tile-yields — the remaining Civ/WorldBox depth.
6. Polish: audio, timelapse capture (shareability), perf scale (WebGL instancing).
