// One pause state. Manual, resume dialog, and background all enter it.
// Only continue leaves. Inputs are read and copied, never written.

const MODES = new Set(['std', 'calm', 'off']);
const RECORD_SKIP = new Set(['paused', 'pauseCount', 'reason']);

function copyScore(score) {
  if (score == null) return null;
  if (typeof score !== 'object') return score;
  if (Array.isArray(score)) return score.slice();
  const out = {};
  for (const key of Object.keys(score)) out[key] = score[key];
  return out;
}

function copyRecord(record) {
  const out = {};
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
  for (const key of Object.keys(record)) {
    if (RECORD_SKIP.has(key)) continue;
    out[key] = record[key];
  }
  return out;
}

// null, undefined, and '' are missing, not zero.
// Only a finite number is a clock value. Strings, booleans, arrays, NaN, and Infinity are illegal.
function readClock(value) {
  if (value == null || value === '') return { kind: 'missing', n: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'num', n: value };
  return { kind: 'bad', n: null };
}

function numOrNull(value) {
  const read = readClock(value);
  return read.kind === 'num' ? read.n : null;
}

// Timed tiers only. Off mode is untimed and must not grow a default limit.
function tierLimitMs(mode) {
  return mode === 'calm' ? 36000 : 24000;
}

function read(state) {
  const src = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const mode = MODES.has(src.mode) ? src.mode : 'std';
  const screen = src.screen === 'node' || src.screen === 'consequence' || src.screen === 'settle'
    ? src.screen
    : 'other';
  const timed = src.timed === true;
  const outcome = src.outcome === 'selected' || src.outcome === 'timeout' ? src.outcome : null;
  let status = src.status;
  if (status !== 'idle' && status !== 'running' && status !== 'paused' && status !== 'selected' && status !== 'timeup') {
    status = 'idle';
  }
  if (outcome === 'selected') status = 'selected';
  if (outcome === 'timeout') status = 'timeup';
  const pauseCount = Number(src.pauseCount);
  const limitRead = readClock(src.limitMs);
  const remainRead = readClock(src.remainingMs);
  let limitMs = limitRead.kind === 'num' ? limitRead.n : null;
  const remainingMs = remainRead.kind === 'num' ? remainRead.n : null;
  // Illegal limit on a timed node is the tier default, not zero and not "untimed".
  // One warn. An illegal remaining is missing, so it does not count as time up.
  if (mode !== 'off' && timed && limitRead.kind === 'bad') {
    limitMs = tierLimitMs(mode);
    console.warn('illegal limitMs on a timed node; using the tier default');
  }
  return {
    mode,
    screen,
    status,
    timed,
    outcome,
    remainingMs,
    limitMs,
    optionId: typeof src.optionId === 'string' && src.optionId ? src.optionId : null,
    pauseCount: Number.isFinite(pauseCount) && pauseCount > 0 ? Math.floor(pauseCount) : 0,
    score: copyScore(src.score),
    record: copyRecord(src.record),
    applyScore: false
  };
}

function nextOf(s, patch) {
  return {
    mode: s.mode,
    screen: s.screen,
    status: s.status,
    timed: s.timed,
    outcome: s.outcome,
    remainingMs: s.remainingMs,
    limitMs: s.limitMs,
    optionId: s.optionId,
    pauseCount: s.pauseCount,
    score: s.score,
    record: s.record,
    applyScore: s.applyScore === true,
    ...patch
  };
}

// Timed node, clock still above zero, not already answered.
function live(s) {
  return s.screen === 'node'
    && s.mode !== 'off'
    && s.timed === true
    && s.outcome == null
    && (s.status === 'running' || s.status === 'paused')
    && s.remainingMs != null
    && s.remainingMs > 0;
}

function finishClock(s) {
  if (s.outcome === 'timeout') return nextOf(s, { status: 'timeup' });
  if (s.outcome === 'selected') return nextOf(s, { status: 'selected' });
  if (s.screen === 'consequence') return nextOf(s, { status: 'selected' });
  if (s.screen !== 'node') {
    if (s.status === 'running' || s.status === 'paused') return nextOf(s, { status: 'idle' });
    return s;
  }
  if (s.mode !== 'off' && s.timed === true) {
    // A real 0 on either clock is time up. A missing clock is not.
    const remainOut = s.remainingMs != null && s.remainingMs <= 0;
    const limitOut = s.limitMs != null && s.limitMs <= 0;
    if ((remainOut || limitOut) && (s.status === 'running' || s.status === 'paused')) {
      return nextOf(s, { status: 'timeup', outcome: 'timeout', remainingMs: 0, optionId: null });
    }
    if (s.status === 'paused' && !live(s)) return nextOf(s, { status: 'idle' });
    return s;
  }
  if (s.status === 'paused') return nextOf(s, { status: 'running' });
  return s;
}

