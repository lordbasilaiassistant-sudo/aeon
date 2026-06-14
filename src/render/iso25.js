// iso25.js — a 2.5D ("basically 3D") look for AEON, pure Canvas2D, zero deps.
//
// WHY: the live top-down renderer (renderer.js / visuals.js) is flat — biome
// colour + a faint hillshade, but no real sense of HEIGHT. This module renders
// the SAME world with an OBLIQUE HEIGHT-EXTRUDED projection so the heightmap
// (world.elev) becomes visible relief: high ground sits higher on screen, every
// elevation step grows a darker CLIFF/SIDE face so land has real thickness, a
// directional SUN lights slopes (hillshade from the terrain normal), and water
// is a depth gradient with an animated shimmer + foam shoreline.
//
// It does NOT touch any existing file. It is a SEPARATE renderer used only by
// iso_demo.html, so the live game keeps working untouched.
//
// PROJECTION (the heart of the look):
//   screenX = (wx - cam.x) * zoom + viewW/2
//   screenY = (wy - cam.y) * zoom + viewH/2  -  height(wx,wy) * RELIEF * zoom * tilt
// i.e. a column is lifted straight up the screen by its elevation. This keeps
// tile (x,y) -> screenX a 1:1 map (so placing agents is trivial and cheap) while
// giving genuine vertical relief + side faces. `tilt` (0..1) scales the lift so
// the camera can flatten toward top-down or exaggerate toward a low angle.
//
// PERF MODEL (must stay smooth at 2000+ agents):
//  - The terrain is the expensive part, and it is STATIC, so we BAKE the whole
//    oblique terrain (top faces + cliff faces + water + hillshade + shoreline)
//    into ONE offscreen canvas ONCE per (tilt,relief) setting. Per frame we just
//    blit that canvas with a single transform — O(1) in tiles. Only the water
//    shimmer + moving entities are drawn live.
//  - Entities reuse the live renderer's playbook: a single viewport-cull pass
//    builds a visible-index buffer, a cheap LOD (batched specks when zoomed out
//    or crowded; little shadowed billboards when zoomed in), and depth sorting by
//    screenY only on the (small) visible set. Off-screen agents cost nothing.

import { BIOME } from '../sim/world.js';
import { hash2 } from '../core/rng.js';

const TAU = Math.PI * 2;

// ---- tunables -------------------------------------------------------------
// RELIEF: world-height -> tile-units of vertical lift. elev is 0..1; sea level
// ~0.42, peaks ~1, so land spans ~0.58 of a unit. RELIEF makes mountains read as
// mountains without the map sliding off the top of the screen.
const RELIEF = 9.0;          // elevation (0..1) -> lift in *tiles*
const SUN = normalize(-0.55, -0.62, 0.56); // light from the upper-left, slightly forward

// limited cohesive palette (mirrors visuals.js so the worlds feel like one game)
const PAL = {
  [BIOME.DEEP]:    [20, 44, 74],
  [BIOME.WATER]:   [78, 140, 172],
  [BIOME.SAND]:    [224, 206, 152],
  [BIOME.GRASS]:   [122, 168, 86],
  [BIOME.FOREST]:  [66, 118, 70],
  [BIOME.HILL]:    [160, 150, 104],
  [BIOME.MOUNTAIN]:[128, 124, 130],
  [BIOME.SNOW]:    [238, 242, 248],
};
const SHALLOW = [96, 158, 188];
const DEEPW   = [16, 36, 64];
const FOAM    = [188, 220, 224];
const CLIFF   = [60, 48, 40];   // exposed earth on the cliff faces (warm brown)

