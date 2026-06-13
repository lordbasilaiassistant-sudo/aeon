// Visuals — pure stylized-render helpers the Renderer calls.
// Fixes the v0.1 look: muddy terrain, food-speck checkerboard, flat glow-dot
// agents, hazy gray post. Embraces clean pixel art (terrain baked 1px/tile,
// drawn with imageSmoothingEnabled=false) + cheap, contrast-preserving post.
//
// All functions are allocation-light in their hot paths: world->screen is
// inlined (no per-agent {x,y} objects), agent colors come from a small per-tribe
// LUT (no per-agent string building), and randomness is the deterministic
// hash2() — never the global Math.random (forbidden in the sim). Anything that
// touches `document` (the bloom buffer) is guarded so headless runs stay safe.
import { BIOME } from '../sim/world.js';
import { hash2 } from '../core/rng.js';

const TAU = Math.PI * 2;
const CARRY_COL = ['#6cae4a', '#b8b2a6', '#caa24a', '#cfd6dd']; // hauled load: wood, stone, ore, metal

// ---------------------------------------------------------------- terrain palette
// Richer, cohesive limited palette (improves on BIOME_COLOR). Value contrast
// carries the read; hues stay tight so the map feels like one world.
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
const SHALLOW = [82, 144, 176];  // water at the shoreline
const DEEPW   = [18, 40, 70];    // water in the abyss
const FOAM    = [172, 208, 214]; // beach shimmer
// per-biome texture amplitude (so big areas aren't flat)
const TEX_AMP = new Float32Array(8);
TEX_AMP[BIOME.DEEP] = 5;  TEX_AMP[BIOME.WATER] = 6;  TEX_AMP[BIOME.SAND] = 11;
TEX_AMP[BIOME.GRASS] = 12; TEX_AMP[BIOME.FOREST] = 15; TEX_AMP[BIOME.HILL] = 14;
TEX_AMP[BIOME.MOUNTAIN] = 18; TEX_AMP[BIOME.SNOW] = 8;

