// Renderer. Stylized top-down: hillshaded baked terrain + instanced-ish agent
// dots/shapes + particle juice + day/night post. Everything culled to viewport.
import { BIOME, BIOME_COLOR } from '../sim/world.js';
import * as Visuals from './visuals.js';

export class Renderer {
  constructor(canvas, sim, camera, fx) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = sim;
    this.cam = camera;
    this.fx = fx;

    // ---- device-pixel / quality tier (self-contained perf governor) ----
    // RENDER is the measured bottleneck; on dpr 2-3 phones we were paying 4-9x
    // the pixel cost for no visible gain. We clamp the effective devicePixelRatio
    // and (on weak hardware) drop a quality tier that skips the bloom post pass
    // and thins particle effects. Crisp at dpr=1, never blurry: renderScale only
    // ever shrinks the backing store, the CSS box stays 1:1 with layout pixels.
    this._quality = 'auto';
    this._applyQuality('auto');   // sets this.qTier, this.renderScale, this.dpr

    // offscreen baked terrain (1px per tile)
    this.terrain = document.createElement('canvas');
    this.terrain.width = sim.world.w;
    this.terrain.height = sim.world.h;
    this.tctx = this.terrain.getContext('2d');
    this.bakeTerrain();

    this.selection = null; // {agent} or {tribe}
    this.ghost = null;     // brush ghost {x,y,r,color}
    this.timeOfDay = 0.3;