function normalize(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clampc(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

// ===========================================================================
//  TERRAIN BAKE  — the static oblique world, drawn ONCE into an offscreen cv.
// ===========================================================================
//
// We bake at a fixed CELL size (pixels per tile in the baked image); the live
// frame then scales that baked canvas to the current zoom. Baking columns from
// BACK (high screen, far Y) to FRONT (low screen, near Y) with side faces gives
// correct painter's-order occlusion: nearer/lower columns overpaint the bases of
// the ones behind, so cliffs read solid.
//
// Returns { canvas, cell, relief, tilt, baseY } where baseY is the extra top
// padding (px) reserved so the tallest lifted column doesn't clip off the top.

export class IsoTerrain {
  constructor(world) {
    this.world = world;
    this.cell = 6;          // baked px per tile (crisp but light: 160x110 -> ~960x660)
    this.tilt = 1.0;        // 0 flat .. 1 full relief
    this.canvas = null;
    this.ctx = null;
    this.baseY = 0;         // top padding in baked px
    this.bake();
  }

  // height of a tile in *tiles* of vertical lift (0 at/under sea, rising on land)
  liftAt(e) {
    const sl = this.world.seaLevel;
    if (e <= sl) return 0;                       // water surface is the datum
    return (e - sl) * RELIEF;                     // land rises above the sea plane
  }

  setTilt(t) {
    this.tilt = t < 0 ? 0 : t > 1 ? 1 : t;
    this.bake();
  }

  bake() {
    if (typeof document === 'undefined') return;  // headless guard
    const W = this.world, w = W.w, h = W.h;
    const cell = this.cell, tilt = this.tilt;
    const elev = W.elev, biome = W.biome, moist = W.moist, dev = W.dev, sl = W.seaLevel;

    // max lift (px) determines top padding so nothing clips off the top
    let maxLiftPx = 0;
    for (let i = 0; i < W.size; i++) {
      const lp = this.liftAt(elev[i]) * cell * tilt;
      if (lp > maxLiftPx) maxLiftPx = lp;
    }
    this.baseY = Math.ceil(maxLiftPx) + cell;

    const cw = w * cell;
    const ch = h * cell + this.baseY + cell * 2;   // pad bottom a touch too
    if (!this.canvas) { this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d'); }
    this.canvas.width = cw; this.canvas.height = ch;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;

    // baked screen position of the TOP-LEFT corner of tile (x,y)'s top face
    const px = (x) => x * cell;
    const py = (x, y, e) => this.baseY + y * cell - this.liftAt(e) * cell * tilt;

    // --- precompute per-tile top-face colour (biome + hillshade + dither) ---
    // We compute the lit top colour once, then draw faces. Water gets its own
    // depth-shaded path.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const b = biome[i];
        const e = elev[i];
        const water = (b === BIOME.DEEP || b === BIOME.WATER);
        const sx = px(x);

        if (water) {
          // ---- water: flat surface at the sea datum, depth-shaded + foam ----
          const sy = py(x, y, sl);            // water sits at sea level (no lift)
          let depth = (sl - e) / 0.42;
          if (depth < 0) depth = 0; else if (depth > 1) depth = 1;
          depth = depth * depth * 0.85 + depth * 0.15;
          let r = lerp(SHALLOW[0], DEEPW[0], depth);
          let g = lerp(SHALLOW[1], DEEPW[1], depth);
          let bl = lerp(SHALLOW[2], DEEPW[2], depth);
          const n = hash2(x, y, 7) - 0.5;
          r += n * 5; g += n * 6; bl += n * 7;
          // foam where water touches land orthogonally
          const land = this._touchesLand(x, y, w, h, biome);
          if (land) { r = lerp(r, FOAM[0], 0.34); g = lerp(g, FOAM[1], 0.34); bl = lerp(bl, FOAM[2], 0.34); }
          ctx.fillStyle = `rgb(${clampc(r)},${clampc(g)},${clampc(bl)})`;
          ctx.fillRect(sx, sy, cell, cell + 1);   // +1 hides seams
          continue;
        }

        // ---- land: top face colour ----
        const m = moist[i];
        let r, g, bl;
        if (b === BIOME.GRASS)      { r = lerp(150, 92, m); g = lerp(166, 150, m); bl = lerp(92, 78, m); }
        else if (b === BIOME.FOREST){ r = lerp(86, 56, m); g = lerp(124, 104, m); bl = lerp(72, 64, m); }
        else { const p = PAL[b] || PAL[BIOME.GRASS]; r = p[0]; g = p[1]; bl = p[2]; }
        // organic dither
        const dn = (hash2(x, y, 2) - 0.5) * 14;
        r += dn; g += dn; bl += dn;
        if (b === BIOME.FOREST) {       // dappled canopy
          const cn = hash2(x * 2, y * 2, 11);
          if (cn > 0.74) { r += 9; g += 13; bl += 5; } else if (cn < 0.28) { r -= 9; g -= 11; bl -= 6; }
        }
        if (b === BIOME.MOUNTAIN && e > 0.88) {   // snow caps
          let t = (e - 0.88) / 0.12; if (t > 1) t = 1;
          r = lerp(r, 232, t * 0.55); g = lerp(g, 236, t * 0.55); bl = lerp(bl, 244, t * 0.55);
        }
        // developed land
        const dv = dev ? dev[i] : 0;
        if (dv === 1) { const row = ((x + y) & 1) ? 1.06 : 0.93; r = lerp(r, 196 * row, 0.5); g = lerp(g, 168 * row, 0.5); bl = lerp(bl, 96 * row, 0.5); }
        else if (dv === 2) { r = lerp(r, 150, 0.55); g = lerp(g, 142, 0.55); bl = lerp(bl, 132, 0.55); }

        // ---- directional sun: shade the top face by the surface normal ----
        // normal from the elevation gradient (central differences in tile units)
        const eL = elev[x > 0 ? i - 1 : i], eR = elev[x < w - 1 ? i + 1 : i];
        const eU = elev[y > 0 ? i - w : i], eD = elev[y < h - 1 ? i + w : i];
        // gradient scaled by RELIEF (so steep mountains shade hard); normal = (-dz/dx,-dz/dy,1)
        const gx = (eR - eL) * 0.5 * RELIEF;
        const gy = (eD - eU) * 0.5 * RELIEF;
        const nrm = normalize(-gx, -gy, 1);
        let lit = nrm.x * SUN.x + nrm.y * SUN.y + nrm.z * SUN.z;   // -1..1
        // map to a soft multiplier: ambient + directional
        let mul = 0.62 + 0.55 * Math.max(0, lit);
        // a touch of ambient-occlusion in valleys (low spots darker)
        if (mul > 1.25) mul = 1.25;
        r *= mul; g *= mul; bl *= mul;

        const e0 = e;
        const lift0 = this.liftAt(e0);
        const sy = py(x, y, e0);

        // ---- CLIFF / SIDE FACE: the front (south) drop to the tile below ----
        // The visible side of an extruded column is the strip between this tile's
        // front edge and the front edge of the tile in front (y+1). Drawing it as
        // a darker face is what gives the land THICKNESS.
        const eFront = (y < h - 1) ? elev[i + w] : sl;          // tile in front
        const liftFront = this.liftAt(eFront);
        const dLift = (lift0 - liftFront) * cell * tilt;        // px the face is tall
        if (dLift > 0.5) {
          // face colour: darker, warm exposed earth, shaded by how much it faces away
          // from the sun (south-facing faces are lit a bit, but always darker than top)
          const faceLit = 0.40 + 0.30 * Math.max(0, SUN.z * 0.2 - SUN.y); // constant-ish
          let fr = lerp(CLIFF[0], r, 0.35) * faceLit * 1.4;
          let fg = lerp(CLIFF[1], g, 0.35) * faceLit * 1.4;
          let fb = lerp(CLIFF[2], bl, 0.35) * faceLit * 1.4;
          // vertical gradient: darker at the base (contact shadow), lighter near top
          const faceTopY = sy + cell;             // bottom edge of the top face
          const grd = ctx.createLinearGradient(0, faceTopY, 0, faceTopY + dLift);
          grd.addColorStop(0, `rgb(${clampc(fr)},${clampc(fg)},${clampc(fb)})`);
          grd.addColorStop(1, `rgb(${clampc(fr * 0.55)},${clampc(fg * 0.55)},${clampc(fb * 0.55)})`);
          ctx.fillStyle = grd;
          ctx.fillRect(sx, faceTopY, cell, dLift + 1);
        }

        // ---- the lit TOP face (drawn AFTER the face so it caps the column) ----
        ctx.fillStyle = `rgb(${clampc(r)},${clampc(g)},${clampc(bl)})`;
        ctx.fillRect(sx, sy, cell, cell + 1);

        // ---- coastline outline: darken a land tile that touches water ----
        if (this._touchesWater(x, y, w, h, biome)) {
          ctx.fillStyle = 'rgba(20,28,30,0.22)';
          ctx.fillRect(sx, sy, cell, cell + 1);
        }
      }
    }
  }

  _touchesWater(x, y, w, h, biome) {
    const i = y * w + x;
    const isW = (b) => b === BIOME.WATER || b === BIOME.DEEP;
    if (x > 0 && isW(biome[i - 1])) return true;
    if (x < w - 1 && isW(biome[i + 1])) return true;
    if (y > 0 && isW(biome[i - w])) return true;
    if (y < h - 1 && isW(biome[i + w])) return true;
    return false;
  }
  _touchesLand(x, y, w, h, biome) {
    const i = y * w + x;
    const isW = (b) => b === BIOME.WATER || b === BIOME.DEEP;
    if (x > 0 && !isW(biome[i - 1])) return true;
    if (x < w - 1 && !isW(biome[i + 1])) return true;
    if (y > 0 && !isW(biome[i - w])) return true;
    if (y < h - 1 && !isW(biome[i + w])) return true;
    return false;
  }
}

// ===========================================================================
//  ISO CAMERA  — pan / zoom / tilt, with the height-extruded projection.
// ===========================================================================
export class IsoCamera {
  constructor(world, viewW, viewH) {
    this.world = world;
    this.x = world.w / 2;
    this.y = world.h / 2;
    this.zoom = 6;
    this.tilt = 1.0;                 // 0 top-down .. 1 full relief
    this.tx = this.x; this.ty = this.y; this.tzoom = this.zoom; this.ttilt = this.tilt;
    this.minZoom = 2.0; this.maxZoom = 40;
    this.viewW = viewW; this.viewH = viewH;
  }
  resize(w, h) { this.viewW = w; this.viewH = h; }

  // vertical lift (in screen px) of a tile at elevation e
  liftPx(e) {
    const sl = this.world.seaLevel;
    if (e <= sl) return 0;
    return (e - sl) * RELIEF * this.zoom * this.tilt;
  }

  // project a world point at elevation e (defaults: look up tile elev)
  project(wx, wy, e) {
    if (e === undefined) {
      const W = this.world, ix = wx | 0, iy = wy | 0;
      e = (ix >= 0 && iy >= 0 && ix < W.w && iy < W.h) ? W.elev[iy * W.w + ix] : 0;
    }
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2 - this.liftPx(e),
    };
  }

  // screen -> world (ignores height; good enough for picking on the ground plane)
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.tzoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.tzoom * factor));
    this.zoom = this.tzoom;
    const after = this.screenToWorld(screenX, screenY);
    this.tx += before.x - after.x;
    this.ty += before.y - after.y;
  }
  panBy(dxPx, dyPx) { this.tx -= dxPx / this.zoom; this.ty -= dyPx / this.zoom; }
  setTilt(t) { this.ttilt = t < 0 ? 0 : t > 1 ? 1 : t; }

  update() {
    const k = 0.18;
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
    this.tilt += (this.ttilt - this.tilt) * k;
    const mx = this.viewW / this.zoom / 2, my = this.viewH / this.zoom / 2;
    this.x = Math.max(-mx * 0.3, Math.min(this.world.w + mx * 0.3, this.x));
    this.y = Math.max(-my * 0.3, Math.min(this.world.h + my * 0.3, this.y));
    this.tx = Math.max(-mx * 0.3, Math.min(this.world.w + mx * 0.3, this.tx));
    this.ty = Math.max(-my * 0.3, Math.min(this.world.h + my * 0.3, this.ty));
  }
}

