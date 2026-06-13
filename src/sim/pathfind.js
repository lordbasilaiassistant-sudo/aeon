// pathfind.js — cheap, cached A* + reusable BFS flow-fields for unit movement.
// PURE module: no sim/agent imports. Walkability is asked of the passed `world`
// via world.walkable(x,y) (bool) over the world.w x world.h tile grid.
//
// Two ways to use it:
//   findPath(world, sx, sy, tx, ty)  -> [{x,y}, ...] waypoints (or null)
//       One-shot A* on a coarse tile grid. Cheap (capped node budget), early-out,
//       and it caches the resulting field per target so many units sharing one
//       target reuse the work.
//   buildField(world, tx, ty)        -> Field   (BFS flow-field toward target)
//   stepFrom(field, x, y)            -> {x,y}    next tile to step to (or null)
//
// Coords are tile centers (integers). The integrator floors agent floats and
// asks for the next waypoint each tick.

// Max tiles a single flood expands. Must cover a whole continent or units on
// the far side of one landmass never get a path — the seed-7 200x130 world has
// a ~10.9k-tile main continent, so 4000 (the contract's cheap example) starves
// it. A BFS over typed Int arrays is microseconds even at 20k, and the field is
// cached+reused per target, so this stays cheap while remaining a hard ceiling
// against a pathological all-land world.
const NODE_CAP = 20000;       // max tiles expanded per flood (bounded, cheap)
const FIELD_TTL_MS = 4000;    // how long a cached flow-field stays valid

// 8-neighbour movement. Diagonals only allowed when both orthogonal sides are
// open, so units never clip a corner of water/mountain.
const N8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// ---- per-world cache of flow-fields, keyed by target tile -------------------
// WeakMap so fields die with their world; no manual cleanup needed.
const _cache = new WeakMap();

function _cacheFor(world) {
  let m = _cache.get(world);
  if (!m) { m = new Map(); _cache.set(world, m); }
  return m;
}

function _key(tx, ty) { return ty * 100003 + tx; }

/**
 * A BFS flow-field toward (tx,ty). `dist` holds step-count from target for
 * every reachable tile (Infinity/unset = unreachable or unexpanded). `dir`
 * holds, for each reachable tile, the index into N8 that walks one step closer.
 */
export class Field {
  constructor(world, tx, ty) {
    this.w = world.w;
    this.h = world.h;
    this.tx = tx | 0;
    this.ty = ty | 0;
    this.born = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const n = this.w * this.h;
    this.dist = new Int32Array(n).fill(-1); // -1 = not reached
    this.dir = new Int16Array(n).fill(-1);  // index into N8 toward target, -1 none
    this._build(world);
  }

  _idx(x, y) { return y * this.w + x; }

  _build(world) {
    const { w, h } = this;
    const tx = this.tx, ty = this.ty;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    // The target tile itself need not be walkable (a unit stops ADJACENT to a
    // city/resource), but if it is walkable we let units stand on it too.
    const startIdx = this._idx(tx, ty);
    this.dist[startIdx] = 0;
    let frontier = [startIdx];
    let expanded = 0;
    while (frontier.length && expanded < NODE_CAP) {
      const next = [];
      for (let f = 0; f < frontier.length; f++) {
        const ci = frontier[f];
        expanded++;
        if (expanded >= NODE_CAP) break;
        const cx = ci % w, cy = (ci / w) | 0;
        const cd = this.dist[ci];
        for (let k = 0; k < N8.length; k++) {
          const nx = cx + N8[k][0], ny = cy + N8[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = this._idx(nx, ny);
          if (this.dist[ni] !== -1) continue;       // already reached
          if (!world.walkable(nx, ny)) continue;     // blocked tile
          // no corner-cutting on diagonals
          if (N8[k][0] !== 0 && N8[k][1] !== 0) {
            if (!world.walkable(cx + N8[k][0], cy) || !world.walkable(cx, cy + N8[k][1])) continue;
          }
          this.dist[ni] = cd + 1;
          // dir points from neighbour BACK toward current (i.e. toward target):
          // the opposite of the step we just took.
          this.dir[ni] = _opposite(k);
          next.push(ni);
        }
      }
      frontier = next;
    }
    this.expanded = expanded;
  }

  reachable(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.dist[this._idx(x, y)] >= 0;
  }

  /** Next tile to step to from (x,y), or null if at/adjacent to target or stuck. */
  stepFrom(x, y) {
    return stepFrom(this, x, y);
  }
}

function _opposite(k) {
  // N8 pairs: 0<->1, 2<->3, 4<->7, 5<->6
  switch (k) {
    case 0: return 1; case 1: return 0;
    case 2: return 3; case 3: return 2;
    case 4: return 7; case 7: return 4;
    case 5: return 6; case 6: return 5;
  }
  return -1;
}

/** Build (or reuse from cache) a flow-field toward (tx,ty). */
export function buildField(world, tx, ty) {
  tx |= 0; ty |= 0;
  const m = _cacheFor(world);
  const key = _key(tx, ty);
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const cached = m.get(key);
  if (cached && (now - cached.born) < FIELD_TTL_MS) return cached;
  const field = new Field(world, tx, ty);
  m.set(key, field);
  return field;
}

/**
 * Given a flow-field and a current tile, return the next tile to move to that
 * is one step closer to the target, or null if there is no progress to make
 * (already at the target, adjacent to it, or stuck on an unreachable tile).
 */
export function stepFrom(field, x, y) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= field.w || y >= field.h) return null;
  const i = y * field.w + x;
  const d = field.dist[i];
  if (d <= 0) return null;            // unreached (-1) or already AT target (0)
  const k = field.dir[i];
  if (k < 0) return null;
  return { x: x + N8[k][0], y: y + N8[k][1] };
}

