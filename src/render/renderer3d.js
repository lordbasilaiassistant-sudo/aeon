// renderer3d.js — the PRODUCTION 3D renderer for AEON, as a drop-in adapter that
// mirrors the LIVE Canvas2D Renderer interface so the integrator can swap it in
// behind a toggle:
//
//   const r = new Renderer3D(canvas, sim, cam, fx);
//   r.resize(w, h);            // CSS pixels (same contract as Renderer.resize)
//   r.selection = {...};       // setter (agent/tribe highlight)
//   r.selected = [...];        // hand-selected units (RTS) — optional
//   r.selBox = {...};          // drag rectangle (world coords) — optional
//   r.armyTarget = {x,y};      // rally marker — optional
//   r.render();                // draw one frame, driven by the GAME camera
//
// It renders the REAL game sim — sim.pool.agents, sim.settlements, sim.tribes,
// sim.territory, sim.world — NOT a private demo sim. The GAME camera (cam.x, cam.y
// in world-tile coords at screen-centre; cam.zoom in CSS px/tile) is mapped onto a
// tilted Civ-style 3D orbit, so panning/zooming the game drives the 3D view 1:1.
//
// HARD CONSTRAINTS honored: plain ES module, raw WebGL2 (via gl3d.js), ZERO deps,
// no CDN, no build step, local-only. The heavy GL guts live in gl3d.js (terrain
// mesh, water, instanced figures, instanced procedural buildings, nation overlay,
// picking); this file is the thin game adapter + 2D label/selection overlay.
//
// OWNERSHIP: this file + gl3d.js + gl3d_demo.html are the graphics dept's; it does
// NOT touch the live game files. It READS the sim; it never mutates it.

import { GL3D, HEIGHT_SCALE } from './gl3d.js';

// Map the 2D camera's zoom (CSS px per tile) onto the 3D orbit distance. At high
// zoom (close in) we want a small orbit radius; zoomed out, a large one. This is
// the single bridge that makes "zoom the game = zoom the 3D world" feel right.
function zoomToDist(zoom, world) {
  // viewport-height worth of tiles is ~ (someH / zoom); pick a dist that frames it.
  // empirically: dist ≈ tilesAcrossView * k. Clamp to the orbit's sane range.
  const tiles = 900 / Math.max(0.6, zoom);     // ~tiles tall the 2D view would show
  return Math.max(10, Math.min(Math.max(world.w, world.h) * 1.5, tiles * 0.9));
}

export class Renderer3D {
  // Static WebGL2 probe so the integrator can decide whether to even offer the 3D
  // toggle (and fall back to the Canvas2D Renderer otherwise).
  static isSupported() { return GL3D.isSupported(); }

  constructor(canvas, sim, camera, fx) {
    this.canvas = canvas;
    this.sim = sim;
    this.cam = camera;              // the GAME Camera (camera.js): x,y,zoom
    this.fx = fx;

    // GL engine (terrain/water/figures/buildings/overlay/picking)
    this.gl3d = new GL3D(canvas, sim);

    // give the engine a hue resolver so nation colors match the rest of the game
    // (player tribe can be accented elsewhere; default = the tribe's own hue).
    this.gl3d._hueOf = (tribeId) => {
      const tr = sim.tribes.get(tribeId);
      return tr ? tr.hue : 210;
    };

    // --- live Renderer interface fields the integrator sets each frame ---
    this._selection = null;     // {agent} | {tribe}
    this.selected = null;       // hand-selected units (RTS) | null
    this.selBox = null;         // {x0,y0,x1,y1} drag rect (world coords) | null
    this.armyTarget = null;     // {x,y} rally marker | null
    this.ghost = null;          // brush ghost {x,y,r,color}

    // 3D orbit state (smoothed). yaw/pitch are ours; target+dist track the game cam.
    this._yaw = 0.0;
    this._pitch = 0.95;         // ~54° down-tilt (Civ/Citystate angle)
    this._dist = zoomToDist(camera.zoom, sim.world);
    this._tDist = this._dist;
    // expose an orbit object in gl3d's expected shape (world-tile target coords)
    this._orbit = {
      targetX: camera.x, targetZ: camera.y,
      targetY: sim.world.seaLevel * HEIGHT_SCALE + 4,
      dist: this._dist, yaw: this._yaw, pitch: this._pitch,
      fov: Math.PI / 4,
    };

    // a 2D overlay canvas for labels / selection rings / drag box, layered over the
    // GL canvas. The integrator's index.html already stacks a #minimap; we create
    // our own overlay so we never touch its DOM. Positioned to match the GL canvas.
    this._overlay = this._makeOverlay(canvas);
    this.octx = this._overlay ? this._overlay.getContext('2d') : null;

    // minimap reuse (optional — same element id the Canvas2D Renderer uses)
    this.mini = (typeof document !== 'undefined') ? document.getElementById('minimap') : null;
    this.mctx = this.mini ? this.mini.getContext('2d') : null;
    this._miniT = 0;

    // territory overlay refresh throttle (sim re-stamps ownership once per year)
    this._lastTerrYear = -1;

    this._cssW = 0; this._cssH = 0;
    this._dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  }

