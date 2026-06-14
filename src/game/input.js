// Pointer + wheel + keyboard + pinch input -> game actions.
const TOOL_KEYS = {
  i: 'inspect', r: 'raise', l: 'lower', f: 'forest',
  s: 'spawn', b: 'food', x: 'smite', p: 'possess',
};

export function bindInput(game) {
  const canvas = game.canvas;
  const cam = game.cam;
  let dragging = false, panning = false, selecting = false, orbiting = false;
  let lastX = 0, lastY = 0, downX = 0, downY = 0, moved = 0;
  let selStart = null;
  const pointers = new Map();
  let pinchDist = 0;

  const isPanTool = () => game.tool === 'inspect' || game.tool === 'possess';

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // minimap: click/drag to jump the camera across the world (Civ-style)
  const mini = document.getElementById('minimap');
  if (mini) {
    let miniDrag = false;
    const jump = (e) => {
      const r = mini.getBoundingClientRect();
      const w = game.renderer.miniToWorld(e.clientX - r.left, e.clientY - r.top);
      game.cam.setTarget(w.x, w.y, game.cam.zoom);
    };
    mini.addEventListener('pointerdown', (e) => { miniDrag = true; mini.setPointerCapture(e.pointerId); jump(e); e.stopPropagation(); });
    mini.addEventListener('pointermove', (e) => { if (miniDrag) jump(e); });
    mini.addEventListener('pointerup', (e) => { miniDrag = false; });
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { // begin pinch
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      panning = false; dragging = false;
      return;
    }
    lastX = downX = e.clientX; lastY = downY = e.clientY; moved = 0;
    // RTS command mode: left button drags a selection box / clicks an order. Right
    // button still pans so you can reposition while commanding.
    if (game.use3D && e.button === 0 && e.shiftKey && !game.commandMode) {
      orbiting = true;                                   // 3D: Shift+left-drag rotates the camera
    } else if (game.commandMode && e.button === 0) {
      selecting = true;
      selStart = game.worldAt(e.clientX, e.clientY);
      if (selStart) game.selBox = { x0: selStart.x, y0: selStart.y, x1: selStart.x, y1: selStart.y };
    } else if (e.button === 2 || e.button === 1 || (isPanTool() && !e.shiftKey)) {
      panning = true;
    } else {
      dragging = true;
      const w = game.worldAt(e.clientX, e.clientY);
      if (w) game.applyTool(w.x, w.y, false);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // pinch zoom
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinchDist > 0) cam.zoomAt(mx, my, d / pinchDist);
      pinchDist = d;
      return;
    }

    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;

    // 3D orbit (Shift+left-drag) overrides everything else
    if (orbiting) { if (game.renderer.orbit) game.renderer.orbit(dx * 0.008, -dy * 0.008); return; }

    // brush ghost (god tools) — world point is null when a 3D ray misses the terrain
    const w = game.worldAt(e.clientX, e.clientY);
    if (!isPanTool() && w) {
      game.renderer.ghost = { x: w.x, y: w.y, r: game.brush, color: ghostColor(game.tool) };
    } else {
      game.renderer.ghost = null;
    }

    if (selecting && selStart && w) {
      game.selBox = { x0: selStart.x, y0: selStart.y, x1: w.x, y1: w.y };
    } else if (panning) {
      cam.panBy(dx, dy);
    } else if (dragging && w) {
      game.applyTool(w.x, w.y, true);
    }
  });

  const endPointer = (e) => {
    if (pointers.size <= 2) pinchDist = 0;
    pointers.delete(e.pointerId);
    if (orbiting) { orbiting = false; dragging = false; panning = false; return; }
    if (selecting) {
      const up = game.worldAt(e.clientX, e.clientY);
      if (up) {
        if (moved < 6) game.issueOrder(up.x, up.y);            // a click = order selected units
        else if (selStart) game.boxSelect(selStart.x, selStart.y, up.x, up.y); // a drag = select your units
      }
      game.selBox = null; selStart = null; selecting = false;
    } else if ((dragging || (panning && e.button === 0)) && moved < 5) {
      // a TAP (left-click, little movement) = a click: select/inspect/possess or use the tool.
      // A drag still pans. This is the intuitive Civ/RTS behavior — tap to pick, drag to move.
      const w = game.worldAt(downX, downY);
      if (w) game.applyTool(w.x, w.y, false);
    }
    dragging = false; panning = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
    cam.zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    game.keys.add(k);
    if (e.repeat) return;
    if (TOOL_KEYS[k]) { game.setTool(TOOL_KEYS[k]); return; }
    if (k === ' ') { e.preventDefault(); game.togglePause(); return; }
    if (k >= '1' && k <= '5') { game.speedIdx = +k - 1; game.ui.setSpeed(game.speed); return; }
    if (k === '[') { game.brush = Math.max(1, game.brush - 1); return; }
    if (k === ']') { game.brush = Math.min(20, game.brush + 1); return; }
    if (k === 'escape') {
      if (game.commandMode) { game.commandMode = false; game.selected = []; game.selBox = null; if (game.ui.setCommandBanner) game.ui.setCommandBanner(false); }
      else if (game.possessed) game.releasePossession();
      else if (game.mode === 'nation') game.ascend();
      else { game.selection = null; game.renderer.selection = null; game.ui.hideInspector(); }
    }
  });
  window.addEventListener('keyup', (e) => game.keys.delete(e.key.toLowerCase()));

  window.addEventListener('resize', () => game.resize());
}

function ghostColor(tool) {
  return {
    raise: 'rgba(220,200,170,0.7)', lower: 'rgba(120,180,220,0.7)',
    forest: 'rgba(110,200,90,0.7)', food: 'rgba(200,220,110,0.7)',
    spawn: 'rgba(255,255,255,0.8)', smite: 'rgba(255,90,70,0.85)',
  }[tool] || 'rgba(255,255,255,0.6)';
}