/**
 * One-shot path from (sx,sy) to (tx,ty). Returns an array of {x,y} tile
 * waypoints walking from near the start to adjacent-to / on the target, or
 * null if the target is unreachable within the node budget.
 *
 * opts.adjacent (default true): a path that ends on a tile ADJACENT to (tx,ty)
 *   counts as success even when the target tile itself is not walkable (so you
 *   can path to a city/resource/coast). When the target IS walkable, the path
 *   ends on it.
 */
export function findPath(world, sx, sy, tx, ty, opts = {}) {
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  const adjacent = opts.adjacent !== false;
  if (!world.inBounds || !world.inBounds(sx, sy)) {
    if (sx < 0 || sy < 0 || sx >= world.w || sy >= world.h) return null;
  }
  // Already there?
  if (sx === tx && sy === ty) return [];

  const targetWalkable = world.walkable(tx, ty);
  // If the target is unwalkable and we don't accept adjacency, there's no path.
  if (!targetWalkable && !adjacent) return null;

  // Reuse a cached flow-field toward the target when one exists — many units
  // sharing a target then cost ~O(path length) instead of a fresh search each.
  const field = buildField(world, tx, ty);

  // Success condition: target tile reached (if walkable) OR start can reach a
  // tile adjacent to the target (handled implicitly — the field floods out from
  // the target, so any walkable tile next to it has dist 1).
  if (!field.reachable(sx, sy)) {
    // Start itself might be unwalkable (agent standing on a coast float-floor);
    // try its walkable neighbours before giving up.
    let alt = null;
    for (let k = 0; k < N8.length; k++) {
      const nx = sx + N8[k][0], ny = sy + N8[k][1];
      if (world.walkable(nx, ny) && field.reachable(nx, ny)) { alt = { x: nx, y: ny }; break; }
    }
    if (!alt) return null;
    sx = alt.x; sy = alt.y;
  }

  // Walk the field gradient from start to target, collecting waypoints.
  const path = [];
  let cx = sx, cy = sy;
  let guard = world.w * world.h; // hard loop guard
  while (guard-- > 0) {
    const step = stepFrom(field, cx, cy);
    if (!step) break; // reached target tile (dist 0) or no further progress
    // If we accept adjacency and the next step would land ON an unwalkable
    // target, stop here — we're already adjacent.
    if (!targetWalkable && step.x === tx && step.y === ty) break;
    path.push(step);
    cx = step.x; cy = step.y;
    if (cx === tx && cy === ty) break;
  }

  if (path.length === 0) {
    // Start was already on/adjacent to a reachable target.
    if (adjacent && _isAdjacent(sx, sy, tx, ty)) return [];
    if (targetWalkable && sx === tx && sy === ty) return [];
    return null;
  }

  // Validate end: last waypoint must be the target (walkable case) or adjacent.
  const last = path[path.length - 1];
  const ok = (last.x === tx && last.y === ty) || (adjacent && _isAdjacent(last.x, last.y, tx, ty));
  if (!ok) return null;
  return path;
}

function _isAdjacent(x, y, tx, ty) {
  const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
  return dx <= 1 && dy <= 1 && (dx + dy) > 0;
}

export const PATHFIND_NODE_CAP = NODE_CAP;
export const PATHFIND_FIELD_TTL_MS = FIELD_TTL_MS;
