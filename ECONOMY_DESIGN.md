# AEON — Economy Design: Costs & City Needs

_Design spec for the "not-too-easy" depth layer (drlor, 2026-06-13). Tracked as issue #6.
Implemented in the coremech sprint AFTER the verb-wiring integration wave (single-writer settlement.js)._

## Principle
Mechanics must be **neither too easy nor too hard**, and **interface/controls must make every
cost and need legible**. Cities are not plant-and-forget: founding and building **cost currencies/
resources**, and every city carries **ongoing needs** it must meet or it declines. This is the
pressure that turns a sandbox into a game with real decisions.

## Currencies & resources (mostly already in `tribe.stock` + `tribe.gold`)
`gold` (treasury) · `wood` · `stone` · `ore` → refined `metal` · `food`.

## Costs (the sinks)
| Action | Cost | Notes |
|--------|------|-------|
| Found city | gold + settler pop | **scales per city** (city N costs more) so expansion is a decision, not a reflex |
| Granary | stone + food | +food / growth (FUNC-BUILDINGS) |
| Walls | stone | +defense (feeds conquest `s.defense`) |
| Barracks | wood + metal | lets you train soldiers you control |
| Market | gold + wood | +gold |
| Library | stone + gold | +research |
| Train soldier | gold + metal | partially exists (`trainSoldier`) |

## City NEEDS (ongoing — unmet ⇒ the city suffers)
- **Food:** city food income ≥ pop, else it shrinks / starves (formalize per-city food balance; the
  founding food-magnet is the seed of this).
- **Water:** city-level water access (adjacent water or a well building); extends the agent thirst need.
- **Upkeep:** every city and unit costs gold/yr. If the treasury can't pay → unrest, then disband.
  This is the sink that makes gold income matter turn-to-turn.
- **Supply / connection:** a city disconnected from national territory is **isolated** → reduced
  output and revolt risk (hooks into TRIBE-FISSION / secession).
- **Stability:** unmet needs or overexpansion → unhappiness → revolt / secession.

## Balance knobs (target feel)
- 2–3 cities comfortable on default play; 6+ requires deliberate economy management.
- Needs create **failure pressure** (you can lose a city, even your nation) but recoverable — not punishing.
- Costs scale so the player must choose between tall (few strong cities) and wide (many needy ones).

## Interface / controls (REQUIRED — legibility is the feature)
- City inspector shows **each need** with sign + color: `food +3 / −1`, `upkeep −4g`, `water ✓`,
  `supply ✓/✗`, `stability 72%`.
- Build queue shows **costs up front**; an unaffordable item shows the **missing resource by name**
  ("need 2 stone").
- A city in trouble surfaces a **toast** ("Rondisad is starving") so the player can act.

## Dependencies
Builds on the now-working **Found** verb (#1, #2) and treasury reserve. Pairs with FUNC-BUILDINGS,
GHOST-CITY, FOUND-SUSTAIN, EMPTY-CITY-GATE from SPRINT_PLAN.md.