    // minimap (Civ-style strategic overview)
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini ? this.mini.getContext('2d') : null;
    this._miniT = 0;
  }

  resize(w, h) {
    // backing store = CSS pixels * effective dpr (dpr already folds in renderScale)
    this._cssW = w; this._cssH = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    // camera works in CSS/layout pixels; the dpr scale is applied on the ctx in
    // render(), so the world->screen transform is unaffected by the clamp.
    this.cam.resize(w, h);
  }

  // ---- quality tier ----------------------------------------------------------
  // Pick an internal tier from hardware hints (cores / memory / coarse-pointer).
  // 'low'  => no bloom post, thinner particles, dpr capped harder (saves the most
  //           pixels on the phones/laptops that were dropping to single-digit fps).
  // 'high' => full bloom + dpr up to 1.5.  'auto' picks one of these at runtime.
  // Public + no-arg-safe so the integrator can later wire a UI toggle:
  //   renderer.setQuality('auto' | 'low' | 'high')
  setQuality(level) {
    this._applyQuality(level || 'auto');
    // re-size the backing store so the new dpr/renderScale takes effect now
    if (this._cssW) this.resize(this._cssW, this._cssH);
    return this._quality;
  }
  getQuality() { return this._quality; }

  _applyQuality(level) {
    if (level !== 'low' && level !== 'high' && level !== 'auto') level = 'auto';
    this._quality = level;
    const tier = level === 'auto' ? this._detectTier() : level;
    this.qTier = tier;
    const rawDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (tier === 'low') {
      // cap hard + an internal downscale so huge-dpr phones stop over-rendering
      this.renderScale = 0.85;
      this.dpr = Math.min(rawDpr, 1.25) * this.renderScale;
    } else {
      this.renderScale = 1;
      this.dpr = Math.min(rawDpr, 1.5);
    }
    // never go below 1 device px per CSS px (keeps it crisp at dpr=1)
    if (this.dpr < 1) this.dpr = 1;
    this.bloom = tier !== 'low';
    if (this.fx) this.fx.quality = tier;   // fx.js thins particles on 'low'
  }

  // Heuristic: weak if few cores OR little memory OR a coarse (touch) pointer on
  // a high-dpr panel. Conservative — only the clearly-weak machines drop to low.
  _detectTier() {
    if (typeof navigator === 'undefined') return 'high';
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;   // GB, Chrome-only; undefined => assume ok
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    let coarse = false;
    try { coarse = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    if (cores <= 4 || mem <= 4) return 'low';
    if (coarse && dpr >= 2) return 'low';      // high-res phone/tablet
    return 'high';
  }

  bakeTerrain() {
    // Workstream D — premium terrain (coastlines, depth-shaded water, hillshade).
    Visuals.bakeTerrain(this.sim.world, this.tctx);
  }

  render() {
    const ctx = this.ctx, cam = this.cam, W = this.sim.world;
    if (W.dirty) this.bakeTerrain();

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.fx.shakeX, this.fx.shakeY);

    // sky/void background
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(-20, -20, cam.viewW + 40, cam.viewH + 40);

    // terrain
    const tl = cam.worldToScreen(0, 0);
    ctx.drawImage(this.terrain, 0, 0, W.w, W.h, tl.x, tl.y, W.w * cam.zoom, W.h * cam.zoom);

    Visuals.drawWaterShimmer(this.ctx, this.cam, this.sim);
    Visuals.drawFood(this.ctx, this.cam, this.sim);
    this.drawTerritory();
    Visuals.drawBorders(this.ctx, this.cam, this.sim);
    Visuals.drawResources(this.ctx, this.cam, this.sim);
    Visuals.drawAnimals(this.ctx, this.cam, this.sim);
    Visuals.drawSettlements(this.ctx, this.cam, this.sim);
    Visuals.drawAgents(this.ctx, this.cam, this.sim);
    this.drawSelection();
    this.drawArmyTarget();
    this.drawCommand();
    this.drawGhost();
    this.drawFX();
    Visuals.drawClouds(this.ctx, this.cam, this.sim);   // drifting atmosphere over the world
    Visuals.applyPost(this.ctx, this.cam, { timeOfDay: (this.sim.tick % 1440) / 1440, fx: this.fx, bloom: this.bloom });

    ctx.restore();
    this.drawMinimap();
  }

  // Civ-style strategic minimap: a cached terrain+territory base (rebuilt ~every
  // 2s) blitted each frame, with the live camera viewport rectangle on top.
  drawMinimap() {
    const m = this.mctx;
    if (!m) return;
    const mw = this.mini.width, mh = this.mini.height;
    if (!this._miniBase) { this._miniBase = document.createElement('canvas'); this._miniBase.width = mw; this._miniBase.height = mh; }
    this._miniT = (this._miniT || 0) + 1;
    if (this._miniT % 120 === 1) this._rebuildMiniBase();
    m.clearRect(0, 0, mw, mh);
    m.imageSmoothingEnabled = false;
    m.drawImage(this._miniBase, 0, 0);
    // live camera viewport rectangle
    const W = this.sim.world, vb = this.cam.viewBounds();
    const rx = (vb.x0 / W.w) * mw, ry = (vb.y0 / W.h) * mh;
    const rw = ((vb.x1 - vb.x0) / W.w) * mw, rh = ((vb.y1 - vb.y0) / W.h) * mh;
    m.strokeStyle = 'rgba(255,255,255,0.9)'; m.lineWidth = 1;
    m.strokeRect(rx + 0.5, ry + 0.5, Math.max(2, rw), Math.max(2, rh));
  }

  _rebuildMiniBase() {
    const b = this._miniBase.getContext('2d'), W = this.sim.world;
    const mw = this.mini.width, mh = this.mini.height;
    b.imageSmoothingEnabled = false;
    b.drawImage(this.terrain, 0, 0, W.w, W.h, 0, 0, mw, mh); // downscaled terrain
    const T = this.sim.territory;
    if (T) {
      const owner = T.owner, sx = W.w / mw, sy = W.h / mh;
      for (let py = 0; py < mh; py++) {
        for (let px = 0; px < mw; px++) {
          const id = owner[((py * sy) | 0) * W.w + ((px * sx) | 0)];
          if (!id) continue;
          const tr = this.sim.tribes.get(id);
          if (!tr) continue;
          b.fillStyle = `hsla(${tr.hue | 0},70%,55%,0.6)`;
          b.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  // map a click on the minimap (px within the canvas) to a world point
  miniToWorld(px, py) {
    const W = this.sim.world;
    return { x: (px / this.mini.width) * W.w, y: (py / this.mini.height) * W.h };
  }

  drawFood() {
    const ctx = this.ctx, cam = this.cam, W = this.sim.world;
    if (cam.zoom < 2.5) return; // too zoomed out to matter
    const vb = cam.viewBounds();
    ctx.fillStyle = 'rgba(190,235,120,0.5)';
    const s = Math.max(1, cam.zoom * 0.28);
    for (let y = vb.y0; y < vb.y1; y++) {
      for (let x = vb.x0; x < vb.x1; x++) {
        const f = W.food[W.idx(x, y)];
        if (f < 0.35) continue;
        const p = cam.worldToScreen(x + 0.5, y + 0.5);
        const sz = s * f;
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
    }
  }

  drawTerritory() {
    const ctx = this.ctx, cam = this.cam;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of this.sim.tribes.values()) {
      if (tr.members < 3) continue;
      const p = cam.worldToScreen(tr.capitalX, tr.capitalY);
      const r = Math.max(8, Math.sqrt(tr.members) * cam.zoom * 0.6);
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, `hsla(${tr.hue},70%,55%,0.16)`);
      grd.addColorStop(1, `hsla(${tr.hue},70%,55%,0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
    }
    ctx.restore();

    // capital banners + names at mid/low zoom
    if (cam.zoom > 2) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.max(9, Math.min(15, cam.zoom * 0.9)) | 0}px ui-sans-serif, system-ui, sans-serif`;
      for (const tr of this.sim.tribes.values()) {
        if (tr.members < 5) continue;
        const p = cam.worldToScreen(tr.capitalX, tr.capitalY);
        ctx.fillStyle = `hsl(${tr.hue},75%,72%)`;
        ctx.globalAlpha = Math.min(1, (cam.zoom - 2) / 4);
        ctx.fillText((tr.isPlayer ? '★ ' : '') + tr.name, p.x, p.y - 6);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawAgents() {
    const ctx = this.ctx, cam = this.cam;
    const A = this.sim.pool.agents;
    const z = cam.zoom;
    const baseR = Math.max(1, z * 0.16);
    const detailed = z > 7;

    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive) continue;
      const p = cam.worldToScreen(a.x, a.y);
      if (p.x < -8 || p.y < -8 || p.x > cam.viewW + 8 || p.y > cam.viewH + 8) continue;

      const tr = this.sim.tribes.get(a.tribeId);
      const hue = tr ? tr.hue : a.hue;
      const light = 38 + a.energy * 26 + a.health * 8;     // brighter = healthier/fed
      const r = baseR * a.size;

      // signal / speak glow (culture)
      if (a.signal > 0.05) {
        ctx.fillStyle = `hsla(${hue},90%,75%,${a.signal * 0.4})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, 7); ctx.fill();
      }

      ctx.fillStyle = `hsl(${hue},${50 + a.diet * 30}%,${light}%)`;
      if (detailed) {
        // body + facing nub
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        const sp = Math.hypot(a.vx, a.vy) || 1;
        ctx.fillStyle = `hsl(${hue},70%,${light + 18}%)`;
        ctx.beginPath();
        ctx.arc(p.x + (a.vx / sp) * r, p.y + (a.vy / sp) * r, r * 0.5, 0, 7);
        ctx.fill();
        // act flash
        if (a.lastAct === 2) { ctx.strokeStyle = '#ff5544'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6, 0, 7); ctx.stroke(); }
      } else {
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
      a.lastAct = 0;
    }
  }

  drawSelection() {
    const sel = this.selection;
    if (!sel) return;
    const ctx = this.ctx, cam = this.cam;
    if (sel.agent && sel.agent.alive) {
      const a = sel.agent;
      const p = cam.worldToScreen(a.x, a.y);
      const r = Math.max(6, cam.zoom * 0.5);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    } else if (sel.tribe) {
      const tr = sel.tribe;
      const p = cam.worldToScreen(tr.capitalX, tr.capitalY);
      const r = Math.max(14, Math.sqrt(tr.members) * cam.zoom * 0.7);
      ctx.strokeStyle = `hsl(${tr.hue},80%,70%)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
    }
  }

  // RTS command: highlight selected units + draw the live drag-selection box
  drawCommand() {
    const ctx = this.ctx, cam = this.cam;
    const sel = this.selected;
    if (sel && sel.length) {
      ctx.strokeStyle = '#9cff7a'; ctx.lineWidth = 1.5;
      const r = Math.max(3, cam.zoom * 0.4);
      for (let i = 0; i < sel.length; i++) {
        const a = sel[i]; if (!a.alive) continue;
        const p = cam.worldToScreen(a.x, a.y);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
        if (a.ordered) { // a faint line to its order point
          const o = cam.worldToScreen(a.ordX, a.ordY);
          ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    }
    const b = this.selBox;
    if (b) {
      const p0 = cam.worldToScreen(b.x0, b.y0), p1 = cam.worldToScreen(b.x1, b.y1);
      const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      ctx.strokeStyle = 'rgba(156,255,122,0.9)'; ctx.fillStyle = 'rgba(156,255,122,0.12)'; ctx.lineWidth = 1.5;
      ctx.fillRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      ctx.strokeRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
    }
  }

  drawArmyTarget() {
    const t = this.armyTarget;
    if (!t) return;
    const ctx = this.ctx, p = this.cam.worldToScreen(t.x, t.y);
    const r = 8 + Math.sin(this.sim.tick * 0.15) * 2;   // pulsing rally marker
    ctx.strokeStyle = '#ff7755'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ff9a7a'; ctx.textAlign = 'center';
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('⚔', p.x, p.y + 4);
  }

  drawGhost() {
    if (!this.ghost) return;
    const ctx = this.ctx, cam = this.cam, g = this.ghost;
    const p = cam.worldToScreen(g.x, g.y);
    ctx.strokeStyle = g.color || 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, g.r * cam.zoom, 0, 7); ctx.stroke();
  }

  drawFX() {
    const ctx = this.ctx, cam = this.cam, fx = this.fx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of fx.particles) {
      const p = cam.worldToScreen(o.x, o.y);
      ctx.globalAlpha = o.life / o.max;
      ctx.fillStyle = o.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, o.r * Math.max(1, cam.zoom * 0.2), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const o of fx.rings) {
      const p = cam.worldToScreen(o.x, o.y);
      ctx.globalAlpha = o.life / o.max;
      ctx.strokeStyle = o.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, o.r * cam.zoom, 0, 7); ctx.stroke();
    }
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    for (const o of fx.texts) {
      const p = cam.worldToScreen(o.x, o.y);
      ctx.globalAlpha = o.life / o.max;
      ctx.fillStyle = o.color;
      ctx.fillText(o.str, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  drawDayNight() {
    const ctx = this.ctx, cam = this.cam;
    // time of day from sim tick (one day ~ 24s at 60fps)
    const t = (this.sim.tick % 1440) / 1440;
    this.timeOfDay = t;
    // brightness curve: noon bright, midnight dark
    const sun = Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5; // 0 night .. 1 noon
    const nightAlpha = (1 - sun) * 0.5;
    if (nightAlpha > 0.02) {
      ctx.fillStyle = `rgba(20,28,60,${nightAlpha})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }
    // warm dawn/dusk tint
    const golden = Math.max(0, 1 - Math.abs(sun - 0.25) * 4) * 0.12;
    if (golden > 0.01) {
      ctx.fillStyle = `rgba(255,170,90,${golden})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }

    // vignette
    const g = ctx.createRadialGradient(
      cam.viewW / 2, cam.viewH / 2, Math.min(cam.viewW, cam.viewH) * 0.35,
      cam.viewW / 2, cam.viewH / 2, Math.max(cam.viewW, cam.viewH) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    // god-power full flash
    if (this.fx.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.fx.flashColor},${this.fx.flash * 0.5})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }
  }
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
