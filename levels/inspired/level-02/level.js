import { uiText } from '../../../js/ui-text.js';
import { createCountdown, timerBarHTML } from '../../../js/timer-bar.js';
import {
  readResume, saveResume, clearResume,
  bumpFailStreak, clearFailStreak,
  readLevelRun, writeLevelRun, clearLevelRun,
  markAutoUnlocked, rememberScore
} from '../../../js/storage.js';

// 判定弹窗期间暂停倒计时。乌咪已裁定要暂停；若以后改口径，只改这一处。
const PAUSE_DURING_JUDGE = true;

// 小屏取舍：纸张按可用宽度等比撑满（670:900，不拉伸）。
// 句子热区等于纸面上的槽（高 = 纸高 × 120/900）。320 宽时槽高仍不低于 48，
// 所以不再用负 margin 把热区撑得比槽高，避免相邻句子热区重叠。
// 放不下时只滚动 .l12-main；四个风险按钮在 .l12-dock，固定底部，不随滚动、不盖句子。

const RISK_ICON = {
  value: 'l12-risk-value.svg',
  usability: 'l12-risk-usability.svg',
  feasibility: 'l12-risk-feasibility.svg',
  viability: 'l12-risk-viability.svg'
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const own = name => new URL(`./assets/${name}`, import.meta.url).href;
const shared = name => new URL(`../level-01/assets/${name}`, import.meta.url).href;
const imgOwn = (name, cls) => `<img class="${cls}" src="${esc(own(name))}" alt="" draggable="false">`;
const imgShared = name => `<img src="${esc(shared(name))}" alt="" draggable="false">`;

function hashSeed(text) {
  let n = 0;
  for (const ch of String(text)) n = (Math.imul(n, 31) + ch.charCodeAt(0)) >>> 0;
  return n;
}

function makeRng(api) {
  if (api && typeof api.random === 'function') return api.random;
  const q = new URLSearchParams(location.search).get('seed');
  if (q == null || q === '') return Math.random;
  const num = Number(q);
  let seed = (Number.isFinite(num) ? num : hashSeed(q)) >>> 0;
  return function rng() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function ensureCss() {
  if (document.getElementById('l12-css')) return;
  const link = document.createElement('link');
  link.id = 'l12-css';
  link.rel = 'stylesheet';
  link.href = new URL('./level.css', import.meta.url).href;
  document.head.appendChild(link);
}

// 自动驾驶钩子只给本机 e2e 用。线上主机名带 l12seq 也必须当没看见。
export function testHookOn(hostname, search) {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local) return false;
  const raw = String(search || '');
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(q).get('l12test') === '1';
}

function readSeq() {
  if (!testHookOn(location.hostname, location.search)) return null;
  const raw = new URLSearchParams(location.search).get('l12seq');
  if (raw == null || raw === '') return null;
  return raw.split('|');
}

export function mount(root, meta, api) {
  let disposed = false;
  const timers = new Set();
  let countdown = null;
  let clickBound = false;
  let onClick = () => {};
  let onVis = () => {};

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (disposed) return;
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function unmount() {
    if (disposed) return;
    disposed = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    if (countdown) countdown.stop();
    countdown = null;
    document.removeEventListener('visibilitychange', onVis);
    if (clickBound) {
      root.removeEventListener('click', onClick);
      clickBound = false;
    }
  }

  if (api && typeof api.bindUnmount === 'function') {
    try { api.bindUnmount(unmount); } catch { /* ignore */ }
  }

  const data = api && api.data;
  if (!data || !Array.isArray(data.sheets)) return unmount;
  ensureCss();
  const ui = uiText(data);
  const bookId = (api && api.bookId) || data.book;
  const levelId = (api && api.levelId) || data.id;
  const seq = readSeq();
  const stopAt = seq
    ? (new URLSearchParams(location.search).get('l12stop') || '')
    : '';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pauseReasons = new Set();

  let variantIndex = 0;
  let attempts = [];
  let scores = [null, null, null];
  let sheetIndex = 0;
  let sheetRaw = 0;
  let judged = {};
  let selected = null;
  let phase = 'intro';
  let inputLocked = false;
  let judgeOpen = false;
  let judgePayload = null;
  let timeUpStarted = false;
  let tapSeen = false;
  let committed = false;
  let failAuto = false;
  let timerTotalMs = 0;
  let autoArmed = false;
  let learnedOpen = true;
  let resultArmed = false;
  let dialogSheet = 1;
  let nudge = false;
  let judgeGen = 0;

  function floorOf() {
    const n = Number(data.scoring && data.scoring.floor);
    return Number.isFinite(n) ? n : 0;
  }
  function shownOf(raw) { return Math.max(floorOf(), raw); }
  function currentLines() { return attempts[sheetIndex] ? attempts[sheetIndex].lines : []; }
  function totalScore() {
    let sum = 0;
    for (let i = 0; i < data.sheets.length; i++) {
      if (i === sheetIndex && (phase === 'play' || phase === 'timeup')) sum += shownOf(sheetRaw);
      else if (typeof scores[i] === 'number') sum += scores[i];
    }
    return sum;
  }
  function starsFor(total) {
    const th = (data.stars && data.stars.thresholds) || {};
    const max = Number(data.stars && data.stars.max) || 3;
    let best = 0;
    for (let s = 1; s <= max; s++) {
      const need = Number(th[String(s)]);
      if (Number.isFinite(need) && total >= need) best = s;
    }
    return best;
  }
  function passAt() { return Number(data.scoring && data.scoring.passAt); }
  function didPass(total) { return total >= passAt(); }

  function effectiveLimit(sheet) {
    const base = Number(sheet && sheet.timeLimit) || 0;
    if (base <= 0) return 0;
    if (!testHookOn(location.hostname, location.search)) return base;
    const q = Number(new URLSearchParams(location.search).get('l12t'));
    if (Number.isFinite(q) && q > 0 && q < base) return q;
    return base;
  }

  function buildAttempt(index, doShuffle) {
    const rng = makeRng(api);
    return data.sheets.map(sheet => {
      const variant = sheet.variants[index % sheet.variants.length];
      const lines = variant.lines.slice();
      if (doShuffle) shuffle(lines, rng);
      return { variant, lines };
    });
  }

  function restoreAttempts(run) {
    attempts = data.sheets.map((sheet, i) => {
      const vid = run.variantIds && run.variantIds[i];
      const variant = sheet.variants.find(v => v.id === vid) || sheet.variants[(run.variantIndex || 0) % sheet.variants.length];
      const map = new Map(variant.lines.map(line => [line.id, line]));
      const order = (run.orders && run.orders[i]) || variant.lines.map(line => line.id);
      const lines = order.map(id => map.get(id)).filter(Boolean);
      return { variant, lines: lines.length === variant.lines.length ? lines : variant.lines.slice() };
    });
  }

  function persist(mode, restart) {
    if (disposed || seq) return;
    const dialog = restart + 1;
    try { saveResume(bookId, levelId, dialog); } catch { /* ignore */ }
    try {
      writeLevelRun(bookId, levelId, {
        variantIndex,
        variantIds: attempts.map(a => a.variant.id),
        orders: attempts.map(a => a.lines.map(line => line.id)),
        scores: scores.slice(),
        mode,
        restart,
        sheet: sheetIndex,
        ts: Date.now()
      });
    } catch { /* ignore */ }
  }

  function stopCountdown() {
    if (countdown) countdown.stop();
    countdown = null;
    timerTotalMs = 0;
  }

  function updateTimerDom(leftMs) {
    const el = root.querySelector('[data-testid="timer-bar"]');
    if (!el) return;
    const sec = Math.max(0, Math.ceil(leftMs / 1000));
    const paused = pauseReasons.size > 0 && phase === 'play';
    el.setAttribute('data-remaining', String(sec));
    el.setAttribute('data-paused', paused ? 'true' : 'false');
    const num = el.querySelector('[data-testid="timer-seconds"]');
    if (num) num.textContent = String(sec);
    const pause = el.querySelector('[data-testid="timer-paused"]');
    if (pause) {
      pause.hidden = !paused;
      pause.textContent = ui.paused;
    }
    const bar = el.querySelector('i');
    if (bar && timerTotalMs) bar.style.width = `${Math.max(0, Math.min(100, leftMs / timerTotalMs * 100))}%`;
  }

  function setPause(reason, on) {
    if (on) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    if (countdown && !countdown.ended) {
      if (pauseReasons.size) countdown.pause();
      else countdown.start();
    }
    if (countdown) updateTimerDom(countdown.remaining);
  }

  function startCountdown(ms) {
    stopCountdown();
    timerTotalMs = ms;
    countdown = createCountdown({
      durationMs: ms,
      onTick(left) { if (!disposed) updateTimerDom(left); },
      onEnd() { if (!disposed) beginTimeUp(); }
    });
    if (document.visibilityState === 'hidden' || document.hidden === true) pauseReasons.add('hidden');
    if (!pauseReasons.size) countdown.start();
    else updateTimerDom(countdown.remaining);
  }

  function hiddenNow() {
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  onVis = function onVisibility() {
    if (disposed) return;
    if (phase === 'play' && countdown && !countdown.ended) setPause('hidden', hiddenNow());
    else if (!hiddenNow()) pauseReasons.delete('hidden');
  };

  function kindFor(line, riskId) {
    if (line.risk == null) return 'false';
    if (line.risk === riskId) return 'hit';
    return 'wrong';
  }
  function nominalFor(kind) {
    if (kind === 'hit') return Number(data.scoring.hit);
    if (kind === 'wrong') return Number(data.scoring.wrongType);
    return Number(data.scoring.falseAlarm);
  }
  function otherRisk(id) {
    const found = data.risks.find(r => r.id !== id);
    return found ? found.id : id;
  }
  function riskBy(id) { return data.risks.find(r => r.id === id) || null; }

  function judgeCopy(line, kind) {
    if (kind === 'hit') {
      const risk = riskBy(line.risk);
      return risk ? risk.correct : '';
    }
    if (kind === 'wrong') {
      const risk = riskBy(line.risk);
      return String(data.judge.wrongType).replace('×', risk ? risk.label : '');
    }
    return data.judge.falseAlarm;
  }

  function shouldEnd() {
    const lines = currentLines();
    const mines = lines.filter(line => line.risk);
    const found = mines.filter(line => {
      const mark = judged[line.id];
      return mark && (mark.kind === 'hit' || mark.kind === 'wrong');
    }).length;
    if (mines.length && found >= mines.length) return true;
    const limit = Number(data.sheets[sheetIndex].timeLimit) || 0;
    if (limit === 0 && lines.every(line => judged[line.id])) return true;
    return false;
  }

  function formatDelta(shownDelta) {
    if (shownDelta > 0) return `+${shownDelta}`;
    if (shownDelta < 0) return String(shownDelta);
    return ui.zeroDelta;
  }

  function finishSheet() {
    if (disposed) return;
    scores[sheetIndex] = shownOf(sheetRaw);
    phase = 'summary';
    inputLocked = false;
    judgeOpen = false;
    judgePayload = null;
    selected = null;
    stopCountdown();
    pauseReasons.delete('judge');
    persist('summary', sheetIndex);
    draw();
  }

  function beginTimeUp() {
    if (disposed || timeUpStarted || phase !== 'play') return;
    timeUpStarted = true;
    inputLocked = true;
    selected = null;
    judgeOpen = false;
    judgePayload = null;
    stopCountdown();
    pauseReasons.clear();
    phase = 'timeup';
    const missed = currentLines().filter(line => line.risk && !judged[line.id]);
    for (const line of currentLines()) {
      if (!line.risk && !judged[line.id]) judged[line.id] = { kind: 'normal' };
    }
    let index = 0;
    const scripted = !!(seq && String(seq[sheetIndex] || '').includes('t'));
    const gap = scripted ? 40 : 420;
    const step = () => {
      if (disposed || phase !== 'timeup') return;
      if (index < missed.length) {
        judged[missed[index].id] = { kind: 'missed' };
        index += 1;
        nudge = !reduceMotion;
        draw();
        later(step, gap);
        return;
      }
      later(() => { if (!disposed && phase === 'timeup') finishSheet(); }, scripted ? 30 : 700);
    };
    nudge = false;
    draw();
    later(step, seq ? 20 : 280);
  }

  function closeJudge() {
    if (!judgeOpen) return;
    judgeOpen = false;
    judgePayload = null;
    judgeGen += 1;
    if (PAUSE_DURING_JUDGE) setPause('judge', false);
    if (disposed) return;
    if (shouldEnd()) finishSheet();
    else draw();
  }

  function applyJudge(line, riskId, source) {
    if (!line || judged[line.id] || phase !== 'play' || inputLocked || disposed) return;
    const kind = kindFor(line, riskId);
    const nominal = nominalFor(kind);
    const before = shownOf(sheetRaw);
    sheetRaw += nominal;
    const shownDelta = shownOf(sheetRaw) - before;
    judged[line.id] = { kind, picked: riskId };
    selected = null;
    tapSeen = true;
    if (source === 'auto') {
      if (shouldEnd()) finishSheet();
      else draw();
      return;
    }
    judgePayload = { kind, line, shownDelta };
    judgeOpen = true;
    if (PAUSE_DURING_JUDGE) setPause('judge', true);
    draw();
    const ms = line.note ? Number(ui.noteShowMs) : Number(data.judge.showSeconds) * 1000;
    const gen = ++judgeGen;
    later(() => {
      if (gen !== judgeGen) return;
      closeJudge();
    }, Number.isFinite(ms) && ms > 0 ? ms : 1500);
  }

  function pickAutoLine(ch) {
    const lines = currentLines();
    if (ch === 'f') return lines.find(line => line.risk == null && !judged[line.id]) || null;
    if (ch === 'h' || ch === 'w') return lines.find(line => line.risk && !judged[line.id]) || null;
    return null;
  }

  function kickAuto() {
    if (!seq || phase !== 'play') return;
    const script = seq[sheetIndex] || '';
    if (!script) return;
    let cursor = 0;
    const step = () => {
      if (disposed || phase !== 'play') return;
      if (cursor >= script.length) return;
      const ch = script[cursor++];
      if (ch === 't') { beginTimeUp(); return; }
      const line = pickAutoLine(ch);
      if (!line) return;
      const riskId = ch === 'h' ? line.risk : (ch === 'f' ? data.risks[0].id : otherRisk(line.risk));
      applyJudge(line, riskId, 'auto');
      if (disposed || phase !== 'play') return;
      later(step, 0);
    };
    later(step, 0);
  }

  function startSheet(index) {
    if (disposed) return;
    sheetIndex = index;
    sheetRaw = 0;
    judged = {};
    selected = null;
    inputLocked = false;
    judgeOpen = false;
    judgePayload = null;
    timeUpStarted = false;
    if (index === 0) tapSeen = false;
    scores[index] = null;
    phase = 'play';
    stopCountdown();
    pauseReasons.clear();
    if (hiddenNow()) pauseReasons.add('hidden');
    autoArmed = true;
    persist('play', index);
    draw();
    const limit = effectiveLimit(data.sheets[index]);
    if (limit > 0) startCountdown(limit * 1000);
  }

  function goNext() {
    if (disposed) return;
    if (phase === 'summary') {
      if (sheetIndex <= 0) {
        phase = 'hint';
        persist('hint', 1);
        draw();
        return;
      }
      if (sheetIndex >= data.sheets.length - 1) { showResult(); return; }
      startSheet(sheetIndex + 1);
      return;
    }
    if (phase === 'hint') startSheet(1);
  }

  function showResult() {
    if (disposed) return;
    const total = totalScore();
    const stars = starsFor(total);
    const pass = didPass(total);
    phase = 'result';
    stopCountdown();
    pauseReasons.clear();
    if (!committed) {
      committed = true;
      if (!seq) {
        try { clearResume(bookId, levelId); } catch { /* ignore */ }
        try { clearLevelRun(bookId, levelId); } catch { /* ignore */ }
        if (pass) {
          failAuto = false;
          try { clearFailStreak(bookId, levelId); } catch { /* ignore */ }
          try { if (api && api.complete) api.complete({ stars, score: total, stay: true }); } catch { /* ignore */ }
        } else {
          let n = 0;
          try { n = bumpFailStreak(bookId, levelId); } catch { /* ignore */ }
          try { rememberScore(bookId, levelId, stars, total); } catch { /* ignore */ }
          const need = Number(data.fail && data.fail.autoUnlockAfter);
          if (Number.isFinite(need) && n >= need) {
            failAuto = true;
            try { markAutoUnlocked(bookId, levelId); } catch { /* ignore */ }
          } else failAuto = false;
        }
      }
    }
    if (disposed) return;
    learnedOpen = true;
    resultArmed = true;
    draw();
  }

  function fresh(index, doShuffle) {
    variantIndex = index;
    attempts = buildAttempt(index, doShuffle);
    scores = [null, null, null];
    sheetIndex = 0;
    sheetRaw = 0;
    judged = {};
    selected = null;
    inputLocked = false;
    judgeOpen = false;
    judgePayload = null;
    timeUpStarted = false;
    tapSeen = false;
    committed = false;
    failAuto = false;
    phase = 'intro';
    stopCountdown();
    pauseReasons.clear();
    if (!seq) {
      try { clearResume(bookId, levelId); } catch { /* ignore */ }
      try { clearLevelRun(bookId, levelId); } catch { /* ignore */ }
    }
    draw();
  }

  function replay() {
    const count = data.sheets[0].variants.length || 1;
    const next = (variantIndex + 1) % count;
    const doShuffle = !!(data.replay && data.replay.shuffleLines);
    fresh(next, doShuffle);
  }

  function continueRun() {
    let run = null;
    try { run = readLevelRun(bookId, levelId); } catch { run = null; }
    if (!run) { fresh(0, false); return; }
    restoreAttempts(run);
    variantIndex = Number(run.variantIndex) || 0;
    scores = Array.isArray(run.scores) ? run.scores.slice() : [null, null, null];
    while (scores.length < 3) scores.push(null);
    if (run.mode === 'summary') {
      sheetIndex = Number(run.sheet) || 0;
      phase = 'summary';
      draw();
      return;
    }
    if (run.mode === 'hint') {
      sheetIndex = 0;
      phase = 'hint';
      draw();
      return;
    }
    startSheet(Number(run.restart) || 0);
  }

  function lineState(line) {
    const mark = judged[line.id];
    if (mark) return mark.kind;
    if (selected === line.id) return 'selected';
    return 'idle';
  }

  function tagHTML(risk) {
    return `<span class="l12-tag" data-risk="${esc(risk.id)}"><img src="${esc(own(RISK_ICON[risk.id]))}" alt=""><span>${esc(risk.label)}</span></span>`;
  }

  function tailHTML(line, state) {
    if (state === 'hit' || state === 'wrong') {
      const risk = riskBy(line.risk);
      if (!risk) return '';
      return `${imgOwn('l12-mine.svg', 'l12-mine')}${tagHTML(risk)}`;
    }
    if (state === 'missed') {
      const risk = riskBy(line.risk);
      const label = String(data.missedLabel).replace('×', risk ? risk.label : '');
      return `${imgOwn('l12-mine-boom.svg', 'l12-boom')}<span class="l12-miss" data-risk="${esc(line.risk || '')}">${esc(label)}</span>`;
    }
    return '';
  }

  function sheetAttr() {
    if (phase === 'play' || phase === 'summary' || phase === 'timeup') {
      const sheet = data.sheets[sheetIndex];
      return sheet ? sheet.id : '';
    }
    return '';
  }
  function variantAttr() {
    if (!(phase === 'play' || phase === 'summary' || phase === 'timeup')) return '';
    const attempt = attempts[sheetIndex];
    return attempt ? attempt.variant.id : '';
  }

  function primary(act, testid, label) {
    return `<button type="button" class="l12-primary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }
  function secondary(act, testid, label) {
    return `<button type="button" class="l12-secondary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }

  function timerHTML() {
    const sheet = data.sheets[sheetIndex];
    const limit = effectiveLimit(sheet);
    if (!(limit > 0 && (phase === 'play' || phase === 'timeup'))) return '';
    const leftMs = countdown ? countdown.remaining : (phase === 'timeup' ? 0 : limit * 1000);
    const sec = Math.max(0, Math.ceil(leftMs / 1000));
    const paused = phase === 'play' && pauseReasons.size > 0;
    return timerBarHTML({
      remainingSec: sec,
      paused,
      pausedLabel: esc(ui.paused),
      totalSec: limit,
      className: 'l12-timer'
    });
  }

  function timeUpHTML() {
    const count = currentLines().filter(line => {
      if (!line.risk) return false;
      const mark = judged[line.id];
      if (!mark) return true;
      return mark.kind === 'missed';
    }).length;
    const text = String(data.timeUp).replace('×', String(count));
    return `<p class="l12-timeup" data-testid="time-up">${esc(text)}</p>`;
  }

  function paperHTML() {
    const attempt = attempts[sheetIndex];
    const lines = attempt.lines.map((line, i) => {
      const state = lineState(line);
      return `<button type="button" class="l12-line is-${state}" style="--i:${i}" data-act="line" data-id="${esc(line.id)}" data-testid="line-${esc(line.id)}" data-state="${state}" aria-label="${esc(line.text)}">
        <span class="l12-line-text">${esc(line.text)}</span>
        <span class="l12-line-tail">${tailHTML(line, state)}</span>
      </button>`;
    }).join('');
    return `<div class="l12-fit"><div class="l12-paper" data-testid="sheet-paper" data-act="blank">
      <h2 class="l12-sheet-title" data-testid="sheet-title">${esc(attempt.variant.title)}</h2>
      <div class="l12-sheet-rule" aria-hidden="true"></div>
      ${lines}
    </div></div>`;
  }

  function hintHTML() {
    if (!(phase === 'play' && sheetIndex === 0 && !tapSeen)) return '';
    return `<p class="l12-hint" data-testid="tap-hint"><img src="${esc(shared('l11-icon-tap.svg'))}" alt="">${esc(data.tapHint)}</p>`;
  }

  function riskDock() {
    const off = !selected || inputLocked || phase !== 'play' || judgeOpen;
    return `<div class="l12-risks" data-testid="risk-dock">${data.risks.map(risk => {
      const dis = off ? ' disabled' : '';
      return `<button type="button" class="l12-risk" data-risk="${esc(risk.id)}" data-act="risk" data-id="${esc(risk.id)}" data-testid="risk-${esc(risk.id)}"${dis} aria-disabled="${off ? 'true' : 'false'}" aria-label="${esc(risk.name)}">
        <img src="${esc(own(RISK_ICON[risk.id]))}" alt=""><span>${esc(risk.label)}</span>
      </button>`;
    }).join('')}</div>`;
  }

  function foundCount() {
    return currentLines().filter(line => {
      if (!line.risk) return false;
      const mark = judged[line.id];
      return mark && (mark.kind === 'hit' || mark.kind === 'wrong');
    }).length;
  }

  function sheetDoneText() {
    const totalMines = currentLines().filter(line => line.risk).length;
    const found = foundCount();
    let n = 0;
    const values = [found, totalMines];
    return String(data.sheetDone).replace(/×/g, () => String(values[n++] ?? ''));
  }

  function judgeHTML() {
    if (!judgeOpen || !judgePayload) return '';
    const { kind, line, shownDelta } = judgePayload;
    const icon = kind === 'hit'
      ? `<span class="l12-mark is-hit">${imgShared('l11-icon-check.svg')}</span>`
      : (kind === 'wrong'
        ? `<span class="l12-mark is-wrong">${imgShared('l11-icon-question.svg')}</span>`
        : `<span class="l12-mark is-false"><i class="l12-x" aria-hidden="true"></i></span>`);
    const note = line.note ? `<p class="l12-note" data-testid="judge-note">${esc(line.note)}</p>` : '';
    const cls = shownDelta > 0 ? 'is-pos' : (shownDelta < 0 ? 'is-neg' : 'is-zero');
    return `<div class="l12-judge" data-testid="judge-pop" data-act="close-judge">
      <div class="l12-judge-card">
        ${icon}
        <div class="l12-judge-copy">
          <p data-testid="judge-text">${esc(judgeCopy(line, kind))}</p>
          ${note}
          <p class="l12-delta ${cls}" data-testid="judge-delta">${esc(formatDelta(shownDelta))}</p>
        </div>
      </div>
    </div>`;
  }

  function learnedHTML() {
    const open = learnedOpen;
    return `<section class="l12-learned" data-testid="learned-bar">
      <button type="button" class="l12-learned-btn" data-act="learned" data-testid="learned-toggle" aria-expanded="${open ? 'true' : 'false'}">
        <span data-testid="learned-short"${open ? ' hidden' : ''}>${esc(ui.learnedCollapsed)}</span>
      </button>
      <div class="l12-learned-more" data-testid="learned-more"${open ? '' : ' hidden'}>
        <p data-testid="learned-summary">${esc(data.learned.summary)}</p>
        <p>${esc(data.learned.tomorrow)}</p>
        <p class="l12-note">${esc(data.learned.disclaimer)}</p>
      </div>
    </section>`;
  }

  function starsHTML(n) {
    const max = Number(data.stars && data.stars.max) || 3;
    let html = '';
    for (let i = 1; i <= max; i++) {
      const on = i <= n;
      html += `<img data-testid="star-${i}" src="${esc(shared(on ? 'ui-star-on.svg' : 'ui-star-off.svg'))}" alt="">`;
    }
    return `<div class="l12-stars" data-testid="stars" role="img" aria-label="${max} 颗星中得 ${n} 颗">${html}</div>`;
  }

  function feedbackText(total, stars) {
    if (!didPass(total)) return failAuto ? data.fail.autoUnlockBody : data.fail.body;
    return (data.stars.feedback && data.stars.feedback[String(stars)]) || '';
  }

  function syncLearned() {
    const more = root.querySelector('[data-testid="learned-more"]');
    const btn = root.querySelector('[data-testid="learned-toggle"]');
    const short = root.querySelector('[data-testid="learned-short"]');
    if (btn) btn.setAttribute('aria-expanded', learnedOpen ? 'true' : 'false');
    if (more) more.hidden = !learnedOpen;
    if (short) short.hidden = learnedOpen;
  }

  function armLearned() {
    later(() => {
      if (disposed || phase !== 'result') return;
      learnedOpen = false;
      syncLearned();
    }, 2000);
  }

  function afterDraw() {
    if (disposed) return;
    const shell = root.querySelector('.l12');
    if (shell && nudge) shell.classList.add('is-nudge');
    nudge = false;
    if (phase === 'result' && resultArmed) {
      resultArmed = false;
      armLearned();
      return;
    }
    if (!seq) return;
    if (phase === 'intro') {
      later(() => { if (!disposed && phase === 'intro') startSheet(0); }, 0);
      return;
    }
    if (phase === 'play') {
      if (autoArmed) { autoArmed = false; kickAuto(); }
      return;
    }
    if (phase === 'summary' && stopAt === 'summary') return;
    if (phase === 'hint' && stopAt === 'hint') return;
    if (phase === 'summary' || phase === 'hint') {
      later(() => {
        if (disposed) return;
        if (phase === 'summary' || phase === 'hint') goNext();
      }, 0);
    }
  }

  function draw() {
    if (disposed) return;
    const total = totalScore();
    const starsNow = starsFor(total);
    let main = '';
    let dock = '';
    let overlay = '';
    if (phase === 'intro') {
      main = `<div class="l12-intro">
        <div class="l12-avatar">${imgShared('l11-icon-person.svg')}</div>
        <div class="l12-quote">${imgShared('l11-bubble.svg')}<p data-testid="intro-body">${esc(data.intro.body)}</p></div>
        <h2 data-testid="intro-title">${esc(data.intro.title)}</h2>
      </div>`;
      dock = primary('start', 'btn-start', data.intro.button || data.buttons.start);
    } else if (phase === 'play' || phase === 'timeup') {
      main = `${timerHTML()}${phase === 'timeup' ? timeUpHTML() : ''}${hintHTML()}${paperHTML()}`;
      dock = riskDock();
    } else if (phase === 'summary') {
      main = `<div class="l12-summary"><p data-testid="sheet-done">${esc(sheetDoneText())}</p></div>`;
      dock = `<div class="l12-actions">${primary('next', 'btn-next', data.buttons.next)}</div>`;
    } else if (phase === 'hint') {
      main = `<p class="l12-hint-block" data-testid="timer-hint">${esc(data.timerHint)}</p>`;
      dock = `<div class="l12-actions">${primary('next', 'btn-next', data.buttons.next)}</div>`;
    } else if (phase === 'result') {
      const text = feedbackText(total, starsNow);
      main = `<p class="l12-score" data-testid="result-score">总分 ${total}</p>
        ${starsHTML(starsNow)}
        <p class="l12-feedback" data-testid="result-feedback">${esc(text)}</p>`;
      const pass = didPass(total);
      const buttons = pass
        ? `${primary('exit', 'btn-backToMap', data.buttons.backToMap)}${secondary('replay', 'btn-replay', data.buttons.replay)}`
        : `${primary('retry', 'btn-retry', data.buttons.retry)}${secondary('exit', 'btn-backToMap', data.buttons.backToMap)}`;
      dock = `${learnedHTML()}<div class="l12-actions">${buttons}</div>`;
    } else if (phase === 'resume') {
      const prompt = String(ui.resumePrompt).replace('×', String(dialogSheet));
      overlay = `<div class="l12-mask" data-testid="resume-dialog"><div class="l12-panel">
        <p data-testid="resume-text">${esc(prompt)}</p>
        <div class="l12-actions">
          ${primary('resume-go', 'resume-continue', ui.resumeContinue)}
          ${secondary('resume-new', 'resume-restart', ui.resumeRestart)}
        </div>
      </div></div>`;
    }
    const starAttr = phase === 'result' ? ` data-stars="${starsNow}"` : '';
    root.innerHTML = `<div class="l12${nudge ? ' is-nudge' : ''}" data-testid="level" data-screen="${phase}" data-sheet="${esc(sheetAttr())}" data-variant="${esc(variantAttr())}" data-score="${total}"${starAttr}>
      <header class="l12-top">
        <button type="button" class="l12-back" data-act="back" data-testid="back" aria-label="返回">${imgShared('ui-back.svg')}<span class="visually-hidden">返回</span></button>
        <h1>${esc(data.title)}</h1>
      </header>
      <div class="l12-main">${main}</div>
      ${dock ? `<div class="l12-dock">${dock}</div>` : ''}
      ${overlay}
      ${judgeHTML()}
    </div>`;
    afterDraw();
  }

  function toggleLine(id) {
    if (phase !== 'play' || inputLocked || disposed) return;
    if (!id || judged[id]) return;
    if (selected === id) selected = null;
    else { selected = id; tapSeen = true; }
    draw();
  }

  function pickRisk(riskId) {
    if (phase !== 'play' || inputLocked || !selected || disposed) return;
    const line = currentLines().find(item => item.id === selected);
    if (!line) return;
    applyJudge(line, riskId, 'click');
  }

  onClick = function handleClick(e) {
    if (disposed) return;
    if (judgeOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeJudge();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.getAttribute('data-act');
    if (act === 'back' || act === 'exit') { if (api && api.exit) api.exit(); return; }
    if (act === 'start') { startSheet(0); return; }
    if (act === 'line') { toggleLine(el.getAttribute('data-id')); return; }
    if (act === 'blank') {
      if (selected) { selected = null; draw(); }
      return;
    }
    if (act === 'risk') { pickRisk(el.getAttribute('data-id')); return; }
    if (act === 'next') { goNext(); return; }
    if (act === 'replay' || act === 'retry') { replay(); return; }
    if (act === 'learned') {
      learnedOpen = !learnedOpen;
      syncLearned();
      return;
    }
    if (act === 'resume-go') { continueRun(); return; }
    if (act === 'resume-new') { fresh(0, false); return; }
  };

  if (disposed) return unmount;
  clickBound = true;
  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVis);

  let saved = null;
  let run = null;
  try { saved = readResume(bookId, levelId); } catch { saved = null; }
  try { run = readLevelRun(bookId, levelId); } catch { run = null; }
  if (!saved) {
    if (!seq) {
      try { clearLevelRun(bookId, levelId); } catch { /* ignore */ }
    }
    run = null;
  }
  if (disposed) return unmount;
  if (saved && run && !seq) {
    dialogSheet = Number(saved.screen) || 1;
    phase = 'resume';
    draw();
    return unmount;
  }
  fresh(0, false);
  return unmount;
}
