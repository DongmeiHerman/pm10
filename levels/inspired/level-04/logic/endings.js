import { ENDING_IDS } from './data-check.js';

export const THREE_STAR_ENDING = 'empowered';
export const FALLBACK_ENDING = 'factory';

function allowIds(known) {
  const base = Array.isArray(known) ? known : ENDING_IDS;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < base.length; i++) {
    const id = base[i];
    if (typeof id !== 'string' || !ENDING_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// names: a flat id -> string map, or data.endings where each id has .name.
export function endingName(ending, names) {
  const id = typeof ending === 'string'
    ? ending
    : (ending && typeof ending === 'object' && typeof ending.id === 'string' ? ending.id : '');
  if (!ENDING_IDS.includes(id)) return '';
  const table = names && typeof names === 'object' ? names : null;
  if (!table) return '';
  const row = table[id];
  if (typeof row === 'string') return row;
  if (row && typeof row === 'object' && typeof row.name === 'string') return row.name;
  return '';
}

// Keep the four frozen ids only. Not an array becomes []. First-seen order, no dupes.
export function normalizeSeen(seen, known) {
  const allow = new Set(allowIds(known));
  const list = Array.isArray(seen) ? seen : [];
  const out = [];
  const got = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item !== 'string' || !allow.has(item) || got.has(item)) continue;
    got.add(item);
    out.push(item);
  }
  return out;
}

export function mergeSeen(seen, ending, known) {
  const out = normalizeSeen(seen, known);
  const id = typeof ending === 'string'
    ? ending
    : (ending && typeof ending === 'object' && typeof ending.id === 'string' ? ending.id : '');
  if (!id || !allowIds(known).includes(id) || out.includes(id)) return out;
  out.push(id);
  return out;
}

export function countLeft(seen, known) {
  const allow = allowIds(known);
  const have = new Set(normalizeSeen(seen, known));
  let left = 0;
  for (let i = 0; i < allow.length; i++) if (!have.has(allow[i])) left += 1;
  return left;
}

function countKind(typeId, types) {
  const list = Array.isArray(types) ? types : [];
  const row = list.find((item) => item && item.id === typeId);
  if (row && row.countAs) return row.countAs;
  if (typeId === 'timeout') return 'loud';
  return typeId;
}

function endingIdFor(kind, endings) {
  if (endings && typeof endings === 'object') {
    for (const id of Object.keys(endings)) {
      if (id === 'rule') continue;
      if (endings[id] && endings[id].from === kind) return id;
    }
  }
  return FALLBACK_ENDING;
}

// 3 stars is empowered. Otherwise count wrong types; timeout uses types[].countAs.
// A tie goes to whichever type appeared last. No wrong type falls back to factory.
export function pickEnding(choices, spec) {
  const list = Array.isArray(choices) ? choices : [];
  const ctx = spec && typeof spec === 'object' ? spec : {};
  if (Number(ctx.stars) === 3) return THREE_STAR_ENDING;
  const counts = {};
  const last = {};
  for (let i = 0; i < list.length; i++) {
    const kind = countKind(list[i], ctx.types);
    if (!kind || kind === 'own') continue;
    counts[kind] = (counts[kind] || 0) + 1;
    last[kind] = i;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return FALLBACK_ENDING;
  let best = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const kind = keys[i];
    const more = counts[kind] > counts[best];
    const tieLater = counts[kind] === counts[best] && last[kind] > last[best];
    if (more || tieLater) best = kind;
  }
  return endingIdFor(best, ctx.endings);
}
