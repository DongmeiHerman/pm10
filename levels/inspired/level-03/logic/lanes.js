export const QUEUE_GAP = 8;
export const LANE_COUNT = 2;
export const BUBBLE_W = 160;
export const BUBBLE_H = 64;

function num(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalize(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    laneCount: num(src.laneCount, LANE_COUNT),
    bubbleW: num(src.bubbleW, BUBBLE_W),
    bubbleH: num(src.bubbleH, BUBBLE_H),
    queueGap: num(src.queueGap, QUEUE_GAP),
    trackW: num(src.trackW, 320),
    spawnEveryMs: num(src.spawnEveryMs, 0),
    stayForMs: num(src.stayForMs, 0),
    timeLimitMs: num(src.timeLimitMs, 0)
  };
}

function blank(idea, index) {
  const id = typeof idea === 'string' ? idea : idea.id;
  return {
    id,
    index,
    lane: null,
    spawnAt: null,
    status: 'pending',
    selected: false,
    x: null,
    x0: 0,
    t0: 0,
    holdX: null,
    reason: null
  };
}

function copyBubble(b) {
  return {
    id: b.id,
    index: b.index,
    lane: b.lane,
    spawnAt: b.spawnAt,
    status: b.status,
    selected: b.selected,
    x: b.x,
    x0: b.x0,
    t0: b.t0,
    holdX: b.holdX,
    reason: b.reason
  };
}

function copyState(state) {
  return {
    cfg: state.cfg,
    elapsedMs: state.elapsedMs,
    nextLane: state.nextLane,
    bubbles: state.bubbles.map(copyBubble)
  };
}

function speedOf(cfg) {
  if (!(cfg.stayForMs > 0)) return 0;
  return (cfg.trackW + cfg.bubbleW) / cfg.stayForMs;
}

function freeX(b, elapsed, cfg) {
  if (!(cfg.stayForMs > 0)) return (cfg.trackW - cfg.bubbleW) / 2;
  return b.x0 - speedOf(cfg) * (elapsed - b.t0);
}

function occupied(bubbles, lane) {
  return bubbles.some((b) => b.lane === lane && (b.status === 'stopped' || b.status === 'queued'));
}

function pose(bubbles, elapsed, cfg) {
  const active = bubbles.filter((b) => b.status === 'moving' || b.status === 'stopped' || b.status === 'queued');
  for (const b of active) {
    if (b.selected || b.status === 'stopped') {
      if (b.holdX == null) b.holdX = b.x != null ? b.x : freeX(b, elapsed, cfg);
      b.x = b.holdX;
      b.status = 'stopped';
    } else {
      b.x = freeX(b, elapsed, cfg);
      b.status = 'moving';
      b.holdX = null;
    }
  }
  for (let lane = 0; lane < cfg.laneCount; lane++) {
    const group = active.filter((b) => b.lane === lane && b.status !== 'missed');
    group.sort((a, b) => a.x - b.x);
    let blocker = null;
    for (const b of group) {
      if (b.status === 'stopped') {
        blocker = b.x;
        continue;
      }
      if (blocker == null) continue;
      const stopAt = blocker + cfg.bubbleW + cfg.queueGap;
      if (b.x < stopAt) {
        b.x = stopAt;
        b.status = 'queued';
        b.x0 = stopAt;
        b.t0 = elapsed;
        blocker = b.x;
      } else {
        blocker = null;
      }
    }
  }
}

export function initLanes(cfg) {
  const norm = normalize(cfg);
  const ideas = cfg && Array.isArray(cfg.ideas) ? cfg.ideas : [];
  return {
    cfg: norm,
    elapsedMs: 0,
    nextLane: 0,
    bubbles: ideas.map(blank)
  };
}