  // ---- the live-Renderer .selection setter (mirrors Renderer) ----
  set selection(v) {
    this._selection = v;
    // follow: orbit eases toward a selected agent/tribe (so a selection recenters)
    if (v && v.agent && v.agent.alive) { this._followX = v.agent.x; this._followY = v.agent.y; }
    else if (v && v.tribe) { this._followX = v.tribe.capitalX; this._followY = v.tribe.capitalY; }
  }
  get selection() { return this._selection; }

  _makeOverlay(glCanvas) {
    if (typeof document === 'undefined') return null;
    const o = document.createElement('canvas');
    o.style.position = 'fixed';
    o.style.left = '0'; o.style.top = '0';
    o.style.pointerEvents = 'none';   // input still goes to the GL canvas
    o.style.zIndex = (parseInt(glCanvas.style.zIndex || '0', 10) + 1) || 1;
    // insert right after the GL canvas so it floats above it
    if (glCanvas.parentNode) glCanvas.parentNode.insertBefore(o, glCanvas.nextSibling);
    return o;
  }

  resize(w, h) {
    this._cssW = w; this._cssH = h;
    const dpr = this._dpr;
    this.gl3d.resize(w, h, dpr);
    if (this._overlay) {
      this._overlay.width = Math.max(1, Math.round(w * dpr));
      this._overlay.height = Math.max(1, Math.round(h * dpr));
      this._overlay.style.width = w + 'px';
      this._overlay.style.height = h + 'px';
    }
  }

  // PICKING — raycast a screen pixel to a world TILE coord (sim space). The
  // integrator can use this for click-to-select agents/cities in the 3D view,
  // replacing camera.screenToWorld for the 3D path.
  screenToWorld(screenX, screenY) {
    return this.gl3d.screenToWorld(screenX, screenY, this._orbit);
  }

  // Allow the integrator to nudge the orbit angle (optional — drag-to-orbit). Pan
  // and zoom come for free through the game camera; this only rotates/tilts.
  orbit(dYaw, dPitch) {
    this._yaw += dYaw;
    this._pitch = Math.max(0.32, Math.min(1.45, this._pitch + dPitch));
  }

  render() {
    const cam = this.cam, sim = this.sim, W = sim.world;

    // 1) map the GAME camera onto the 3D orbit -------------------------------
    // target = the world point the 2D camera is centered on; dist tracks zoom.
    let tx = cam.x, ty = cam.y;
    if (cam.follow && cam.follow.alive) { tx = cam.follow.x; ty = cam.follow.y; }
    this._tDist = zoomToDist(cam.zoom, W);
    // ease distance so a wheel-zoom doesn't snap
    this._dist += (this._tDist - this._dist) * 0.2;

    const o = this._orbit;
    o.targetX = tx; o.targetZ = ty;
    o.targetY = this.gl3d.heightAt(tx, ty) + 2;     // sit the orbit pivot on the ground
    o.dist = this._dist;
    o.yaw = this._yaw;
    o.pitch = this._pitch;

    // overlay strength: fade the nation tint as you zoom in (so figures/buildings
    // read up close, borders read when pulled back — Civ-style).
    this.gl3d.overlay = Math.max(0.25, Math.min(0.9, 1.05 - cam.zoom * 0.03));

    // 2) refresh the nation overlay when territory likely changed (once/sim-year)
    const yr = (typeof sim.year === 'function') ? sim.year() : (sim.tick / 60) | 0;
    if (yr !== this._lastTerrYear || this.gl3d._ownerDirty) {
      this.gl3d.updateTerritory(this.gl3d._hueOf);
      this._lastTerrYear = yr;
    }

    // 3) draw the 3D world ----------------------------------------------------
    this.gl3d.setCamInfo(o);
    this.gl3d.render(o);

    // 4) 2D overlay: selection rings, drag box, army target, city/nation labels
    this._drawOverlay(o);
  }

