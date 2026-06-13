# AEON — The Free Guy Principle: every soul has an inner life

_North-star design (drlor, 2026-06-13): "give them feelings, hunger, community needs, personal
behaviors... we want them basically living in the city like Free Guy. We just can be a leader in
places, as survival mode." Tracked as issue #7._

## The vision
AEON's one true differentiator: **every creature already thinks with a real, evolving neural net.**
The goal is to make that FELT — each NPC is a background character with a life of their own (like the
NPCs in *Free Guy*): they get hungry, afraid, content, lonely; they have personal habits and bonds;
they pursue their own little goals. **The player is a LEADER among them (Survival mode), not a
puppeteer** — you set direction (policies, orders, found cities) and the populace lives in response.
The drama is emergent, not scripted. (Creative/god mode is the sandbox exception.)

## Inner state (per agent) — the two-layer mind, deepened
**Layer 1 — needs & feelings (survival brain, already partly here):**
- **Needs:** hunger (energy), thirst, rest/fatigue, safety, and **belonging** (social contact with
  one's people). Each has a level; unmet needs drive behavior and hurt the agent over time.
- **Emotions/mood:** an affect state DERIVED from needs + recent events — content (fed & safe),
  fear (under threat / starving), anger (attacked / rival near), grief (lost kin), joy (birth, plenty).
  Mood biases the NN's choices and is VISIBLE.
- **Personality:** genome-derived tendencies (bold/timid, social/solitary, forager/homebody,
  curious/cautious) so two well-fed agents still behave differently — watching ONE is interesting.
- **Relationships & memory:** kin and tribe bonds; light memory of recent events (who fed/attacked me,
  where food/danger was) that colors decisions.

**Layer 2 — community (culture/social):** belonging, shared language/religion/customs (already
emerging via culture/anthropology) become real social NEEDS — agents want to be near their people,
participate, and suffer when isolated (ties to the city-needs economy, issue #6, and tribe fission).

## Wire it into the NN (cognition + integrator)
- Add **senses** for inner/social state (own mood, nearest-kin direction, crowd density, belonging
  level) so the brain can act ON feelings.
- Feed needs/mood as **modulators** of existing drives (a fearful agent flees & shares less; a content
  one explores & breeds). Keep it cheap (no per-agent heavy loops) and keep evolution intact.

## Surface it (frontend + integrator) — legibility is the feature
- **Inspect an NPC** → a little "life card": mood (emoji/face + color), needs bars (hunger/thirst/
  belonging), current activity WITH A REASON ("foraging — hungry", "fleeing — afraid", "heading home"),
  closest bonds, age/generation. This is the Free Guy moment: you click a dot and meet a person.
- Subtle world tells: expression/posture, occasional thought/▴ emote, mood-tinted shading (cheap LOD).

## Player-as-leader (survival)
You lead a people, not micro-pawns: policies bias the population's feelings/behavior; orders/found are
deliberate interventions; the populace otherwise lives autonomously. Success = a thriving, content
nation; failure = starvation, fear, collapse (the fail-state work). Legible cause→effect throughout.

## Sequencing
A COGNITION-led sprint (brain.js/agent.js inner state) + FRONTEND (life-card UI) + INTEGRATOR (senses
wiring + inspector), AFTER the current verb-wiring wave. Pairs with the city-needs economy (#6). Balance
per the design law ([[feedback-balance-and-ux]]): feelings must MATTER without being punishing, and
must be readable.
