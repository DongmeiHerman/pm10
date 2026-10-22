// Section 15: drop ASCII spaces, punctuation counts.
export const LINE_MAX = 28;
export const OPTION_MAX = 16;
export const ASIDE_MAX = 24;
export const ENDING_BODY_MAX = 32;
export const ENDING_IDS = Object.freeze(['empowered', 'factory', 'firefight', 'lone']);
const ENDING_FROM = Object.freeze({
  factory: 'list',
  firefight: 'loud',
  lone: 'block'
});
export const TIME_MODES = Object.freeze(['std', 'calm', 'off']);

export function countChars(text) {
  return Array.from(String(text == null ? '' : text).replace(/ /g, '')).length;
}

function push(issues, code, path, detail) {
  issues.push({ code, path, detail });
}

function playNodeCounts(data) {
  const acts = Array.isArray(data.acts) ? data.acts : [];
  let slots = 0;
  for (const act of acts) {
    const n = act && Array.isArray(act.variants) ? act.variants.length : 0;
    if (n > slots) slots = n;
  }
  if (!acts.length) return [0];
  const counts = [];
  const total = slots || 1;
  for (let i = 0; i < total; i++) {
    let n = 0;
    for (const act of acts) {
      const list = act && Array.isArray(act.variants) ? act.variants : [];
      if (!list.length) continue;
      const variant = list[i % list.length];
      n += variant && Array.isArray(variant.nodes) ? variant.nodes.length : 0;
    }
    counts.push(n);
  }
  return counts;
}

function sameMembers(got, expect) {
  if (got.length !== expect.length) return false;
  const a = got.slice().sort();
  const b = expect.slice().sort();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function timeLeftCueLegal(cue) {
  if (!cue || typeof cue !== 'object' || Array.isArray(cue)) return false;
  const keys = Object.keys(cue);
  if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(cue, 'std') || !Object.prototype.hasOwnProperty.call(cue, 'calm')) {
    return false;
  }
  for (const key of ['std', 'calm']) {
    const n = cue[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return false;
  }
  return true;
}

function checkEndingRow(issues, id, row) {
  const where = `endings.${id}`;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    push(issues, 'ending', where, `${id} not an object`);
    return;
  }
  if (typeof row.name !== 'string' || row.name === '') {
    push(issues, 'ending', where, `${id} name empty`);
  }
  if (typeof row.body !== 'string' || row.body === '') {
    push(issues, 'ending', where, `${id} body empty`);
  } else if (countChars(row.body) > ENDING_BODY_MAX) {
    push(issues, 'endingBody', where, `${id} body ${countChars(row.body)} max ${ENDING_BODY_MAX}`);
  }
  // empowered has no "from" in the frozen data. The other three are fixed, not "one of".
  if (id === 'empowered') {
    if (Object.prototype.hasOwnProperty.call(row, 'from')) {
      push(issues, 'ending', where, `${id} has from`);
    }
    return;
  }
  if (row.from !== ENDING_FROM[id]) {
    push(issues, 'ending', where, `${id} from ${row.from}`);
  }
}