  // Project a world TILE coord to a screen CSS pixel using the engine's last
  // view-proj. Returns {x,y,vis} (vis=false if behind the camera).
  _project(wx, wy) {
    const g = this.gl3d, vp = g._vp;
    const X = wx - g.cx, Z = wy - g.cz;            // centre the world (engine convention)
    const Y = g.heightAt(wx, wy) + 1.2;            // lift labels off the ground a touch
    const cx = vp[0]*X + vp[4]*Y + vp[8]*Z + vp[12];
    const cy = vp[1]*X + vp[5]*Y + vp[9]*Z + vp[13];
    const cw = vp[3]*X + vp[7]*Y + vp[11]*Z + vp[15];
    if (cw <= 0.0001) return { x: 0, y: 0, vis: false };
    const ndcX = cx / cw, ndcY = cy / cw;
    return {
      x: (ndcX * 0.5 + 0.5) * this._cssW,
      y: (1 - (ndcY * 0.5 + 0.5)) * this._cssH,
      vis: true,
    };
  }

  _drawOverlay(orbit) {
    const ctx = this.octx;
    if (!ctx) return;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._cssW, this._cssH);

    const sim = this.sim, cam = this.cam;

    // --- nation / city name labels (low zoom = strategic readability) ---
    const showLabels = cam.zoom < 9;   // pulled back enough that labels help
    if (showLabels) {
      ctx.textAlign = 'center';
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      ctx.lineWidth = 3;
      for (let i = 0; i < sim.settlements.length; i++) {
        const s = sim.settlements[i];
        const p = this._project(s.x, s.y);
        if (!p.vis) continue;
        const tr = sim.tribes.get(s.tribeId);
        const hue = tr ? tr.hue : 205;
        const tierMark = ['•', '◦', '▣', '★'][s.tier | 0] || '•';
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.fillStyle = `hsl(${hue},75%,78%)`;
        const label = `${tierMark} ${s.name}`;
        ctx.strokeText(label, p.x, p.y - 14);
        ctx.fillText(label, p.x, p.y - 14);
      }
    }

    // --- selection ring (agent or tribe) ---
    const sel = this._selection;
    if (sel) {
      if (sel.agent && sel.agent.alive) {
        const p = this._project(sel.agent.x, sel.agent.y);
        if (p.vis) this._ring(ctx, p.x, p.y, 16, '#ffffff', [4, 3]);
      } else if (sel.tribe) {
        const p = this._project(sel.tribe.capitalX, sel.tribe.capitalY);
        if (p.vis) this._ring(ctx, p.x, p.y, 22, `hsl(${sel.tribe.hue},80%,70%)`);
      }
    }

    // --- RTS hand-selected units ---
    if (this.selected && this.selected.length) {
      ctx.strokeStyle = '#9cff7a'; ctx.lineWidth = 1.5;
      for (let i = 0; i < this.selected.length; i++) {
        const a = this.selected[i]; if (!a.alive) continue;
        const p = this._project(a.x, a.y);
        if (!p.vis) continue;
        ctx.beginPath(); ctx.arc(p.x, p.y - 8, 9, 0, 7); ctx.stroke();
      }
    }

