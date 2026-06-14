// Bootstrap: build the world, show the start screen (Survival / Creative),
// let the player create their people, then run the frame loop.
import { Game } from './game/game.js';
import { UI } from './game/ui.js';
import { bindInput } from './game/input.js';
import { HERITAGE } from './sim/heritage.js';
import { tribeName } from './sim/names.js';
import { RNG } from './core/rng.js';

const canvas = document.getElementById('game');
const loadbar = document.getElementById('loadbar');
const loadstatus = document.getElementById('loadstatus');

const steps = [
  ['shaping the land…', 8],
  ['carving rivers and mountains…', 22],
  ['breathing climate into the world…', 40],
  ['seeding the first peoples…', 70],
  ['the world awaits…', 100],
];

let ui, game;
const nameRng = new RNG((Math.floor(Math.random() * 1e9)) >>> 0);

// banner palette (cohesive, distinct hues)
const BANNERS = [0, 28, 45, 90, 140, 175, 205, 230, 265, 300, 330, 355];
let chosenHue = 205;
const chosenTraits = new Set();

function progress(i) {
  if (i >= steps.length) { boot(); return; }
  const [label, pct] = steps[i];
  loadstatus.textContent = label;
  loadbar.style.width = pct + '%';
  if (i === 3 && !game) {
    ui = new UI();
    const seed = (Math.floor(Math.random() * 1e9)) >>> 0; // varied world each load
    game = new Game(canvas, ui, { w: 260, h: 162, seed, cap: 2600 });
    ui.bind(game);
    bindInput(game);
    game.speedIdx = 0; // paused while the player is at the menus
    // frame the whole world (god's-eye view behind the menus)
    game.cam.zoom = game.cam.tzoom = Math.min(
      window.innerWidth / game.world.w, window.innerHeight / game.world.h) * 0.92;
  }
  setTimeout(() => progress(i + 1), 170);
}

function boot() {
  document.getElementById('loading').style.display = 'none';
  buildCreateScreen();
  wireStartScreen();
  ui.setActiveTool(game.tool);
  const b3d = document.getElementById('btn-3d');
  if (b3d) { b3d.textContent = game.use3D ? '◳ 3D' : '▢ 2D'; b3d.onclick = () => game.toggle3D(); }
  startRenderLoop();
}

// ---- start screen + create-your-people ---------------------------------
function wireStartScreen() {
  document.getElementById('mode-creative').onclick = () => {
    game.startCreative();
    enterGame();
    document.getElementById('modal').classList.remove('hidden'); // show the god intro once
    document.getElementById('modal-start').onclick = () => document.getElementById('modal').classList.add('hidden');
  };
  document.getElementById('mode-survival').onclick = () => {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('create-screen').classList.remove('hidden');
    if (!document.getElementById('people-name').value) rollName();
  };
  document.getElementById('create-back').onclick = () => {
    document.getElementById('create-screen').classList.add('hidden');
    document.getElementById('start-screen').classList.remove('hidden');
  };
}

function buildCreateScreen() {
  // banner swatches
  const sw = document.getElementById('banner-swatches');
  sw.innerHTML = BANNERS.map((h) =>
    `<div class="swatch" data-hue="${h}" style="background:hsl(${h},62%,52%)"></div>`).join('');
  sw.querySelectorAll('.swatch').forEach((el) => {
    el.onclick = () => {
      chosenHue = +el.dataset.hue;
      sw.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
      el.classList.add('sel');
    };
  });
  sw.firstChild && sw.children[6] && sw.children[6].classList.add('sel'); // default blue

  // heritage trait chips (choose up to 2)
  const tc = document.getElementById('create-traits');
  tc.innerHTML = HERITAGE.map((h) =>
    `<div class="trait-chip" data-id="${h.id}"><span class="tc-ico">${h.icon}</span>` +
    `<span><span class="tc-name">${h.name}</span><br><span class="tc-desc">${h.desc}</span></span></div>`).join('');
  tc.querySelectorAll('.trait-chip').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (chosenTraits.has(id)) chosenTraits.delete(id);
      else { if (chosenTraits.size >= 2) return; chosenTraits.add(id); }
      refreshTraitChips();
    };
  });

  // name randomize
  document.getElementById('name-roll').onclick = rollName;

  // begin
  document.getElementById('create-begin').onclick = () => {
    const name = (document.getElementById('people-name').value || '').trim() || tribeName(nameRng);
    game.startSurvival({ name, hue: chosenHue, traits: [...chosenTraits] });
    enterGame();
  };
}

