# AEON — Conflict & Combat Design

drlor: "think about conflicts and combat mechanics too." Current combat is a stub
(bump → strength compare → loot/damage). This is the full model. Conflict must be a
CONSEQUENCE of the world (resources, borders, beliefs) and must be something the NN
brains learn to do well — aggressive lineages win wars and propagate; in peace, traders
and farmers out-breed warriors. War should produce stories, not just attrition.

---

## 1. Three levels of conflict (one shared combat core)
1. **Individual** — creature vs creature / creature vs animal. The atomic fight.
2. **Battle** — group vs group where armies meet; numbers, morale, leaders, terrain decide it.
3. **War** — nation vs nation (the strategic layer: `warPressure`, war goals, fronts, sieges,
   peace). War SETS who is hostile; battles/individual fights RESOLVE it.

## 2. Why fights start (triggers — never random)
- **Resource competition** — a depleted/contested node → raid the neighbor who has it.
- **Territory** — overlapping borders / crowding (need land).
- **War declared** (diplomacy) — then enemy nation's units are valid targets.
- **Predation** — hunters vs prey; wild predators vs people/livestock.
- **Ideology** — religion/culture clash raises hostility.
- **Internal strife** — famine/overcrowding/oppressive policy → rebellion or tribe FISSION
  (a splinter breaks away — also our diversity fix).
All feed (or are gated by) `diplomacy.warPressure` from GAME_RULES.md §2.

## 3. Combat stats & resolution (per fighter)
- **Attack power** = size × trait(aggression) × `caps.combat` (tech+metal) × weaponTier × roleMul
  (soldier > civilian) × terrainMod (high ground/cover) × (numbers/flank bonus).
- **Defense** = armorTier (metals) + wall bonus (in a defended settlement) + terrainMod + health.
- **HP model** (replaces instant loot): fighters have HP; a strike deals `max(0, atk − def)` damage;
  death at 0 HP. Lets battles last, wounds accumulate, retreat matter.
- **Morale** — drops with losses, being outnumbered, low health, a leader's death. Below a threshold
  the unit **ROUTS** (flees, can't fight) → routs cascade → decisive battles, not fights-to-the-last.
- **Ranged vs melee** — ranged (tech) strikes first/at distance (kiting); melee must close. Walls/
  shields counter ranged.

## 4. Weapons & armor tiers (tech × resources × smithy — "build up to it")
A tier activates only with TECH + REFINED RESOURCE + a smithy (ties to MECHANICS §3):
```
Fists/claws → Stone weapons (StoneTools) → Bronze (Bronzeworking + copper&tin)
→ Iron/Steel (IronWorking + iron&coal) → Gunpowder arms (Gunpowder + saltpeter)
→ Rifles/artillery (Industrialization) → armored vehicles/aircraft (Vehicles system)
Armor parallels it: hide → bronze → iron/steel plate → kevlar/composite.
```
`caps.combat` already scaffolds this; combat.js refines it into discrete weapon/armor tiers a
nation fields once it has the tech + the metal in its stockpile.

## 5. Battle dynamics (group level)
- **Numbers & flanking** — local outnumbering and attacks from multiple sides multiply damage.
- **Leaders/generals** — a high-fitness/role=leader unit buffs nearby kin (morale + attack); killing
  it can rout the army. Emergent "heroes" (named, high-lineage) become war stories.
- **Formations (light)** — soldiers cluster/hold a line near a rally point; civilians stay back/flee.
- **Siege** — attacking a settlement: walls give big defense; attackers must grind walls down or
  starve it (cut supply). Outcome: **raze** (destroy, max grievance) or **capture** (flip settlement +
  territory + stockpile to the victor — conquest, the Domination path).
- **Terrain** — forests = cover (−ranged), hills = +attack/defense, rivers/coasts = choke points.

## 6. How the NN brains fight (it's learned + evolved, not scripted)
Combat actions widen in the Cognition pass (MECHANICS §6 / brain I/O):
- senses: nearest foe dir/strength, foe density, own HP/morale, kin nearby, am-I-soldier, at-war?,
  near-wall/home, leader-alive.
- actions: attack(target-bias: weakest/nearest/threat-to-kin), flee (morale), hold-the-line, call-for-
  help (signal → rally kin), guard-settlement.
- Selection: lineages whose brains fight/flee/coordinate well survive wars and propagate; pacifist
  lineages thrive in peace and collapse under invasion. War literally shapes evolution.

## 7. Consequences (the cycle that generates history)
- Casualties → **grievance** (diplomacy) → future wars (feud cycles).
- Loot/conquest → resources, territory, captured settlements (or razed ruins).
- Refugees → survivors flee to allies / found new tribes (migration + fission).
- Heroes & massacres → named events in the log (the shareable WorldBox-style stories).

## 8. Non-war conflict
- **Hunting** — hunters vs animals for food (combat core, prey flees, predators fight back).
- **Raids** — short hostile incursions below full war (steal stockpile, then leave).
- **Rebellion** — oppressed/starving population turns on its own nation (internal combat → fission).
- **Duels/feuds** — individual grudges (kin-revenge) within or across tribes.

## 9. Build plan (a later wave — depends on roles + diplomacy + tech-weapons)
New `sim/combat.js` (HP, morale, weapon/armor tiers, battle resolution, siege) replacing the inline
attack stub; reads `diplomacy.atWar`/stance, `tribe.caps`/stockpile (weapon tier), agent role; writes
casualties→grievance. Wire into sim senseThinkAct (attack/flee/hold) + new brain I/O. Renderer adds
battle FX (clashes, routs, sieges). Sequenced AFTER: playability (diplomacy/governance) → economy
(roles/stockpiles/resources) — so combat has nations, soldiers, and weapons to work with.
