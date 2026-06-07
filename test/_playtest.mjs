import { Sim } from '../src/sim/sim.js';

const log = (...a) => console.log(...a);
const ROOT = 'C:/Users/drlor/OneDrive/Desktop/WorldBoxGame';

function snapTribe(s, t) {
  return {
    name: t.name, id: t.id, members: t.members,
    cap: [Math.round(t.capitalX), Math.round(t.capitalY)],
    era: t.tech?.era ?? 0, kills: t.kills, deaths: t.deaths,
    land: s.territory ? s.territory.areaOf(t.id) : 0,
    settles: s.settleSys.countOf(t.id),
    gold: Math.round(t.gold || 0),
    policy: { ...t.policy },
  };
}
function stepYears(s, years) { for (let i = 0; i < years * 60; i++) s.step(); }

// ============ BOOT SURVIVAL ============
const s = new Sim({ w: 200, h: 130, seed: 7, cap: 1500 });
const me = s.createPlayerPeople({ name: 'Me', traits: ['martial'] });
me.isPlayer = true;
log('=== BOOT: created player people ===');
log('player:', snapTribe(s, me));
log('all tribes at boot:', [...s.tribes.values()].map(t => `${t.name}#${t.id}(${t.members})`).join(', '));

// let the world settle a bit so AI nations exist + capitals set
stepYears(s, 20);
log('\n=== after 20 yrs settling ===');
log('player:', snapTribe(s, me));
const others = [...s.tribes.values()].filter(t => t.id !== me.id && t.members > 0);
log('rivals:', others.map(t => `${t.name}#${t.id} m=${t.members} cap=[${Math.round(t.capitalX)},${Math.round(t.capitalY)}] land=${s.territory.areaOf(t.id)}`).join('\n        '));
log('neighbors of me:', (s.diplomacy.neighborsOf(s, me)||[]).map(t=>t.name+'#'+t.id).join(', ') || 'NONE in range');

// ============ TEST 1: ATTACK ANOTHER NATION ============
log('\n\n############ TEST 1: "cant attack another nation" ############');
const neigh = s.diplomacy.neighborsOf(s, me);
let target = neigh[0] || others.sort((a,b)=>{
  const da=(a.capitalX-me.capitalX)**2+(a.capitalY-me.capitalY)**2;
  const db=(b.capitalX-me.capitalX)**2+(b.capitalY-me.capitalY)**2; return da-db;
})[0];
if (!target) { log('NO TARGET EXISTS'); }
else {
  const d = Math.round(Math.hypot(target.capitalX-me.capitalX, target.capitalY-me.capitalY));
  log(`Nearest rival: ${target.name}#${target.id} at distance ${d} tiles (NEIGHBOR_RANGE=90).`);
  log(`BEFORE: me.members=${me.members} kills=${me.kills} | target.members=${target.members} land=${s.territory.areaOf(target.id)} settles=${s.settleSys.countOf(target.id)}`);
  // Player action: max aggression, declare war, march army at their capital
  s.governance.setPolicy(s, me, 'aggression', 1);
  const warOk = s.governance.declareWar(s, me, target);
  s.governance.marchArmy(s, me, target.capitalX, target.capitalY);
  log(`declareWar returned: ${warOk}; warRally set to [${me.warRally?.x},${me.warRally?.y}]`);
  // count my soldiers (role 1/2)
  s.assignRoles();
  const soldiers = s.pool.agents.filter(a=>a.alive && a.tribeId===me.id && (a.role===1||a.role===2));
  log(`my soldiers (role 1/2): ${soldiers.length} of ${me.members}`);
  // record their positions, step 30 years of war, see if they move toward target & if anything is conquered
  const beforePos = soldiers.slice(0,5).map(a=>({id:a.id, d: Math.round(Math.hypot(a.x-target.capitalX, a.y-target.capitalY))}));
  const tgtLandBefore = s.territory.areaOf(target.id);
  const tgtMembersBefore = target.members;
  for (let y=0; y<40; y++){
    stepYears(s,1);
    if (me.members>0 && target.members>0) s.governance.marchArmy(s, me, target.capitalX, target.capitalY);
    if (target.members===0 || me.members===0) break;
  }
  log(`AFTER ~40 yrs of declared war + army marched at their capital:`);
  log(`  me.members=${me.members} kills=${me.kills}`);
  log(`  target ${target.name}: members ${tgtMembersBefore}->${target.members}, land ${tgtLandBefore}->${s.territory.areaOf(target.id)}, settles=${s.settleSys.countOf(target.id)}`);
  log(`  still at war? ${s.diplomacy.atWar(s, me, target)}`);
  // did MY territory grow into theirs? (conquest)
  log(`  my land now=${s.territory.areaOf(me.id)} (was tracked); did any enemy city change tribeId? checking settlements...`);
  const conquered = s.settlements.filter(st=>st.tribeId===me.id).length;
  log(`  settlements owned by me=${conquered}`);
}

