// Territory, borders, expansion & conquest. Borders are PERSISTENT and GROW
// outward from permanent cities (they never "move"); a nation spends GOLD to push
// its claim faster; and a people that can't defend its land LOSES it — an
// overwhelming enemy army captures a city, its territory and a share of its
// stockpile. owner[i] = tribe id holding tile i (0 = wilderness / water).
//
// Recomputed once per sim-year. Cheap: one pass over fighters bins them to the
// nearest city to decide sieges; expansion stamps only unclaimed land.
const YEAR = 60;
const MAXR_BY_TIER = [9, 13, 18, 24]; // how far a camp/village/town/city can ever reach
// Treasury reserve: auto-expansion will NOT spend a nation's gold below this floor,
// so a young nation can actually save up the ~10 gold needed to FOUND a city instead
// of having every coin instantly burned on border creep. Borders still grow for free
// (baseline 0.5/yr) and pay-to-push only kicks in once a nation is flush past the floor.
export const TREASURY_RESERVE = 12;

export class Territory {
  constructor(world) {
    this.w = world.w; this.h = world.h;
    this.owner = new Uint16Array(this.w * this.h); // PERSISTENT ownership
    this.areaByTribe = new Map();
  }

  update(sim) {
    if (sim.tick % YEAR !== 0) return;
    const W = sim.world, owner = this.owner, live = sim.tribes, dip = sim.diplomacy;
    const sl = sim.settlements || [];

    // --- 1) PEACEFUL EXPANSION — borders grow outward from fixed cities -------
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      const tr = live.get(s.tribeId);
      if (!tr || tr.members === 0) continue;
      if (s.claimR === undefined) s.claimR = 3;
      const maxR = MAXR_BY_TIER[s.tier] || 9;
      let grow = 0.5;                                   // baseline border creep / yr (FREE)
      // Pay-to-push: only spend the SURPLUS above the treasury reserve, never dip below
      // the floor — this lets a nation bank enough gold to FOUND a city.
      const surplus = tr.gold - TREASURY_RESERVE;
      if (surplus > 0) { const spend = Math.min(surplus, 4); tr.gold -= spend; grow += spend * 0.45; } // GOLD claims land

      if (s.claimR < maxR) s.claimR = Math.min(maxR, s.claimR + grow);
      this._stampUnowned(W, owner, s.x, s.y, s.claimR, s.tribeId);
      s._def = 0; s._atk = null;
    }

    // --- 2) MILITARY PASS — bin fighters to the nearest city (defenders vs besiegers)
    const A = sim.pool.agents;
    for (let k = 0; k < A.length; k++) {
      const a = A[k];
      if (!a.alive || (a.role !== 1 && a.role !== 2)) continue; // only soldiers project force
      let ns = null, nd = Infinity;
      for (let i = 0; i < sl.length; i++) {
        const s = sl[i];
        const reach = s.claimR + 4;
        const dx = s.x - a.x, dy = s.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < nd && d2 < reach * reach) { nd = d2; ns = s; }
      }
      if (!ns) continue;
      const at = live.get(a.tribeId);
      const force = a.strength * (at && at.caps ? at.caps.combat : 1);
      if (a.tribeId === ns.tribeId) ns._def += force;
      else if (dip && dip.hostile(sim, a.tribeId, ns.tribeId)) {
        if (!ns._atk) ns._atk = new Map();
        ns._atk.set(a.tribeId, (ns._atk.get(a.tribeId) || 0) + force);
      }
    }

    // --- 3) CONQUEST — an overwhelming besieger captures the city -------------
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      if (!s._atk) continue;
      let best = 0, bestId = 0;
      for (const [tid, f] of s._atk) if (f > best) { best = f; bestId = tid; }
      const defense = (s._def || 0) + s.tier * 6 + 4 + (s.defense || 0); // soldiers + tier + built walls
      if (bestId && best > defense * 1.4) {
        const newTr = live.get(bestId), oldTr = live.get(s.tribeId);
        if (newTr) {
          if (oldTr) {                                  // loot the conquered stockpile
            for (const r in oldTr.stock) { const take = oldTr.stock[r] * 0.4; oldTr.stock[r] -= take; newTr.stock[r] = (newTr.stock[r] || 0) + take; }
            const g = oldTr.gold * 0.4; oldTr.gold -= g; newTr.gold += g;
            newTr.kills += 3;
            if (dip) dip.addGrievance(sim, oldTr.id, newTr.id, 2);
          }
          this._reflag(W, owner, s.x, s.y, s.claimR, bestId); // the land changes banner
          s.tribeId = bestId; s.claimR = Math.max(4, s.claimR * 0.6);
          sim.emit('conquest', `${newTr.name} seizes ${s.name}${oldTr ? ' from ' + oldTr.name : ''}`, s.x, s.y, newTr.hue);
        }
      }
    }

    // --- 4) free extinct nations' land (every 5 yrs) + retally ----------------
    if (sim.tick % (YEAR * 5) === 0) {
      for (let i = 0; i < owner.length; i++) {
        const id = owner[i];
        if (id) { const t = live.get(id); if (!t || t.members === 0) owner[i] = 0; }
      }
    }
    this.areaByTribe.clear();
    for (let i = 0; i < owner.length; i++) {
      const id = owner[i];
      if (id) this.areaByTribe.set(id, (this.areaByTribe.get(id) || 0) + 1);
    }
  }

  // claim only UNCLAIMED land within radius (peaceful growth into wilderness)
  _stampUnowned(W, owner, cx, cy, r, id) {
    const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(this.w - 1, (cx + r) | 0);
    const y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(this.h - 1, (cy + r) | 0);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        if (W.isWater(x, y)) continue;
        const i = y * this.w + x;
        if (owner[i] === 0) owner[i] = id;
      }
    }
  }

  // a conqueror re-flags the captured city's land to its own banner
  _reflag(W, owner, cx, cy, r, id) {
    const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(this.w - 1, (cx + r) | 0);
    const y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(this.h - 1, (cy + r) | 0);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        if (W.isWater(x, y)) continue;
        owner[y * this.w + x] = id;
      }
    }
  }

  areaOf(tribeId) { return this.areaByTribe.get(tribeId) || 0; }
  ownerAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.owner[(y | 0) * this.w + (x | 0)];
  }
}
