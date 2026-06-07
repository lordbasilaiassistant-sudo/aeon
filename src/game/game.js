// Game controller: ties sim + render together, owns modes (god / nation),
// tools (the divine hand), nation policy, and possession (the avatar bridge).
import { Sim, TICKS_PER_YEAR } from '../sim/sim.js';
import { Camera } from '../render/camera.js';
import { Renderer } from '../render/renderer.js';
import { FX } from '../render/fx.js';

export const SPEEDS = [0, 1, 2, 3, 5];   // displayed multiplier (0 = paused)
const BASE_TPS = 6;                       // 1× = 6 sim-ticks/sec — calm, Civ-watchable

// divine-hand tools — disabled in Survival mode (you live by the world's rules)
const GOD_TOOLS = new Set(['raise', 'lower', 'forest', 'spawn', 'food', 'smite']);

export class Game {
  constructor(canvas, ui, opts = {}) {
    this.canvas = canvas;
    this.ui = ui;
    this.fx = new FX();
    this.sim = new Sim(opts);
    this.gov = this.sim.governance; // expose the GovernanceAPI to the UI (game.gov.*)
    this.world = this.sim.world;
    this.cam = new Camera(this.world, window.innerWidth, window.innerHeight);
    this.renderer = new Renderer(canvas, this.sim, this.cam, this.fx);

    this.gameMode = 'creative';   // 'survival' | 'creative' (set by start screen)
    this.mode = 'god';            // 'god' | 'nation' (camera/control altitude)
    this.tool = 'inspect';
    this.brush = 3.0;
    this.speedIdx = 1;
    this.selection = null;        // {agent} | {tribe}
    this.playerTribe = null;
    this.possessed = null;
    this.commandMode = false;     // RTS command: drag-select your units, click to order them
    this.selected = [];           // hand-selected units (your soldiers)
    this.selBox = null;           // live selection rectangle (world coords) for the renderer
    this.keys = new Set();
    this.acc = 0;                 // sim-step accumulator

    this.sim.onEvent = (e) => this.ui.toast(e);
    this.resize();
  }

