export const ENABLE_DRAG = true;

export function dragThresholdExceeded(dx, dy, limit = 8) {
  const x = Number(dx);
  const y = Number(dy);
  const lim = Number(limit);
  const cap = Number.isFinite(lim) ? lim : 8;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.hypot(x, y) >= cap;
}

export function dragAllowed(el) {
  if (ENABLE_DRAG !== true) return false;
  if (!el || typeof el.getAttribute !== 'function') return true;
  return el.getAttribute('data-l05-sr') !== '1';
}
