// Tribes / nations. Emergent: creatures cluster by kinship & proximity into
// tribes that claim territory, accumulate culture, war and trade.
//
// KEY to the "play as a nation" pillar: a tribe carries a POLICY (will vector).
// When the player leads a tribe, that will is injected into every member's
// neural INPUTS (will_aggression / will_expansion / will_breed) — the citizens'
// own evolved brains then decide how to act on it. The player steers; they never
// puppeteer. (research/02 — indirect steering, never per-agent control.)
import { tribeName } from './names.js';

let _nextTribeId = 1;

export class Tribe {
  constructor(rng, hue, founderGenome) {
    this.id = _nextTribeId++;
    this.name = tribeName(rng);
    this.hue = hue;                 // 0..360 banner color
    this.founder = founderGenome;   // genetic centroid (for species identity)
    this.members = 0;
    this.births = 0;
    this.deaths = 0;
    this.kills = 0;
    this.peakMembers = 0;
    this.foundedYear = 0;
    this.capitalX = 0;
    this.capitalY = 0;
    this.territory = 0;             // tile count of influence
    this.culture = 0;              // accumulates from 'speak' acts -> research/cohesion
    // tribe.tech ({points,known:Set,era}) + tribe.caps are attached by
    // TechSystem.initTribe; tribe.lang + tribe.religion by Culture.initTribe.
    this.isPlayer = false;

    // policy / national will — what the player (or an emergent drift) pushes
    this.policy = {
      aggression: 0,  // -1 pacifist .. +1 warlike
      expansion: 0,   // -1 stay home .. +1 spread
      breed: 0,       // -1 restraint .. +1 grow fast
      research: 0,    // -1 isolationist .. +1 tech-focused (steerResearch + aiTurn)
    };
    this.rally = null;    // {x,y} civilian rally / new-settlement point
    this.warRally = null; // {x,y} where the army (warriors/rangers) marches — player/AI command
    this.stock = { wood: 0, stone: 0, ore: 0, metal: 0 }; // stockpile; metal = refined ore
    this.gold = 0;     // treasury — funds territorial expansion (claim new land)
    // running center-of-mass for capital placement
    this._sx = 0; this._sy = 0; this._n = 0;
  }

  beginFrame() { this._sx = 0; this._sy = 0; this._n = 0; this.members = 0; }

  noteMember(x, y) {
    this._sx += x; this._sy += y; this._n++; this.members++;
  }

  endFrame() {
    if (this._n > 0) {
      this.capitalX = this._sx / this._n;
      this.capitalY = this._sy / this._n;
    }
    if (this.members > this.peakMembers) this.peakMembers = this.members;
  }
}

export function hueToCss(h, s = 65, l = 55) {
  return `hsl(${h | 0}, ${s}%, ${l}%)`;
}
