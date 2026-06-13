// Smooth camera. The zoom is the bridge between god altitude and ground level —
// one continuous space (research/02: two modes = two altitudes of one camera).
//
// COORD CONTRACT (perf/dpr): the camera works entirely in CSS / layout pixels
// (viewW/viewH are the CSS canvas size passed by Renderer.resize). The renderer
// applies the device-pixel-ratio as a ctx.scale(dpr,dpr) before drawing, so the
// dpr clamp / renderScale in renderer.js never touches this transform — zoom is
// always "CSS pixels per world tile". Do not multiply by dpr here.
export class Camera {
  constructor(world, viewW, viewH) {
    this.world = world;
    this.x = world.w / 2;   // world-tile coords at screen center
    this.y = world.h / 2;
    this.zoom = 4;          // pixels per tile
    this.tx = this.x; this.ty = this.y; this.tzoom = this.zoom;
    this.minZoom = 1.2;
    this.maxZoom = 42;
    this.viewW = viewW; this.viewH = viewH;
    this.follow = null;     // agent to follow (possession / nation focus)
  }

  resize(w, h) { this.viewW = w; this.viewH = h; }

  setTarget(x, y, zoom) {
    this.tx = x; this.ty = y;
    if (zoom != null) this.tzoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.tzoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.tzoom * factor));
    // keep cursor anchored: adjust target so the same world point stays under cursor
    this.zoom = this.tzoom; // apply instantly for anchor math
    const after = this.screenToWorld(screenX, screenY);
    this.tx += before.x - after.x;
    this.ty += before.y - after.y;
  }

  panBy(dxPx, dyPx) {
    this.tx -= dxPx / this.zoom;
    this.ty -= dyPx / this.zoom;
  }

  update() {
    if (this.follow && this.follow.alive) {
      this.tx = this.follow.x; this.ty = this.follow.y;
    }
    const k = 0.18;
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
    // clamp center so we don't fly off the world too far
    const marginX = this.viewW / this.zoom / 2;
    const marginY = this.viewH / this.zoom / 2;
    this.x = Math.max(-marginX * 0.3, Math.min(this.world.w + marginX * 0.3, this.x));
    this.y = Math.max(-marginY * 0.3, Math.min(this.world.h + marginY * 0.3, this.y));
    this.tx = Math.max(-marginX * 0.3, Math.min(this.world.w + marginX * 0.3, this.tx));
    this.ty = Math.max(-marginY * 0.3, Math.min(this.world.h + marginY * 0.3, this.ty));
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  // visible tile rectangle (for culling)
  viewBounds() {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.viewW, this.viewH);
    return {
      x0: Math.max(0, Math.floor(tl.x)),
      y0: Math.max(0, Math.floor(tl.y)),
      x1: Math.min(this.world.w, Math.ceil(br.x)),
      y1: Math.min(this.world.h, Math.ceil(br.y)),
    };
  }
}