    // --- drag-selection box (world coords -> screen) ---
    const b = this.selBox;
    if (b) {
      const p0 = this._project(b.x0, b.y0), p1 = this._project(b.x1, b.y1);
      if (p0.vis && p1.vis) {
        const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
        ctx.strokeStyle = 'rgba(156,255,122,0.9)';
        ctx.fillStyle = 'rgba(156,255,122,0.12)'; ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        ctx.strokeRect(x, y, Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      }
    }

    // --- army rally / move target ---
    if (this.armyTarget) {
      const p = this._project(this.armyTarget.x, this.armyTarget.y);
      if (p.vis) {
        const r = 9 + Math.sin(sim.tick * 0.15) * 2;
        ctx.strokeStyle = '#ff7755'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
        ctx.fillStyle = '#ff9a7a'; ctx.textAlign = 'center';
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('⚔', p.x, p.y + 5);
      }
    }

    // --- brush ghost (god tools) ---
    if (this.ghost) {
      const p = this._project(this.ghost.x, this.ghost.y);
      if (p.vis) {
        ctx.strokeStyle = this.ghost.color || 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, this.ghost.r * cam.zoom), 0, 7); ctx.stroke();
      }
    }

    // minimap (optional — same strategic overview the Canvas2D Renderer draws)
    this._drawMinimap();
  }

  _ring(ctx, x, y, r, color, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc(x, y - 8, r, 0, 7); ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  // Civ-style strategic minimap (cached terrain+territory base, live viewport box).
  // Mirrors the Canvas2D Renderer's minimap so a toggle keeps the same HUD.
  _drawMinimap() {
    const m = this.mctx;
    if (!m) return;
    const mw = this.mini.width, mh = this.mini.height, W = this.sim.world;
    if (!this._miniBase) {
      this._miniBase = document.createElement('canvas');
      this._miniBase.width = mw; this._miniBase.height = mh;
    }
    this._miniT++;
    if (this._miniT % 120 === 1) this._rebuildMiniBase();
    m.clearRect(0, 0, mw, mh);
    m.imageSmoothingEnabled = false;
    m.drawImage(this._miniBase, 0, 0);
    // live viewport: derive from the game camera (CSS px / zoom = tiles across)
    const cam = this.cam;
    const tilesW = this._cssW / cam.zoom, tilesH = this._cssH / cam.zoom;
    const rx = ((cam.x - tilesW / 2) / W.w) * mw, ry = ((cam.y - tilesH / 2) / W.h) * mh;
    const rw = (tilesW / W.w) * mw, rh = (tilesH / W.h) * mh;
    m.strokeStyle = 'rgba(255,255,255,0.9)'; m.lineWidth = 1;
    m.strokeRect(rx + 0.5, ry + 0.5, Math.max(2, rw), Math.max(2, rh));
  }

  _rebuildMiniBase() {
    const b = this._miniBase.getContext('2d'), W = this.sim.world;
    const mw = this.mini.width, mh = this.mini.height;
    b.imageSmoothingEnabled = false;
    // paint biome colors straight from the world (no shared terrain canvas dep)
    const img = b.createImageData(mw, mh);
    const data = img.data, sx = W.w / mw, sy = W.h / mh;
    const COL = {
      0:[40,78,120], 1:[74,130,175], 2:[221,205,156], 3:[126,174,95],
      4:[78,132,78], 5:[150,150,110], 6:[140,138,140], 7:[236,240,246],
    };
    const T = this.sim.territory, owner = T ? T.owner : null;
    for (let py = 0; py < mh; py++) {
      for (let px = 0; px < mw; px++) {
        const wx = (px * sx) | 0, wy = (py * sy) | 0;
        const wi = wy * W.w + wx;
        const c = COL[W.biome[wi]] || COL[3];
        let r = c[0], g = c[1], bl = c[2];
        if (owner) {
          const id = owner[wi];
          if (id) {
            const tr = this.sim.tribes.get(id);
            if (tr) {
              // blend toward the nation hue (cheap hsl→rgb-ish via the engine helper)
              const rgb = hslToRgb255(tr.hue, 0.6, 0.55);
              r = (r + rgb[0]) >> 1; g = (g + rgb[1]) >> 1; bl = (bl + rgb[2]) >> 1;
            }
          }
        }
        const o = (py * mw + px) * 4;
        data[o] = r; data[o+1] = g; data[o+2] = bl; data[o+3] = 255;
      }
    }
    b.putImageData(img, 0, 0);
  }

  // map a click on the minimap (px within the canvas) to a world point (parity
  // with the Canvas2D Renderer's miniToWorld).
  miniToWorld(px, py) {
    const W = this.sim.world;
    return { x: (px / this.mini.width) * W.w, y: (py / this.mini.height) * W.h };
  }

  dispose() {
    this.gl3d.dispose();
    if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
  }
}

// tiny hsl(0..360,0..1,0..1) -> [r,g,b] 0..255 for the minimap blend
function hslToRgb255(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    r = hue(h + 1/3); g = hue(h); b = hue(h - 1/3);
  }
  return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
}
