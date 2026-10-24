const DEFAULT_FORMULA = {
  outputToWork: 14,
  outputToBiz: 2,
  resultToBiz: 14,
  resultToWork: 2,
  maxRaw: 84
};

const DEFAULT_WEIGHTS = [3, 2, 1];

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function heightPct(raw, maxRaw) {
  const cap = num(maxRaw, 84);
  const n = num(raw, 0);
  if (cap <= 0) return 0;
  return Math.round((n / cap) * 100);
}

export function kindsFromWall(wall, stickers) {
  const byId = new Map();
  const list = Array.isArray(stickers) ? stickers : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item && typeof item.id === 'string') byId.set(item.id, item);
  }
  const slots = Array.isArray(wall) ? wall : [];
  const kinds = [];
  for (let i = 0; i < slots.length; i += 1) {
    const id = slots[i];
    if (typeof id !== 'string' || id === '') {
      kinds.push(null);
      continue;
    }
    const sticker = byId.get(id);
    kinds.push(sticker && sticker.kind === 'result' ? 'result' : 'output');
  }
  return kinds;
}

export function computeBars(kinds, formula, weights) {
  const f = formula && typeof formula === 'object' ? formula : DEFAULT_FORMULA;
  const w = Array.isArray(weights) && weights.length ? weights : DEFAULT_WEIGHTS;
  const list = Array.isArray(kinds) ? kinds : [];
  const n = Math.max(list.length, w.length);
  let rawWork = 0;
  let rawBiz = 0;
  for (let i = 0; i < n; i += 1) {
    const kind = list[i];
    if (kind !== 'output' && kind !== 'result') continue;
    const weight = num(w[i], 0);
    if (kind === 'result') {
      rawWork += weight * num(f.resultToWork, 2);
      rawBiz += weight * num(f.resultToBiz, 14);
    } else {
      rawWork += weight * num(f.outputToWork, 14);
      rawBiz += weight * num(f.outputToBiz, 2);
    }
  }
  const maxRaw = num(f.maxRaw, 84);
  return {
    raw_work: rawWork,
    raw_biz: rawBiz,
    heightPct_work: heightPct(rawWork, maxRaw),
    heightPct_biz: heightPct(rawBiz, maxRaw)
  };
}
