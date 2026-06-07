// HUD / DOM controller: top-bar stats, labelled tool dock (with hover tooltips),
// inspector (live brain visualizer + trait bars + lineage), a functional MENU,
// a NATIONS browser, the nation-control HUD (policies + research + diplomacy +
// destiny + live stats), a first-load onboarding hint, and the event log.
//
// Symmetric-governance UI: every macro decision the human makes here routes
// through the SAME GovernanceAPI an AI nation uses (game.gov.*), falling back to
// the direct game.* methods when statecraft isn't wired yet. The UI never
// puppeteers individuals — it sets a nation's will and lets evolved brains act.
import { N_IN, N_HID, N_OUT, W_IH, SENSE, ACT, GENE, gene } from '../sim/brain.js';
import { hueToCss } from '../sim/tribe.js';
import { TECHS } from '../sim/tech.js';

const $ = (id) => document.getElementById(id);

// Single source of truth for the god tools: icon, label, hotkey, description.
// Drives the dock labels, the hover tooltips, and the menu legend.
const TOOL_INFO = {
  inspect: { icon: '🔍', name: 'Inspect', hotkey: 'I', desc: 'Click a creature to open its brain & lineage, or a people to read the nation.' },
  raise:   { icon: '⛰', name: 'Raise Land', hotkey: 'R', desc: 'Push terrain up — build hills, mountains and land bridges. Drag to sculpt.' },
  lower:   { icon: '🌊', name: 'Lower / Water', hotkey: 'L', desc: 'Sink terrain — carve lakes, rivers and seas. Drag to flood.' },
  forest:  { icon: '🌲', name: 'Forest', hotkey: 'F', desc: 'Grow trees and greenery that foragers feed on.' },
  spawn:   { icon: '✿', name: 'Spawn Life', hotkey: 'S', desc: 'Seed a brand-new tribe of evolving minds where you click.' },
  food:    { icon: '🍒', name: 'Bless Food', hotkey: 'B', desc: 'Scatter food to help a struggling people pull through lean times.' },
  smite:   { icon: '⚡', name: 'Smite', hotkey: 'X', desc: 'Strike down everything in the blast — raw selection pressure.' },
  possess: { icon: '👁', name: 'Possess', hotkey: 'P', desc: 'Descend into a single body and walk it yourself with WASD.' },
};

const CONTROLS = [
  ['Scroll', 'zoom — one continuous space from orbit to the ground'],
  ['Drag', 'pan the world'],
  ['Space', 'pause / resume'],
  ['1 – 5', 'simulation speed'],
  ['[  ]', 'shrink / grow the tool brush'],
  ['Esc', 'release a body · ascend · close panels'],
  ['W A S D', 'move the body you possess'],
];

