// Procedural names with a dead-language flavor (Latin/Norse/Greek roots),
// for tribes, creatures and lineages. No AI-slop word salad.
import { } from '../core/rng.js';

const ON = ['ar', 'val', 'thor', 'myr', 'kel', 'dro', 'fen', 'gor', 'hal', 'ith',
  'jor', 'kry', 'lun', 'mor', 'nor', 'oth', 'pyr', 'quel', 'rok', 'syl',
  'tor', 'ulf', 'var', 'wyn', 'xan', 'yr', 'zel', 'aes', 'bru', 'caer'];
const MID = ['a', 'e', 'i', 'o', 'u', 'an', 'en', 'ir', 'or', 'ul', 'ae', 'ei', 'au'];
const END = ['dia', 'nia', 'mar', 'gard', 'heim', 'tia', 'mos', 'dor', 'wen', 'ric',
  'thal', 'vik', 'mire', 'fell', 'reach', 'hold', 'vale', 'spire', 'fen', 'crest'];

const TITLE = ['the People of', 'the Kin of', 'the Tribe of', 'the Children of',
  'the Banner of', 'the Free', 'the Old', 'the Wandering', 'the Ashen', 'the Verdant'];

export function tribeName(rng) {
  const root = cap(rng.pick(ON) + rng.pick(MID) + rng.pick(END));
  return rng.bool(0.4) ? `${rng.pick(TITLE)} ${root}` : root;
}

export function personName(rng) {
  let n = cap(rng.pick(ON) + rng.pick(MID));
  if (rng.bool(0.5)) n += rng.pick(END).slice(0, 3);
  return n;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
