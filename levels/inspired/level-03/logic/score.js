export const PASS_AT = 13;
export const STAR_THRESHOLDS = { 1: 13, 2: 15, 3: 18 };
export const SCORE_RIGHT = 2;
export const SCORE_COSTLY = 0;
export const SCORE_UNCLEAR = 0;
export const SCORE_BUILD = -1;
export const SCORE_MISSED = 0;
export const SCORE_FLOOR = 0;

export const DEFAULT_SCORING = {
  right: SCORE_RIGHT,
  costly: SCORE_COSTLY,
  unclear: SCORE_UNCLEAR,
  build: SCORE_BUILD,
  missed: SCORE_MISSED,
  floor: SCORE_FLOOR
};

export function gradeOf(idea, toolId) {
  if (toolId === 'build') return 'build';
  const needs = !!(idea && idea.needsClick);
  if (toolId === 'click') return needs ? 'right' : 'costly';
  if (toolId === 'paper') return needs ? 'unclear' : 'right';
  return 'unclear';
}

export function deltaOf(grade, scoring) {
  const table = scoring && typeof scoring === 'object' ? scoring : DEFAULT_SCORING;
  const n = Number(table[grade]);
  return Number.isFinite(n) ? n : 0;
}

export function roundScore(deltas, scoring) {
  const list = Array.isArray(deltas) ? deltas : [];
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += Number(list[i]) || 0;
  const floor = scoring && Number.isFinite(Number(scoring.floor)) ? Number(scoring.floor) : SCORE_FLOOR;
  return Math.max(floor, sum);
}

export function starsFor(total, thresholds) {
  const th = thresholds && typeof thresholds === 'object' ? thresholds : STAR_THRESHOLDS;
  let best = 0;
  for (let s = 1; s <= 3; s++) {
    const raw = th[s] != null ? th[s] : th[String(s)];
    const need = Number(raw);
    if (Number.isFinite(need) && total >= need) best = s;
  }
  return best;
}

export function didPass(total, passAt) {
  const line = Number.isFinite(Number(passAt)) ? Number(passAt) : PASS_AT;
  return total >= line;
}