const STANCES = ['ally', 'neutral', 'rival', 'war'];

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), modeBadge: $('mode-badge'),
      year: $('stat-year'), pop: $('stat-pop'), gen: $('stat-gen'),
      nations: $('stat-nations'), fit: $('stat-fit'),
      speed: $('btn-speed'),
      inspector: $('inspector'), inspTitle: $('insp-title'), inspBody: $('insp-body'),
      nationBar: $('nation-bar'), nationName: $('nation-name'), nationFlag: $('nation-flag'),
      nationStats: $('nation-stats'),
      nationPolicies: $('nation-policies'),
      nationResearch: $('nation-research'), nationDiplo: $('nation-diplo'), nationDestiny: $('nation-destiny'),
      eventlog: $('eventlog'), dock: $('dock'),
      menuModal: $('menu-modal'), menuCard: $('menu-card'),
      nationsPanel: $('nations-panel'), nationsList: $('nations-list'),
      btnNations: $('btn-nations'),
    };
    this.game = null;
    this.openAgent = null;
    this.openTribe = null;
    this.nationTab = 'policies';
    this._diploSig = '';
    this._researchSig = '';
    this._natSig = '';
    this._natRows = new Map();
    this._natOpen = false;
    this._menuBuilt = false;
    this._onboardShown = false;

    // ---- inspector + ascend ----
    $('insp-close').onclick = () => this.hideInspector();
    $('nation-leave').onclick = () => this.game && this.game.ascend();
    if ($('nation-army')) $('nation-army').onclick = () => this.game && this.game.musterArmy();

    // ---- god tools: build labels, wire click + hover tooltip ----
    this._buildTooltip();
    document.querySelectorAll('.tool').forEach((btn) => {
      const info = TOOL_INFO[btn.dataset.tool];
      if (info) {
        btn.innerHTML = `<span class="tool-ico">${info.icon}</span><span class="tool-label">${info.name}</span>`;
        btn.removeAttribute('title'); // replaced by the rich tooltip
        btn.addEventListener('mouseenter', () => this._showTip(btn, info));
        btn.addEventListener('mouseleave', () => this._hideTip());
        btn.addEventListener('mousedown', () => this._hideTip());
      }
      btn.onclick = () => this.game && this.game.setTool(btn.dataset.tool);
    });

    // ---- top-bar buttons ----
    $('btn-speed').onclick = () => this.game && this.game.cycleSpeed();
    $('btn-help').onclick = () => $('modal').classList.remove('hidden');
    $('btn-menu').onclick = () => this.toggleMenu();
    if (this.el.btnNations) this.el.btnNations.onclick = () => this.toggleNations();

    // ---- nation HUD tabs ----
    document.querySelectorAll('.ntab').forEach((tb) => {
      tb.onclick = () => this.setNationTab(tb.dataset.ntab);
    });

    // ---- delegated handlers (survive list rebuilds) ----
    if (this.el.nationDiplo) this.el.nationDiplo.addEventListener('click', (e) => this._onDiploClick(e));
    if (this.el.nationsList) this.el.nationsList.addEventListener('click', (e) => this._onNationsClick(e));

    // ---- menu modal ----
    if (this.el.menuModal) {
      this.el.menuModal.addEventListener('click', (e) => { if (e.target === this.el.menuModal) this.closeMenu(); });
    }
    if ($('nations-close')) $('nations-close').onclick = () => this.closeNations();

    this._buildMenu();
  }

  bind(game) { this.game = game; }

  // ---- governance helpers (the symmetric API; degrade gracefully) ---------
  _gov(method) {
    const g = this.game && this.game.gov;
    return (g && typeof g[method] === 'function') ? g : null;
  }
  _sim() { return this.game ? this.game.sim : null; }

  setSpeed(speed) {
    this.el.speed.textContent = speed === 0 ? '⏸ paused' : `▶ ${speed}×`;
    this.el.speed.classList.toggle('paused', speed === 0);
    this._syncMenu();
  }

  setActiveTool(tool) {
    document.querySelectorAll('.tool').forEach((b) =>
      b.classList.toggle('active', b.dataset.tool === tool));
  }

  setMode(mode, tribe) {
    const b = this.el.modeBadge;
    if (mode === 'nation' && tribe) {
      b.textContent = 'NATION'; b.className = 'mode-badge nation';
      b.style.background = hueToCss(tribe.hue, 60, 45);
      this._dismissOnboard();
    } else {
      b.textContent = 'GOD'; b.className = 'mode-badge god'; b.style.background = '';
    }
  }

  // ---- top-bar live stats ----
  updateStats(sim) {
    this.el.year.textContent = sim.year().toLocaleString();
    this.el.pop.textContent = sim.population().toLocaleString();
    this.el.gen.textContent = sim.maxGen;
    this.el.nations.textContent = sim.activeTribes();
    this.el.fit.textContent = sim.peakFitness.toFixed(1);
    if (!this._onboardShown) this._showOnboard();
    if (this.openAgent && this.openAgent.alive) this.refreshAgentStats();
    else if (this.openAgent && !this.openAgent.alive) this.markDead();
    if (this.openTribe) this.refreshTribeStats();
    if (this.game && this.game.playerTribe) this.refreshNationBar();
    if (this._natOpen) this.refreshNationsPanel();
  }

  // ---- inspector --------------------------------------------------------
  showInspector(sel, game) {
    if (!sel) return this.hideInspector();
    this.el.inspector.classList.remove('hidden');
    if (sel.agent) this.renderAgent(sel.agent, sel.tribe, game);
    else if (sel.settlement) this.renderSettlement(sel.settlement, sel.tribe, game);
    else if (sel.tribe) this.renderTribe(sel.tribe, game);
  }

  hideInspector() {
    this.el.inspector.classList.add('hidden');
    this.openAgent = null; this.openTribe = null;
    if (this.game) { this.game.selection = null; this.game.renderer.selection = null; }
  }

  renderAgent(a, tribe, game) {
    this.openAgent = a; this.openTribe = null;
    this.el.inspTitle.textContent = a.name;
    const traits = ['size', 'speed', 'metabolism', 'fertility', 'aggression', 'vision', 'diet', 'resilience'];
    this.el.inspBody.innerHTML = `
      <div class="insp-sub" style="color:${hueToCss(tribe ? tribe.hue : a.hue)}">
        ${tribe ? esc(tribe.name) : 'feral'} · gen ${a.generation}
      </div>
      <div class="brainwrap"><canvas id="brain-cv" width="260" height="150"></canvas>
        <div class="brain-cap">its mind — blue excites, red inhibits</div></div>
      <div id="agent-vitals"></div>
      <div class="trait-head">heritable traits</div>
      <div id="agent-traits">
        ${traits.map((t) => `
          <div class="trait"><span class="trait-name">${t}</span>
          <span class="trait-bar"><i style="width:${(gene(a.genome, t === 'diet' ? 'diet' : t) * 100).toFixed(0)}%;
            background:${traitColor(t)}"></i></span></div>`).join('')}
      </div>
      <div class="insp-actions">
        <button id="act-possess">👁 Descend into this body</button>
        ${tribe ? `<button id="act-playas">⚑ Lead ${esc(tribe.name)}</button>` : ''}
      </div>`;
    this.brainCv = $('brain-cv');
    this.drawBrain(a);
    this.refreshAgentStats();
    $('act-possess').onclick = () => game.possess(a);
    const pa = $('act-playas'); if (pa) pa.onclick = () => game.playAsTribe(tribe);
  }

  refreshAgentStats() {
    const a = this.openAgent;
    const v = $('agent-vitals'); if (!v) return;
    v.innerHTML = `
      <div class="vital"><span>energy</span><span class="vbar"><i style="width:${(a.energy * 83).toFixed(0)}%;background:#e8c84a"></i></span></div>
      <div class="vital"><span>health</span><span class="vbar"><i style="width:${(a.health * 100).toFixed(0)}%;background:#5ad06a"></i></span></div>
      <div class="vital"><span>age</span><span class="vbar"><i style="width:${(a.age / a.maxAge * 100).toFixed(0)}%;background:#9aa"></i></span></div>
      <div class="vrow"><span>offspring ${a.offspring}</span><span>fitness ${a.fitness.toFixed(1)}</span></div>`;
  }

  markDead() {
    if (this.el.inspTitle) this.el.inspTitle.textContent += ' †';
    this.openAgent = null;
  }

  // Brain visualizer: input | hidden | output columns, edges colored by weight.
  drawBrain(a) {
    const cv = this.brainCv; if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const colX = [16, W / 2, W - 16];
    const g = a.genome;
    const yOf = (i, n) => (H - 12) * (i + 0.5) / n + 6;

    ctx.lineWidth = 0.6;
    for (let h = 0; h < N_HID; h++) {
      const base = h * N_IN;
      for (let i = 0; i < N_IN; i++) {
        const w = g[base + i];
        if (Math.abs(w) < 0.25) continue;
        ctx.strokeStyle = edgeColor(w);
        ctx.beginPath();
        ctx.moveTo(colX[0], yOf(i, N_IN));
        ctx.lineTo(colX[1], yOf(h, N_HID));
        ctx.stroke();
      }
    }
    for (let o = 0; o < N_OUT; o++) {
      const base = W_IH + o * N_HID;
      for (let h = 0; h < N_HID; h++) {
        const w = g[base + h];
        if (Math.abs(w) < 0.25) continue;
        ctx.strokeStyle = edgeColor(w);
        ctx.beginPath();
        ctx.moveTo(colX[1], yOf(h, N_HID));
        ctx.lineTo(colX[2], yOf(o, N_OUT));
        ctx.stroke();
      }
    }
    const node = (x, y, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); };
    for (let i = 0; i < N_IN; i++) node(colX[0], yOf(i, N_IN), '#8fd');
    for (let h = 0; h < N_HID; h++) node(colX[1], yOf(h, N_HID), '#ccd');
    for (let o = 0; o < N_OUT; o++) node(colX[2], yOf(o, N_OUT), '#fd8');
    ctx.fillStyle = '#aab'; ctx.font = '7px ui-sans-serif'; ctx.textAlign = 'right';
    for (let o = 0; o < N_OUT; o++) ctx.fillText(ACT[o], colX[2] - 5, yOf(o, N_OUT) + 2);
  }

  // ---- tribe inspector (context-aware: yours = control, foreign = diplomacy) ----
  renderTribe(tr, game) {
    this.openTribe = tr; this.openAgent = null;
    this.el.inspTitle.textContent = tr.name;
    const me = game.playerTribe;
    const isMine = me && me.id === tr.id;
    const foreign = me && !isMine;
    let actions;
    if (isMine) {
      actions = `<div class="insp-sub" style="color:${hueToCss(tr.hue)}">★ your nation</div>
        <div id="tribe-stats"></div>
        <div class="insp-actions"><button id="act-possess2">👁 Possess a citizen</button></div>`;
    } else if (foreign) {
      const st = this._stance(me, tr);
      actions = `<div class="insp-sub" style="color:${hueToCss(tr.hue)}">a rival people — <span class="stance-badge stance-${st}">${st}</span></div>
        <div id="tribe-stats"></div>
        <div class="trait-head">diplomacy</div>
        <div class="insp-diplo">
          <button class="dbtn war" data-d="war">⚔ War</button>
          <button class="dbtn peace" data-d="peace">☮ Peace</button>
          <button class="dbtn ally" data-d="ally">🤝 Ally</button>
        </div>
        <div class="trait-head">trade (gold → their goods)</div>
        <div class="insp-diplo">
          <button class="tbtn" data-buy="wood">🪵 8 · 6g</button>
          <button class="tbtn" data-buy="stone">🪨 8 · 8g</button>
          <button class="tbtn" data-buy="metal">⚒ 6 · 18g</button>
        </div>
        <div class="insp-actions"><button id="act-possess2">👁 Possess a citizen</button></div>`;
    } else {
      // no player nation yet (Creative / observing) — offer to take them
      actions = `<div class="insp-sub" style="color:${hueToCss(tr.hue)}">a nation of evolving minds</div>
        <div id="tribe-stats"></div>
        <div class="insp-actions">
          <button id="act-playas2">⚑ Play as this nation</button>
          <button id="act-possess2">👁 Possess a citizen</button>
        </div>`;
    }
    this.el.inspBody.innerHTML = actions;
    this.refreshTribeStats();
    const pa = $('act-playas2'); if (pa) pa.onclick = () => game.playAsTribe(tr);
    const po = $('act-possess2'); if (po) po.onclick = () => this._possessCitizen(tr.id);
    if (foreign) {
      this.el.inspBody.querySelectorAll('.insp-diplo .dbtn').forEach((b) => {
        b.onclick = () => {
          const sim = this._sim(); const d = b.dataset.d;
          if (d === 'war') { const g = this._gov('declareWar'); if (g) g.declareWar(sim, me, tr); }
          else if (d === 'peace') { const g = this._gov('makePeace'); if (g) g.makePeace(sim, me, tr); }
          else if (d === 'ally') { const g = this._gov('proposeAlliance'); if (g) g.proposeAlliance(sim, me, tr); }
          this.renderTribe(tr, game); // refresh stance badge
        };
      });
      const TRADES = { wood: { gold: 6, amt: 8 }, stone: { gold: 8, amt: 8 }, metal: { gold: 18, amt: 6 } };
      this.el.inspBody.querySelectorAll('.tbtn').forEach((b) => {
        b.onclick = () => {
          const g = this._gov('proposeTrade'); if (!g) return;
          const r = b.dataset.buy, deal = TRADES[r];
          const ok = g.proposeTrade(this._sim(), me, tr, { gold: deal.gold }, { [r]: deal.amt });
          this.toast({ type: ok ? 'info' : 'extinct', msg: ok ? `Bought ${deal.amt} ${r} from ${tr.name}` : `${tr.name} declines the trade` });
        };
      });
    }
  }

  // ---- settlement inspector ----
  renderSettlement(s, tr, game) {
    this.openTribe = tr || null; this.openAgent = null;
    const tier = (typeof s.tier === 'number') ? s.tier : 0;
    const tierName = ['Camp', 'Village', 'Town', 'City'][tier] || 'Settlement';
    const hue = tr ? tr.hue : 200;
    const me = game.playerTribe;
    const mine = me && tr && me.id === tr.id;
    const blds = (s.buildings || []).reduce((m, b) => { m[b.type] = (m[b.type] || 0) + 1; return m; }, {});
    const bldList = Object.keys(blds).map((k) => `${k}×${blds[k]}`).join(', ') || 'open ground';
    this.el.inspTitle.textContent = (s.name && s.name !== (tr && tr.name)) ? s.name : tierName;
    this.el.inspBody.innerHTML = `
      <div class="insp-sub" style="color:${hueToCss(hue)}">${tierName}${tr ? ' · ' + esc(tr.name) : ''}${mine ? ' ★' : ''}</div>
      <div class="vrow"><span>tier</span><span>${tierName}</span></div>
      <div class="vrow"><span>nation</span><span>${tr ? esc(tr.name) : '—'}</span></div>
      <div class="vrow"><span>era</span><span>${esc(this._eraName(tr))}</span></div>
      <div class="vrow"><span>population</span><span>${tr ? tr.members : '—'}</span></div>
      <div class="trait-head">structures</div>
      <div class="settle-blds">${esc(bldList)}</div>
      ${mine ? `<div class="trait-head">city focus — <b>${esc(s.focus || 'growth')}</b>${s.defense ? ' · walls ' + (s.defense | 0) : ''}</div>
      <div class="insp-diplo">
        <button class="fbtn" data-f="growth" title="Grow population">🌱</button>
        <button class="fbtn" data-f="build" title="Build walls / defense">🏛</button>
        <button class="fbtn" data-f="military" title="Train soldiers">⚔</button>
        <button class="fbtn" data-f="gold" title="Generate gold">🪙</button>
        <button class="fbtn" data-f="research" title="Focus research">🔬</button>
      </div>` : ''}
      <div class="insp-actions">
        ${tr ? (mine
          ? `<button id="act-focus">⚑ Lead your nation</button>`
          : (me ? `<button id="act-war2" class="dbtn war">⚔ War on ${esc(tr.name)}</button>` : `<button id="act-playas3">⚑ Play as ${esc(tr.name)}</button>`)) : ''}
      </div>`;
    const f = $('act-focus'); if (f) f.onclick = () => { game.cam.setTarget(s.x, s.y, Math.max(game.cam.zoom, 9)); this.setNationTab('policies'); };
    this.el.inspBody.querySelectorAll('.fbtn').forEach((b) => {
      b.onclick = () => { s.focus = b.dataset.f; this.renderSettlement(s, tr, game); this.toast({ type: 'info', msg: `${s.name || 'City'}: ${s.focus} focus` }); };
    });
    const pa = $('act-playas3'); if (pa) pa.onclick = () => game.playAsTribe(tr);
    const w = $('act-war2'); if (w) w.onclick = () => { const g = this._gov('declareWar'); if (g && me && tr) g.declareWar(this._sim(), me, tr); };
  }

  refreshTribeStats() {
    const tr = this.openTribe; const el = $('tribe-stats'); if (!el) return;
    const era = this._eraName(tr);
    const faith = tr.religion ? tr.religion.name : '—';
    const sim = this._sim();
    const land = (sim && sim.territory) ? sim.territory.areaOf(tr.id) : 0;
    const govt = (sim && sim.civics) ? sim.civics.governmentName(tr) : 'Chiefdom';
    const ethos = tr.ethosName && tr.ethosName !== '—' ? tr.ethosName : 'forming';
    const custom = (tr.customs && tr.customs.length) ? tr.customs[0] : '—';
    el.innerHTML = `
      <div class="vrow"><span>era</span><span>${esc(era)}</span></div>
      <div class="vrow"><span>government</span><span>${esc(govt)}</span></div>
      <div class="vrow"><span>ethos</span><span>${esc(ethos)}</span></div>
      <div class="vrow"><span>custom</span><span>${esc(custom)}</span></div>
      <div class="vrow"><span>population</span><span>${tr.members}</span></div>
      <div class="vrow"><span>territory</span><span>${land} tiles</span></div>
      <div class="vrow"><span>peak</span><span>${tr.peakMembers}</span></div>
      <div class="vrow"><span>births / deaths</span><span>${tr.births} / ${tr.deaths}</span></div>
      <div class="vrow"><span>battles won</span><span>${tr.kills}</span></div>
      <div class="vrow"><span>culture</span><span>${tr.culture.toFixed(1)}</span></div>
      <div class="vrow"><span>faith</span><span>${esc(faith)}</span></div>
      <div class="vrow"><span>founded</span><span>year ${tr.foundedYear}</span></div>`;
  }

  // ---- nation control HUD ----------------------------------------------
  showNationBar(tr, game) {
    this.el.nationBar.classList.remove('hidden');
    this.el.nationName.textContent = tr.name;
    this.el.nationFlag.style.color = hueToCss(tr.hue);
    this._diploSig = ''; this._researchSig = '';
    this.buildPolicies(tr);
    this.buildResearch(tr);
    this.buildDiplo(tr);
    this.buildDestiny(tr);
    this.setNationTab(this.nationTab);
    this.refreshNationBar();
  }

  hideNationBar() { this.el.nationBar.classList.add('hidden'); }

  setNationTab(tab) {
    this.nationTab = tab;
    document.querySelectorAll('.ntab').forEach((b) => b.classList.toggle('active', b.dataset.ntab === tab));
    document.querySelectorAll('.ntab-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== tab));
  }

  // policy sliders (incl. research focus) — routed through GovernanceAPI
  buildPolicies(tr) {
    const policies = [
      ['aggression', 'Pacifist', 'Warlike'],
      ['expansion', 'Homebound', 'Expansionist'],
      ['breed', 'Restraint', 'Grow fast'],
      ['research', 'Tradition', 'Science'],
    ];
    this.el.nationPolicies.innerHTML = policies.map(([key, lo, hi]) => {
      const v = (tr.policy && typeof tr.policy[key] === 'number') ? tr.policy[key] : 0;
      return `<div class="policy">
        <div class="policy-labels"><span>${lo}</span><span class="policy-key">${key}</span><span>${hi}</span></div>
        <input type="range" min="-1" max="1" step="0.05" value="${v}" data-key="${key}"></div>`;
    }).join('');
    this.el.nationPolicies.querySelectorAll('input').forEach((inp) => {
      inp.oninput = () => this._setPolicy(inp.dataset.key, +inp.value);
    });
  }

  _setPolicy(key, val) {
    const gov = this._gov('setPolicy');
    if (gov) gov.setPolicy(this._sim(), this.game.playerTribe, key, val);
    else this.game.setPolicy(key, val); // fallback for the 3 sim-read levers
  }

  buildResearch(tr) {
    const sim = this._sim();
    const avail = (sim && sim.tech && typeof sim.tech.available === 'function') ? sim.tech.available(tr) : [];
    this._researchSig = avail.map((d) => d.id).join(',');
    const prio = this._priority(tr);
    const opts = [`<option value="">Auto — climb the cheapest branch</option>`]
      .concat(avail.map((d) =>
        `<option value="${d.id}"${d.id === prio ? ' selected' : ''}>${esc(d.name)} · ${esc(this._eraNameOf(d.era))}</option>`))
      .join('');
    this.el.nationResearch.innerHTML = `
      <div class="nation-line" id="research-line"></div>
      <label class="pick-label">Prioritize research</label>
      <select class="picker" id="tech-pick">${opts}</select>
      <div class="pick-hint">Bias what your people study next — they still need the population and culture to afford it.</div>`;
    const sel = $('tech-pick');
    sel.onchange = () => this._setPriority(sel.value || null);
    this._refreshResearchLine(tr);
  }

  _refreshResearchLine(tr) {
    const line = $('research-line'); if (!line) return;
    const known = (tr.tech && tr.tech.known) ? tr.tech.known.size : 0;
    const pts = (tr.tech && typeof tr.tech.points === 'number') ? Math.floor(tr.tech.points) : 0;
    line.innerHTML = `<span>${esc(this._eraName(tr))}</span><span>${known} / ${TECHS.length} techs · ${pts} pts</span>`;
  }

  _priority(tr) {
    const gov = this._gov('getPriority');
    if (gov) { try { return gov.getPriority(this._sim(), tr) || ''; } catch { /* ignore */ } }
    return (tr.tech && tr.tech.priority) ? tr.tech.priority : '';
  }

  _setPriority(techId) {
    const tr = this.game.playerTribe; if (!tr) return;
    const gov = this._gov('prioritizeTech');
    if (gov) gov.prioritizeTech(this._sim(), tr, techId);
    else if (tr.tech) tr.tech.priority = techId; // forward-compatible hint for Tech/Statecraft
  }

  buildDiplo(tr) {
    const sim = this._sim();
    const others = this._otherTribes(tr);
    this._diploSig = others.map((t) => t.id).join(',');
    const govReady = !!this._gov('declareWar') || !!this._gov('setStance');
    if (!others.length) {
      this.el.nationDiplo.innerHTML = `<div class="empty-note">No other nations stir in the world — you stand alone.</div>`;
      return;
    }
    const rows = others.map((t) => {
      const st = this._stance(tr, t);
      return `<div class="diplo-row" data-tid="${t.id}">
        <span class="swatch" style="background:${hueToCss(t.hue)}"></span>
        <span class="diplo-name">${esc(t.name)}</span>
        <span class="stance-badge stance-${st}" data-stance>${st}</span>
        <span class="diplo-meta" data-meta></span>
        <span class="diplo-btns">
          <button class="dbtn war" data-act="war" data-tid="${t.id}" title="Declare war">⚔</button>
          <button class="dbtn peace" data-act="peace" data-tid="${t.id}" title="Make peace">☮</button>
          <button class="dbtn ally" data-act="ally" data-tid="${t.id}" title="Propose alliance">🤝</button>
          <button class="dbtn" data-act="neutral" data-tid="${t.id}" title="Set neutral">•</button>
        </span></div>`;
    }).join('');
    this.el.nationDiplo.innerHTML =
      (govReady ? '' : `<div class="empty-note warn">Diplomacy goes live when statecraft is online; stances shown are read-only for now.</div>`) +
      rows;
    if (!govReady) this.el.nationDiplo.querySelectorAll('.dbtn').forEach((b) => { b.disabled = true; });
    this._refreshDiplo(tr);
  }

  _refreshDiplo(tr) {
    const sim = this._sim();
    this.el.nationDiplo.querySelectorAll('.diplo-row').forEach((row) => {
      const t = sim && sim.tribes ? sim.tribes.get(+row.dataset.tid) : null;
      if (!t) return;
      const st = this._stance(tr, t);
      const badge = row.querySelector('[data-stance]');
      if (badge) { badge.textContent = st; badge.className = `stance-badge stance-${st}`; }
      const meta = row.querySelector('[data-meta]');
      if (meta) {
        const wp = this._warPressure(t, tr); // pressure THEY feel toward us
        meta.textContent = (wp != null) ? `risk ${wp.toFixed(0)}` : `${t.members}`;
      }
    });
  }

  _onDiploClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const sim = this._sim();
    const me = this.game.playerTribe;
    const other = sim && sim.tribes ? sim.tribes.get(+btn.dataset.tid) : null;
    if (!me || !other) return;
    const act = btn.dataset.act;
    if (act === 'war') { const g = this._gov('declareWar'); if (g) g.declareWar(sim, me, other); }
    else if (act === 'peace') { const g = this._gov('makePeace'); if (g) g.makePeace(sim, me, other); }
    else if (act === 'ally') { const g = this._gov('proposeAlliance'); if (g) g.proposeAlliance(sim, me, other); }
    else if (act === 'neutral') { const g = this._gov('setStance'); if (g) g.setStance(sim, me, other, 'neutral'); }
    this._refreshDiplo(me);
  }

  buildDestiny(tr) {
    const list = this._destinies();
    if (!list.length) {
      this.el.nationDestiny.innerHTML = `<div class="empty-note">Destinies (opt-in win goals) activate when statecraft is online.</div>`;
      return;
    }
    const chosen = this._chosenDestiny(tr);
    const opts = [`<option value="">No destiny — just live</option>`]
      .concat(list.map((d) => `<option value="${d.id}"${d.id === chosen ? ' selected' : ''}>${esc(d.name)}</option>`))
      .join('');
    this.el.nationDestiny.innerHTML = `
      <label class="pick-label">Chosen destiny</label>
      <select class="picker" id="destiny-pick">${opts}</select>
      <div class="pick-hint" id="destiny-desc"></div>
      <div class="destiny-prog"><span class="destiny-bar"><i id="destiny-bar"></i></span><span id="destiny-pct">—</span></div>`;
    const sel = $('destiny-pick');
    sel.onchange = () => {
      const g = this._gov('setDestiny');
      if (g) g.setDestiny(this._sim(), this.game.playerTribe, sel.value || null);
      this._refreshDestiny(this.game.playerTribe);
    };
    this._refreshDestiny(tr);
  }

  _refreshDestiny(tr) {
    const sel = $('destiny-pick'); if (!sel) return;
    const def = this._destinies().find((d) => d.id === (sel.value || this._chosenDestiny(tr)));
    const desc = $('destiny-desc'), bar = $('destiny-bar'), pct = $('destiny-pct');
    if (!def) {
      if (desc) desc.textContent = 'Pick a long-game goal to chase — or none, and simply endure.';
      if (bar) bar.style.width = '0%';
      if (pct) pct.textContent = '—';
      return;
    }
    const p = this._destinyProgress(def, tr);
    const done = this._destinyDone(def, tr);
    if (desc) desc.textContent = def.desc || '';
    if (bar) bar.style.width = `${(p * 100).toFixed(0)}%`;
    if (pct) pct.textContent = done ? '✓ fulfilled' : `${(p * 100).toFixed(0)}%`;
  }

  // live header + stats + tab refresh while leading
  refreshNationBar() {
    const tr = this.game.playerTribe; if (!tr) return;
    this.el.nationName.textContent = `${tr.name} — ${tr.members} souls`;
    // stats line
    const settle = this._settlementCount(tr.id);
    const faith = tr.religion ? tr.religion.name : 'none';
    const st = tr.stock || { wood: 0, stone: 0, ore: 0 };
    const sim = this._sim();
    const govt = (sim && sim.civics) ? sim.civics.governmentName(tr) : 'Chiefdom';
    this.el.nationStats.innerHTML = `
      <span class="nstat">${esc(this._eraName(tr))}</span>
      <span class="nstat" title="government">⚖ ${esc(govt)}</span>
      <span class="nstat">◉ ${tr.members}</span>
      <span class="nstat">⌂ ${settle}</span>
      <span class="nstat" title="wood">🪵 ${st.wood | 0}</span>
      <span class="nstat" title="stone">🪨 ${st.stone | 0}</span>
      <span class="nstat" title="ore">⛏ ${st.ore | 0}</span>
      <span class="nstat" title="refined metal">⚒ ${st.metal | 0}</span>
      <span class="nstat">✦ ${faith === 'none' ? 'no faith' : esc(faith)}</span>`;
    // rebuild lists only when their membership/availability actually changed
    const others = this._otherTribes(tr);
    const dsig = others.map((t) => t.id).join(',');
    if (dsig !== this._diploSig) this.buildDiplo(tr); else if (this.nationTab === 'diplo') this._refreshDiplo(tr);
    const avail = (sim && sim.tech && typeof sim.tech.available === 'function') ? sim.tech.available(tr) : [];
    const rsig = avail.map((d) => d.id).join(',');
    if (rsig !== this._researchSig) this.buildResearch(tr); else this._refreshResearchLine(tr);
    if (this.nationTab === 'destiny') this._refreshDestiny(tr);
  }

  // ---- nations browser panel -------------------------------------------
  toggleNations() { this._natOpen ? this.closeNations() : this.openNations(); }

  openNations() {
    this._natOpen = true;
    this.el.nationsPanel.classList.remove('hidden');
    if (this.el.btnNations) this.el.btnNations.classList.add('active');
    this._natSig = '';
    this.refreshNationsPanel();
  }

  closeNations() {
    this._natOpen = false;
    this.el.nationsPanel.classList.add('hidden');
    if (this.el.btnNations) this.el.btnNations.classList.remove('active');
  }

  refreshNationsPanel() {
    const sim = this._sim(); if (!sim) return;
    const living = [...sim.tribes.values()].filter((t) => t.members > 0).sort((a, b) => b.members - a.members);
    const sig = living.map((t) => t.id).join(',');
    if (sig !== this._natSig) {
      this._natSig = sig;
      this._natRows.clear();
      if (!living.length) {
        this.el.nationsList.innerHTML = `<div class="empty-note">No nations live right now. Use ✿ Spawn Life to seed a people.</div>`;
        return;
      }
      this.el.nationsList.innerHTML = living.map((t) => `
        <div class="nat-row" data-tid="${t.id}">
          <button class="nat-main" data-focus="${t.id}">
            <span class="swatch" style="background:${hueToCss(t.hue)}"></span>
            <span class="nat-text"><span class="nat-name">${esc(t.name)}</span>
              <span class="nat-meta" data-meta></span></span>
          </button>
          <div class="nat-acts hidden">
            <button class="nat-act" data-act="playas" data-tid="${t.id}">⚑ Play as</button>
            <button class="nat-act" data-act="watch" data-tid="${t.id}">🎥 Watch</button>
            <button class="nat-act" data-act="possess" data-tid="${t.id}">👁 Possess</button>
          </div>
        </div>`).join('');
      this.el.nationsList.querySelectorAll('.nat-row').forEach((row) =>
        this._natRows.set(+row.dataset.tid, row.querySelector('[data-meta]')));
    }
    // update meta text in place
    for (const [tid, metaEl] of this._natRows) {
      const t = sim.tribes.get(tid);
      if (!t || !metaEl) continue;
      const faith = t.religion ? ' · ' + t.religion.name : '';
      metaEl.textContent = `${this._eraName(t)} · ${t.members} souls${faith}`;
    }
  }

  _onNationsClick(e) {
    const main = e.target.closest('button[data-focus]');
    if (main) {
      const tid = +main.dataset.focus;
      const tr = this._sim().tribes.get(tid);
      if (tr) this._focusTribe(tr);
      const row = main.closest('.nat-row');
      const acts = row && row.querySelector('.nat-acts');
      // collapse others, toggle this one
      this.el.nationsList.querySelectorAll('.nat-acts').forEach((a) => { if (a !== acts) a.classList.add('hidden'); });
      if (acts) acts.classList.toggle('hidden');
      return;
    }
    const act = e.target.closest('button[data-act]');
    if (!act) return;
    const tid = +act.dataset.tid;
    const tr = this._sim().tribes.get(tid);
    if (!tr) return;
    if (act.dataset.act === 'playas') this.game.playAsTribe(tr);
    else if (act.dataset.act === 'watch') { this._focusTribe(tr); this.showInspector({ tribe: tr }, this.game); }
    else if (act.dataset.act === 'possess') this._possessCitizen(tid);
  }

  _focusTribe(tr) {
    const cam = this.game.cam;
    cam.setTarget(tr.capitalX, tr.capitalY, Math.max(cam.zoom, 9));
  }

  _possessCitizen(tid) {
    const sim = this._sim();
    const a = sim.pool.agents.find((x) => x.alive && x.tribeId === tid);
    if (a) this.game.possess(a);
    else this.toast({ type: 'info', msg: 'That people has no living citizen to possess.' });
  }

  // ---- menu ------------------------------------------------------------
  toggleMenu() {
    if (!this.el.menuModal) return;
    this.el.menuModal.classList.contains('hidden') ? this.openMenu() : this.closeMenu();
  }
  openMenu() { this._syncMenu(); this.el.menuModal.classList.remove('hidden'); }
  closeMenu() { this.el.menuModal.classList.add('hidden'); }

  _buildMenu() {
    if (this._menuBuilt || !this.el.menuCard) return;
    this._menuBuilt = true;
    const tools = Object.values(TOOL_INFO).map((t) =>
      `<div class="legend-row"><span class="legend-ico">${t.icon}</span>
        <span class="legend-name">${t.name}</span><span class="legend-key">${t.hotkey}</span>
        <span class="legend-desc">${esc(t.desc)}</span></div>`).join('');
    const controls = CONTROLS.map(([k, d]) =>
      `<div class="legend-row ctl"><span class="legend-key wide">${esc(k)}</span><span class="legend-desc">${esc(d)}</span></div>`).join('');
    this.el.menuCard.innerHTML = `
      <div class="menu-head"><h2>AEON</h2><button class="panel-close" id="menu-close">✕</button></div>
      <p class="menu-about">A living world where every creature thinks with its own evolving neural network. You are its god — and you can descend to lead any one nation. Local-only; nothing leaves your machine.</p>
      <div class="menu-section"><h3>World</h3>
        <div class="menu-btns">
          <button class="menu-btn" id="menu-restart">🌍 Restart World (new seed)</button>
          <button class="menu-btn" id="menu-pause">⏸ Pause</button>
          <button class="menu-btn" id="menu-speed">▶ Speed</button>
          <button class="menu-btn" id="menu-nations">⚑ Choose a Nation</button>
        </div>
      </div>
      <div class="menu-section"><h3>Lead a nation</h3>
        <p class="menu-tip">Open <b>⚑ Nations</b> (top bar) or click any people on the map, then <b>Play as</b> to lead them. Set their will with the policy sliders, steer research &amp; diplomacy, and pick a destiny to chase. You guide; their own brains decide.</p>
      </div>
      <div class="menu-section"><h3>Controls</h3><div class="legend">${controls}</div></div>
      <div class="menu-section"><h3>The Divine Hand</h3><div class="legend">${tools}</div></div>`;
    $('menu-close').onclick = () => this.closeMenu();
    $('menu-restart').onclick = () => { if (confirm('Restart the world with a new seed? The current world will be lost.')) location.reload(); };
    $('menu-pause').onclick = () => { if (this.game) { this.game.togglePause(); this._syncMenu(); } };
    $('menu-speed').onclick = () => { if (this.game) { this.game.cycleSpeed(); this._syncMenu(); } };
    $('menu-nations').onclick = () => { this.closeMenu(); this.openNations(); };
  }

  _syncMenu() {
    const sp = this.game ? this.game.speed : 1;
    const pb = $('menu-pause'), sb = $('menu-speed');
    if (pb) pb.textContent = sp === 0 ? '▶ Resume' : '⏸ Pause';
    if (sb) sb.textContent = sp === 0 ? '▶ Speed' : `▶ Speed ${sp}×`;
  }

  // ---- onboarding hint -------------------------------------------------
  _showOnboard() {
    if (this._onboardShown) return;
    // wait until the intro modal is dismissed so the hint isn't lost behind it
    const intro = $('modal');
    if (intro && !intro.classList.contains('hidden')) return;
    this._onboardShown = true;
    const d = document.createElement('div');
    d.id = 'onboard';
    d.innerHTML = `<span>Pick a nation to lead — open <b>⚑ Nations</b> or click a people — or just shape the world as a god.</span>
      <button id="onboard-x" aria-label="dismiss">✕</button>`;
    this.el.hud.appendChild(d);
    requestAnimationFrame(() => d.classList.add('show'));
    $('onboard-x').onclick = () => this._dismissOnboard();
    this._onboardTimer = setTimeout(() => this._dismissOnboard(), 16000);
  }
  _dismissOnboard() {
    const d = $('onboard'); if (!d) return;
    clearTimeout(this._onboardTimer);
    d.classList.remove('show');
    setTimeout(() => d.remove(), 400);
  }

  // ---- tooltip ---------------------------------------------------------
  _buildTooltip() {
    this._tip = document.createElement('div');
    this._tip.id = 'tooltip';
    this._tip.className = 'hidden';
    document.body.appendChild(this._tip);
  }
  _showTip(btn, info) {
    const r = btn.getBoundingClientRect();
    this._tip.innerHTML = `<div class="tip-head"><b>${info.name}</b><span class="tip-key">${info.hotkey}</span></div>
      <div class="tip-desc">${esc(info.desc)}</div>`;
    this._tip.classList.remove('hidden');
    this._tip.style.left = `${r.right + 10}px`;
    this._tip.style.top = `${r.top}px`;
  }
  _hideTip() { if (this._tip) this._tip.classList.add('hidden'); }

  // ---- shared little reads --------------------------------------------
  _eraName(tr) {
    const sim = this._sim();
    const era = (tr && tr.tech && typeof tr.tech.era === 'number') ? tr.tech.era : 0;
    if (sim && sim.tech && typeof sim.tech.eraName === 'function') return sim.tech.eraName(era);
    return `Era ${era}`;
  }
  _eraNameOf(era) {
    const sim = this._sim();
    if (sim && sim.tech && typeof sim.tech.eraName === 'function') return sim.tech.eraName(era || 0);
    return `Era ${era || 0}`;
  }
  _settlementCount(tid) {
    const sim = this._sim();
    if (sim && sim.settleSys && typeof sim.settleSys.countOf === 'function') return sim.settleSys.countOf(tid);
    return 0;
  }
  _otherTribes(tr) {
    const sim = this._sim();
    if (!sim) return [];
    return [...sim.tribes.values()].filter((t) => t.members > 0 && t.id !== tr.id).sort((a, b) => a.id - b.id);
  }

  // diplomacy reads (defensive across however statecraft exposes state)
  _stance(a, b) {
    const sim = this._sim();
    const g = this.game && this.game.gov;
    try {
      if (g && typeof g.getStance === 'function') { const s = g.getStance(sim, a, b); if (s) return s; }
      if (g && typeof g.stanceOf === 'function') { const s = g.stanceOf(sim, a, b); if (s) return s; }
    } catch { /* ignore */ }
    const d = sim && sim.diplomacy;
    try {
      if (d && typeof d.getStance === 'function') { const s = d.getStance(a, b); if (s) return s; }
      if (d && typeof d.stanceOf === 'function') { const s = d.stanceOf(a, b); if (s) return s; }
    } catch { /* ignore */ }
    if (a && a.stances) { const s = a.stances.get ? a.stances.get(b.id) : a.stances[b.id]; if (s && STANCES.includes(s)) return s; }
    return 'neutral';
  }
  _warPressure(a, b) {
    const sim = this._sim();
    const g = this.game && this.game.gov;
    try { if (g && typeof g.warPressure === 'function') { const v = g.warPressure(sim, a, b); if (typeof v === 'number') return v; } } catch { /* ignore */ }
    const d = sim && sim.diplomacy;
    try { if (d && typeof d.warPressure === 'function') { const v = d.warPressure(a, b); if (typeof v === 'number') return v; } } catch { /* ignore */ }
    return null;
  }

  // destiny reads
  _destinies() {
    const g = this.game && this.game.gov;
    if (g && Array.isArray(g.DESTINIES)) return g.DESTINIES;
    return [];
  }
  _chosenDestiny(tr) {
    const sim = this._sim();
    const g = this.game && this.game.gov;
    try { if (g && typeof g.getDestiny === 'function') { const v = g.getDestiny(sim, tr); return (v && v.id) ? v.id : v; } } catch { /* ignore */ }
    if (tr && tr.destiny != null) return (typeof tr.destiny === 'object') ? tr.destiny.id : tr.destiny;
    if (tr && tr.destinyId != null) return tr.destinyId;
    return null;
  }
  _destinyProgress(def, tr) {
    const sim = this._sim();
    try { if (def && typeof def.progress === 'function') { const v = +def.progress(sim, tr); return v > 1 ? 1 : (v < 0 || Number.isNaN(v) ? 0 : v); } } catch { /* ignore */ }
    return 0;
  }
  _destinyDone(def, tr) {
    const sim = this._sim();
    try { if (def && typeof def.done === 'function') return !!def.done(sim, tr); } catch { /* ignore */ }
    return false;
  }

  setPossession(agent, game) {
    if (agent) this.toast({ type: 'info', msg: `You are ${agent.name}. WASD to move · Esc to release.` });
  }

  // ---- event log toasts ----
  toast(e) {
    const div = document.createElement('div');
    div.className = `toast toast-${e.type || 'info'}`;
    if (e.color != null) div.style.borderLeftColor = hueToCss(e.color);
    div.textContent = e.msg;
    this.el.eventlog.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    setTimeout(() => { div.classList.remove('show'); setTimeout(() => div.remove(), 400); }, 4200);
    while (this.el.eventlog.children.length > 5) this.el.eventlog.firstChild.remove();
  }
}

function edgeColor(w) {
  const a = Math.min(0.85, Math.abs(w) * 0.5 + 0.12);
  return w > 0 ? `rgba(90,150,255,${a})` : `rgba(255,90,90,${a})`;
}
function traitColor(t) {
  const map = { size: '#c97', speed: '#7cf', metabolism: '#fc6', fertility: '#f9c',
    aggression: '#f66', vision: '#9df', diet: '#f85', resilience: '#7d9' };
  return map[t] || '#9ad';
}
function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