export function lanesStep(state, elapsedMs) {
  const next = copyState(state);
  const cfg = next.cfg;
  const elapsed = Math.max(next.elapsedMs, Number(elapsedMs) || 0);
  const bubbles = next.bubbles;

  for (const b of bubbles) {
    if ((b.status === 'moving' || b.status === 'stopped' || b.status === 'queued') && cfg.stayForMs > 0 && b.spawnAt != null && elapsed - b.spawnAt >= cfg.stayForMs) {
      b.status = 'missed';
      b.selected = false;
      b.reason = 'stay';
    }
  }

  const timedOut = cfg.timeLimitMs > 0 && elapsed >= cfg.timeLimitMs;
  for (const b of bubbles) {
    if (b.status !== 'pending') continue;
    const due = b.index * cfg.spawnEveryMs;
    if (elapsed < due) break;
    if (timedOut && due >= cfg.timeLimitMs) break;
    const prefer = next.nextLane % cfg.laneCount;
    const other = (prefer + 1) % cfg.laneCount;
    let lane = null;
    if (!occupied(bubbles, prefer)) lane = prefer;
    else if (!occupied(bubbles, other)) lane = other;
    else break;
    b.status = 'moving';
    b.lane = lane;
    b.spawnAt = elapsed < due ? due : Math.max(due, elapsed);
    if (timedOut && b.spawnAt > cfg.timeLimitMs) {
      b.status = 'pending';
      b.lane = null;
      b.spawnAt = null;
      break;
    }
    if (!timedOut) b.spawnAt = Math.max(due, elapsed);
    b.x0 = cfg.trackW;
    b.t0 = b.spawnAt;
    b.selected = false;
    b.x = cfg.trackW;
    next.nextLane = (prefer + 1) % cfg.laneCount;
  }

  if (timedOut) {
    for (const b of bubbles) {
      if (b.status === 'pending') {
        b.status = 'missed';
        b.reason = 'unspawned';
      }
    }
  }

  pose(bubbles, elapsed, cfg);
  next.elapsedMs = elapsed;
  return next;
}

function repaint(state) {
  const next = copyState(state);
  pose(next.bubbles, next.elapsedMs, next.cfg);
  return next;
}

function resumeMoving(b, elapsed) {
  b.selected = false;
  b.x0 = b.x != null ? b.x : b.x0;
  b.t0 = elapsed;
  b.holdX = null;
  b.status = 'moving';
}

export function selectBubble(state, id) {
  const next = copyState(state);
  const target = next.bubbles.find((b) => b.id === id);
  if (!target) return next;
  if (target.status !== 'moving' && target.status !== 'queued' && target.status !== 'stopped') return next;
  for (const b of next.bubbles) {
    if (b.selected && b.id !== id) resumeMoving(b, next.elapsedMs);
  }
  if (target.holdX == null) target.holdX = target.x != null ? target.x : freeX(target, next.elapsedMs, next.cfg);
  target.selected = true;
  target.status = 'stopped';
  target.x = target.holdX;
  return repaint(next);
}

export function releaseBubble(state) {
  const next = copyState(state);
  for (const b of next.bubbles) {
    if (!b.selected) continue;
    resumeMoving(b, next.elapsedMs);
  }
  return repaint(next);
}

export function benchBubble(state, id) {
  const next = copyState(state);
  const target = next.bubbles.find((b) => b.id === id);
  if (!target) return next;
  if (target.status !== 'moving' && target.status !== 'queued' && target.status !== 'stopped') return next;
  target.status = 'testing';
  target.selected = false;
  target.holdX = null;
  return repaint(next);
}

export function markBubbleDone(state, id) {
  const next = copyState(state);
  for (const b of next.bubbles) {
    if (b.id !== id) continue;
    b.status = 'done';
    b.selected = false;
    b.holdX = null;
  }
  return next;
}

export function setTrackWidth(state, width) {
  if (!(width > 0) || Math.abs(state.cfg.trackW - width) < 1) return state;
  const next = copyState(state);
  next.cfg = { ...state.cfg, trackW: width };
  return next;
}
