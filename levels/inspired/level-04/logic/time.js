import { TIME_MODES } from './data-check.js';

export function normalizeMode(mode) {
  return TIME_MODES.includes(mode) ? mode : 'std';
}

// Milliseconds, or null when the node or the mode is untimed.
export function timeLimitMs(node, mode, factor) {
  const spec = node && typeof node === 'object' ? node : null;
  const limit = spec ? Number(spec.timeLimit) : Number.NaN;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const picked = normalizeMode(mode);
  if (picked === 'off') return null;
  let sec = limit;
  if (picked === 'calm') {
    const scale = Number(factor);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    sec = limit * scale;
  }
  const ms = Math.round(sec * 1000);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

function actNumber(value) {
  if (value === 1 || value === '1' || value === 'A1') return 1;
  if (value === 2 || value === '2' || value === 'A2') return 2;
  if (value === 3 || value === '3' || value === 'A3') return 3;
  return 0;
}

// entry1: hint before the first timed node. entry2: only after a first timeout in act 2.
export function timeEntries(state) {
  const src = state && typeof state === 'object' ? state : {};
  const mode = normalizeMode(src.mode);
  if (mode === 'off') return { entry1: false, entry2: false };
  const act = actNumber(src.firstTimeoutAct);
  return {
    entry1: src.entry1Seen !== true,
    entry2: src.entry2Seen !== true && act === 2
  };
}

// True on the frame remaining crosses from above cueSec to cueSec or below.
// prevRemainingMs is optional; without it, any remaining at or below the cue counts.
// Caller stores cued after the first true. paused and untimed never cue.
export function cueDue(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (src.paused === true || src.cued === true) return false;
  if (src.mode === 'off' || src.untimed === true) return false;
  if (src.remainingMs == null || src.cueSec == null || src.totalSec == null) return false;
  const cueSec = Number(src.cueSec);
  const totalSec = Number(src.totalSec);
  const remainingMs = Number(src.remainingMs);
  if (!Number.isFinite(cueSec) || cueSec <= 0) return false;
  if (!Number.isFinite(totalSec) || !(totalSec > cueSec)) return false;
  if (!Number.isFinite(remainingMs)) return false;
  const cueMs = cueSec * 1000;
  if (remainingMs > cueMs) return false;
  if (src.prevRemainingMs == null || src.prevRemainingMs === '') return true;
  const prev = Number(src.prevRemainingMs);
  if (!Number.isFinite(prev)) return true;
  return prev > cueMs;
}