function lerp(a, b, t) { return a + (b - a) * t; }
function clampc(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
function _isWater(b) { return b === BIOME.DEEP || b === BIOME.WATER; }

/**
 * Bake crisp stylized terrain into the offscreen 1px-per-tile context.
 * Coastline outlines, depth-shaded water, per-biome dithering + texture
 * (dappled forest canopy, snow-capped peaks, dune variation), hillshade,
 * 8-neighbour foam/coastline. Mirrors renderer.bakeTerrain() (clears dirty).
 */
export function bakeTerrain(world, tctx) {
  const W = world, w = W.w, h = W.h;
  const elev = W.elev, moist = W.moist, biome = W.biome;
  const dev = W.dev;
  const sl = W.seaLevel;
  const img = tctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = biome[i];
      const e = elev[i];
      const water = (b === BIOME.DEEP || b === BIOME.WATER);
      let r, g, bl;

      if (water) {
        // shore -> abyss depth shade (eased so deep water reads dark fast)
        let depth = (sl - e) / 0.42;
        if (depth < 0) depth = 0; else if (depth > 1) depth = 1;
        depth = depth * depth * 0.85 + depth * 0.15;
        r = SHALLOW[0] + (DEEPW[0] - SHALLOW[0]) * depth;
        g = SHALLOW[1] + (DEEPW[1] - SHALLOW[1]) * depth;
        bl = SHALLOW[2] + (DEEPW[2] - SHALLOW[2]) * depth;
        const n = hash2(x, y, 7) - 0.5;   // faint surface ripple
        r += n * 5; g += n * 6; bl += n * 7;
        // gentle large-scale swell band — keeps open water from going flat
        const swell = (hash2(x >> 2, y >> 2, 23) - 0.5) * 4 * (1 - depth);
        r += swell; g += swell; bl += swell * 1.2;
      } else {
        const m = moist[i];
        if (b === BIOME.GRASS) {            // dry savanna -> lush meadow
          r = lerp(150, 92, m); g = lerp(166, 150, m); bl = lerp(92, 78, m);
        } else if (b === BIOME.FOREST) {
          r = lerp(86, 56, m); g = lerp(124, 104, m); bl = lerp(72, 64, m);
        } else {
          const p = PAL[b] || PAL[BIOME.GRASS];
          r = p[0]; g = p[1]; bl = p[2];
        }
        // high-freq dither (organic grain, no flat fills)
        const amp = TEX_AMP[b];
        const n = hash2(x, y, 2) - 0.5;
        r += n * amp; g += n * amp; bl += n * amp;
        // low-freq clumps -> canopy / patch variation on vegetation
        if (b === BIOME.FOREST || b === BIOME.GRASS) {
          const c = hash2(x >> 1, y >> 1, 5);
          if (c < 0.42) { r -= 8; g -= 6; bl -= 6; }
          else if (c > 0.78) { r += 6; g += 8; bl += 4; }
        }
        // dappled forest canopy — small sunlit leaves / shadow gaps for texture
        if (b === BIOME.FOREST) {
          const cn = hash2(x * 2, y * 2, 11);
          if (cn > 0.74) { r += 9; g += 13; bl += 5; }
          else if (cn < 0.28) { r -= 9; g -= 11; bl -= 6; }
        }
        // sand dune banding (subtle warm variation, not noise)
        if (b === BIOME.SAND) {
          const dn = hash2(x >> 1, y >> 1, 19);
          if (dn > 0.70) { r += 6; g += 5; }
          else if (dn < 0.30) { r -= 5; g -= 5; bl -= 3; }
        }
        // snow caps on the highest peaks (peaks read white, not just gray rock)
        if (b === BIOME.MOUNTAIN && e > 0.88) {
          let t = (e - 0.88) / 0.12; if (t > 1) t = 1;
          r = lerp(r, 232, t * 0.55); g = lerp(g, 236, t * 0.55); bl = lerp(bl, 244, t * 0.55);
        }
        // hillshade from elevation gradient (light from NW)
        const eL = elev[x > 0 ? i - 1 : i];
        const eU = elev[y > 0 ? i - w : i];
        let slope = (e - eL) + (e - eU);
        if (slope > 0.11) slope = 0.11; else if (slope < -0.11) slope = -0.11;
        const mul = 1 + slope * 2.7;
        r *= mul; g *= mul; bl *= mul;
        // developed land: farmland (cultivated rows) and urban (built-up stone)
        const dv = dev ? dev[i] : 0;
        if (dv === 1) {            // farmland — warm tilled patchwork
          const row = ((x + y) & 1) ? 1.06 : 0.93;
          r = lerp(r, 196 * row, 0.55); g = lerp(g, 168 * row, 0.55); bl = lerp(bl, 96 * row, 0.55);
        } else if (dv === 2) {     // urban — stone & rooftops
          r = lerp(r, 150, 0.6); g = lerp(g, 142, 0.6); bl = lerp(bl, 132, 0.6);
        }
      }

      // coastline: 8-neighbour test — dark outline on land, foam on water.
      // diagonals get a softer treatment so coves/corners read crisply.
      const bL = x > 0 ? biome[i - 1] : b;
      const bR = x < w - 1 ? biome[i + 1] : b;
      const bU = y > 0 ? biome[i - w] : b;
      const bD = y < h - 1 ? biome[i + w] : b;
      const bUL = (x > 0 && y > 0) ? biome[i - w - 1] : b;
      const bUR = (x < w - 1 && y > 0) ? biome[i - w + 1] : b;
      const bDL = (x > 0 && y < h - 1) ? biome[i + w - 1] : b;
      const bDR = (x < w - 1 && y < h - 1) ? biome[i + w + 1] : b;
      if (!water) {
        if (_isWater(bL) || _isWater(bR) || _isWater(bU) || _isWater(bD)) {
          r *= 0.72; g *= 0.72; bl *= 0.68;                       // hard shore line
        } else if (_isWater(bUL) || _isWater(bUR) || _isWater(bDL) || _isWater(bDR)) {
          r *= 0.86; g *= 0.86; bl *= 0.83;                       // soft corner darken
        }
      } else {
        const orthLand = !_isWater(bL) || !_isWater(bR) || !_isWater(bU) || !_isWater(bD);
        const diagLand = !_isWater(bUL) || !_isWater(bUR) || !_isWater(bDL) || !_isWater(bDR);
        if (orthLand) {
          r = lerp(r, FOAM[0], 0.38); g = lerp(g, FOAM[1], 0.38); bl = lerp(bl, FOAM[2], 0.38);
        } else if (diagLand && b === BIOME.WATER) {
          r = lerp(r, FOAM[0], 0.16); g = lerp(g, FOAM[1], 0.16); bl = lerp(bl, FOAM[2], 0.16);
        }
      }

      const o = i * 4;
      d[o] = clampc(r); d[o + 1] = clampc(g); d[o + 2] = clampc(bl); d[o + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  W.dirty = false;
}

// ---------------------------------------------------------------- agent color LUT
// Per-tribe color cache: 6 brightness buckets (by energy/health) for the tribe
// hue PLUS a parallel "predator" ramp (hue nudged toward red), a lighter head
// shade, dark limbs, and a speak-signal ring tint. Rebuilt only when a tribe's
// hue changes, so the per-agent draw loop allocates zero strings.
const LRAMP = [44, 50, 56, 62, 68, 74];
const _tribeLUT = new Map();
let _fallback = null;
const SHADOW_COL = 'rgba(8,10,16,0.30)';

// shortest-path hue blend toward red (predator warmth) — avoids 350->8 wraparound
function _redden(h, t) {
  let dd = ((6 - h + 540) % 360) - 180;   // signed shortest delta to 6deg
  return ((h + dd * t) % 360 + 360) % 360;
}

function _makeColors(hue) {
  const h = hue | 0;
  const ph = _redden(h, 0.42) | 0;
  const fill = new Array(6);
  const fillPred = new Array(6);
  for (let k = 0; k < 6; k++) {
    fill[k] = `hsl(${h},60%,${LRAMP[k]}%)`;
    fillPred[k] = `hsl(${ph},72%,${LRAMP[k] - 4}%)`;  // predators: warmer, a touch darker
  }
  return {
    hue, fill, fillPred,
    nub: `hsl(${h},70%,84%)`,        // light head (skin / banner identity)
    ring: `hsl(${h},85%,76%)`,       // speak-signal ring
    limb: `hsl(${h},55%,34%)`,       // dark legs / arms, tribe-tinted
    limbPred: `hsl(${ph},62%,30%)`,
  };
}

function _tribeColors(sim) {
  const m = _tribeLUT;
  const tribes = sim.tribes;
  if (m.size > tribes.size + 48) m.clear();   // prune long-game id churn
  for (const tr of tribes.values()) {
    const e = m.get(tr.id);
    if (!e || e.hue !== tr.hue) m.set(tr.id, _makeColors(tr.hue));
  }
  return m;
}

function _fallbackColors(hue) {
  if (!_fallback) {
    _fallback = new Array(24);
    for (let k = 0; k < 24; k++) _fallback[k] = _makeColors(k * 15);
  }
  let i = (hue / 15) | 0;
  if (i < 0) i = 0; else if (i > 23) i = 23;
  return _fallback[i];
}

// ---- visible-agent index buffer (reused every frame; no per-frame alloc) ----
// drawAgents fills this with the indices of alive, on-screen agents in ONE pass,
// so the shadow + body passes iterate only what's visible (not the whole pool).
// At high zoom most agents are off-screen, so this is the single biggest win.
let _visIdx = new Int32Array(4096);
function _ensureVis(n) {
  if (_visIdx.length < n) {
    let s = _visIdx.length; while (s < n) s <<= 1;
    _visIdx = new Int32Array(s);
  }
  return _visIdx;
}
// Parallel key buffer for the cheap batched tier: packs (colorBucket) per visible
// agent so we can flush rects grouped by fillStyle (group state changes, no
// per-agent string building). Key = bucket*2 + predFlag, 0..11 (6 light × 2).
let _visKey = new Int16Array(4096);
function _ensureKey(n) {
  if (_visKey.length < n) {
    let s = _visKey.length; while (s < n) s <<= 1;
    _visKey = new Int16Array(s);
  }
  return _visKey;
}

/**
 * Draw readable agents as little PEOPLE: head + torso + a hint of legs/arms,
 * shaded by tribe hue + vitality, with a subtle 2-frame walk shuffle off the
 * shared gait clock. Predators (high diet) tint redder. Detail rises with zoom
 * (specks when far, full figures up close); offscreen culled. Consumes
 * a.lastAct (one-frame eat/attack flash) like renderer.drawAgents did.
 *
 * PERF: one viewport-AABB cull pass builds a visible-index buffer, then the
 * draw tier is chosen from zoom AND on-screen count. When zoomed out OR many
 * agents are visible, every creature collapses to a cheap 1-2px rect batched by
 * tribe/vitality colour (grouped fillStyle changes; zero per-agent gradients,
 * shadowBlur or string building). The rich shaded figure (shadow + facing +
 * limbs + signal ring) is only paid when zoomed in AND few are on screen — the
 * close-zoom look the player actually sees is preserved exactly.
 */
export function drawAgents(ctx, cam, sim) {
  const A = sim.pool.agents;
  const n = A.length;
  const zoom = cam.zoom, vw = cam.viewW, vh = cam.viewH;
  const offx = vw * 0.5 - cam.x * zoom;
  const offy = vh * 0.5 - cam.y * zoom;
  const lut = _tribeColors(sim);
  const rScale = zoom * 0.17;

  // 1) VIEWPORT CULL — world-space AABB (+margin) computed ONCE, then a single
  // pass over the pool collects alive, on-screen agents into the index buffer.
  // Margin is the worst-case sprite half-extent in world tiles (~3.5 * size).
  const marginPx = rScale * 3.5 * 2 + 4;
  const wx0 = (-marginPx - offx) / zoom, wx1 = (vw + marginPx - offx) / zoom;
  const wy0 = (-marginPx - offy) / zoom, wy1 = (vh + marginPx - offy) / zoom;
  const vis = _ensureVis(n);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (!a.alive) { a.lastAct = 0; continue; }
    const ax = a.x, ay = a.y;
    if (ax < wx0 || ax > wx1 || ay < wy0 || ay > wy1) { a.lastAct = 0; continue; }
    vis[nv++] = i;
  }
  if (nv === 0) return;

  // 2) LEVEL OF DETAIL — tier from zoom AND on-screen count. Either zoomed out,
  // or a crowd on screen, drops to the cheap batched-rect tier (no shadows, no
  // ellipses/arcs). Rich creatures only when zoomed in AND the crowd is small.
  const far = zoom < 2.6;
  const cheap = far || zoom < 5 || nv > 700;   // batched specks, no figures
  const near = !cheap && zoom >= 6;            // facing/ring/arms/eyes

  // -------------------------------------------------- CHEAP TIER (batched rects)
  // Group by colour bucket so fillStyle changes once per bucket, not per agent.
  if (cheap) {
    const key = _ensureKey(nv);
    for (let k = 0; k < nv; k++) {
      const a = A[vis[k]];
      const pred = a.diet > 0.55 ? 1 : 0;
      let bi = (a.energy * 0.7 + a.health * 0.3) * 5 | 0;
      if (bi < 0) bi = 0; else if (bi > 5) bi = 5;
      key[k] = bi * 2 + pred;
    }
    // 12 vitality groups (6 light × normal/pred). Iterating group-major keeps
    // agents of the same brightness/predator class contiguous, so within a group
    // we only re-assign fillStyle when the *tribe colour string* actually changes
    // (cheap identity compare on the cached LUT string — no per-agent building).
    const minR = zoom < 2 ? 1 : 1.2;
    let cur = null;
    for (let g = 0; g < 12; g++) {
      const bi = g >> 1, pred = g & 1;
      for (let k = 0; k < nv; k++) {
        if (key[k] !== g) continue;
        const a = A[vis[k]];
        const col = sim.tribes.get(a.tribeId) ? lut.get(a.tribeId) : _fallbackColors(a.hue);
        const body = (pred ? col.fillPred : col.fill)[bi];
        if (body !== cur) { ctx.fillStyle = body; cur = body; }
        const sx = a.x * zoom + offx, sy = a.y * zoom + offy;
        let r = rScale * a.size; if (r < minR) r = minR;
        ctx.fillRect(sx - r, sy - r, r * 1.8, r * 1.8);
      }
    }
    return;   // lastAct already cleared during cull
  }

  // -------------------------------------------------- RICH TIER (close + sparse)
  // batched drop-shadow pass at the FEET (grounds the little figures)
  ctx.fillStyle = SHADOW_COL;
  ctx.beginPath();
  for (let k = 0; k < nv; k++) {
    const a = A[vis[k]];
    const sx = a.x * zoom + offx, sy = a.y * zoom + offy;
    let r = rScale * a.size; if (r < 0.9) r = 0.9;
    const cy = sy + r * 1.45, rx = r * 0.85, ry = r * 0.34;
    ctx.moveTo(sx + rx, cy);
    ctx.ellipse(sx, cy, rx, ry, 0, 0, TAU);
  }
  ctx.fill();

  // body pass — each agent is a little CREATURE (head + body + limbs), never a dot
  const walkPhase = (sim.tick % 24) / 24;   // shared gait clock (2-frame shuffle)
  for (let k = 0; k < nv; k++) {
    const a = A[vis[k]];
    const sx = a.x * zoom + offx, sy = a.y * zoom + offy;
    let r = rScale * a.size; if (r < 0.8) r = 0.8;

    const tr = sim.tribes.get(a.tribeId);
    const col = tr ? lut.get(a.tribeId) : _fallbackColors(a.hue);
    const pred = a.diet > 0.55;                       // predators read redder
    let bi = (a.energy * 0.7 + a.health * 0.3) * 5 | 0;
    if (bi < 0) bi = 0; else if (bi > 5) bi = 5;
    const body = (pred ? col.fillPred : col.fill)[bi];

    // facing + a 2-frame gait (legs swing opposite, torso bobs) while moving
    const sp = Math.hypot(a.vx, a.vy);
    const fx = sp > 0.001 ? a.vx / sp : 0;
    const moving = sp > 0.01;
    const gait = moving ? Math.sin((walkPhase + (a.id & 7) * 0.13) * TAU) : 0;
    // walk bob while moving; a slow breathing pulse while idle (resting creatures live)
    const bob = moving ? gait * r * 0.12 : Math.sin((walkPhase + (a.id & 7) * 0.5) * TAU * 0.6) * r * 0.045;
    const hr = r * 0.6;                       // head radius
    const torsoY = sy + r * 0.3 + bob;
    const headY = sy - r * 0.5 + bob;
    const limbCol = pred ? col.limbPred : col.limb;

    // legs (behind torso) — a 2-frame shuffle reads as walking when zoomed in
    if (r > 1.25) {
      ctx.fillStyle = limbCol;
      let lw = r * 0.26; if (lw < 1) lw = 1;
      const legY = torsoY + r * 0.6;
      const legLen = r * 0.55;
      const sw = gait * r * 0.28;
      ctx.fillRect(sx - r * 0.32 - lw * 0.5, legY, lw, legLen + sw);
      ctx.fillRect(sx + r * 0.32 - lw * 0.5, legY, lw, legLen - sw);
    }

    // torso (rounded body) in tribe colour, shaded by vitality
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(sx, torsoY, r * 0.62, r * 0.95, 0, 0, TAU);
    ctx.fill();
    // head (lighter tribe shade reads as a face/skin and keeps banner identity)
    ctx.fillStyle = col.nub;
    ctx.beginPath();
    ctx.arc(sx + fx * r * 0.22, headY, hr, 0, TAU);
    ctx.fill();
    // a hauler carries a load on its back — makes the gather→haul economy visible
    if (a.carryType >= 0 && r > 0.9) {
      ctx.fillStyle = CARRY_COL[a.carryType] || '#cfd6dd';
      const cs = r * 0.55;
      ctx.fillRect(sx - fx * r * 0.5 - cs * 0.5, torsoY - r * 0.55, cs, cs);
    }
    // a crewed vehicle the people earned — a boat (with mast) or a plane (wings)
    if (a.vehicle === 1) {
      ctx.fillStyle = '#6b4a2c';
      ctx.beginPath(); ctx.ellipse(sx, torsoY + r * 0.85, r * 1.45, r * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d8cdb0'; ctx.fillRect(sx - r * 0.07, torsoY - r * 0.5, r * 0.14, r * 1.3);
    } else if (a.vehicle === 2) {
      ctx.fillStyle = '#aeb6c2';
      ctx.fillRect(sx - r * 1.4, torsoY - r * 0.13, r * 2.8, r * 0.26);
      ctx.fillRect(sx - r * 0.22, torsoY - r * 0.55, r * 0.44, r * 1.1);
    }

    if (near) {
      // arms (in front of torso) swinging opposite the legs — a "hint of limbs"
      if (r > 1.4) {
        ctx.fillStyle = limbCol;
        let aw = r * 0.22; if (aw < 1) aw = 1;
        const armY = torsoY - r * 0.18;
        const asw = gait * r * 0.26;
        ctx.fillRect(sx - r * 0.6 - aw * 0.5, armY, aw, r * 0.5 - asw);
        ctx.fillRect(sx + r * 0.6 - aw * 0.5, armY, aw, r * 0.5 + asw);
      }
      // role kit: warriors carry a spear, rangers a bow (so unit types read on sight)
      if (r > 1.3) {
        if (a.role === 1) {
          const hx = sx + r * 0.72;
          ctx.strokeStyle = '#d8d2c2'; ctx.lineWidth = Math.max(1, r * 0.16);
          ctx.beginPath(); ctx.moveTo(hx, torsoY - r * 0.95); ctx.lineTo(hx, torsoY + r * 0.7); ctx.stroke();
          ctx.fillStyle = '#cdd2d8';
          ctx.beginPath(); ctx.moveTo(hx, torsoY - r * 1.18); ctx.lineTo(hx - r * 0.2, torsoY - r * 0.82); ctx.lineTo(hx + r * 0.2, torsoY - r * 0.82); ctx.closePath(); ctx.fill();
        } else if (a.role === 2) {
          ctx.strokeStyle = '#9fe3d0'; ctx.lineWidth = Math.max(1, r * 0.13);
          ctx.beginPath(); ctx.arc(sx - r * 0.7, torsoY, r * 0.58, -1.15, 1.15); ctx.stroke();
        }
      }
      // tiny eye dot facing the walk direction (only when really close)
      if (zoom > 13) {
        ctx.fillStyle = 'rgba(20,24,32,0.72)';
        const ex = sx + fx * r * 0.22 + fx * hr * 0.35;
        const es = hr * 0.28 < 1 ? 1 : hr * 0.28;
        ctx.fillRect(ex - es * 0.5, headY - es * 0.5, es, es);
      }
      if (a.signal > 0.12) {                  // 'speaking' (culture) — soft ring
        ctx.globalAlpha = a.signal * 0.45 > 0.5 ? 0.5 : a.signal * 0.45;
        ctx.strokeStyle = col.ring;
        ctx.lineWidth = r * 0.22 < 1 ? 1 : r * 0.22;
        ctx.beginPath();
        ctx.arc(sx, torsoY, r * 1.7, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (a.lastAct === 2) {                   // attack flash
        ctx.strokeStyle = '#ff5a44';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, torsoY, r * 1.7, 0, TAU);
        ctx.stroke();
      }
    }
    a.lastAct = 0;
  }
}

// ---------------------------------------------------------------- settlements
const TIER_NAMES = ['Camp', 'Village', 'Town', 'City'];
// unit cluster offsets (deterministic layout, no per-frame jitter)
const _CLUSTER = [
  [0, 0], [-0.85, 0.4], [0.85, 0.3], [-0.5, -0.7], [0.6, -0.6],
  [0, 0.95], [-1.05, -0.2], [1.05, -0.1], [0.2, -1.05],
];

function _tierNum(s) {
  if (typeof s.tier === 'number') {
    let t = s.tier | 0; return t < 0 ? 0 : t > 3 ? 3 : t;
  }
  if (s.tier != null) {
    const t = ('' + s.tier).toLowerCase();
    if (t.charCodeAt(0) === 99 && t[2] === 't') return 3; // city
    if (t[0] === 't') return 2;                            // town
    if (t[0] === 'v') return 1;                            // village
    if (t[0] === 'c') return 0;                            // camp
  }
  const p = s.pop || 0;
  return p >= 80 ? 3 : p >= 35 ? 2 : p >= 12 ? 1 : 0;
}

// a primitive camp dwelling: short mud wall + dominant conical thatch roof
function _drawHut(ctx, bx, by, u, roof, roofD) {
  const wallH = u * 0.7, wallW = u * 1.4;
  const wx = bx - wallW * 0.5, wy = by - wallH * 0.2;
  ctx.fillStyle = '#9a8466';
  ctx.fillRect(wx, wy, wallW, wallH);
  ctx.strokeStyle = '#6f5d45'; ctx.lineWidth = 1; ctx.strokeRect(wx, wy, wallW, wallH);
  // conical thatch (overhangs the wall)
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(bx - u, wy + 1);
  ctx.lineTo(bx, by - u * 1.35);
  ctx.lineTo(bx + u, wy + 1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = roofD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx, by - u * 1.35); ctx.lineTo(bx, wy + 1); ctx.stroke();
}

// a house/block whose ROOF shape tells the era: gable thatch/wood (era<2),
// shallower tiled gable (era 2), flat parapet w/ windows (era 3+).
function _drawBuilding(ctx, bx, by, bw, bh, era, wl, wd, roof, roofD, detail) {
  const x0 = bx - bw * 0.5, y0 = by - bh * 0.5;
  ctx.fillStyle = wl; ctx.fillRect(x0, y0, bw, bh);
  ctx.strokeStyle = wd; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, bw, bh);

  if (era >= 3) {
    // modern flat roof + parapet, hint of window rows
    ctx.fillStyle = roof; ctx.fillRect(x0, y0, bw, bh * 0.16 < 1 ? 1 : bh * 0.16);
    ctx.fillStyle = roofD; ctx.fillRect(x0, y0, bw, 1);
    if (detail && bw > 5) {
      ctx.fillStyle = 'rgba(40,55,78,0.55)';
      const ww = bw * 0.2, gap = bw * 0.18, step = ww + gap;
      for (let wy = y0 + bh * 0.32; wy < y0 + bh * 0.82; wy += bh * 0.3)
        for (let wx = x0 + gap; wx + ww < x0 + bw; wx += step)
          ctx.fillRect(wx, wy, ww, bh * 0.14 < 1 ? 1 : bh * 0.14);
    }
  } else {
    // pitched gable roof; thatch (era<2) is taller than tile (era 2)
    const peak = era >= 2 ? bh * 0.55 : bh * 0.8;
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x0 - bw * 0.12, y0);
    ctx.lineTo(bx, y0 - peak);
    ctx.lineTo(x0 + bw * 1.12, y0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = roofD; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, y0 - peak); ctx.lineTo(bx, y0); ctx.stroke();
    if (detail && bw > 4) {                 // a little door
      ctx.fillStyle = 'rgba(42,30,22,0.62)';
      ctx.fillRect(bx - bw * 0.16, y0 + bh * 0.45, bw * 0.32, bh * 0.55);
    }
  }
}

// crenellated wall ring for towns/cities (merlons along the top edge)
function _drawWalls(ctx, cx, cy, wr, bw, wl, era) {
  const x0 = cx - wr, y0 = cy - wr * 0.78, ww = wr * 2, wh = wr * 1.56;
  ctx.fillStyle = era >= 3 ? 'rgba(150,158,168,0.18)' : 'rgba(150,140,120,0.16)';
  ctx.fillRect(x0, y0, ww, wh);
  ctx.lineWidth = bw * 0.32 < 1.5 ? 1.5 : bw * 0.32;
  ctx.strokeStyle = wl;
  ctx.strokeRect(x0, y0, ww, wh);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.strokeRect(x0, y0, ww, wh);
  // merlons (battlements) along the top — pre-modern only
  if (era < 3) {
    const mw = bw * 0.45 < 1.5 ? 1.5 : bw * 0.45;
    const step = mw * 2;
    ctx.fillStyle = wl;
    for (let mx = x0; mx + mw <= x0 + ww; mx += step) {
      ctx.fillRect(mx, y0 - mw, mw, mw);
    }
  }
}

function _drawSettlement(ctx, cx, cy, zoom, tier, s, hue, era, tick, sid) {
  const h = hue | 0;
  if (zoom < 3) {                       // far: just a tier marker
    const rr = (1.5 + tier) * 0.9 + zoom * 0.25;
    ctx.fillStyle = 'rgba(8,10,16,0.5)';
    ctx.beginPath(); ctx.arc(cx + 0.5, cy + 0.8, rr, 0, TAU); ctx.fill();
    ctx.fillStyle = `hsl(${h},55%,${55 - tier * 4}%)`;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    return;
  }
  const bw = zoom * 0.55 < 2.5 ? 2.5 : zoom * 0.55;
  const cap = (s.buildings && s.buildings.length) || (2 + tier);
  let nb = 2 + tier; if (cap > nb) nb = cap; if (nb > 9) nb = 9;
  const spread = bw * (1.0 + tier * 0.35);
  const detail = zoom > 8;

  // ground shadow
  ctx.fillStyle = 'rgba(8,10,16,0.26)';
  ctx.beginPath(); ctx.arc(cx + 1, cy + bw * 0.5, spread * 1.2, 0, TAU); ctx.fill();

  // era-tinted materials (thatch/wood -> stone -> concrete) + tribe-hued roofs
  const wl = era >= 3 ? '#c6cdd6' : era >= 2 ? '#cabfa6' : '#c3b291';
  const wd = era >= 3 ? '#9aa3ad' : era >= 2 ? '#9c9077' : '#977f5f';
  const roof = `hsl(${h},48%,${era >= 3 ? 46 : 40}%)`;
  const roofD = `hsl(${h},48%,${era >= 3 ? 34 : 28}%)`;

  // fortification ring for towns/cities (crenellated)
  if (tier >= 2) {
    const wr = spread * (tier >= 3 ? 1.3 : 1.05);
    _drawWalls(ctx, cx, cy, wr, bw, wl, era);
  }

  // dwellings — camps are huts, settled tiers are houses/blocks by era
  for (let k = 0; k < nb; k++) {
    const off = _CLUSTER[k];
    const bx = cx + off[0] * spread * 0.6;
    const by = cy + off[1] * spread * 0.5;
    if (tier === 0) {
      _drawHut(ctx, bx, by, bw * 0.85, roof, roofD);
    } else {
      const bh = bw * (0.95 + (k % 3) * 0.18);
      _drawBuilding(ctx, bx, by, bw, bh, era, wl, wd, roof, roofD, detail);
    }
  }

  // central tower with roof cap for town/city
  if (tier >= 2) {
    const tw = bw * 0.85, th = bw * (1.6 + tier * 0.5);
    const tx = cx - tw * 0.5, ty = cy - th * 0.6;
    ctx.fillStyle = wl; ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = wd; ctx.lineWidth = 1; ctx.strokeRect(tx, ty, tw, th);
    if (era >= 3) {                       // modern: flat top + antenna
      ctx.fillStyle = roofD; ctx.fillRect(tx, ty, tw, 1.5);
      ctx.strokeStyle = wd; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, ty); ctx.lineTo(cx, ty - tw * 0.8); ctx.stroke();
    } else {                              // pre-modern: peaked roof cap
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.7, ty); ctx.lineTo(cx, ty - tw * 0.7); ctx.lineTo(cx + tw * 0.7, ty);
      ctx.closePath(); ctx.fill();
    }
  }

  // gentle chimney smoke (a little life) — deterministic drift off the tick
  if (zoom > 5 && tier >= 1 && era < 3) {
    const base = (tick * 0.012 + sid * 0.37);
    for (let p = 0; p < 2; p++) {
      let pr = (base + p * 0.5) % 1; if (pr < 0) pr += 1;
      const px = cx + Math.sin((pr * 3 + sid) * 1.9) * bw * 0.5;
      const py = cy - bw * 1.1 - pr * bw * 2.4;
      const rr = bw * 0.28 * (0.5 + pr);
      ctx.globalAlpha = 0.16 * (1 - pr);
      ctx.fillStyle = '#dde0e6';
      ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Draw sim.settlements as stylized building clusters by tier/era; names at high
 * zoom. Guards undefined/empty settlement list; offscreen culled.
 */
export function drawSettlements(ctx, cam, sim) {
  const S = sim.settlements;
  if (!S || S.length === 0) return;
  const zoom = cam.zoom, vw = cam.viewW, vh = cam.viewH;
  const offx = vw * 0.5 - cam.x * zoom;
  const offy = vh * 0.5 - cam.y * zoom;
  const tick = sim.tick || 0;
  const showNames = zoom > 6;
  if (showNames) {
    ctx.textAlign = 'center';
    const fs = zoom * 0.7; ctx.font = `${(fs < 9 ? 9 : fs > 16 ? 16 : fs) | 0}px ui-sans-serif, system-ui, sans-serif`;
  }
  // VIEWPORT CULL — world-space AABB (+margin in tiles) computed once; the
  // per-settlement pixel test below stays as the precise gate.
  const marginT = 48 / zoom + 2;
  const wx0 = -offx / zoom - marginT, wx1 = (vw - offx) / zoom + marginT;
  const wy0 = -offy / zoom - marginT, wy1 = (vh - offy) / zoom + marginT;
  // count visible first so heavy per-settlement smoke can be skipped in crowds
  let nvis = 0;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.x < wx0 || s.x > wx1 || s.y < wy0 || s.y > wy1) continue;
    nvis++;
  }
  const smoke = zoom > 4.5 && nvis <= 120;   // chimney plumes only when not a crowd
  const tribes = sim.tribes;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.x < wx0 || s.x > wx1 || s.y < wy0 || s.y > wy1) continue;
    const sx = (s.x + 0.5) * zoom + offx;
    const sy = (s.y + 0.5) * zoom + offy;
    const tier = _tierNum(s);
    const tr = tribes && tribes.get ? tribes.get(s.tribeId) : null;
    const hue = tr ? tr.hue : 205;
    const era = (tr && tr.tech && typeof tr.tech.era === 'number') ? tr.tech.era : 0;
    const sid = (s.id != null ? s.id : i) | 0;
    _drawSettlement(ctx, sx, sy, zoom, tier, s, hue, era, tick, sid);
    // chimney smoke — a living city breathes (more plumes for bigger tiers).
    // Skipped in dense crowds of settlements (the `smoke` LOD gate) to stay cheap.
    if (tier >= 1 && smoke) {
      const plumes = tier + 1;
      for (let q = 0; q < plumes; q++) {
        const ph = ((tick * 0.02 + sid * 0.37 + q * 0.31) % 1);
        const ox = Math.sin((sid + q) * 2.1) * zoom * 0.5;
        const px = sx + ox, py = sy - zoom * 0.4 - ph * zoom * 1.6;
        const rr = zoom * 0.1 * (0.5 + ph);
        ctx.fillStyle = `rgba(206,206,210,${(1 - ph) * 0.2})`;
        ctx.beginPath(); ctx.arc(px, py, rr < 0.8 ? 0.8 : rr, 0, TAU); ctx.fill();
      }
    }
    if (showNames) {
      const label = s.name || (tr ? tr.name : TIER_NAMES[tier]); // each city its own place-name
      const ty = sy - tier * zoom * 0.5 - 7;
      let alpha = (zoom - 6) / 4; if (alpha > 1) alpha = 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(label, sx + 1, ty + 1);
      ctx.fillStyle = `hsl(${hue | 0},60%,85%)`; ctx.fillText(label, sx, ty);
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * Subtle food cue: only when zoomed in, dim sparse flecks on high-food tiles
 * (NOT a checkerboard). At very high zoom the fleck reads as a little sprout.
 * Culled to cam.viewBounds().
 */
// Country borders: a colored edge wherever a nation's owned tile meets a different
// owner (or wilderness). Reads sim.territory.owner; culled to the viewport.
export function drawBorders(ctx, cam, sim) {
  const T = sim.territory;
  if (!T) return;
  const zoom = cam.zoom;
  if (zoom < 1.4) return;
  const owner = T.owner, W = sim.world, w = W.w, h = W.h;
  const vb = cam.viewBounds();
  const offx = cam.viewW * 0.5 - cam.x * zoom;
  const offy = cam.viewH * 0.5 - cam.y * zoom;
  ctx.lineWidth = Math.max(1.4, zoom * 0.16);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.92;
  for (let y = vb.y0; y < vb.y1; y++) {
    for (let x = vb.x0; x < vb.x1; x++) {
      const i = y * w + x;
      const o = owner[i];
      if (!o) continue;
      const up = y > 0 ? owner[i - w] : 0;
      const dn = y < h - 1 ? owner[i + w] : 0;
      const lf = x > 0 ? owner[i - 1] : 0;
      const rt = x < w - 1 ? owner[i + 1] : 0;
      if (up === o && dn === o && lf === o && rt === o) continue; // interior tile
      const tr = sim.tribes.get(o);
      if (!tr) continue;
      ctx.strokeStyle = `hsl(${tr.hue | 0},78%,62%)`;
      const sx = x * zoom + offx, sy = y * zoom + offy;
      ctx.beginPath();
      if (up !== o) { ctx.moveTo(sx, sy); ctx.lineTo(sx + zoom, sy); }
      if (dn !== o) { ctx.moveTo(sx, sy + zoom); ctx.lineTo(sx + zoom, sy + zoom); }
      if (lf !== o) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + zoom); }
      if (rt !== o) { ctx.moveTo(sx + zoom, sy); ctx.lineTo(sx + zoom, sy + zoom); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

// Animated water shimmer — moving sun-glints over the sea (the map breathes).
export function drawWaterShimmer(ctx, cam, sim) {
  const zoom = cam.zoom;
  if (zoom < 2) return;
  const W = sim.world, w = W.w, biome = W.biome, t = sim.tick;
  const vb = cam.viewBounds();
  const offx = cam.viewW * 0.5 - cam.x * zoom;
  const offy = cam.viewH * 0.5 - cam.y * zoom;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(170,212,236,0.12)';
  for (let y = vb.y0; y < vb.y1; y++) {
    for (let x = vb.x0; x < vb.x1; x++) {
      const b = biome[y * w + x];
      if (b !== BIOME.WATER && b !== BIOME.DEEP) continue;
      const ph = Math.sin(x * 0.7 + y * 0.45 + t * 0.05);
      if (ph < 0.86) continue;                       // sparse, drifting glints
      const sx = (x + 0.5) * zoom + offx, sy = (y + 0.5) * zoom + offy;
      ctx.fillRect(sx - zoom * 0.38, sy - zoom * 0.12, zoom * 0.76, zoom * 0.24);
    }
  }
  ctx.restore();
}

// Drifting clouds with soft ground shadows — cheap, high-atmosphere.
export function drawClouds(ctx, cam, sim) {
  const zoom = cam.zoom, t = sim.tick, W = sim.world;
  const offx = cam.viewW * 0.5 - cam.x * zoom;
  const offy = cam.viewH * 0.5 - cam.y * zoom;
  const span = W.w + 60;
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const sz = 0.4 + hash2(i, 3, 3) * 0.9;
    const drift = (hash2(i, 1, 1) * span + t * 0.012 * (0.5 + sz)) % span - 30;
    const wy = hash2(i, 2, 2) * W.h;
    const sx = drift * zoom + offx, sy = wy * zoom + offy;
    const r = (8 + sz * 16) * zoom * 0.16 + 24;
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.beginPath(); ctx.ellipse(sx + r * 0.18, sy + r * 0.22, r * 1.15, r * 0.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(246,249,255,0.09)';
    ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.25, r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx - r * 0.5, sy + r * 0.15, r * 0.7, r * 0.45, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Wildlife — prey (tan, antlered) & predators (grey, lean). Read distinctly from people.
export function drawAnimals(ctx, cam, sim) {
  const AN = sim.animals;
  if (!AN) return;
  const zoom = cam.zoom;
  if (zoom < 2.6) return;
  const L = AN.list, vw = cam.viewW, vh = cam.viewH;
  const offx = vw * 0.5 - cam.x * zoom, offy = vh * 0.5 - cam.y * zoom;
  const r = Math.max(1.2, zoom * 0.16);
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    if (!a.alive) continue;
    const sx = a.x * zoom + offx, sy = a.y * zoom + offy;
    if (sx < -6 || sy < -6 || sx > vw + 6 || sy > vh + 6) continue;
    if (a.type === 0) {                 // prey — tan, low body + tiny antler nub
      ctx.fillStyle = '#b79a6a';
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.1, r * 0.7, 0, 0, TAU); ctx.fill();
      if (zoom > 7) { ctx.fillStyle = '#7c6a4a'; ctx.fillRect(sx + r * 0.5, sy - r * 1.1, Math.max(1, r * 0.18), r * 0.9); }
    } else {                            // predator — grey, leaner, darker
      ctx.fillStyle = '#6b6f74';
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.2, r * 0.55, 0, 0, TAU); ctx.fill();
      if (zoom > 7) { ctx.fillStyle = '#4a4d52'; ctx.beginPath(); ctx.arc(sx + r * 0.9, sy - r * 0.2, r * 0.45, 0, TAU); ctx.fill(); }
    }
  }
}

// Resource nodes — wood / stone / ore. Shrink as they deplete (visible economy).
export function drawResources(ctx, cam, sim) {
  const R = sim.resources;
  if (!R) return;
  const zoom = cam.zoom;
  if (zoom < 3.5) return;
  const nodes = R.nodes;
  const offx = cam.viewW * 0.5 - cam.x * zoom;
  const offy = cam.viewH * 0.5 - cam.y * zoom;
  const vb = cam.viewBounds();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.amount <= 0) continue;
    if (n.x < vb.x0 - 1 || n.x > vb.x1 + 1 || n.y < vb.y0 - 1 || n.y > vb.y1 + 1) continue;
    const sx = n.x * zoom + offx, sy = n.y * zoom + offy;
    const s = zoom * (0.22 + 0.22 * (n.amount / n.max));
    if (n.type === 0) {                 // wood — a little tree
      ctx.fillStyle = '#3f7d3a'; ctx.beginPath(); ctx.arc(sx, sy - s * 0.25, s * 0.72, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(sx - s * 0.12, sy + s * 0.1, s * 0.24, s * 0.5);
    } else if (n.type === 1) {          // stone — a quarry block
      ctx.fillStyle = '#9a968f'; ctx.fillRect(sx - s * 0.5, sy - s * 0.42, s, s * 0.84);
      ctx.fillStyle = '#c2beb6'; ctx.fillRect(sx - s * 0.5, sy - s * 0.42, s, s * 0.26);
    } else {                            // ore — dark rock with a metal glint
      ctx.fillStyle = '#574d44'; ctx.fillRect(sx - s * 0.5, sy - s * 0.42, s, s * 0.84);
      ctx.fillStyle = '#e0a64c'; ctx.fillRect(sx - s * 0.26, sy - s * 0.16, s * 0.32, s * 0.32);
    }
  }
}

export function drawFood(ctx, cam, sim) {
  const zoom = cam.zoom;
  if (zoom < 9) return;                               // only a close-in cue, not a map texture
  const W = sim.world;
  const vb = cam.viewBounds();
  const offx = cam.viewW * 0.5 - cam.x * zoom;
  const offy = cam.viewH * 0.5 - cam.y * zoom;
  const base = zoom * 0.12;
  const sprout = zoom > 16;
  for (let y = vb.y0; y < vb.y1; y++) {
    const row = y * W.w;
    for (let x = vb.x0; x < vb.x1; x++) {
      const f = W.food[row + x];
      if (f < 0.78) continue;                          // only the lushest tiles
      if (hash2(x, y, 17) > 0.10) continue;            // very sparse scatter
      const jx = (hash2(x, y, 3) - 0.5) * 0.6;
      const jy = (hash2(x, y, 9) - 0.5) * 0.6;
      const px = (x + 0.5 + jx) * zoom + offx;
      const py = (y + 0.5 + jy) * zoom + offy;
      const sz = base * (0.6 + f * 0.5);
      if (sprout) {                                    // tiny stalk + leafy tuft
        ctx.fillStyle = 'rgba(96,150,76,0.32)';
        ctx.fillRect(px - sz * 0.12, py - sz * 0.2, sz * 0.24, sz * 0.9);
        ctx.fillStyle = 'rgba(150,205,120,0.34)';
        ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz * 0.5);
      } else {
        ctx.fillStyle = 'rgba(150,205,120,0.28)';
        ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
      }
    }
  }
}

