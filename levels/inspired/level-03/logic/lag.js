export const FULL_FPS = 24;
export const LONG_FRAME_MS = 100;
export const WARMUP_MS = 500;
export const PROBE_MS = 3000;
export const MAX_LONG_FRAMES = 3;
export const GUARD_WINDOW_MS = 3000;
export const GUARD_LONG_FRAMES = 5;

function num(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function resolve(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    fullFps: num(src.fullFps != null ? src.fullFps : src.minFps, FULL_FPS),
    longFrameMs: num(src.longFrameMs, LONG_FRAME_MS),
    warmupMs: num(src.warmupMs, WARMUP_MS),
    probeMs: num(src.probeMs, PROBE_MS),
    maxLongFrames: num(src.maxLongFrames, MAX_LONG_FRAMES),
    guardWindowMs: num(src.guardWindowMs, GUARD_WINDOW_MS),
    guardLongFrames: num(src.guardLongFrames, GUARD_LONG_FRAMES)
  };
}

function counted(input) {
  if (!input || typeof input !== 'object') return false;
  if (!(input.moving === true && input.foreground === true && input.noModal === true)) return false;
  const dt = Number(input.rawDeltaMs);
  return Number.isFinite(dt) && dt > 0;
}

function clone(state) {
  const cfg = state && state.cfg ? state.cfg : resolve(null);
  return {
    cfg,
    warmupMs: state && state.warmupMs || 0,
    probeMs: state && state.probeMs || 0,
    probeFrames: state && state.probeFrames || 0,
    probeLong: state && state.probeLong || 0,
    verdict: state && state.verdict || 'insufficient',
    guardFrames: state && Array.isArray(state.guardFrames) ? state.guardFrames.slice() : [],
    guardVerdict: state && state.guardVerdict || 'ok'
  };
}

export function initLagState(cfg) {
  return {
    cfg: resolve(cfg),
    warmupMs: 0,
    probeMs: 0,
    probeFrames: 0,
    probeLong: 0,
    verdict: 'insufficient',
    guardFrames: [],
    guardVerdict: 'ok'
  };
}

function addProbe(next, dt) {
  const c = next.cfg;
  next.probeMs += dt;
  next.probeFrames += 1;
  if (dt > c.longFrameMs) next.probeLong += 1;
  // 60fps 的 1000/60 累加会落在阈值下约 1e-12ms，按填满处理。
  if (next.probeMs >= c.probeMs - 1e-6) {
    const fps = next.probeFrames / (next.probeMs / 1000);
    next.verdict = (fps < c.fullFps || next.probeLong >= c.maxLongFrames) ? 'lag' : 'ok';
  }
}

export function probeStep(state, input) {
  const next = clone(state);
  if (next.verdict === 'ok' || next.verdict === 'lag') return next;
  if (!counted(input)) return next;
  const dt = Number(input.rawDeltaMs);
  const c = next.cfg;
  if (next.warmupMs < c.warmupMs) {
    next.warmupMs += dt;
    return next;
  }
  addProbe(next, dt);
  return next;
}

function judgeGuard(frames, c) {
  let sum = 0;
  let longs = 0;
  let n = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    sum += frames[i].dt;
    n += 1;
    if (frames[i].long) longs += 1;
    if (sum >= c.guardWindowMs) break;
  }
  if (longs >= c.guardLongFrames) return 'lag';
  if (sum >= c.guardWindowMs) {
    const fps = n / (sum / 1000);
    if (fps < c.fullFps) return 'lag';
  }
  return 'ok';
}

// 从最新一帧往前累加，留下刚好盖住 guardWindowMs 的最短后缀。
function trimGuardFrames(frames, windowMs) {
  let sum = 0;
  let start = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    sum += frames[i].dt;
    start = i;
    if (sum >= windowMs) break;
  }
  if (start <= 0) return frames;
  return frames.slice(start);
}

export function guardStep(state, input) {
  const next = clone(state);
  if (next.guardVerdict === 'lag') return next;
  if (!counted(input)) return next;
  const dt = Number(input.rawDeltaMs);
  const long = dt > next.cfg.longFrameMs;
  const appended = next.guardFrames.concat([{ dt, long }]);
  next.guardFrames = trimGuardFrames(appended, next.cfg.guardWindowMs);
  next.guardVerdict = judgeGuard(next.guardFrames, next.cfg);
  return next;
}