// ============ TEST 2: MOVE UNITS / ARMY ============
log('\n\n############ TEST 2: "cant move units" ############');
{
  // Is there ANY way to move a chosen unit to a chosen tile? Test marchArmy pull strength.
  const soldiers = s.pool.agents.filter(a=>a.alive && a.tribeId===me.id && (a.role===1||a.role===2));
  if (soldiers.length===0){ log('no soldiers to test; assigning roles'); s.governance.setPolicy(s,me,'aggression',1); s.assignRoles(); }
  const army = s.pool.agents.filter(a=>a.alive && a.tribeId===me.id && (a.role===1||a.role===2));
  const tx = Math.min(s.world.w-3, me.capitalX+30), ty = me.capitalY;
  // ensure walkable target
  let gx=tx, gy=ty; for(let r=0;r<20 && !s.world.walkable(gx,gy);r++){gx=me.capitalX+10+r;}
  log(`Ordering army of ${army.length} to march to [${Math.round(gx)},${Math.round(gy)}] (a chosen empty tile, 30 tiles east).`);
  const avgBefore = army.length? army.reduce((s2,a)=>s2+Math.hypot(a.x-gx,a.y-gy),0)/army.length : 0;
  s.governance.marchArmy(s, me, gx, gy);
  for(let y=0;y<15;y++){ stepYears(s,1); s.governance.marchArmy(s, me, gx, gy); }
  const armyAfter = s.pool.agents.filter(a=>a.alive && a.tribeId===me.id && (a.role===1||a.role===2));
  const avgAfter = armyAfter.length? armyAfter.reduce((s2,a)=>s2+Math.hypot(a.x-gx,a.y-gy),0)/armyAfter.length : 0;
  log(`avg distance of soldiers to ordered point: before=${avgBefore.toFixed(1)} after 15yr=${avgAfter.toFixed(1)}`);
  log(`(Note: only role 1/2 agents respond, and only as a soft heading bias; civilians ignore it entirely.)`);

  // Possession: the ONE truly-direct control. Move a single body with controlVec.
  const body = s.pool.agents.find(a=>a.alive && a.tribeId===me.id);
  if (body){
    s.controlled = body; const bx=body.x, by=body.y;
    s.controlVec.x=1; s.controlVec.y=0;
    for(let i=0;i<120;i++) s.step();
    log(`POSSESSION: drove one body east for 120 ticks: moved from [${bx.toFixed(1)},${by.toFixed(1)}] to [${body.x.toFixed(1)},${body.y.toFixed(1)}] (dx=${(body.x-bx).toFixed(1)})`);
    s.controlled=null; s.controlVec.x=0; s.controlVec.y=0;
  }
}

// ============ TEST 3: BUILDING & DEV ============
log('\n\n############ TEST 3: "cant do proper building and dev" ############');
{
  log(`Can the player PLACE a building? Searching API for any build-placement method...`);
  const govMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(s.governance));
  log(`governance methods: ${govMethods.filter(m=>m!=='constructor').join(', ')}`);
  log(`-> no placeBuilding/buildQueue/constructDistrict. "Build" = settlement.focus enum only.`);

  // Found a settlement where I choose:
  const fx = Math.min(s.world.w-3, me.capitalX+18), fy = me.capitalY+5;
  let gx=fx, gy=fy; for(let r=0;r<30 && !s.world.walkable(gx,gy);r++){gx=me.capitalX+12+r; gy=me.capitalY+5;}
  const settlesBefore = s.settleSys.countOf(me.id);
  log(`foundSettlement at chosen [${Math.round(gx)},${Math.round(gy)}]; settles before=${settlesBefore}`);
  s.governance.setPolicy(s, me, 'expansion', 1);
  s.governance.foundSettlement(s, me, gx, gy);
  log(`foundIntent=${JSON.stringify(me.foundIntent)} rally=${JSON.stringify(me.rally)}`);
  stepYears(s, 30);
  const settlesAfter = s.settleSys.countOf(me.id);
  log(`settles after 30yr=${settlesAfter}. New camp formed where I asked? checking nearest settlement to [${Math.round(gx)},${Math.round(gy)}]`);
  const near = s.settlementAt(gx, gy, 12);
  log(`nearest settlement to my chosen spot: ${near? `${near.name||'camp'} tier=${near.tier} mine=${near.tribeId===me.id} dist=${Math.round(Math.hypot(near.x-gx,near.y-gy))}`:'NONE within 12 tiles'}`);

  // City focus test: does setting focus visibly change anything?
  const myCity = s.settlements.find(st=>st.tribeId===me.id);
  if (myCity){
    log(`\nCity focus test on "${myCity.name||'camp'}" tier=${myCity.tier}:`);
    myCity.focus='military';
    const defBefore=myCity.defense||0;
    const soldiersBefore=s.pool.agents.filter(a=>a.alive&&a.tribeId===me.id&&a.role===1).length;
    stepYears(s,15);
    log(`  focus=military 15yr: defense ${defBefore}->${myCity.defense||0}, warriors ${soldiersBefore}->${s.pool.agents.filter(a=>a.alive&&a.tribeId===me.id&&a.role===1).length}, gold=${Math.round(me.gold)}`);
    myCity.focus='build';
    const def2=myCity.defense||0;
    stepYears(s,15);
    log(`  focus=build 15yr: defense ${def2}->${myCity.defense||0} (needs stone=${Math.round(me.stock.stone||0)})`);
  } else log('I have NO settlement to set focus on.');
}

// ============ TEST 4: WIN/LOSE LOOP ============
log('\n\n############ TEST 4: can I win or lose? ############');
{
  s.governance.setDestiny(s, me, 'ascendant'); // grow to 200
  const ds = s.governance.checkDestiny(s, me);
  log(`destiny set: ${ds?.name} progress=${(ds.progress*100).toFixed(0)}% done=${ds.done}`);
  log(`Is there a lose condition surfaced to player beyond extinction? (members->0 => game.ascend, toast). No defeat screen, no score.`);
  log(`player members now: ${me.members}, alive in world: ${s.activeTribes()} nations`);
}

log('\n=== FINAL WORLD ===');
log('year', s.year(), 'pop', s.population(), 'nations', s.activeTribes(), 'maxGen', s.maxGen);
