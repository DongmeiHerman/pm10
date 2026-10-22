import { TIME_MODES } from './data-check.js';
import { pickEnding } from './endings.js';
import { applyChoice, fillX, formatDelta, isPass, minBar, starsFor } from './score.js';
import { normalizeMode, timeEntries, timeLimitMs } from './time.js';

// step(state, event) -> new state. Does not read the clock and does not mutate inputs.
// type: start, pick, close, next, hint, settle, timeout, mode.
// screen: opening, node, consequence, actSummary, hint, settle.
// event.at is the timestamp. Mode changes do not rewrite logged timeouts.

function copyMap(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const key of Object.keys(src)) out[key] = src[key];
  return out;
}

function copyOrders(orders) {
  if (!Array.isArray(orders)) return null;
  return orders.map((act) => {
    if (!Array.isArray(act)) return [];
    return act.map((node) => (Array.isArray(node) ? node.slice() : []));
  });
}

function copyEntry(row) {
  return {
    act: row.act,
    node: row.node,
    nodeId: row.nodeId,
    optionId: row.optionId,
    type: row.type,
    delta: copyMap(row.delta),
    before: copyMap(row.before),
    after: copyMap(row.after),
    at: row.at
  };
}

function startBars(data) {
  const bars = {};
  const list = data && Array.isArray(data.bars) ? data.bars : [];
  for (const bar of list) {
    if (!bar || typeof bar.id !== 'string') continue;
    const n = Number(bar.start);
    bars[bar.id] = Number.isFinite(n) ? n : 0;
  }
  return bars;
}

function actsOf(data) {
  return data && Array.isArray(data.acts) ? data.acts : [];
}

function nodesOf(state) {
  const acts = actsOf(state && state.data);
  const act = acts[state.act];
  const variants = act && Array.isArray(act.variants) ? act.variants : [];
  if (!variants.length) return [];
  const count = variants.length;
  let index = Number(state.variant);
  if (!Number.isInteger(index)) index = 0;
  index = ((index % count) + count) % count;
  const variant = variants[index];
  return variant && Array.isArray(variant.nodes) ? variant.nodes : [];
}

function currentNode(state) {
  const nodes = nodesOf(state);
  return nodes[state.node] || null;
}

function stamp(state, event) {
  if (event && Object.prototype.hasOwnProperty.call(event, 'at') && Number.isFinite(Number(event.at))) {
    return Number(event.at);
  }
  return state.at == null ? null : state.at;
}

function cloneRun(state) {
  const actBars = Array.isArray(state.actBars) ? state.actBars : [];
  const log = Array.isArray(state.log) ? state.log : [];
  return {
    screen: state.screen,
    mode: state.mode,
    variant: state.variant,
    orders: copyOrders(state.orders),
    act: state.act,
    node: state.node,
    bars: copyMap(state.bars),
    actBars: actBars.map((row) => ({ act: row.act, bars: copyMap(row.bars) })),
    log: log.map(copyEntry),
    locked: state.locked === true,
    pending: state.pending ? copyEntry(state.pending) : null,
    entry1Seen: state.entry1Seen === true,
    entry2Seen: state.entry2Seen === true,
    firstTimeoutAct: state.firstTimeoutAct || 0,
    hintWhich: state.hintWhich || 0,
    limitMs: state.limitMs == null ? null : state.limitMs,
    at: state.at == null ? null : state.at,
    short: state.short == null ? null : state.short,
    stars: state.stars == null ? null : state.stars,
    pass: state.pass == null ? null : state.pass,
    ending: state.ending == null ? null : state.ending,
    data: state.data
  };
}

export function createRun(data, options) {
  const spec = data && typeof data === 'object' ? data : {};
  const opt = options && typeof options === 'object' ? options : {};
  let variant = Number(opt.variant);
  if (!Number.isInteger(variant) || variant < 0) variant = 0;
  return {
    screen: 'opening',
    mode: normalizeMode(opt.mode != null ? opt.mode : spec.timeModeDefault),
    variant,
    orders: copyOrders(opt.orders),
    act: 0,
    node: 0,
    bars: startBars(spec),
    actBars: [],
    log: [],
    locked: false,
    pending: null,
    entry1Seen: false,
    entry2Seen: false,
    firstTimeoutAct: 0,
    hintWhich: 0,
    limitMs: null,
    at: null,
    short: null,
    stars: null,
    pass: null,
    ending: null,
    data: spec
  };
}