// ---------------------------------------------------------------- post FX
// Persistent low-res buffer for cheap bloom (bright-pass via self-multiply, then
// lighter-composited so darks stay dark — no gray wash).
let _bloom = null, _bctx = null;

function _bloomCanvas(bw, bh) {
  if (typeof document === 'undefined') return null;
  if (!_bloom) { _bloom = document.createElement('canvas'); _bctx = _bloom.getContext('2d'); }
  if (_bloom.width !== bw || _bloom.height !== bh) { _bloom.width = bw; _bloom.height = bh; }
  return _bloom;
}

/**
 * Tasteful post: soft contrast-preserving bloom, gentle day/night (multiply, so
 * it darkens+cools without washing to gray), warm golden-hour tint, vignette,
 * and the god-power flash. Replaces renderer.drawDayNight().
 *
 * opts: { timeOfDay?:0..1, tick?:number, fx?:FX, bloom?:boolean }
 */
export function applyPost(ctx, cam, opts) {
  const vw = cam.viewW, vh = cam.viewH;
  const o = opts || 0;
  let t;
  if (o && typeof o.timeOfDay === 'number') t = o.timeOfDay;
  else if (o && typeof o.tick === 'number') t = (o.tick % 1440) / 1440;
  else t = 0.3;
  const fx = o && o.fx;
  const sun = Math.sin(t * TAU - Math.PI / 2) * 0.5 + 0.5; // 0 night .. 1 noon

  // --- bloom (reads the composed scene, lightens bright regions only) ---
  if (o.bloom !== false) {
    const src = ctx.canvas;
    const bw = (vw * 0.25) | 0, bh = (vh * 0.25) | 0;
    if (bw > 1 && bh > 1) {
      const bc = _bloomCanvas(bw, bh);
      if (bc) {
        _bctx.globalCompositeOperation = 'source-over';
        _bctx.imageSmoothingEnabled = true;
        _bctx.clearRect(0, 0, bw, bh);
        _bctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, bw, bh);
        // self-multiply => crushes darks, keeps brights = a cheap bright-pass
        _bctx.globalCompositeOperation = 'multiply';
        _bctx.drawImage(bc, 0, 0);
        _bctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16 + sun * 0.06;      // subtle glow on bright areas, not a haze
        ctx.drawImage(bc, 0, 0, bw, bh, 0, 0, vw, vh);
        ctx.restore();
      }
    }
  }

  // --- day/night via MULTIPLY (preserves saturation; never gray haze) ---
  const night = 1 - sun;
  if (night > 0.02) {
    // multiply tint: white = no-op (day), cool dim = night
    const amt = night * 0.55;
    const cr = clampc(255 - (255 - 150) * amt);
    const cg = clampc(255 - (255 - 165) * amt);
    const cb = clampc(255 - (255 - 215) * amt);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();
  }

  // --- warm golden hour at dawn/dusk (subtle) ---
  const golden = Math.max(0, 1 - Math.abs(sun - 0.28) * 4) * 0.10;
  if (golden > 0.005) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255,168,96,${golden})`;
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();
  }

  // --- vignette (gentle) ---
  const g = ctx.createRadialGradient(
    vw / 2, vh / 2, Math.min(vw, vh) * 0.36,
    vw / 2, vh / 2, Math.max(vw, vh) * 0.74);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vw, vh);

  // --- god-power full flash ---
  if (fx && fx.flash > 0.01) {
    ctx.fillStyle = `rgba(${fx.flashColor},${fx.flash * 0.5})`;
    ctx.fillRect(0, 0, vw, vh);
  }
}