export function validateData(data) {
  const issues = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    push(issues, 'data', '', 'not an object');
    return issues;
  }

  const known = new Set();
  if (Array.isArray(data.speakers)) {
    for (const speaker of data.speakers) {
      if (speaker && typeof speaker.id === 'string') known.add(speaker.id);
    }
  }

  const acts = Array.isArray(data.acts) ? data.acts : [];
  acts.forEach((act, ai) => {
    const variants = act && Array.isArray(act.variants) ? act.variants : [];
    variants.forEach((variant, vi) => {
      const nodes = variant && Array.isArray(variant.nodes) ? variant.nodes : [];
      nodes.forEach((node, ni) => {
        const where = `acts[${ai}].variants[${vi}].nodes[${ni}]`;
        const id = node && node.id ? node.id : where;
        if (!node || typeof node !== 'object') {
          push(issues, 'own', where, `${id} not a node`);
          return;
        }
        if (!known.has(node.speaker)) {
          push(issues, 'speaker', where, `${id} speaker ${node.speaker}`);
        }
        if (typeof node.line === 'string' && countChars(node.line) > LINE_MAX) {
          push(issues, 'line', where, `${id} line ${countChars(node.line)} max ${LINE_MAX}`);
        }
        const options = Array.isArray(node.options) ? node.options : [];
        let own = 0;
        options.forEach((opt, oi) => {
          const optWhere = `${where}.options[${oi}]`;
          if (opt && opt.type === 'own') own += 1;
          if (opt && typeof opt.text === 'string' && countChars(opt.text) > OPTION_MAX) {
            push(issues, 'option', optWhere, `${opt.id || optWhere} option ${countChars(opt.text)} max ${OPTION_MAX}`);
          }
          if (opt && typeof opt.after === 'string' && countChars(opt.after) > ASIDE_MAX) {
            push(issues, 'aside', optWhere, `${opt.id || optWhere} aside ${countChars(opt.after)} max ${ASIDE_MAX}`);
          }
        });
        if (own !== 1) {
          push(issues, 'own', where, `${id} own ${own}`);
        }
        const limit = Number(node.timeLimit);
        if (Number.isFinite(limit) && limit > 0) {
          const waitOk = typeof node.waitLabel === 'string' && countChars(node.waitLabel) > 0;
          const afterOk = typeof node.timeoutAfter === 'string' && countChars(node.timeoutAfter) > 0;
          if (!waitOk || !afterOk) {
            push(issues, 'timed', where, `${id} timed missing wait or timeout`);
          }
        }
        if (typeof node.timeoutAfter === 'string' && countChars(node.timeoutAfter) > ASIDE_MAX) {
          push(issues, 'aside', where, `${id} timeout ${countChars(node.timeoutAfter)} max ${ASIDE_MAX}`);
        }
      });
    });
  });

  const counts = playNodeCounts(data);
  const bars = Array.isArray(data.bars) ? data.bars : [];
  bars.forEach((bar, bi) => {
    const start = Number(bar && bar.start);
    const max = Number(bar && bar.max);
    const id = bar && bar.id ? bar.id : `bars[${bi}]`;
    if (!Number.isFinite(start) || !Number.isFinite(max)) {
      push(issues, 'bar', `bars[${bi}]`, `${id} bad start or max`);
      return;
    }
    for (let i = 0; i < counts.length; i++) {
      const n = counts[i];
      if (start - n < 0 || start + n > max) {
        push(issues, 'bar', `bars[${bi}]`, `${id} start ${start} nodes ${n} low ${start - n} high ${start + n} max ${max}`);
        break;
      }
    }
  });

  const endings = data.endings;
  const endingObj = endings && typeof endings === 'object' && !Array.isArray(endings);
  // Skip only the key "rule". Another string value ("note":"x") is still an extra id.
  // Do not skip every string value.
  const ids = endingObj
    ? Object.keys(endings).filter((key) => key !== 'rule')
    : null;
  if (!ids || !sameMembers(ids, ENDING_IDS)) {
    push(issues, 'endings', 'endings', `ending ids must be ${ENDING_IDS.join(',')}`);
  }
  if (endingObj) {
    for (const id of ENDING_IDS) checkEndingRow(issues, id, endings[id]);
  }

  if (!timeLeftCueLegal(data.timeLeftCue)) {
    push(issues, 'timeLeftCue', 'timeLeftCue', 'need positive integer std and calm only');
  }
  if (!TIME_MODES.includes(data.timeModeDefault)) {
    push(issues, 'timeModeDefault', 'timeModeDefault', 'std, calm or off');
  }
  if (data.seenEndingsOn !== 'pass') {
    push(issues, 'seenEndingsOn', 'seenEndingsOn', 'pass only');
  }

  return issues;
}
