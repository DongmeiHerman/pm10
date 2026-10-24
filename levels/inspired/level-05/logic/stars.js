const DEFAULT_TABLE = {
  0: 1,
  1: 1,
  2: 2,
  3: 3
};

export function countResults(kinds) {
  const list = Array.isArray(kinds) ? kinds : [];
  let n = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === 'result') n += 1;
  }
  return n;
}

export function starsFromResultCount(count, table) {
  const map = table && typeof table === 'object' ? table : DEFAULT_TABLE;
  const raw = Number(count);
  const key = Number.isFinite(raw) && raw > 0 ? String(Math.min(3, Math.floor(raw))) : '0';
  const n = Number(map[key]);
  if (Number.isFinite(n) && n >= 1) return Math.min(3, Math.floor(n));
  return 1;
}