function enterPause(s) {
  if (!live(s) || s.status !== 'running') return s;
  return nextOf(s, { status: 'paused', pauseCount: s.pauseCount + 1 });
}

function leavePause(s) {
  if (!live(s) || s.status !== 'paused') return s;
  return nextOf(s, { status: 'running' });
}

function choosing(s) {
  if (s.screen !== 'node' || s.outcome != null) return false;
  if (s.status !== 'running' && s.status !== 'paused') return false;
  if (s.mode !== 'off' && s.timed === true) return s.remainingMs != null && s.remainingMs > 0;
  return true;
}

function pick(s, event) {
  if (!choosing(s)) return s;
  const optionId = typeof event.optionId === 'string' ? event.optionId : '';
  if (!optionId) return s;
  return nextOf(s, {
    status: 'selected',
    outcome: 'selected',
    optionId,
    screen: 'consequence',
    applyScore: true
  });
}

function tick(s, event) {
  if (!live(s) || s.status !== 'running') return s;
  const dt = Number(event.dt);
  if (!Number.isFinite(dt) || dt <= 0) return s;
  const remain = s.remainingMs - dt;
  if (remain > 0) return nextOf(s, { remainingMs: remain });
  return nextOf(s, { remainingMs: 0, status: 'timeup', outcome: 'timeout', optionId: null });
}

function timeup(s) {
  if (!live(s) || s.status !== 'running') return s;
  return nextOf(s, { remainingMs: 0, status: 'timeup', outcome: 'timeout', optionId: null });
}

function openConsequence(s) {
  const status = s.outcome === 'timeout' ? 'timeup' : 'selected';
  return nextOf(s, { screen: 'consequence', status });
}

// Mid-quit return: full limit, and a timed node starts paused.
function reenter(s, event) {
  const limit = numOrNull(event.limitMs);
  const timed = s.mode !== 'off' && limit != null && limit > 0;
  if (!timed) {
    return nextOf(s, {
      screen: 'node',
      timed: false,
      status: 'idle',
      outcome: null,
      optionId: null,
      remainingMs: null,
      limitMs: null
    });
  }
  return nextOf(s, {
    screen: 'node',
    timed: true,
    status: 'paused',
    outcome: null,
    optionId: null,
    remainingMs: limit,
    limitMs: limit,
    pauseCount: s.pauseCount + 1
  });
}

function present(s) {
  const held = live(s) && s.status === 'paused';
  const going = live(s) && s.status === 'running';
  const open = held || going;
  let status = s.status;
  if (held) status = 'paused';
  else if (s.outcome === 'timeout') status = 'timeup';
  else if (s.outcome === 'selected' || s.screen === 'consequence') status = 'selected';
  else if (s.status === 'paused') status = 'idle';
  return {
    mode: s.mode,
    screen: s.screen,
    status,
    timed: s.timed,
    outcome: s.outcome,
    remainingMs: s.remainingMs,
    limitMs: s.limitMs,
    optionId: s.optionId,
    pauseCount: s.pauseCount,
    score: s.score,
    record: s.record,
    applyScore: s.applyScore === true,
    paused: held,
    showButton: open,
    buttonKey: open ? (held ? 'ui.resume' : 'ui.paused') : null,
    ariaPressed: null,
    waitKey: held ? 'pausedNote' : (open ? 'wait' : null),
    bar: held ? 'gray' : (going ? 'run' : 'off'),
    clock: held ? 'hold' : (going ? 'run' : 'off'),
    mask: false,
    blur: false,
    optionsEnabled: s.screen === 'node' && s.outcome == null && (s.status === 'running' || s.status === 'paused'),
    keepFocus: open
  };
}

export function pauseNext(state, event) {
  let s = finishClock(read(state));
  const ev = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
  const type = typeof ev.type === 'string' ? ev.type : '';
  if (type === 'pause' || type === 'resumeOpen' || type === 'hide') s = enterPause(s);
  else if (type === 'continue') s = leavePause(s);
  else if (type === 'pick') s = pick(s, ev);
  else if (type === 'tick') s = tick(s, ev);
  else if (type === 'timeup') s = timeup(s);
  else if (type === 'consequence') s = openConsequence(s);
  else if (type === 'reenter') s = reenter(s, ev);
  return present(finishClock(s));
}