  resize() {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  get speed() { return SPEEDS[this.speedIdx]; }
  cycleSpeed() { this.speedIdx = (this.speedIdx + 1) % SPEEDS.length; this.ui.setSpeed(this.speed); }
  togglePause() {
    this.speedIdx = this.speedIdx === 0 ? 1 : 0;
    this.ui.setSpeed(this.speed);
  }

  setTool(t) {
    if (this.gameMode === 'survival' && GOD_TOOLS.has(t)) return; // no divine hand in Survival
    this.tool = t;
    this.ui.setActiveTool(t);
  }

  // ---------------------------------------------------------------- start modes
  // CREATIVE: the WorldBox god sandbox — full divine hand, no win goal.
  startCreative() {
    this.gameMode = 'creative';
    document.body.classList.remove('mode-survival');
    document.body.classList.add('mode-creative');
    this.mode = 'god';
    this.setTool('inspect');
    this.speedIdx = 1; this.ui.setSpeed(this.speed);
  }

  // SURVIVAL: create the player's people and play AS that one nation — no god powers.
  startSurvival(opts) {
    const tribe = this.sim.createPlayerPeople(opts);
    this.gameMode = 'survival';
    document.body.classList.remove('mode-creative');
    document.body.classList.add('mode-survival');
    this.tool = 'inspect'; this.ui.setActiveTool('inspect');
    this.speedIdx = 1; this.ui.setSpeed(this.speed);
    this.playAsTribe(tribe);
    // SNAP the camera onto the homeland immediately (no fly-in from the corner)
    this.cam.x = this.cam.tx = tribe.capitalX;
    this.cam.y = this.cam.ty = tribe.capitalY;
    this.cam.zoom = this.cam.tzoom = 11;
    return tribe;
  }

  // ---------------------------------------------------------------- tools
  applyTool(wx, wy, dragging) {
    // (RTS command mode — drag-select & order — is handled in input.js, not here)
    // Survival forbids the divine hand; only inspect/possess act.
    if (this.gameMode === 'survival' && GOD_TOOLS.has(this.tool)) return;
    const W = this.world, S = this.sim, fx = this.fx;
    const x = Math.max(0, Math.min(W.w - 1, wx));
    const y = Math.max(0, Math.min(W.h - 1, wy));
    switch (this.tool) {
      case 'inspect': if (!dragging) this.selectAt(x, y); break;
      case 'possess': if (!dragging) this.tryPossess(x, y); break;
      case 'raise':
        W.raise(x, y, this.brush, 0.06);
        if (Math.random() < 0.5) fx.burst(x, y, '#caa', 4, 1, 18);
        break;
      case 'lower':
        W.raise(x, y, this.brush, -0.06);
        if (Math.random() < 0.5) fx.burst(x, y, '#7ac', 5, 1.2, 20);
        break;
      case 'forest':
        W.plantForest(x, y, this.brush);
        if (Math.random() < 0.6) fx.burst(x, y, '#6c4', 5, 0.8, 26);
        break;
      case 'food':
        W.blessFood(x, y, this.brush);
        if (Math.random() < 0.7) fx.burst(x, y, '#bd6', 4, 0.6, 22);
        break;
      case 'spawn':
        if (!dragging) {
          const t = S.godSpawnLife(x, y, 18);
          if (t) { fx.ring(x, y, `hsl(${t.hue},80%,70%)`, this.brush + 4, 30); fx.burst(x, y, `hsl(${t.hue},80%,70%)`, 24, 2.5, 36); fx.addShake(3); }
        }
        break;
      case 'smite': {
        const n = S.godSmite(x, y, this.brush + 1);
        fx.fullFlash(0.7, '255,255,255');
        fx.addShake(12);
        fx.ring(x, y, '#fff', this.brush + 3, 24);
        fx.burst(x, y, '#ff8844', 30, 3.2, 34);
        fx.burst(x, y, '#ffffff', 16, 4, 22);
        if (n > 0) fx.text(x, y - 2, `−${n}`, '#ff7755');
        break;
      }
    }
  }

  // ---------------------------------------------------------------- select
  // Click ANYTHING. Priority is zoom-aware (Civ-like): zoomed OUT you pick
  // settlements & nations (strategy/diplomacy); zoomed IN you pick individual
  // creatures (tactics). Context options then depend on whether it's yours.
  selectAt(wx, wy) {
    const z = this.cam.zoom;
    const tactical = z >= 7;
    const S = this.sim;
    const tryAgent = () => {
      const a = S.agentAt(wx, wy, Math.max(1.5, 8 / z));
      return a ? { agent: a, tribe: S.tribes.get(a.tribeId) } : null;
    };
    const trySettle = () => {
      const s = S.settlementAt(wx, wy, Math.max(2.5, 16 / z));
      return s ? { settlement: s, tribe: S.tribes.get(s.tribeId) } : null;
    };
    const tryLand = () => {
      const id = S.territory ? S.territory.ownerAt(wx, wy) : 0;
      const tr = id ? S.tribes.get(id) : S.tribeAt(wx, wy);
      return tr ? { tribe: tr } : null;
    };
    this.selection = tactical
      ? (tryAgent() || trySettle() || tryLand())
      : (trySettle() || tryLand() || tryAgent());
    this.renderer.selection = this.selection;
    this.ui.showInspector(this.selection, this);
  }

  // ---------------------------------------------------------------- nation
  playAsTribe(tribe) {
    if (!tribe) return;
    if (this.playerTribe) this.playerTribe.isPlayer = false;
    this.playerTribe = tribe;
    tribe.isPlayer = true;
    this.mode = 'nation';
    this.ui.setMode('nation', tribe);
    this.ui.showNationBar(tribe, this);
    this.cam.setTarget(tribe.capitalX, tribe.capitalY, Math.max(this.cam.zoom, 9));
    this.fx.text(tribe.capitalX, tribe.capitalY - 3, 'You lead them now', `hsl(${tribe.hue},80%,75%)`);
  }

  ascend() {
    // In Survival you ARE your nation — "ascend"/Esc just drops out of a possessed
    // body back to leading the nation; it never opens god mode.
    if (this.gameMode === 'survival') { this.releasePossession(); return; }
    this.releasePossession();
    if (this.playerTribe) this.playerTribe.isPlayer = false;
    this.playerTribe = null;
    this.mode = 'god';
    this.ui.setMode('god', null);
    this.ui.hideNationBar();
    this.cam.follow = null;
  }

  setPolicy(key, val) {
    if (this.playerTribe) this.gov.setPolicy(this.sim, this.playerTribe, key, val);
  }

  // ---------------------------------------------------------------- army command
  // toggle RTS command mode: drag a box to select your soldiers, click to order them
  musterArmy() {
    if (!this.playerTribe) { this.ui.toast({ type: 'info', msg: 'Lead a nation first to command its army.' }); return; }
    this.commandMode = !this.commandMode;
    if (!this.commandMode) { this.selected = []; this.selBox = null; }
    this.ui.toast({ type: 'info', msg: this.commandMode ? '⚔ Command mode: drag to select your soldiers, click to send them.' : 'Command mode off.' });
  }

  // select your own units inside a world-space rectangle (prefers soldiers)
  boxSelect(x0, y0, x1, y1) {
    if (!this.playerTribe) return;
    const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) }, hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
    const A = this.sim.pool.agents, pick = [];
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive || a.tribeId !== this.playerTribe.id) continue;
      if (a.x >= lo.x && a.x <= hi.x && a.y >= lo.y && a.y <= hi.y) pick.push(a);
    }
    // if any soldiers are in the box, command just the soldiers; else everyone caught
    const soldiers = pick.filter((a) => a.role === 1 || a.role === 2);
    this.selected = soldiers.length ? soldiers : pick;
    this.ui.toast({ type: 'info', msg: `${this.selected.length} units selected — click to move/attack.` });
  }

  // order selected units to a spot; clicking enemy land marches them in AND declares war
  issueOrder(wx, wy) {
    if (!this.selected.length) return;
    for (let i = 0; i < this.selected.length; i++) {
      const a = this.selected[i];
      if (a.alive) { a.ordered = true; a.ordX = wx; a.ordY = wy; }
    }
    const ownerId = this.sim.territory ? this.sim.territory.ownerAt(wx, wy) : 0;
    let attack = false;
    if (ownerId && this.playerTribe && ownerId !== this.playerTribe.id) {
      const foe = this.sim.tribes.get(ownerId);
      if (foe && !this.sim.diplomacy.atWar(this.sim, this.playerTribe.id, ownerId)) {
        this.gov.declareWar(this.sim, this.playerTribe, foe); attack = true;
      } else if (foe) attack = true;
    }
    this.fx.ring(wx, wy, attack ? '#ff5a44' : '#6ea8ff', 6, 26);
    this.fx.text(wx, wy, attack ? '⚔ attack' : '→ move', attack ? '#ff8a72' : '#9cc4ff');
  }

  // ---------------------------------------------------------------- possess
  tryPossess(wx, wy) {
    const a = this.sim.agentAt(wx, wy, Math.max(1.5, 8 / this.cam.zoom));
    if (a) this.possess(a);
  }

  possess(agent) {
    this.possessed = agent;
    this.sim.controlled = agent;
    this.cam.follow = agent;
    this.cam.setTarget(agent.x, agent.y, Math.max(this.cam.zoom, 16));
    // playing as a single body counts as descending into the world
    if (!this.playerTribe) {
      const tr = this.sim.tribes.get(agent.tribeId);
      if (tr) { this.playerTribe = tr; tr.isPlayer = true; this.mode = 'nation'; this.ui.setMode('nation', tr); this.ui.showNationBar(tr, this); }
    }
    this.ui.setPossession(agent, this);
    this.fx.ring(agent.x, agent.y, '#fff', 5, 24);
  }

  releasePossession() {
    if (this.possessed) this.fx.ring(this.possessed.x, this.possessed.y, '#fff', 5, 20);
    this.possessed = null;
    this.sim.controlled = null;
    this.sim.controlVec.x = 0; this.sim.controlVec.y = 0;
    this.cam.follow = null;
    this.ui.setPossession(null, this);
  }

  // ---------------------------------------------------------------- loop
  update(dtMs) {
    // possession steering from WASD/arrows
    if (this.possessed) {
      if (!this.possessed.alive) { this.fx.text(this.cam.x, this.cam.y, 'Your body has died', '#f66'); this.releasePossession(); }
      else {
        let vx = 0, vy = 0;
        if (this.keys.has('w') || this.keys.has('arrowup')) vy -= 1;
        if (this.keys.has('s') || this.keys.has('arrowdown')) vy += 1;
        if (this.keys.has('a') || this.keys.has('arrowleft')) vx -= 1;
        if (this.keys.has('d') || this.keys.has('arrowright')) vx += 1;
        this.sim.controlVec.x = vx; this.sim.controlVec.y = vy;
      }
    }

    // step sim at a PACED rate: 1× = 6 ticks/sec (calm), up to 5× = 30. Civ-like —
    // slow enough to read the world and issue orders, fast-forward when you want.
    const mult = this.speed;            // 0..5 (SPEEDS[idx])
    if (mult > 0) {
      this.acc += dtMs;
      const interval = 1000 / (mult * BASE_TPS);
      let steps = 0;
      while (this.acc >= interval && steps < 120) { this.sim.step(); this.acc -= interval; steps++; }
      if (this.acc > interval * 5) this.acc = 0; // avoid spiral of death
    }

    // keep player tribe alive reference
    if (this.playerTribe && !this.sim.tribes.has(this.playerTribe.id)) {
      this.ui.toast({ type: 'extinct', msg: `${this.playerTribe.name} has fallen`, color: this.playerTribe.hue });
      this.ascend();
    }

    // surface the army's march target + live selection to the renderer
    this.renderer.armyTarget = this.playerTribe ? this.playerTribe.warRally : null;
    this.renderer.selected = this.commandMode ? this.selected : null;
    this.renderer.selBox = this.selBox;

    this.cam.update();
    this.fx.update();
    this.renderer.render();
  }
}
