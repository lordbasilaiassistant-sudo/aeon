import { Sim } from '../src/sim/sim.js';
const log = (...a) => console.log(...a);
function sy(s, y) { for (let i = 0; i < y * 60; i++) s.step(); }

// Try MANY seeds peaceful+growth: does the player nation survive 100 years? grow cities? advance era?
log('=== SURVIVABILITY SWEEP (peaceful, breed+, 10 seeds, 100yr each) ===');
for (const seed of [1,2,3,7,11,21,42,99,123,777]) {
  const s = new Sim({ w: 200, h: 130, seed, cap: 1500 });
  const me = s.createPlayerPeople({ name: 'Me', traits: ['fertile','hardy'] });
  me.isPlayer = true;
  s.governance.setPolicy(s, me, 'aggression', -1);
  s.governance.setPolicy(s, me, 'breed', 1);
  s.governance.setPolicy(s, me, 'research', 1);
  let peakPop = 0, peakSettle = 0, peakTier = 0, peakEra = 0;
  for (let y = 0; y < 100; y++) {
    sy(s, 1);
    peakPop = Math.max(peakPop, me.members);
    peakSettle = Math.max(peakSettle, s.settleSys.countOf(me.id));
    const mt = Math.max(0, ...s.settlements.filter(st=>st.tribeId===me.id).map(st=>st.tier));
    peakTier = Math.max(peakTier, mt);
    peakEra = Math.max(peakEra, me.tech.era);
    if (me.members === 0) break;
  }
  const alive = me.members > 0;
  log(`seed ${String(seed).padStart(3)}: ${alive?'ALIVE':'DEAD '} final=${String(me.members).padStart(3)} peakPop=${String(peakPop).padStart(3)} peakSettles=${peakSettle} bestTier=${['Camp','Vil','Town','City'][peakTier]} peakEra=${peakEra} (knownTechs=${me.tech.known.size}/24)`);
}

// FOUND SETTLEMENT on the strongest case, well managed
log('\n=== FOUND-SETTLEMENT on a thriving nation (best effort) ===');
const s = new Sim({ w: 200, h: 130, seed: 42, cap: 1500 });
const me = s.createPlayerPeople({ name: 'Me', traits: ['fertile','hardy'] });
me.isPlayer = true;
s.governance.setPolicy(s, me, 'breed', 1);
s.governance.setPolicy(s, me, 'expansion', 1);
sy(s, 30);
log(`thriving check: members=${me.members} settles=${s.settleSys.countOf(me.id)}`);
if (me.members > 30) {
  // pick an empty walkable spot ~20 tiles away, away from existing settles
  let gx=Math.round(me.capitalX), gy=Math.round(me.capitalY);
  for (let r=14;r<40;r++){ const cx=Math.round(me.capitalX+r), cy=gy; if (s.world.walkable(cx,cy) && !s.settlementAt(cx,cy,8)){gx=cx;gy=cy;break;} }
  log(`ordering foundSettlement at empty [${gx},${gy}]; settles before=${s.settleSys.countOf(me.id)}`);
  s.governance.foundSettlement(s, me, gx, gy);
  sy(s, 40);
  const near = s.settlementAt(gx, gy, 12);
  log(`after 40yr: settles=${s.settleSys.countOf(me.id)}; camp near my chosen spot? ${near?`${near.name} mine=${near.tribeId===me.id} dist=${Math.round(Math.hypot(near.x-gx,near.y-gy))}`:'NONE within 12'}`);
  log(`(foundSettlement only places a rally pull; a camp forms ONLY if >=8 residents happen to cluster within CLAIM_RADIUS for a year — no deterministic placement.)`);
}

// Did ANY nation reach a City tier or advanced era in a free-running world (100yr)?
log('\n=== Does the WORLD ever build Cities / advance eras on its own? (free run 150yr, seed 7) ===');
const w = new Sim({ w: 240, h: 150, seed: 7, cap: 2600 });
sy(w, 150);
const tribes = [...w.tribes.values()].filter(t=>t.members>0);
const tiers = w.settlements.map(st=>st.tier);
const tierCount = [0,0,0,0]; tiers.forEach(t=>tierCount[t]++);
log(`year ${w.year()}: ${tribes.length} nations, ${w.settlements.length} settlements`);
log(`settlement tiers: Camp=${tierCount[0]} Village=${tierCount[1]} Town=${tierCount[2]} City=${tierCount[3]}`);
log(`highest era reached by any nation: ${Math.max(0,...tribes.map(t=>t.tech.era))} (${['Stone','Bronze','Iron','Classical','Medieval','Renais','Industrial','Modern','Info'][Math.max(0,...tribes.map(t=>t.tech.era))]})`);
log(`nations & era: ${tribes.map(t=>`${t.name}(m${t.members},e${t.tech.era})`).join(', ')}`);
