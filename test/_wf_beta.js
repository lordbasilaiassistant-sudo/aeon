export const meta = {
  name: 'aeon-beta-gamers',
  description: 'Expert-gamer subagents beta-test AEON and report why it is not a game yet + prioritized fixes',
  phases: [
    { title: 'Playtest', detail: '4 expert gamers probe the real game' },
    { title: 'Synthesize', detail: 'write BETA_REPORT.md — prioritized fix list' },
  ],
}

const ROOT = 'C:\\Users\\drlor\\OneDrive\\Desktop\\WorldBoxGame'

const RET = {
  type: 'object',
  required: ['plays_as_game', 'what_works', 'whats_broken', 'whats_missing', 'top_fixes'],
  properties: {
    plays_as_game: { type: 'number', description: '0-10: how much it currently FEELS like a playable game in your lens' },
    what_works: { type: 'array', items: { type: 'string' } },
    whats_broken: { type: 'array', items: { type: 'string' }, description: 'things that exist but fail / feel wrong (with evidence)' },
    whats_missing: { type: 'array', items: { type: 'string' }, description: 'absent things a real game in this genre needs' },
    top_fixes: { type: 'array', items: { type: 'object', required: ['fix', 'why', 'impact'], properties: {
      fix: { type: 'string' }, why: { type: 'string' }, impact: { type: 'string', description: 'high/med/low toward feeling like a game' } } } },
  },
}

const PRE = [
  'You are a VETERAN strategy gamer (Civ 6, WorldBox, Crusader Kings, Total War) doing a brutal beta-test',
  'of AEON, an in-browser god-game/civ-sim where every creature is a tiny evolving neural net. Project root:',
  ROOT,
  '',
  'How to actually playtest (you have Bash + node):',
  '- The sim is plain ES modules. Boot it headless and PLAY via the API. Example:',
  '    node --input-type=module -e \'import {Sim} from "' + ROOT.replace(/\\/g, '/') + '/src/sim/sim.js"; const s=new Sim({w:200,h:130,seed:7,cap:1500}); const me=s.createPlayerPeople({name:"Me",traits:["martial"]}); /* now try player actions */ console.log(...)\'',
  '- Player/AI actions live on s.governance (setPolicy, prioritizeTech, marchArmy, declareWar, makePeace,',
  '  proposeAlliance, proposeTrade, foundSettlement, setDestiny) and s.diplomacy. Cities are s.settlements',
  '  (each has .focus you can set). Step time with s.step() in a loop.',
  '- READ the real player-control surface: ' + ROOT + '\\src\\game\\ui.js, game.js, governance.js — what can a',
  '  HUMAN actually click/do? Is it discoverable? Does the action have a visible, meaningful effect?',
  '- READ the design intent: ' + ROOT + '\\GOAL.md, GAMEPLAY_FLOW.md, GAME_RULES.md (skim).',
  '',
  'The user\'s verdict (take it seriously): "nothing feels like a game. cant move units, cant do proper',
  'building and dev, cant attack another nation." Verify this concretely. Be a harsh, specific expert —',
  'cite what you tried and what happened. Rate plays_as_game honestly (likely low). Your output drives fixes.',
].join('\n')

phase('Playtest')
const LENSES = [
  { key: 'military', prompt: [PRE, '',
    'YOUR LENS: MILITARY / WARFARE. Try to wage a war as a player would. Concretely test:',
    '- Can I MOVE/COMMAND units or an army to a place I choose? (try governance.marchArmy; do soldiers go?)',
    '- Can I ATTACK another nation — declare war and actually take their land/city? (declareWar, then step;',
    '  does combat happen, does territory.js conquest fire, does a city change hands?)',
    '- Is combat readable/controllable, or just autonomous blobs colliding? Can I pick targets, retreat, defend?',
    '- What would a Total War / Civ player NEED to feel in command of a military? List what is missing.',
    'Run node probes to confirm. Report works/broken/missing + top fixes (ordered by impact).',
  ].join('\n') },
  { key: 'citybuilder', prompt: [PRE, '',
    'YOUR LENS: CITY-BUILDING / DEVELOPMENT / ECONOMY. Try to build and develop as a player. Test:',
    '- Can I FOUND a city where I want, and choose what it BUILDS/does? (settlement.focus, foundSettlement)',
    '- Does development feel meaningful — production choices, tradeoffs, growth I control? Or does it just happen?',
    '- Economy: resources, stockpile, refine, trade — can I run an economy with real decisions? (proposeTrade)',
    '- What does a Civ city-builder NEED (build queues, districts/buildings I choose, tile improvements, etc.)',
    '  that is missing here? Run node probes; report works/broken/missing + top fixes.',
  ].join('\n') },
  { key: 'strategy-ux', prompt: [PRE, '',
    'YOUR LENS: 4X STRATEGY LOOP + UX/CONTROLS + PACING + ONBOARDING. Assess:',
    '- Is there a "one more turn" loop — escalating, meaningful decisions each beat? Or is it watch-and-wait?',
    '- The player CONTROL SURFACE (read ui.js/game.js): what can a human actually do, and is it discoverable',
    '  and responsive? Does each action give clear feedback? Could a newcomer learn it (no tutorial exists)?',
    '- Pacing/speed, camera, selection, information (can I see what I need to decide?).',
    '- What is the SINGLE biggest reason it does not yet feel like a strategy game? Report works/broken/missing + top fixes.',
  ].join('\n') },
  { key: 'brutal', prompt: [PRE, '',
    'YOUR LENS: COLD FIRST-TIME PLAYER — "is this even a game?" No charity. Boot it, try to play, and judge:',
    '- In 5 minutes, can I form a goal, take actions toward it, face opposition, and win/lose? If not, why not?',
    '- List the TOP 5 reasons it currently reads as a tech-demo / screensaver rather than a game.',
    '- Then: the smallest set of changes that would flip it into "actually a game you play." Be concrete and',
    '  ruthless about priority. Report works/broken/missing + top fixes (this lens carries the most weight).',
  ].join('\n') },
]

const results = await parallel(LENSES.map((l) => () =>
  agent(l.prompt, { label: 'beta:' + l.key, phase: 'Playtest', schema: RET, agentType: 'general-purpose' })
    .then((r) => ({ key: l.key, ...(r || {}) }))
))

phase('Synthesize')
const digest = results.filter(Boolean).map((r) =>
  '### ' + r.key + ' — plays_as_game ' + r.plays_as_game + '/10\nBROKEN: ' + (r.whats_broken || []).join(' | ') +
  '\nMISSING: ' + (r.whats_missing || []).join(' | ') +
  '\nTOP FIXES: ' + (r.top_fixes || []).map((f) => '[' + f.impact + '] ' + f.fix).join(' ; ')
).join('\n\n')

const synth = await agent([
  'You are AEON\'s lead designer. Four veteran gamers beta-tested it (below). The user says it does not feel',
  'like a game (can\'t move units, build/develop, or attack nations). WRITE ' + ROOT + '\\BETA_REPORT.md (Write tool):',
  'a brutal, honest assessment + a SINGLE prioritized fix list ordered by impact toward "actually a playable',
  'game like Civ 6." Group fixes into (A) make it controllable now, (B) make decisions meaningful, (C) polish.',
  'Be concrete and implementable (name the file/system for each fix). After writing, return the ordered top-10',
  'fix list as your summary.',
  '',
  digest,
].join('\n'), { label: 'synthesize', phase: 'Synthesize', agentType: 'general-purpose' })

return { lenses: results.filter(Boolean).map((r) => ({ key: r.key, score: r.plays_as_game })), synthesis: synth }
