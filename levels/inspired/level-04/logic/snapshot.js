import { TIME_MODES } from './data-check.js';
import { createRun } from './run.js';
import { normalizeMode, timeLimitMs } from './time.js';

// Pure snapshot. No clock, no storage. Inputs are not mutated.
// Mid-act (node / consequence) resumes at the start of that act.
// actSummary / hint already finished the act, so resume starts the next one
// (design section 10). Opening and settle have nothing to resume.
// Remaining time and pause are not stored. Resume refills the limit and
// sets startPaused so the first timed node waits for continue.

const SCREENS = ['opening', 'node', 'consequence', 'actSummary', 'hint', 'settle'];

function copyBars(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const key of Object.keys(src)) {
    const n = Number(src[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function copyOrders(orders) {
  if (!Array.isArray(orders)) return null;
  return orders.map((act) => {
    if (!Array.isArray(act)) return [];
    return act.map((node) => {
      if (!Array.isArray(node)) return [];
      const ids = [];
      for (const id of node) if (typeof id === 'string') ids.push(id);
      return ids;
    });
  });
}

function copyChoice(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : null;
  return {
    act: Number.isInteger(row.act) && row.act >= 0 ? row.act : 0,
    node: Number.isInteger(row.node) && row.node >= 0 ? row.node : 0,
    nodeId: typeof row.nodeId === 'string' ? row.nodeId : null,
    optionId: typeof row.optionId === 'string' ? row.optionId : null,
    type: typeof row.type === 'string' ? row.type : '',
    delta: copyBars(row.delta),
    before: copyBars(row.before),
    after: copyBars(row.after),
    at
  };
}

function copyDone(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (!Number.isInteger(row.act) || row.act < 0) return null;
  const list = Array.isArray(row.choices) ? row.choices : (Array.isArray(row.log) ? row.log : []);
  const choices = [];
  for (const choice of list) {
    const copied = copyChoice(choice);
    if (copied) choices.push(copied);
  }
  return {
    act: row.act,
    start: copyBars(row.start),
    bars: copyBars(row.bars),
    choices
  };
}

function variantNodes(data, actIndex, variant) {
  const acts = data && Array.isArray(data.acts) ? data.acts : [];
  const act = acts[actIndex];
  const variants = act && Array.isArray(act.variants) ? act.variants : [];
  if (!variants.length) return [];
  let index = Number(variant);
  if (!Number.isInteger(index)) index = 0;
  index = ((index % variants.length) + variants.length) % variants.length;
  const picked = variants[index];
  return picked && Array.isArray(picked.nodes) ? picked.nodes : [];
}

function ordersFromData(data, variant) {
  const acts = data && Array.isArray(data.acts) ? data.acts : [];
  return acts.map((_, index) => variantNodes(data, index, variant).map((node) => {
    const options = node && Array.isArray(node.options) ? node.options : [];
    const ids = [];
    for (const opt of options) if (opt && typeof opt.id === 'string') ids.push(opt.id);
    return ids;
  }));
}

function ordersFromState(state) {
  if (Array.isArray(state.orders)) return copyOrders(state.orders);
  return ordersFromData(state.data, state.variant);
}

function doneFromState(state) {
  const last = state.screen === 'actSummary' || state.screen === 'hint' ? state.act : state.act - 1;
  const log = Array.isArray(state.log) ? state.log : [];
  const actBars = Array.isArray(state.actBars) ? state.actBars : [];
  const done = [];
  for (let i = 0; i <= last; i++) {
    const choices = [];
    for (const row of log) {
      if (!row || row.act !== i) continue;
      const copied = copyChoice(row);
      if (copied) choices.push(copied);
    }
    const startRow = actBars.find((row) => row && row.act === i);
    const start = startRow ? copyBars(startRow.bars) : (choices[0] ? copyBars(choices[0].before) : {});
    const end = choices.length ? copyBars(choices[choices.length - 1].after) : copyBars(start);
    done.push({ act: i, start, bars: end, choices });
  }
  return done;
}

function actStartFromState(state) {
  const actBars = Array.isArray(state.actBars) ? state.actBars : [];
  const row = actBars.find((item) => item && item.act === state.act);
  if (row) return copyBars(row.bars);
  return copyBars(state.bars);
}

function stampOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function snapshotOf(state) {
  try {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    if (!Number.isInteger(state.variant) || state.variant < 0) return null;
    if (!Number.isInteger(state.act) || state.act < 0) return null;
    if (typeof state.screen !== 'string' || !SCREENS.includes(state.screen)) return null;
    return normalizeRun({
      variant: state.variant,
      orders: ordersFromState(state),
      done: doneFromState(state),
      actStart: actStartFromState(state),
      bars: copyBars(state.bars),
      screen: state.screen,
      act: state.act,
      mode: state.mode,
      entry1Seen: state.entry1Seen === true,
      entry2Seen: state.entry2Seen === true,
      at: stampOf(state.at)
    });
  } catch {
    return null;
  }
}

export function normalizeRun(snap) {
  try {
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
    if (!Number.isInteger(snap.variant) || snap.variant < 0) return null;
    if (!Number.isInteger(snap.act) || snap.act < 0) return null;
    if (typeof snap.screen !== 'string' || !SCREENS.includes(snap.screen)) return null;
    const done = [];
    if (Array.isArray(snap.done)) {
      for (const row of snap.done) {
        const copied = copyDone(row);
        if (copied) done.push(copied);
      }
    }
    const mode = TIME_MODES.includes(snap.mode) ? snap.mode : 'std';
    return {
      variant: snap.variant,
      orders: copyOrders(snap.orders),
      done,
      actStart: copyBars(snap.actStart),
      bars: copyBars(snap.bars),
      screen: snap.screen,
      act: snap.act,
      mode: normalizeMode(mode),
      entry1Seen: snap.entry1Seen === true,
      entry2Seen: snap.entry2Seen === true,
      at: stampOf(snap.at)
    };
  } catch {
    return null;
  }
}

function restartAct(snap) {
  if (snap.screen === 'actSummary' || snap.screen === 'hint') return snap.act + 1;
  if (snap.screen === 'node' || snap.screen === 'consequence') return snap.act;
  return -1;
}

function barsFor(snap, restart) {
  if (restart === snap.act) return copyBars(snap.actStart);
  const prev = snap.done.find((row) => row && row.act === restart - 1);
  if (prev) return copyBars(prev.bars);
  return copyBars(snap.bars);
}

function logFor(snap, restart) {
  const log = [];
  const done = Array.isArray(snap.done) ? snap.done : [];
  for (const row of done) {
    if (!row || row.act >= restart) continue;
    const choices = Array.isArray(row.choices) ? row.choices : [];
    for (const choice of choices) {
      const copied = copyChoice(choice);
      if (copied) log.push(copied);
    }
  }
  return log;
}

export function resumeFrom(snap, data) {
  try {
    const norm = normalizeRun(snap);
    if (!norm) return null;
    const spec = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    const acts = spec && Array.isArray(spec.acts) ? spec.acts : null;
    if (!acts) return null;
    const restart = restartAct(norm);
    if (restart < 0 || restart >= acts.length) return null;
    const bars = barsFor(norm, restart);
    const log = logFor(norm, restart);
    const actBars = [];
    for (let i = 0; i < restart; i++) {
      const prev = norm.done.find((row) => row && row.act === i);
      const start = prev ? copyBars(Object.keys(prev.start).length ? prev.start : prev.bars) : {};
      actBars.push({ act: i, bars: start });
    }
    actBars.push({ act: restart, bars: copyBars(bars) });
    let firstTimeoutAct = 0;
    for (const row of log) {
      if (row.type === 'timeout' && !firstTimeoutAct) firstTimeoutAct = row.act + 1;
    }
    const orders = Array.isArray(norm.orders) ? norm.orders : ordersFromData(spec, norm.variant);
    const next = createRun(spec, { variant: norm.variant, mode: norm.mode, orders });
    const nodes = variantNodes(spec, restart, norm.variant);
    const factor = spec.calm ? spec.calm.factor : undefined;
    next.screen = 'node';
    next.act = restart;
    next.node = 0;
    next.bars = bars;
    next.actBars = actBars;
    next.log = log;
    next.locked = false;
    next.pending = null;
    next.entry1Seen = norm.entry1Seen;
    next.entry2Seen = norm.entry2Seen;
    next.firstTimeoutAct = firstTimeoutAct;
    next.hintWhich = 0;
    next.limitMs = timeLimitMs(nodes[0] || null, norm.mode, factor);
    next.at = norm.at;
    next.short = null;
    next.stars = null;
    next.pass = null;
    next.ending = null;
    next.startPaused = true;
    return next;
  } catch {
    return null;
  }
}