// ===========================================================================
//  ISO RENDERER  — blits the baked terrain, then live shimmer + entities.
// ===========================================================================
export class IsoRenderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = sim;
    this.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5);
    this.cam = new IsoCamera(sim.world, canvas.width, canvas.height);
    this.terrain = new IsoTerrain(sim.world);
    this._lastBakeTilt = this.cam.tilt;
    this._dirtyWatch = sim.world.dirty;

    // reusable per-frame buffers (no per-frame allocation in the hot path)
    this._vis = new Int32Array(4096);
    this._depth = new Float64Array(4096);
    this._order = new Int32Array(4096);
    this._tribeLUT = new Map();
  }

  resize(w, h) {
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.resize(w, h);
  }

  _ensure(field, n) {
    let buf = this[field];
    if (buf.length < n) { let s = buf.length; while (s < n) s <<= 1; buf = new buf.constructor(s); this[field] = buf; }
    return buf;
  }

  // tribe colour cache: hsl strings per tribe hue, rebuilt only on hue change
  _colorsFor(hue) {
    let c = this._tribeLUT.get(hue);
    if (!c) {
      const h = hue | 0;
      c = {
        body: `hsl(${h},58%,52%)`,
        bodyLo: `hsl(${h},58%,40%)`,
        head: `hsl(${h},66%,80%)`,
        limb: `hsl(${h},52%,32%)`,
      };
      this._tribeLUT.set(hue, c);
    }
    return c;
  }

  render() {
    const ctx = this.ctx, cam = this.cam, W = this.sim.world;
    cam.update();

    // rebake terrain if the heightmap changed (divine edits) — rare
    if (W.dirty) { this.terrain.bake(); W.dirty = false; }

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.imageSmoothingEnabled = false;

    // sky gradient (a horizon makes the relief read as a landscape, not a map)
    const sky = ctx.createLinearGradient(0, 0, 0, cam.viewH);
    sky.addColorStop(0, '#0c1322');
    sky.addColorStop(0.55, '#10202f');
    sky.addColorStop(1, '#0a0d14');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    this._drawTerrain();
    this._drawWaterShimmer();
    this._drawEntities();
    this._applyPost();

    ctx.restore();
  }

  // Blit the baked oblique terrain. The bake maps tile (x,y) top-left to baked px
  // (x*cell, baseY + y*cell - lift). To place it on screen we align baked-tile
  // (0,0)'s GROUND row to where the camera projects world (0,0) at sea level,
  // then scale by zoom/cell. Because the bake already encodes per-column lift at
  // its own tilt, we only rebake when the *tilt* changes meaningfully.
  _drawTerrain() {
    const ctx = this.ctx, cam = this.cam, t = this.terrain;
    if (!t.canvas) return;
    if (Math.abs(cam.tilt - this._lastBakeTilt) > 0.04) { t.setTilt(cam.tilt); this._lastBakeTilt = cam.tilt; }

    const cell = t.cell;
    const scale = cam.zoom / cell;                 // baked px -> screen px
    // baked image origin (its pixel 0,0) in screen space.
    // baked (0,0) corresponds to world x=0, and screen-y there = top padding row.
    // World (0,0) at sea level projects to: sxy. In the baked image, world (0,0)'s
    // SEA-LEVEL row is at baked-y = baseY (since lift at sea = 0, y index 0).
    const originScreenX = (0 - cam.x) * cam.zoom + cam.viewW / 2;
    const seaTopScreenY = (0 - cam.y) * cam.zoom + cam.viewH / 2;   // world(0,0) sea-level, no lift
    const imgX = originScreenX;
    const imgY = seaTopScreenY - t.baseY * scale;

    const dw = t.canvas.width * scale;
    const dh = t.canvas.height * scale;
    // viewport cull: skip if entirely off-screen
    if (imgX > cam.viewW || imgY > cam.viewH || imgX + dw < 0 || imgY + dh < 0) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t.canvas, 0, 0, t.canvas.width, t.canvas.height, imgX, imgY, dw, dh);
  }

  // animated sun-glints over the sea — drawn live on top of the baked water so
  // the ocean breathes. Culled to the visible tile rect; sparse.
  _drawWaterShimmer() {
    const ctx = this.ctx, cam = this.cam, W = this.sim.world;
    if (cam.zoom < 3) return;
    const biome = W.biome, w = W.w, t = this.sim.tick;
    const tl = cam.screenToWorld(0, 0), br = cam.screenToWorld(cam.viewW, cam.viewH);
    const x0 = Math.max(0, tl.x | 0), x1 = Math.min(w, (br.x | 0) + 1);
    const y0 = Math.max(0, tl.y | 0), y1 = Math.min(W.h, (br.y | 0) + 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(150,196,224,0.10)';
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const b = biome[y * w + x];
        if (b !== BIOME.WATER && b !== BIOME.DEEP) continue;
        const ph = Math.sin(x * 0.7 + y * 0.45 + t * 0.05);
        if (ph < 0.86) continue;
        const p = cam.project(x + 0.5, y + 0.5, W.seaLevel);
        ctx.fillRect(p.x - cam.zoom * 0.36, p.y - cam.zoom * 0.1, cam.zoom * 0.72, cam.zoom * 0.2);
      }
    }
    ctx.restore();
  }

  // ---- entities: settlements + agents, depth-sorted, shadowed, lifted -------
  _drawEntities() {
    const ctx = this.ctx, cam = this.cam, sim = this.sim, W = this.sim.world;
    const A = sim.pool.agents, n = A.length;
    const zoom = cam.zoom;

    // world-space viewport AABB (+ generous margin for tall lifted columns)
    const tl = cam.screenToWorld(0, 0), br = cam.screenToWorld(cam.viewW, cam.viewH);
    const margin = 4 + (RELIEF * zoom) / zoom;   // a few tiles of slack
    const wx0 = tl.x - margin, wx1 = br.x + margin;
    // lifted entities appear HIGHER on screen, so the visible world-y band extends
    // BELOW the bottom edge by the max lift in tiles.
    const wy0 = tl.y - margin, wy1 = br.y + margin + RELIEF;

    // 1) cull pass -> visible indices + their depth key (screenY, for painter sort)
    const vis = this._ensure('_vis', n);
    const depth = this._ensure('_depth', n);
    let nv = 0;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      if (!a.alive) continue;
      const ax = a.x, ay = a.y;
      if (ax < wx0 || ax > wx1 || ay < wy0 || ay > wy1) continue;
      vis[nv] = i;
      // depth = ground screenY (without lift) so closer-to-front draws last;
      // ties broken slightly by x for stability
      depth[nv] = ay * 4096 + ax;
      nv++;
    }

    // settlements: collect into the same depth space so buildings & people
    // interleave correctly by row.
    const S = sim.settlements || [];
    const sVis = [];
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s.x < wx0 || s.x > wx1 || s.y < wy0 || s.y > wy1) continue;
      sVis.push({ s, key: s.y * 4096 + s.x });
    }

    // 2) LOD tier
    const far = zoom < 6 || nv > 800;
    const minR = zoom < 4 ? 1 : 1.3;

    // --- settlements first if far (they're big, draw under the speck swarm) ---
    // We depth-sort settlements always; agents only when in the rich tier (sort
    // cost is O(nv log nv) and nv is small when zoomed in — when far we skip it).
    sVis.sort((p, q) => p.key - q.key);

    if (far) {
      // settlements as simple lifted markers
      for (let k = 0; k < sVis.length; k++) this._drawSettlementFar(sVis[k].s);
      // agents: batched specks (cheap), no per-agent sort/shadow
      this._drawAgentSpecks(vis, nv, minR);
      return;
    }

    // --- RICH TIER: sort the visible agents by depth, draw shadows + billboards.
    // ord[] holds indices 0..nv-1 into vis[]/depth[], sorted by depth (screen Y),
    // so nearer-front agents (higher depth key) paint last and overlap correctly.
    const ord = new Array(nv);
    for (let k = 0; k < nv; k++) ord[k] = k;
    ord.sort((i, j) => depth[i] - depth[j]);

    // merge settlements + agents by depth key so a person in front of a hut
    // overlaps it correctly. Two pointers over the two pre-sorted lists.
    let si = 0;
    const drawAgentAt = (k) => this._drawAgentRich(A[vis[ord[k]]]);
    for (let k = 0; k < nv; k++) {
      const akey = depth[ord[k]];
      while (si < sVis.length && sVis[si].key <= akey) { this._drawSettlementNear(sVis[si].s); si++; }
      drawAgentAt(k);
    }
    while (si < sVis.length) { this._drawSettlementNear(sVis[si].s); si++; }
  }

  // batched specks (zoomed out / crowded). One fillStyle change per tribe colour
  // bucket would be ideal, but at this size a per-agent fill is already cheap and
  // the colours vary; we keep it simple and fast (no shadows, no arcs).
  _drawAgentSpecks(vis, nv, minR) {
    const ctx = this.ctx, cam = this.cam, sim = this.sim;
    const tribes = sim.tribes;
    let cur = null;
    for (let k = 0; k < nv; k++) {
      const a = sim.pool.agents[vis[k]];
      const tr = tribes.get(a.tribeId);
      const hue = tr ? tr.hue : a.hue;
      const col = this._colorsFor(hue);
      const light = a.energy > 0.5 ? col.body : col.bodyLo;
      if (light !== cur) { ctx.fillStyle = light; cur = light; }
      const p = cam.project(a.x, a.y);
      let r = cam.zoom * 0.16 * a.size; if (r < minR) r = minR;
      ctx.fillRect(p.x - r, p.y - r, r * 1.8, r * 1.8);
    }
  }

  // a little lifted billboard person with a soft cast shadow on the ground
  _drawAgentRich(a) {
    const ctx = this.ctx, cam = this.cam, sim = this.sim;
    const tr = sim.tribes.get(a.tribeId);
    const hue = tr ? tr.hue : a.hue;
    const col = this._colorsFor(hue);
    const p = cam.project(a.x, a.y);             // lifted (feet sit on terrain top)
    const ground = (a.y - cam.y) * cam.zoom + cam.viewH / 2; // un-lifted ground y
    const liftY = ground - p.y;                  // how far the feet are lifted
    let r = cam.zoom * 0.17 * a.size; if (r < 1) r = 1;

    // cast shadow on the GROUND (at the un-lifted position), offset by the sun.
    // A taller lift throws the shadow a bit further — sells the height.
    ctx.fillStyle = 'rgba(6,10,16,0.30)';
    const shx = p.x + liftY * 0.18 + r * 0.5;
    const shy = p.y + r * 1.5 + Math.min(liftY * 0.12, r * 2);
    ctx.beginPath();
    ctx.ellipse(shx, shy, r * 0.95, r * 0.4, 0, 0, TAU);
    ctx.fill();

    const moving = (a.vx * a.vx + a.vy * a.vy) > 0.0001;
    const sp = Math.hypot(a.vx, a.vy) || 1;
    const fx = moving ? a.vx / sp : 0;
    const bob = moving ? Math.sin((sim.tick + (a.id & 7) * 3) * 0.5) * r * 0.12 : 0;
    const torsoY = p.y - r * 0.2 + bob;
    const headY = p.y - r * 1.0 + bob;

    // legs
    if (r > 1.2) {
      ctx.fillStyle = col.limb;
      const lw = Math.max(1, r * 0.26);
      const sw = moving ? Math.sin(sim.tick * 0.5 + a.id) * r * 0.22 : 0;
      ctx.fillRect(p.x - r * 0.32 - lw * 0.5, torsoY + r * 0.55, lw, r * 0.6 + sw);
      ctx.fillRect(p.x + r * 0.32 - lw * 0.5, torsoY + r * 0.55, lw, r * 0.6 - sw);
    }
    // torso (rounded), shaded
    ctx.fillStyle = a.energy > 0.45 ? col.body : col.bodyLo;
    ctx.beginPath();
    ctx.ellipse(p.x, torsoY, r * 0.6, r * 0.92, 0, 0, TAU);
    ctx.fill();
    // head
    ctx.fillStyle = col.head;
    ctx.beginPath();
    ctx.arc(p.x + fx * r * 0.2, headY, r * 0.55, 0, TAU);
    ctx.fill();
    // carried load (visible economy)
    if (a.carryType >= 0 && r > 1) {
      ctx.fillStyle = ['#6cae4a', '#b8b2a6', '#caa24a', '#cfd6dd'][a.carryType] || '#cfd6dd';
      const cs = r * 0.5;
      ctx.fillRect(p.x - fx * r * 0.5 - cs * 0.5, torsoY - r * 0.5, cs, cs);
    }
    // speak ring (culture)
    if (a.signal > 0.12 && r > 1.2) {
      ctx.globalAlpha = Math.min(0.5, a.signal * 0.45);
      ctx.strokeStyle = col.head; ctx.lineWidth = Math.max(1, r * 0.2);
      ctx.beginPath(); ctx.arc(p.x, torsoY, r * 1.7, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // attack flash
    if (a.lastAct === 2) {
      ctx.strokeStyle = '#ff5a44'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, torsoY, r * 1.6, 0, TAU); ctx.stroke();
    }
    a.lastAct = 0;
  }

  _tierNum(s) {
    if (typeof s.tier === 'number') { let t = s.tier | 0; return t < 0 ? 0 : t > 3 ? 3 : t; }
    const p = s.pop || 0;
    return p >= 80 ? 3 : p >= 35 ? 2 : p >= 12 ? 1 : 0;
  }

  _drawSettlementFar(s) {
    const ctx = this.ctx, cam = this.cam, sim = this.sim;
    const tr = sim.tribes.get(s.tribeId);
    const hue = tr ? tr.hue : 205;
    const tier = this._tierNum(s);
    const p = cam.project(s.x + 0.5, s.y + 0.5);
    const rr = (1.6 + tier) * 0.9 + cam.zoom * 0.18;
    ctx.fillStyle = 'rgba(6,10,16,0.5)';
    ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 1, rr, 0, TAU); ctx.fill();
    ctx.fillStyle = `hsl(${hue | 0},55%,${56 - tier * 4}%)`;
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // a lifted little building cluster sitting on the terrain, with a cast shadow
  _drawSettlementNear(s) {
    const ctx = this.ctx, cam = this.cam, sim = this.sim;
    const tr = sim.tribes.get(s.tribeId);
    const hue = tr ? tr.hue : 205;
    const era = (tr && tr.tech && typeof tr.tech.era === 'number') ? tr.tech.era : 0;
    const tier = this._tierNum(s);
    const p = cam.project(s.x + 0.5, s.y + 0.5);
    const zoom = cam.zoom;
    const bw = Math.max(3, zoom * 0.5);
    const spread = bw * (1.0 + tier * 0.3);

    // ground shadow
    ctx.fillStyle = 'rgba(6,10,16,0.28)';
    ctx.beginPath(); ctx.ellipse(p.x + bw * 0.3, p.y + bw * 0.4, spread * 1.3, spread * 0.6, 0, 0, TAU); ctx.fill();

    const wl = era >= 3 ? '#c6cdd6' : era >= 2 ? '#cabfa6' : '#c3b291';
    const wd = era >= 3 ? '#9aa3ad' : era >= 2 ? '#9c9077' : '#977f5f';
    const roof = `hsl(${hue | 0},48%,${era >= 3 ? 46 : 40}%)`;
    const nb = Math.min(7, 2 + tier);
    const cluster = [[0, 0], [-0.85, 0.4], [0.85, 0.3], [-0.5, -0.7], [0.6, -0.6], [0, 0.95], [-1.05, -0.2]];
    for (let k = 0; k < nb; k++) {
      const off = cluster[k];
      const bx = p.x + off[0] * spread * 0.55;
      const by = p.y + off[1] * spread * 0.45;
      const h = bw * (0.9 + (k % 3) * 0.2);
      // wall block (lifted so it has a little body)
      ctx.fillStyle = wl;
      ctx.fillRect(bx - bw * 0.5, by - h * 0.5, bw, h);
      ctx.strokeStyle = wd; ctx.lineWidth = 1; ctx.strokeRect(bx - bw * 0.5, by - h * 0.5, bw, h);
      // gable roof (or flat for modern)
      ctx.fillStyle = roof;
      if (era >= 3) {
        ctx.fillRect(bx - bw * 0.5, by - h * 0.5, bw, Math.max(1, h * 0.16));
      } else {
        const peak = h * 0.7;
        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.6, by - h * 0.5);
        ctx.lineTo(bx, by - h * 0.5 - peak);
        ctx.lineTo(bx + bw * 0.6, by - h * 0.5);
        ctx.closePath(); ctx.fill();
      }
    }
    // name label at high zoom
    if (zoom > 9) {
      const label = s.name || (tr ? tr.name : 'Camp');
      ctx.textAlign = 'center';
      ctx.font = `${Math.min(15, zoom * 0.7) | 0}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(label, p.x + 1, p.y - spread - 5);
      ctx.fillStyle = `hsl(${hue | 0},60%,85%)`; ctx.fillText(label, p.x, p.y - spread - 6);
    }
  }

  // gentle day/night + vignette + golden hour, like the live post (no bloom — the
  // baked relief already carries the depth read; we keep post cheap).
  _applyPost() {
    const ctx = this.ctx, cam = this.cam;
    const t = (this.sim.tick % 1440) / 1440;
    const sun = Math.sin(t * TAU - Math.PI / 2) * 0.5 + 0.5;
    const night = 1 - sun;
    if (night > 0.02) {
      const amt = night * 0.5;
      const cr = clampc(255 - (255 - 150) * amt), cg = clampc(255 - (255 - 165) * amt), cb = clampc(255 - (255 - 215) * amt);
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`; ctx.fillRect(0, 0, cam.viewW, cam.viewH); ctx.restore();
    }
    const golden = Math.max(0, 1 - Math.abs(sun - 0.28) * 4) * 0.10;
    if (golden > 0.005) { ctx.fillStyle = `rgba(255,168,96,${golden})`; ctx.fillRect(0, 0, cam.viewW, cam.viewH); }
    const g = ctx.createRadialGradient(cam.viewW / 2, cam.viewH / 2, Math.min(cam.viewW, cam.viewH) * 0.36, cam.viewW / 2, cam.viewH / 2, Math.max(cam.viewW, cam.viewH) * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cam.viewW, cam.viewH);
  }
}
