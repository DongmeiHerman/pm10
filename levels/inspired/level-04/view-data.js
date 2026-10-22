import { fillX, formatDelta } from './logic/score.js';
import { shuffleOptions } from './logic/shuffle.js';
import { normalizeMode, timeLimitMs } from './logic/time.js';

export function actCount(data) {
  const acts = data && Array.isArray(data.acts) ? data.acts : [];
  return acts.length > 0 ? acts.length : 3;
}

export function speakerById(data, id) {
  const want = typeof id === 'string' ? id : '';
  const list = data && Array.isArray(data.speakers) ? data.speakers : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || item.id !== want) continue;
    return {
      id: typeof item.id === 'string' ? item.id : want,
      name: typeof item.name === 'string' ? item.name : '',
      avatar: typeof item.avatar === 'string' ? item.avatar : ''
    };
  }
  return { id: want, name: '', avatar: '' };
}

export function variantNodes(data, actIndex, variant) {
  const acts = data && Array.isArray(data.acts) ? data.acts : [];
  const actNo = Number(actIndex);
  const act = Number.isInteger(actNo) ? acts[actNo] : null;
  const variants = act && Array.isArray(act.variants) ? act.variants : [];
  if (!variants.length) return [];
  let index = Number(variant);
  if (!Number.isInteger(index)) index = 0;
  const count = variants.length;
  index = ((index % count) + count) % count;
  const picked = variants[index];
  return picked && Array.isArray(picked.nodes) ? picked.nodes : [];
}

export function nodeAt(data, state) {
  if (!state || typeof state !== 'object') return null;
  const nodes = variantNodes(data, state.act, state.variant);
  const index = Number(state.node);
  if (!Number.isInteger(index) || index < 0 || index >= nodes.length) return null;
  return nodes[index];
}

// createRun stores orders as act -> node -> option id list. shuffleOptions returns nodes.
export function optionOrders(data, variant, rng, playIndex) {
  const spec = data && typeof data === 'object' ? data : {};
  const acts = Array.isArray(spec.acts) ? spec.acts : [];
  const replay = spec.replay && typeof spec.replay === 'object' ? spec.replay : null;
  const index = Number.isInteger(variant) && variant >= 0 ? variant : 0;
  return acts.map((_, actIndex) => {
    const nodes = variantNodes(spec, actIndex, index);
    const shuffled = shuffleOptions(nodes, rng, replay, playIndex);
    return shuffled.map((node) => {
      const options = node && Array.isArray(node.options) ? node.options : [];
      const ids = [];
      for (const opt of options) {
        if (opt && typeof opt.id === 'string') ids.push(opt.id);
      }
      return ids;
    });
  });
}

export function orderAt(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.orders)) return null;
  const act = state.orders[state.act];
  if (!Array.isArray(act)) return null;
  const row = act[state.node];
  return Array.isArray(row) ? row : null;
}

export function orderedOptions(node, idOrder) {
  const options = node && Array.isArray(node.options) ? node.options : [];
  const byId = new Map();
  for (const opt of options) {
    if (opt && typeof opt.id === 'string' && !byId.has(opt.id)) byId.set(opt.id, opt);
  }
  const out = [];
  const seen = new Set();
  const ids = Array.isArray(idOrder) ? idOrder : [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const opt = byId.get(id);
    if (!opt) continue;
    seen.add(id);
    out.push(opt);
  }
  for (const opt of options) {
    if (!opt || typeof opt.id !== 'string' || seen.has(opt.id)) continue;
    seen.add(opt.id);
    out.push(opt);
  }
  return out;
}

export function barViews(data, values) {
  const list = data && Array.isArray(data.bars) ? data.bars : [];
  const src = values && typeof values === 'object' ? values : {};
  const out = [];
  for (const bar of list) {
    if (!bar || typeof bar.id !== 'string') continue;
    const max = Number(bar.max);
    const raw = Number(src[bar.id]);
    out.push({
      id: bar.id,
      label: typeof bar.label === 'string' ? bar.label : '',
      max: Number.isFinite(max) ? max : 0,
      value: Number.isFinite(raw) ? raw : 0
    });
  }
  return out;
}

export function meterText(template, bar) {
  const label = bar && typeof bar.label === 'string' ? bar.label : '';
  const value = bar && bar.value != null ? bar.value : 0;
  const max = bar && bar.max != null ? bar.max : 0;
  return fillX(template, [label, value, max]);
}

export function actLabelText(template, actIndex, total) {
  const n = Number(actIndex);
  const shown = Number.isInteger(n) && n >= 0 ? n + 1 : 1;
  const count = Number(total);
  const all = Number.isInteger(count) && count > 0 ? count : 3;
  return fillX(template, [shown, all]);
}

export function saysPrefix(template, name) {
  return fillX(template, [name == null ? '' : name]);
}

export function fillPercent(value, max) {
  const cap = Number(max);
  const n = Number(value);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(n)) return '0%';
  let pct = Math.round((n / cap) * 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return String(pct) + '%';
}