function enterNode(state, act, nodeIndex) {
  const probe = { data: state.data, act, variant: state.variant, node: nodeIndex };
  const node = currentNode(probe);
  const factor = state.data && state.data.calm ? state.data.calm.factor : undefined;
  const limitMs = timeLimitMs(node, state.mode, factor);
  const actBars = state.actBars.slice();
  if (!actBars.some((row) => row.act === act)) {
    actBars.push({ act, bars: copyMap(state.bars) });
  }
  return {
    ...state,
    screen: 'node',
    act,
    node: nodeIndex,
    locked: false,
    pending: null,
    hintWhich: 0,
    limitMs,
    actBars
  };
}

function finish(state) {
  const choices = state.log.map((row) => row.type);
  const thresholds = state.data && state.data.stars ? state.data.stars.thresholds : undefined;
  const passAt = state.data && state.data.scoring ? state.data.scoring.passAt : undefined;
  const short = minBar(state.bars);
  const stars = starsFor(short, thresholds);
  state.screen = 'settle';
  state.locked = false;
  state.pending = null;
  state.limitMs = null;
  state.hintWhich = 0;
  state.short = short;
  state.stars = stars;
  state.pass = isPass(short, passAt);
  state.ending = pickEnding(choices, {
    stars,
    types: state.data && state.data.types,
    endings: state.data && state.data.endings
  });
  return state;
}

function dueHint(state) {
  if (!state || state.screen !== 'actSummary') return 0;
  const entries = timeEntries({
    mode: state.mode,
    entry1Seen: state.entry1Seen === true,
    entry2Seen: state.entry2Seen === true,
    firstTimeoutAct: state.firstTimeoutAct || null
  });
  if (state.act === 0 && entries.entry1) return 1;
  if (state.act === 1 && entries.entry2) return 2;
  return 0;
}

function goHint(state, event, which) {
  const next = cloneRun(state);
  next.at = stamp(state, event);
  next.screen = 'hint';
  next.hintWhich = which;
  next.limitMs = null;
  if (which === 1) next.entry1Seen = true;
  if (which === 2) next.entry2Seen = true;
  return next;
}

function goNextAct(state, event) {
  const nextAct = state.act + 1;
  if (nextAct >= actsOf(state.data).length) return state;
  const next = cloneRun(state);
  next.at = stamp(state, event);
  return enterNode(next, nextAct, 0);
}

function onStart(state, event) {
  if (state.screen !== 'opening') return state;
  const next = cloneRun(state);
  next.at = stamp(state, event);
  if (event.mode != null) next.mode = normalizeMode(event.mode);
  if (Number.isInteger(event.variant) && event.variant >= 0) next.variant = event.variant;
  return enterNode(next, 0, 0);
}

function lockChoice(state, event, choice) {
  const node = currentNode(state);
  const next = cloneRun(state);
  next.at = stamp(state, event);
  const after = applyChoice(next.bars, choice.type, next.data);
  const before = copyMap(next.bars);
  const delta = {};
  for (const key of Object.keys(after)) {
    const was = Number(before[key]);
    const now = Number(after[key]);
    delta[key] = (Number.isFinite(now) ? now : 0) - (Number.isFinite(was) ? was : 0);
  }
  const entry = {
    act: next.act,
    node: next.node,
    nodeId: node && node.id,
    optionId: choice.optionId,
    type: choice.type,
    delta,
    before,
    after,
    at: next.at
  };
  next.log = next.log.concat([entry]);
  next.pending = entry;
  next.locked = true;
  next.screen = 'consequence';
  if (choice.type === 'timeout' && !next.firstTimeoutAct) next.firstTimeoutAct = next.act + 1;
  return next;
}

function onPick(state, event) {
  if (state.screen !== 'node' || state.locked === true) return state;
  const node = currentNode(state);
  if (!node) return state;
  const options = Array.isArray(node.options) ? node.options : [];
  const option = options.find((opt) => opt && opt.id === event.optionId);
  if (!option || typeof option.type !== 'string') return state;
  return lockChoice(state, event, { optionId: option.id, type: option.type });
}

function onTimeout(state, event) {
  if (state.screen !== 'node' || state.locked === true) return state;
  if (state.limitMs == null) return state;
  return lockChoice(state, event, { optionId: null, type: 'timeout' });
}

