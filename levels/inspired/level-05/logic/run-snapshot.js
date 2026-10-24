// Mid-run snapshot for level 5. Plain JSON only: no timers, no DOM, no functions.
// Stage ids are the four big nodes. Progress resume.screen is only a 1-4 placeholder;
// the stage name and the wall / bar snapshot live on the level run.

const STAGES = ['paste', 'bars', 'comment', 'repost'];

const STAGE_UI_KEY = {
  paste: 'stagePaste',
  bars: 'stageBars',
  comment: 'stageComment',
  repost: 'stageRepost'
};

function isStage(value) {
  return STAGES.indexOf(value) >= 0;
}

export function stageIdFromScreen(screen, phase) {
  if (screen === 'repost') return 'repost';
  if (screen === 'paste') {
    if (phase === 'repost') return 'repost';
    if (phase === 'first' || phase == null) return 'paste';
    return null;
  }
  if (screen === 'bars') return 'bars';
  if (screen === 'comment') return 'comment';
  return null;
}

export function stageLabel(ui, stageId) {
  const key = STAGE_UI_KEY[stageId];
  if (!key || !ui || typeof ui !== 'object') return '';
  const value = ui[key];
  return typeof value === 'string' ? value : '';
}

// Placeholder passed to saveResume. Number(screen) is stored on progress.resume.
export function resumeScreenNumber(stageId) {
  if (stageId === 'paste') return 1;
  if (stageId === 'bars') return 2;
  if (stageId === 'comment') return 3;
  if (stageId === 'repost') return 4;
  return 0;
}

function copyWall(wall) {
  if (!Array.isArray(wall)) return null;
  const out = [];
  for (let i = 0; i < wall.length; i += 1) {
    const id = wall[i];
    if (id == null || id === '') out.push(null);
    else if (typeof id === 'string') out.push(id);
    else return null;
  }
  return out;
}

function copyPool(pool) {
  if (pool == null) return [];
  if (!Array.isArray(pool)) return null;
  const out = [];
  for (let i = 0; i < pool.length; i += 1) {
    const id = pool[i];
    if (typeof id !== 'string' || id === '') return null;
    out.push(id);
  }
  return out;
}

function copySnap(snap) {
  if (snap == null) return null;
  if (typeof snap !== 'object' || Array.isArray(snap)) return null;
  const bars = snap.bars;
  if (!bars || typeof bars !== 'object' || Array.isArray(bars)) return null;
  const picked = {};
  const keys = ['raw_work', 'raw_biz', 'heightPct_work', 'heightPct_biz'];
  for (let i = 0; i < keys.length; i += 1) {
    const n = Number(bars[keys[i]]);
    if (!Number.isFinite(n)) return null;
    picked[keys[i]] = n;
  }
  const stars = Number(snap.stars);
  const resultCount = Number(snap.resultCount);
  if (!Number.isFinite(stars) || !Number.isFinite(resultCount)) return null;
  return {
    bars: picked,
    stars,
    resultCount,
    comment: typeof snap.comment === 'string' ? snap.comment : ''
  };
}

function phaseOf(stage, phase) {
  if (stage === 'repost' || phase === 'repost') return 'repost';
  return 'first';
}

export function buildRunSnapshot(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!src) return null;
  const stage = isStage(src.stage) ? src.stage : stageIdFromScreen(src.screen, src.phase);
  if (!stage) return null;
  const wall = copyWall(src.wall);
  if (!wall) return null;
  const pool = copyPool(src.pool);
  if (!pool) return null;
  const phase = phaseOf(stage, src.phase);
  const screen = stage === 'bars' || stage === 'comment' ? stage : 'paste';
  const canRepost = typeof src.canRepost === 'boolean' ? src.canRepost : phase !== 'repost';
  const ts = typeof src.ts === 'number' && Number.isFinite(src.ts) ? src.ts : Date.now();
  const run = {
    stage,
    screen,
    phase,
    wall,
    pool,
    snap: copySnap(src.snap),
    canRepost,
    ts
  };
  return JSON.parse(JSON.stringify(run));
}

function stageOfRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return null;
  if (isStage(run.stage)) return run.stage;
  return stageIdFromScreen(run.screen, run.phase);
}

export function restoreFromRun(run) {
  const stage = stageOfRun(run);
  if (!stage) return null;
  const wall = copyWall(run.wall);
  if (!wall) return null;
  const pool = copyPool(run.pool);
  if (!pool) return null;
  let screen = 'paste';
  if (stage === 'bars') screen = 'bars';
  else if (stage === 'comment') screen = 'comment';
  const phase = phaseOf(stage, run.phase);
  const canRepost = typeof run.canRepost === 'boolean' ? run.canRepost : phase !== 'repost';
  return {
    stage,
    screen,
    phase,
    wall,
    pool,
    snap: copySnap(run.snap),
    canRepost
  };
}
