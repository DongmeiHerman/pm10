export const PASS_AT = 13;
export const BAR_MAX = 16;
export const STAR_THRESHOLDS = { 1: 13, 2: 14, 3: 16 };

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// Add the type delta on each bar, then clamp to 0..max. The clamp is only a backstop.
export function applyChoice(values, typeId, data) {
  const src = values && typeof values === 'object' ? values : {};
  const spec = data && typeof data === 'object' ? data : {};
  const types = Array.isArray(spec.types) ? spec.types : [];
  const type = types.find((item) => item && item.id === typeId);
  const delta = type && type.delta && typeof type.delta === 'object' ? type.delta : {};
  const bars = Array.isArray(spec.bars) ? spec.bars : [];
  const cap = spec.scoring && Number.isFinite(Number(spec.scoring.max)) ? Number(spec.scoring.max) : BAR_MAX;
  const next = {};
  const list = bars.length ? bars : Object.keys(src).map((id) => ({ id, max: cap }));
  for (const bar of list) {
    const id = bar.id;
    const max = Number.isFinite(Number(bar.max)) ? Number(bar.max) : cap;
    const cur = Number(src[id]);
    const base = Number.isFinite(cur) ? cur : (Number.isFinite(Number(bar.start)) ? Number(bar.start) : 0);
    const add = Number(delta[id]);
    next[id] = clamp(base + (Number.isFinite(add) ? add : 0), 0, max);
  }
  return next;
}

export function minBar(values) {
  const src = values && typeof values === 'object' ? values : {};
  let best = null;
  for (const key of Object.keys(src)) {
    const n = Number(src[key]);
    if (!Number.isFinite(n)) continue;
    if (best == null || n < best) best = n;
  }
  return best == null ? 0 : best;
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

// Pass when the short bar reaches the line. 13 passes.
export function isPass(short, passAt) {
  const line = Number.isFinite(Number(passAt)) ? Number(passAt) : PASS_AT;
  return Number(short) >= line;
}

// Minus sign is U+2212. Zero matches ui.zeroDelta, "+0".
export function formatDelta(n, zero) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return zero == null ? '+0' : String(zero);
  if (v > 0) return `+${v}`;
  return `\u2212${Math.abs(v)}`;
}

// Replace each × in order. A function replacer leaves $ in the values alone.
export function fillX(template, values) {
  const list = Array.isArray(values) ? values : (values == null ? [] : [values]);
  let i = 0;
  return String(template == null ? '' : template).replace(/×/g, () => {
    if (i >= list.length) return '';
    const v = list[i++];
    return v == null ? '' : String(v);
  });
}