function onClose(state, event) {
  if (state.screen !== 'consequence' || !state.pending) return state;
  const next = cloneRun(state);
  next.at = stamp(state, event);
  next.bars = copyMap(next.pending.after);
  next.pending = null;
  next.locked = false;
  const nodes = nodesOf(next);
  if (next.node + 1 < nodes.length) return enterNode(next, next.act, next.node + 1);
  if (next.act + 1 < actsOf(next.data).length) {
    next.screen = 'actSummary';
    next.limitMs = null;
    next.hintWhich = 0;
    return next;
  }
  return finish(next);
}

function onNext(state, event) {
  if (state.screen === 'hint') return goNextAct(state, event);
  if (state.screen !== 'actSummary') return state;
  const which = dueHint(state);
  if (which) return goHint(state, event, which);
  return goNextAct(state, event);
}

function onHint(state, event) {
  const which = dueHint(state);
  if (!which) return state;
  if (event.which != null && Number(event.which) !== which) return state;
  return goHint(state, event, which);
}

function onSettle(state, event) {
  if (state.screen === 'settle') return state;
  if (state.screen !== 'actSummary') return state;
  if (state.act + 1 < actsOf(state.data).length) return state;
  const next = cloneRun(state);
  next.at = stamp(state, event);
  return finish(next);
}

function onMode(state, event) {
  if (state.screen !== 'opening' && state.screen !== 'hint') return state;
  if (typeof event.mode !== 'string' || !TIME_MODES.includes(event.mode)) return state;
  if (event.mode === state.mode) return state;
  const next = cloneRun(state);
  next.at = stamp(state, event);
  next.mode = event.mode;
  return next;
}

// Act summary for state.act. Copy comes from data.actDone, ui.actScoreLine,
// ui.barDelta, ui.zeroDelta, types[].tag, options[].text, bars[].label.
export function actSummary(state) {
  if (!state || typeof state !== 'object') return null;
  const spec = state.data && typeof state.data === 'object' ? state.data : {};
  const ui = spec.ui && typeof spec.ui === 'object' ? spec.ui : {};
  const actIndex = Number.isInteger(state.act) ? state.act : 0;
  const log = Array.isArray(state.log) ? state.log : [];
  const nodes = nodesOf({ data: spec, act: actIndex, variant: state.variant, node: 0 });
  const types = Array.isArray(spec.types) ? spec.types : [];
  const bars = Array.isArray(spec.bars) ? spec.bars : [];
  const rows = [];
  for (const row of log) {
    if (!row || row.act !== actIndex) continue;
    const node = nodes.find((item) => item && item.id === row.nodeId) || nodes[row.node] || null;
    const options = node && Array.isArray(node.options) ? node.options : [];
    const opt = options.find((item) => item && item.id === row.optionId) || null;
    const type = typeof row.type === 'string' ? row.type : '';
    const kind = types.find((item) => item && item.id === type);
    const delta = copyMap(row.delta);
    const changes = [];
    for (const bar of bars) {
      const id = bar && bar.id;
      const label = bar && typeof bar.label === 'string' ? bar.label : '';
      const n = Number(delta[id]);
      changes.push(fillX(ui.barDelta, [label, formatDelta(Number.isFinite(n) ? n : 0, ui.zeroDelta)]));
    }
    rows.push({
      nodeId: typeof row.nodeId === 'string' ? row.nodeId : null,
      optionId: typeof row.optionId === 'string' ? row.optionId : null,
      choice: opt && typeof opt.text === 'string' ? opt.text : '',
      type,
      tag: kind && typeof kind.tag === 'string' ? kind.tag : '',
      delta,
      changes
    });
  }
  let own = 0;
  for (const row of rows) if (row.type === 'own') own += 1;
  const short = minBar(state.bars);
  return {
    rows,
    own,
    nodes: nodes.length,
    line: fillX(spec.actDone, [own, nodes.length]),
    short,
    scoreLine: fillX(ui.actScoreLine, [short])
  };
}

export function step(state, event) {
  if (!state || typeof state !== 'object') return state;
  const ev = event && typeof event === 'object' ? event : {};
  if (ev.type === 'start') return onStart(state, ev);
  if (ev.type === 'pick') return onPick(state, ev);
  if (ev.type === 'close') return onClose(state, ev);
  if (ev.type === 'next') return onNext(state, ev);
  if (ev.type === 'hint') return onHint(state, ev);
  if (ev.type === 'settle') return onSettle(state, ev);
  if (ev.type === 'timeout') return onTimeout(state, ev);
  if (ev.type === 'mode') return onMode(state, ev);
  return state;
}