const TAG_VIEW = {
  own: { color: '#138A55', icon: 'l11-icon-check.svg', dots: false },
  list: { color: '#5B6275', icon: 'l14-tag-list.svg', dots: false },
  loud: { color: '#E5701E', icon: 'l14-tag-loud.svg', dots: false },
  block: { color: '#2F3E9E', icon: 'l14-tag-block.svg', dots: false },
  timeout: { color: '#9AA1B2', icon: '', dots: true }
};

export function tagView(type) {
  const known = type === 'own' || type === 'list' || type === 'loud' || type === 'block' || type === 'timeout';
  const row = known ? TAG_VIEW[type] : TAG_VIEW.list;
  return { color: row.color, icon: row.icon, dots: row.dots === true };
}

export function deltaLine(template, bars, delta, zero) {
  const src = delta && typeof delta === 'object' ? delta : {};
  const list = Array.isArray(bars) ? bars : [];
  const parts = [];
  for (let i = 0; i < list.length; i += 1) {
    const bar = list[i];
    if (!bar || typeof bar.id !== 'string') continue;
    const label = typeof bar.label === 'string' ? bar.label : '';
    const raw = Number(src[bar.id]);
    const n = Number.isFinite(raw) ? raw : 0;
    parts.push(fillX(template, [label, formatDelta(n, zero)]));
  }
  return parts.join(' ');
}

export function betterSayText(node, type, template) {
  if (type === 'own') return '';
  const options = node && Array.isArray(node.options) ? node.options : [];
  let phrase = '';
  for (let i = 0; i < options.length; i += 1) {
    const opt = options[i];
    if (!opt || opt.type !== 'own') continue;
    if (typeof opt.betterSay === 'string' && opt.betterSay !== '') phrase = opt.betterSay;
    else if (typeof opt.text === 'string') phrase = opt.text;
    break;
  }
  return fillX(template, [phrase]);
}

export function bossFace(speakerId, type) {
  if (speakerId !== 'boss') return '';
  if (type === 'own') return 'l11-boss-happy.svg';
  if (type === 'block' || type === 'timeout') return 'l11-boss-frown.svg';
  return '';
}

export function fillScale(value, max) {
  const cap = Number(max);
  const n = Number(value);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(n)) return 0;
  const ratio = n / cap;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

export function remainingSec(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.ceil(n / 1000);
}

function calmFactor(data) {
  const calm = data && data.calm && typeof data.calm === 'object' ? data.calm : null;
  return calm ? calm.factor : undefined;
}

// Act 2 is index 1. Seconds come from its first timed node and the current mode.
function firstTimedNode(data, actIndex, variant) {
  const nodes = variantNodes(data, actIndex, variant);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const limit = node ? Number(node.timeLimit) : Number.NaN;
    if (Number.isFinite(limit) && limit > 0) return node;
  }
  return null;
}

function secOf(ms) {
  if (ms == null) return null;
  const sec = ms / 1000;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return sec;
}

// The comma between the two × in ui.timeSr, so the off-mode name stays data-driven.
function srJoiner(template) {
  const text = typeof template === 'string' ? template : '';
  const parts = text.split('×');
  if (parts.length < 3) return '';
  return parts[1];
}

// Opening-screen radios. Seconds come from act 2 variant 0, the first play.
export function timeModeChoices(data, ui) {
  const spec = data && typeof data === 'object' ? data : {};
  const text = ui && typeof ui === 'object' ? ui : {};
  const node = firstTimedNode(spec, 1, 0);
  const factor = calmFactor(spec);
  const stdSec = secOf(timeLimitMs(node, 'std', factor));
  const calmSec = secOf(timeLimitMs(node, 'calm', factor));
  const stdName = typeof text.timeStd === 'string' ? text.timeStd : '';
  const calmName = typeof text.timeCalm === 'string' ? text.timeCalm : '';
  const offName = typeof text.timeOff === 'string' ? text.timeOff : '';
  const offSr = typeof text.timeOffSr === 'string' ? text.timeOffSr : '';
  const joiner = srJoiner(text.timeSr);
  return [
    {
      id: 'std',
      lines: [stdName, fillX(text.timeSeconds, [stdSec])],
      label: fillX(text.timeSr, [stdName, stdSec])
    },
    {
      id: 'calm',
      lines: [calmName, fillX(text.timeSeconds, [calmSec])],
      label: fillX(text.timeSr, [calmName, calmSec])
    },
    {
      id: 'off',
      lines: [offName],
      label: offName + joiner + offSr
    }
  ];
}

export function hintText(data, state) {
  if (!state || state.screen !== 'hint') return '';
  const which = Number(state.hintWhich);
  const spec = data && typeof data === 'object' ? data : {};
  const ui = spec.ui && typeof spec.ui === 'object' ? spec.ui : {};
  if (which === 2) return typeof ui.timerHintAgain === 'string' ? ui.timerHintAgain : '';
  if (which !== 1) return '';
  if (normalizeMode(state.mode) === 'off') {
    return typeof spec.timerHintOff === 'string' ? spec.timerHintOff : '';
  }
  const node = firstTimedNode(spec, 1, state.variant);
  const ms = timeLimitMs(node, state.mode, calmFactor(spec));
  const sec = ms == null ? 0 : ms / 1000;
  return fillX(spec.timerHint, [sec]);
}

