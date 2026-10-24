function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampStars(value) {
  const n = Math.round(num(value, 1));
  if (n < 1) return 1;
  if (n > 3) return 3;
  return n;
}

// This level always passes (1 star still clears). hookOn writes nothing.
// Never emit bumpFailStreak.
export function settlePlan(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (src.hookOn === true) return [];
  const stars = clampStars(src.stars);
  const score = src.score != null ? num(src.score, stars) : stars;
  return [
    { op: 'clearResume' },
    { op: 'clearLevelRun' },
    { op: 'clearFailStreak' },
    { op: 'complete', stars, score, stay: true }
  ];
}
