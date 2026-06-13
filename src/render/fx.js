// Juice: particles, screenshake, ring shockwaves, floating text.
// Research/02: juice is the single biggest cheap "great graphics" multiplier.
export class FX {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.flash = 0;       // full-screen flash 0..1
    this.flashColor = '255,255,255';
    // Quality tier set by the renderer ('low' | 'high'). On 'low' we emit fewer
    // particles per burst so weak/high-dpr devices spend far less fill on juice.
    // Capped so the particle array can't grow unbounded on weak hardware either.
    this.quality = 'high';
    this._maxParticles = 1400;
  }

  // particle budget per burst (0..1) — thinned on the low quality tier
  get _pScale() { return this.quality === 'low' ? 0.5 : 1; }

  burst(x, y, color, n = 14, spd = 2.2, life = 30) {
    n = Math.max(1, Math.round(n * this._pScale));
    if (this.particles.length > this._maxParticles) return;  // hard cap, weak HW guard
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.3 + Math.random());
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, max: life, color, r: 1 + Math.random() * 2,
      });
    }
  }

  ring(x, y, color, maxR = 8, life = 26) {
    this.rings.push({ x, y, r: 0, maxR, life, max: life, color });
  }

  text(x, y, str, color = '#fff') {
    this.texts.push({ x, y, str, color, life: 60, max: 60, vy: -0.04 });
  }

  addShake(amt) { this.shake = Math.min(24, this.shake + amt); }
  fullFlash(amt, color) { this.flash = Math.min(1, this.flash + amt); if (color) this.flashColor = color; }

  update() {
    const p = this.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const o = p[i];
      o.x += o.vx; o.y += o.vy; o.vx *= 0.92; o.vy *= 0.92; o.vy += 0.02;
      if (--o.life <= 0) p.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const o = this.rings[i];
      o.r += (o.maxR - o.r) * 0.18;
      if (--o.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const o = this.texts[i];
      o.y += o.vy;
      if (--o.life <= 0) this.texts.splice(i, 1);
    }
    this.shake *= 0.85;
    if (this.shake < 0.2) this.shake = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shake;
    this.shakeY = (Math.random() * 2 - 1) * this.shake;
    this.flash *= 0.88;
    if (this.flash < 0.01) this.flash = 0;
  }
}