function lookupTag(typesTag, type) {
  if (typeof typesTag === 'function') {
    const value = typesTag(type);
    return typeof value === 'string' ? value : '';
  }
  if (typeof typesTag === 'string') return typesTag;
  if (Array.isArray(typesTag)) {
    for (let i = 0; i < typesTag.length; i += 1) {
      const item = typesTag[i];
      if (item && item.id === type && typeof item.tag === 'string') return item.tag;
    }
    return '';
  }
  if (typesTag && typeof typesTag === 'object') {
    const value = typesTag[type];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.tag === 'string') return value.tag;
  }
  return '';
}

export function summaryRowView(row, typesTag) {
  const src = row && typeof row === 'object' ? row : {};
  const type = typeof src.type === 'string' ? src.type : '';
  const rowTag = typeof src.tag === 'string' ? src.tag : '';
  const tag = rowTag !== '' ? rowTag : lookupTag(typesTag, type);
  const raw = typeof src.choice === 'string' ? src.choice : '';
  const choice = type === 'timeout' ? tag : raw;
  const changes = [];
  if (Array.isArray(src.changes)) {
    for (let i = 0; i < src.changes.length; i += 1) {
      const item = src.changes[i];
      if (typeof item === 'string') changes.push(item);
    }
  }
  return { choice: choice, type: type, tag: tag, changes: changes };
}

const ENDING_ART = {
  empowered: { kind: 'image', icon: 'l11-team.svg', color: '', height: 96 },
  factory: { kind: 'image', icon: 'l14-ending-factory.svg', color: '', height: 96 },
  firefight: { kind: 'badge', icon: 'l14-tag-loud.svg', color: '#E5701E', height: 96 },
  lone: { kind: 'badge', icon: 'l14-tag-block.svg', color: '#2F3E9E', height: 96 }
};

export function endingArt(id) {
  const known = id === 'empowered' || id === 'factory' || id === 'firefight' || id === 'lone';
  const row = known ? ENDING_ART[id] : null;
  if (!row) return { kind: 'image', icon: '', color: '', height: 0 };
  return { kind: row.kind, icon: row.icon, color: row.color, height: row.height };
}

// Visual break on the settle screen, after this exact marker. The sentence
// itself is not rewritten. The three added markers are the full first line.
// Factory still breaks after the period that already ends its first line.
const ENDING_BODY_BREAK_AFTER = {
  empowered: '功能没多做，用户却留住了。',
  factory: '用户还在走。',
  firefight: '谁喊得响就先做谁的。',
  lone: '需求挡下了不少，团队清静了，'
};

export function endingBodyLines(id, body) {
  if (typeof id !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(ENDING_BODY_BREAK_AFTER, id)) return null;
  const mark = ENDING_BODY_BREAK_AFTER[id];
  if (typeof mark !== 'string' || mark === '') return null;
  const sentence = typeof body === 'string' ? body : '';
  const at = sentence.indexOf(mark);
  if (at < 0) return null;
  const cut = at + mark.length;
  if (cut <= 0 || cut >= sentence.length) return null;
  return [sentence.slice(0, cut), sentence.slice(cut)];
}

export function starRow(stars, max) {
  const cap = Number(max);
  const count = Number.isInteger(cap) && cap > 0 ? cap : 0;
  const n = Number(stars);
  const lit = Number.isFinite(n) && n > 0 ? n : 0;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(i < lit ? 'on' : 'off');
  return out;
}

// Global order across acts for one variant. Act 1 node 1 is index 0. Missing is -1.
export function globalNodeIndex(data, variant, act, node) {
  const actNo = Number(act);
  const nodeNo = Number(node);
  if (!Number.isInteger(actNo) || actNo < 0) return -1;
  if (!Number.isInteger(nodeNo) || nodeNo < 0) return -1;
  const spec = data && typeof data === 'object' ? data : {};
  const acts = Array.isArray(spec.acts) ? spec.acts : [];
  let cursor = 0;
  for (let i = 0; i < acts.length; i += 1) {
    const nodes = variantNodes(spec, i, variant);
    if (i === actNo) {
      if (nodeNo >= nodes.length) return -1;
      return cursor + nodeNo;
    }
    cursor += nodes.length;
  }
  return -1;
}

// Letter at the global node index, or null when the seq is missing or used up.
// With | the seq is split per act (acceptance form oo|ooo|ooo): act and node pick the letter.
export function seqLetter(seq, globalIndex, act, node) {
  if (typeof seq !== 'string') return null;
  if (seq.includes('|')) {
    const parts = seq.split('|');
    const a = Number(act);
    const n = Number(node);
    if (!Number.isInteger(a) || a < 0 || a >= parts.length) return null;
    if (!Number.isInteger(n) || n < 0 || n >= parts[a].length) return null;
    return parts[a].charAt(n);
  }
  const index = Number(globalIndex);
  if (!Number.isInteger(index) || index < 0 || index >= seq.length) return null;
  const letter = seq.charAt(index);
  return letter === '' ? null : letter;
}
