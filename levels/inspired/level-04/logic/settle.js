import { ENDING_IDS } from './data-check.js';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function endingId(ending) {
  if (typeof ending === 'string') return ending;
  if (ending && typeof ending === 'object' && typeof ending.id === 'string') return ending.id;
  return '';
}

// Ordered save actions. Does not touch storage. hookOn means write nothing.
export function settlePlan(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (src.hookOn === true) return [];
  const short = num(src.short != null ? src.short : src.score, 0);
  const stars = num(src.stars, 0);
  if (src.passed === true) {
    const actions = [
      { op: 'clearResume' },
      { op: 'clearLevelRun' },
      { op: 'clearFailStreak' }
    ];
    const id = endingId(src.ending);
    if (src.seenEndingsOn === 'pass' && ENDING_IDS.includes(id)) {
      actions.push({ op: 'addSeenEnding', ending: id });
    }
    actions.push({ op: 'complete', stars, score: short, stay: true });
    return actions;
  }
  const prev = num(src.failStreak, 0);
  const base = prev > 0 ? Math.floor(prev) : 0;
  const next = base + 1;
  const actions = [
    { op: 'bumpFailStreak' },
    { op: 'rememberScore', stars, score: short }
  ];
  const need = Number(src.autoUnlockAfter);
  if (Number.isFinite(need) && next >= need) actions.push({ op: 'markAutoUnlocked' });
  return actions;
}
