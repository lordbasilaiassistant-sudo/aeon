// Heritage traits — the few "leader/people" choices at Create-Your-People (Civ
// leader-ability flavor). Each expresses onto the founding genome (so the whole
// starting people inherits it) and may lean a starting policy or homeland.
// Shared by the sim (to apply) and the UI (to display the picker).
import { nudgeGene } from './brain.js';

export const HERITAGE = [
  { id: 'hardy', name: 'Hardy', icon: '🛡',
    desc: 'Resilient to cold & disease; longer-lived.',
    apply(g) { nudgeGene(g, 'resilience', 1.3); nudgeGene(g, 'lifespan', 0.8); } },
  { id: 'fertile', name: 'Fertile', icon: '🌱',
    desc: 'Your people breed fast and grow quickly.',
    apply(g) { nudgeGene(g, 'fertility', 1.4); } },
  { id: 'martial', name: 'Martial', icon: '⚔️',
    desc: 'Born warriors — stronger and bolder in battle.',
    apply(g) { nudgeGene(g, 'aggression', 1.1); nudgeGene(g, 'size', 0.4); },
    policy: { aggression: 0.3 } },
  { id: 'scholarly', name: 'Scholarly', icon: '📜',
    desc: 'Keen and curious — research advances faster.',
    apply(g) { nudgeGene(g, 'vision', 0.9); },
    policy: { research: 0.4 } },
  { id: 'swift', name: 'Swift', icon: '🐎',
    desc: 'Fleet-footed — your people move quickly.',
    apply(g) { nudgeGene(g, 'speed', 1.1); } },
  { id: 'verdant', name: 'Verdant', icon: '🌾',
    desc: 'Thrive on the land — efficient, peaceful foragers.',
    apply(g) { nudgeGene(g, 'metabolism', -0.6); nudgeGene(g, 'diet', -0.4); } },
  { id: 'seafaring', name: 'Seafaring', icon: '🌊',
    desc: 'Founded by the coast, drawn to the water.',
    apply(g) { nudgeGene(g, 'diet', 0.3); }, coastal: true },
];

export const HERITAGE_BY_ID = new Map(HERITAGE.map((h) => [h.id, h]));
