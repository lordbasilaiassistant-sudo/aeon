import { Sim } from '../src/sim/sim.js';
const log = (...a) => console.log(...a);
function stepYears(s, years) { for (let i = 0; i < years * 60; i++) s.step(); }

const s = new Sim({ w: 200, h: 130, seed: 11, cap: 1500 });
const me = s.createPlayerPeople({ name: 'Me', traits: ['fertile'] });
me.isPlayer = true;
// peaceful, growth-focused
s.governance.setPolicy(s, me, 'aggression', -1);
s.governance.setPolicy(s, me, 'breed', 1);
stepYears(s, 25);
log('=== healthy peaceful nation after 25yr ===');
log(`me.members=${me.members} settles=${s.settleSys.countOf(me.id)} land=${s.territory.areaOf(me.id)} cap=[${Math.round(me.capitalX)},${Math.round(me.capitalY)}]`);
log('my settlements:', s.settlements.filter(st=>st.tribeId===me.id).map(st=>`${st.name||'camp'} tier=${st.tier} focus=${st.focus} at[${Math.round(st.x)},${Math.round(st.y)}] def=${st.defense||0}`).join(' | ') || 'NONE');

// ---- POSSESSION ----
log('\n--- POSSESSION (the one direct control) ---');
const body = s.pool.agents.find(a=>a.alive && a.tribeId===me.id);
if (body){
  const bx=body.x, by=body.y;
  s.controlled=body; s.controlVec.x=1; s.controlVec.y=0;
  for(let i=0;i<120;i++) s.step();
  log(`drove a body east 120 ticks: [${bx.toFixed(1)},${by.toFixed(1)}] -> [${body.x.toFixed(1)},${body.y.toFixed(1)}] dx=${(body.x-bx).toFixed(1)} (works=${(body.x-bx)>3})`);
  s.controlled=null; s.controlVec.x=0; s.controlVec.y=0;
} else log('no body');

// ---- FOUND SETTLEMENT where I choose ----
log('\n--- FOUND A NEW SETTLEMENT at a chosen spot ---');
s.governance.setPolicy(s, me, 'expansion', 1);
let gx=Math.round(me.capitalX)+16, gy=Math.round(me.capitalY);
for(let r=0;r<40 && !s.world.walkable(gx,gy);r++){ gx=Math.round(me.capitalX)+12+r; }
const before=s.settleSys.countOf(me.id);
log(`foundSettlement at chosen walkable [${gx},${gy}] (16 east of capital). settles before=${before}`);
s.governance.foundSettlement(s, me, gx, gy);
stepYears(s, 25);
const after=s.settleSys.countOf(me.id);
const near=s.settlementAt(gx,gy,10);
log(`settles after 25yr=${after}. camp at my chosen spot? ${near?`yes-ish: ${near.name||'camp'} mine=${near.tribeId===me.id} dist=${Math.round(Math.hypot(near.x-gx,near.y-gy))}`:'NO settlement within 10 tiles of where I asked'}`);
log('all my settlements now:', s.settlements.filter(st=>st.tribeId===me.id).map(st=>`${st.name||'camp'} t${st.tier} at[${Math.round(st.x)},${Math.round(st.y)}]`).join(' | '));

// ---- CITY FOCUS effects ----
log('\n--- CITY FOCUS: does each option do something visible? ---');
const city = s.settlements.find(st=>st.tribeId===me.id);
if (city){
  for (const f of ['gold','research','build','military','growth']){
    city.focus=f;
    const g0=Math.round(me.gold), p0=Math.round(me.tech.points), d0=Math.round(city.defense||0);
    const w0=s.pool.agents.filter(a=>a.alive&&a.tribeId===me.id&&a.role===1).length;
    stepYears(s,10);
    log(`  focus=${f.padEnd(8)} 10yr -> gold ${g0}->${Math.round(me.gold)}, techPts ${p0}->${Math.round(me.tech.points)}, def ${d0}->${Math.round(city.defense||0)}, warriors ${w0}->${s.pool.agents.filter(a=>a.alive&&a.tribeId===me.id&&a.role===1).length} (stone=${Math.round(me.stock.stone||0)})`);
  }
} else log('no city to focus');

// ---- TECH / RESEARCH player choice ----
log('\n--- RESEARCH: prioritize a tech, does it get unlocked? ---');
import('../src/sim/tech.js').then(({TECHS})=>{
  const avail = s.tech.available(me);
  log(`available techs to pick: ${avail.slice(0,6).map(t=>t.name).join(', ')}${avail.length>6?'...':''}`);
  if (avail.length){
    const pick = avail.find(t=>t.name) || avail[0];
    s.governance.setPolicy(s, me, 'research', 1);
    s.governance.prioritizeTech(s, me, pick.id);
    const known0=me.tech.known.size;
    log(`prioritized "${pick.name}" (era ${pick.era}). known before=${known0}`);
    stepYears(s, 30);
    log(`known after 30yr=${me.tech.known.size}, era=${me.tech.era}, has "${pick.name}"? ${me.tech.known.has(pick.id)}`);
  }
  log('\n=== END (year '+s.year()+', me.members='+me.members+') ===');
});