function refreshTraitChips() {
  const full = chosenTraits.size >= 2;
  const seaSel = chosenTraits.has('seafaring');
  document.querySelectorAll('.trait-chip').forEach((el) => {
    const id = el.dataset.id;
    const sel = chosenTraits.has(id);
    el.classList.toggle('sel', sel);
    el.classList.toggle('disabled', full && !sel);
  });
  document.getElementById('homeland-note').textContent = seaSel
    ? 'Your people will settle a fertile COAST of their own, drawn to the sea.'
    : 'Your people will settle a fertile homeland of their own, far from rivals.';
}

function rollName() {
  document.getElementById('people-name').value = tribeName(nameRng);
}

function enterGame() {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('create-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  ui.setSpeed(game.speed);
}

// ---- frame loop --------------------------------------------------------
function startRenderLoop() {
  let last = performance.now();
  let statTimer = 0, frames = 0, fpsTimer = 0;
  window.__perf = { fps: 0, frameMs: 0 };
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    const t0 = performance.now();
    game.update(dt);
    window.__perf.frameMs = performance.now() - t0;
    frames++; fpsTimer += dt;
    if (fpsTimer >= 500) { window.__perf.fps = Math.round((frames * 1000) / fpsTimer); frames = 0; fpsTimer = 0; }
    statTimer += dt;
    if (statTimer > 200) { ui.updateStats(game.sim); statTimer = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  installDebugAPI();
}

// ---- Beta-test / debug API ---------------------------------------------
function installDebugAPI() {
  const g = game, s = game.sim;
  window.AEON = {
    game: g, sim: s, ui,
    perf: () => ({ ...window.__perf, pop: s.population(), agents: s.pool.count }),
    stats: () => ({
      year: s.year(), pop: s.population(), tribes: s.activeTribes(),
      maxGen: s.maxGen, peakFitness: +s.peakFitness.toFixed(1), births: s.births, deaths: s.deaths,
    }),
    fastForward: async (years = 10) => {
      const ticks = years * 60, CHUNK = 60;
      for (let i = 0; i < ticks; i += CHUNK) {
        const end = Math.min(ticks, i + CHUNK);
        for (let k = i; k < end; k++) s.step();
        await new Promise((r) => requestAnimationFrame(r));
      }
      return window.AEON.stats();
    },
    survival: (name, traits = [], hue = 205) => { g.startSurvival({ name, hue, traits }); enterGame(); return g.playerTribe && g.playerTribe.name; },
    creative: () => { g.startCreative(); enterGame(); },
    spawn: (x, y, n = 18) => g.sim.godSpawnLife(x ?? s.world.w / 2, y ?? s.world.h / 2, n),
    smite: (x, y, r = 6) => g.sim.godSmite(x ?? s.world.w / 2, y ?? s.world.h / 2, r),
    setTool: (t) => g.setTool(t),
    setSpeed: (i) => { g.speedIdx = i; ui.setSpeed(g.speed); },
    playFirstTribe: () => { const t = [...s.tribes.values()].find((x) => x.members > 0); if (t) g.playAsTribe(t); return t && t.name; },
    possessRandom: () => { const a = s.pool.agents.find((x) => x.alive); if (a) g.possess(a); return a && a.name; },
    ascend: () => g.ascend(),
    camera: (x, y, zoom) => g.cam.setTarget(x, y, zoom),
  };
  console.log('[AEON] debug API ready — AEON.creative() / AEON.survival("Name",["martial"]) / AEON.stats()');
}

progress(0);
