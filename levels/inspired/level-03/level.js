import { uiText, STARS_SR, MISSED_SR, JUDGE_PLUS_SR, JUDGE_ZERO_SR, JUDGE_MINUS_SR } from '../../../js/ui-text.js';
import { createCountdown, timerBarHTML } from '../../../js/timer-bar.js';
import { testHookOn } from '../../../js/test-hook.js';
import {
  readResume, saveResume, clearResume,
  bumpFailStreak, clearFailStreak,
  readLevelRun, writeLevelRun, clearLevelRun,
  markAutoUnlocked, rememberScore
} from '../../../js/storage.js';
import { gradeOf, deltaOf, roundScore, starsFor, didPass } from './logic/score.js';
import {
  LANE_COUNT, BUBBLE_W, BUBBLE_H, QUEUE_GAP,
  initLanes, lanesStep, selectBubble, releaseBubble, benchBubble,
  markBubbleDone, setTrackWidth
} from './logic/lanes.js';
import { initLagState, probeStep, guardStep } from './logic/lag.js';

const HIT_MIN = 44;
const LANE_PITCH = BUBBLE_H + QUEUE_GAP;
const GONE_MS = 1000;

const L13_UI_DEFAULTS = {
  paused: '暂停',
  zeroDelta: '+0',
  unlocked: '已解锁',
  comeBack: '回来拿星',
  resumePrompt: '上次做到第 × 轮，接着做吗？',
  resumeContinue: '接着做',
  resumeRestart: '从头开始',
  learnedCollapsed: '这关学到了：能用纸试的，别用代码试',
  noteShowMs: 3000,
  calmToggle: '从容模式',
  calmToggleNote: '时间多一半',
  cardsToggle: '逐张出题',
  cardsToggleNote: '不飘走，等你选',
  cardsToggleSr: '用读屏建议打开',
  lagSwitchNext: '画面有点卡，后面改成一张一张出，计分不变。',
  lagSwitchNow: '画面有点卡，这轮改成逐张重来，前面的分数保留。',
  lagOk: '好的',
  lagKeep: '还是飘过',
  roundLabel: '第 × / × 轮',
  untimed: '不限时',
  pickFirst: '先点一个想法',
  testing: '测试中',
  waitTest: '先等这个测完',
  goneTag: '没测',
  roundScore: '本轮 × 分',
  roundFloor: '正式开发扣到底，本轮按 0 分计',
  srNewIdea: '来了一个想法',
  statsLine: '测出 × 个，× 个有人要，正式开发 × 次',
  cardCount: '第 × / × 张',
  benchLeft: '× · 还剩 × 秒',
  srSelected: '已选中',
  shouldUse: '该用：×',
  totalScore: '总分 × / ×',
  toolSeconds: '× 秒',
  srTool: '×，× 秒'
};

const TOOL_COLOR = { paper: '#4C5FD5', click: '#0F9E86', build: '#E5701E' };
const R1_CLOCK_MS = 24 * 60 * 60 * 1000;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const own = name => new URL(`./assets/${name}`, import.meta.url).href;
const shared = name => new URL(`../level-01/assets/${name}`, import.meta.url).href;
const imgShared = (name, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${esc(shared(name))}" alt="" draggable="false">`;

function fill(template, values) {
  let i = 0;
  return String(template ?? '').replace(/×/g, () => String(values[i++] ?? ''));
}

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

function hookOn() {
  return testHookOn(location.hostname, location.search, 'l13test');
}

function ensureCss() {
  if (document.getElementById('l13-css')) return;
  const link = document.createElement('link');
  link.id = 'l13-css';
  link.rel = 'stylesheet';
  link.href = new URL('./level.css', import.meta.url).href;
  document.head.appendChild(link);
}

function formatDelta(n, zero) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${Math.abs(n)}`;
  return zero;
}

export function mount(root, meta, api) {
  let disposed = false;
  let live = null;
  let judgeEl = null;
  let judgeHist = 0;
  let judgeCloseFromPop = false;
  let judgeKeyBound = false;
  let judgePopBound = false;
  let dropPopListener = null;
  let histChain = Promise.resolve();
  let inerted = [];
  let judgeReturnTool = '';
  let announcedKey = '';
  const announcedSet = new Set();
  const missedSrSet = new Set();
  const timers = new Set();
  let countdown = null;
  let clickBound = false;
  let resizeBound = false;
  let onClick = () => {};
  let onResize = () => {};

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
    if (live) {
      live.remove();
      live = null;
    }
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    if (countdown) {
      if (typeof countdown.dispose === 'function') countdown.dispose();
      else countdown.stop();
    }
    countdown = null;
    if (clickBound) {
      root.removeEventListener('click', onClick);
      clickBound = false;
    }
    if (resizeBound) {
      window.removeEventListener('resize', onResize);
      resizeBound = false;
    }
    if (judgeKeyBound) {
      window.removeEventListener('keydown', onJudgeKey);
      judgeKeyBound = false;
    }
    if (judgePopBound) {
      window.removeEventListener('popstate', onJudgePop);
      judgePopBound = false;
    }
    if (dropPopListener) {
      window.removeEventListener('popstate', dropPopListener);
      dropPopListener = null;
    }
    clearInert();
    if (judgeEl) {
      judgeEl.remove();
      judgeEl = null;
    }
    // 只有还停在本关、且当前历史就是弹窗压上的那条时才退。hash 已经换过就别退，免得把路由拉回来。
    if (judgeHist === 1 && judgeStateOnTop() && location.hash.indexOf('/level-03') !== -1) {
      judgeHist = 0;
      try { history.back(); } catch { /* ignore */ }
    } else {
      judgeHist = 0;
    }
    const lagBox = root.querySelector('[data-testid="lag-dialog"]');
    if (lagBox) lagBox.remove();
  }

  if (api && typeof api.bindUnmount === 'function') {
    try { api.bindUnmount(unmount); } catch { /* ignore */ }
  }

  const data = api && api.data;
  if (!data || !Array.isArray(data.rounds) || !Array.isArray(data.tools)) return unmount;
  ensureCss();

  const ui = uiText(data, L13_UI_DEFAULTS);
  // 挂在关卡根节点外，重绘不会丢掉，读屏才能接着播新卡。
  const staleLive = document.getElementById('l13-sr-live');
  if (staleLive) staleLive.remove();
  live = document.createElement('div');
  live.id = 'l13-sr-live';
  live.className = 'visually-hidden';
  live.setAttribute('data-testid', 'sr-new');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.style.position = 'fixed';
  live.style.top = '0';
  live.style.left = '0';
  live.style.pointerEvents = 'none';
  const liveParent = root.parentNode;
  if (liveParent) liveParent.insertBefore(live, root.nextSibling);
  else document.body.appendChild(live);
  // 判定弹窗跟 live 一样挂在 #app 外面，重绘不重建。关掉只藏起来，离开关卡再删。
  const staleJudge = document.getElementById('l13-judge-pop');
  if (staleJudge) staleJudge.remove();
  judgeEl = document.createElement('div');
  judgeEl.id = 'l13-judge-pop';
  judgeEl.className = 'l13-judge';
  judgeEl.hidden = true;
  judgeEl.addEventListener('click', onJudgeClick);
  document.body.appendChild(judgeEl);
  const bookId = (api && api.bookId) || data.book;
  const levelId = (api && api.levelId) || data.id;
  const params = new URLSearchParams(location.search);
  const seq = hookOn() ? (() => {
    const raw = params.get('l13seq');
    if (raw == null || raw === '') return null;
    return raw.split('|');
  })() : null;
  const stopAt = seq ? (params.get('l13stop') || '') : '';
  let autoArmed = false;
  let autoStop = false;
  let driveGen = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pauseReasons = new Set();

  let variantIndex = 0;
  let attempts = [];
  let scores = [null, null, null];
  let marks = {};
  let roundIndex = 0;
  let ideaCursor = 0;
  let phase = 'intro';
  let calm = false;
  let layout = 'float';
  let layoutSource = 'default';
  let lagRefused = false;
  let lagState = null;
  let lagKind = '';
  let lagNeedFocus = false;
  let lagArm = false;
  let testing = null;
  let teamHold = false;
  let inputLocked = false;
  let timeUpStarted = false;
  let timeUpVisible = false;
  let roundEnding = false;
  let lockShown = false;
  let judgeOpen = false;
  let judgePayload = null;
  let judgeGen = 0;
  let tapSeen = false;
  let committed = false;
  let failAuto = false;
  let learnedOpen = true;
  let resultArmed = false;
  let dialogRound = 1;
  let toastText = '';
  let toastGen = 0;
  let timerTotalMs = 0;
  let tightStage = false;
  let teamSvg = '';
  let drawing = false;
  let laneState = null;
  let goneTags = [];
  let floatSig = '';
  let finishQueued = false;

  function hiddenNow() {
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  function roomForBoss() {
    return window.innerHeight - 64 >= 460;
  }

  function toolBy(id) {
    return data.tools.find(tool => tool.id === id) || data.tools[0];
  }

  function toolIcon(id) {
    if (id === 'paper') return shared('l11-icon-paper.svg');
    if (id === 'click') return own('l13-tool-click.svg');
    return own('l13-tool-build.svg');
  }

  function currentIdeas() {
    const attempt = attempts[roundIndex];
    return attempt ? attempt.ideas : [];
  }

  function currentIdea() {
    return currentIdeas()[ideaCursor] || null;
  }

  function roundLimitSec(round) {
    const base = Number(round && round.timeLimit) || 0;
    if (base <= 0) return 0;
    let sec = base;
    const factor = Number(data.calm && data.calm.factor);
    if (calm && Number.isFinite(factor) && factor > 0) sec = base * factor;
    if (hookOn()) {
      const q = Number(params.get('l13t'));
      if (Number.isFinite(q) && q > 0 && q < sec) sec = q;
    }
    return sec;
  }

  function prefsFromEnv() {
    let calmOn = reduceMotion;
    let choice = reduceMotion ? 'cards' : 'float';
    let source = reduceMotion ? 'reducedMotion' : 'default';
    if (hookOn()) {
      const lay = params.get('l13layout');
      if (lay === 'cards' || lay === 'float') {
        choice = lay;
        source = 'manual';
      }
      const flag = params.get('l13calm');
      if (flag === '1') calmOn = true;
      if (flag === '0') calmOn = false;
    }
    return { calmOn, choice, source };
  }

  function applyPrefs(prefs) {
    calm = prefs.calmOn;
    layout = prefs.choice;
    layoutSource = prefs.source;
  }

  function rendersCards() {
    return layout === 'cards';
  }

  function lagWatching() {
    return layoutSource === 'default' && !lagRefused && layout !== 'cards';
  }

  function lagCfg() {
    const fb = data.fallback || {};
    return {
      minFps: fb.minFps,
      longFrameMs: fb.longFrameMs,
      warmupMs: fb.warmupMs,
      probeMs: fb.probeMs,
      maxLongFrames: fb.maxLongFrames,
      guardWindowMs: fb.guardWindowMs,
      guardLongFrames: fb.guardLongFrames
    };
  }

  // 只吃 onFrame 的原始间隔。气泡位置仍用 countdown.elapsed，不拿帧间隔去推位置。
  function lagSample(raw) {
    const modal = judgeOpen || !!lagKind || phase === 'resume';
    let moving = false;
    if (pauseReasons.size === 0 && !modal && phase === 'play' && layout !== 'cards') {
      if (roundIndex === 0) moving = true;
      else if (laneState) moving = laneState.bubbles.some((b) => b.status === 'moving');
    }
    return {
      rawDeltaMs: raw,
      moving,
      foreground: !hiddenNow(),
      noModal: !modal
    };
  }

  function armProbeForce() {
    if (!hookOn() || params.get('l13lag') !== '1') return;
    if (roundIndex !== 0 || !lagWatching()) return;
    const state = initLagState(lagCfg());
    state.verdict = 'lag';
    lagState = state;
  }

  function prepareLagForRound(index) {
    const prev = lagState;
    lagState = initLagState(lagCfg());
    if (index > 0 && prev && (prev.verdict === 'ok' || prev.verdict === 'lag')) lagState.verdict = prev.verdict;
    if (index === 0) armProbeForce();
  }

  function restartLagWindow() {
    if (lagKind || !lagWatching()) return;
    const prev = lagState;
    const next = initLagState(lagCfg());
    if (prev && (prev.verdict === 'ok' || prev.verdict === 'lag')) next.verdict = prev.verdict;
    lagState = next;
  }

  function bobDy() {
    if (roundIndex !== 0 || phase !== 'play' || !lagWatching()) return 0;
    const fb = data.fallback || {};
    const amp = Number(fb.bobPx);
    const sec = Number(fb.bobSeconds);
    const px = Number.isFinite(amp) ? amp : 6;
    const period = (Number.isFinite(sec) && sec > 0 ? sec : 2) * 1000;
    const elapsed = countdown ? countdown.elapsed : 0;
    return Math.sin((elapsed / period) * Math.PI * 2) * px;
  }

  function bubbleTransform(b) {
    const x = Number(b.x) || 0;
    const y = laneTop(b.lane) + bobDy();
    return `translate3d(${x}px,${y}px,0)`;
  }

  function openLagNow() {
    if (inputLocked || lockShown || roundEnding) return;
    if (lagKind || disposed || phase !== 'play' || !lagWatching()) return;
    lagKind = 'now';
    lagNeedFocus = true;
    setPause('lag', true);
    draw();
  }

  function queueLagNow() {
    if (inputLocked || lockShown || roundEnding) return;
    if (lagKind || lagArm || lagRefused || disposed) return;
    if (!lagWatching() || phase !== 'play' || roundIndex <= 0) return;
    lagArm = true;
    later(() => {
      lagArm = false;
      if (inputLocked || lockShown || roundEnding) return;
      if (disposed || lagKind || lagRefused || phase !== 'play' || !lagWatching()) return;
      openLagNow();
    }, 0);
  }

  function offerLagNext() {
    if (roundIndex !== 0 || !lagWatching()) return;
    if (!lagState || lagState.verdict !== 'lag') return;
    lagKind = 'next';
    lagNeedFocus = true;
    pauseReasons.add('lag');
  }

  function noteLagFrame(raw) {
    if (inputLocked || lockShown || roundEnding) return;
    if (disposed || phase !== 'play' || !lagWatching() || lagKind) return;
    if (!lagState) lagState = initLagState(lagCfg());
    const force = hookOn() ? (params.get('l13lag') || '') : '';
    if (roundIndex === 0) {
      if (force === '1') {
        if (lagState.verdict !== 'ok' && lagState.verdict !== 'lag') {
          const forced = initLagState(lagCfg());
          forced.verdict = 'lag';
          lagState = forced;
        }
        return;
      }
      lagState = probeStep(lagState, lagSample(raw));
      return;
    }
    if (force === 'guard' && roundIndex === 1 && countdown && countdown.elapsed >= 1000) {
      queueLagNow();
      return;
    }
    lagState = guardStep(lagState, lagSample(raw));
    if (lagState.guardVerdict === 'lag') queueLagNow();
  }

  function acceptLag() {
    const kind = lagKind;
    layout = 'cards';
    layoutSource = 'auto';
    lagKind = '';
    lagNeedFocus = false;
    lagArm = false;
    if (kind === 'now') {
      pauseReasons.delete('lag');
      startRound(roundIndex);
      return;
    }
    pauseReasons.delete('lag');
    persist(phase === 'play' ? 'play' : 'summary', roundIndex);
    draw();
  }

  function refuseLag() {
    const kind = lagKind;
    lagRefused = true;
    lagKind = '';
    lagNeedFocus = false;
    lagArm = false;
    if (kind === 'now') setPause('lag', false);
    else pauseReasons.delete('lag');
    persist(phase === 'play' ? 'play' : 'summary', roundIndex);
    draw();
  }

  function focusLagDialog() {
    if (!lagKind || !lagNeedFocus) return;
    const btn = root.querySelector('[data-testid="lag-ok"]');
    if (!btn) return;
    lagNeedFocus = false;
    try { btn.focus(); } catch { /* ignore */ }
  }

  function lagHTML() {
    if (!lagKind) return '';
    const body = lagKind === 'now' ? ui.lagSwitchNow : ui.lagSwitchNext;
    const kind = lagKind === 'now' ? 'now' : 'next';
    return `<div class="l13-lag" data-testid="lag-dialog" data-kind="${kind}" role="dialog" aria-modal="true" aria-labelledby="l13-lag-body">
      <div class="l13-panel">
        <p id="l13-lag-body" data-testid="lag-body">${esc(body)}</p>
        <div class="l13-actions">
          ${primary('lag-ok', 'lag-ok', ui.lagOk)}
          ${secondary('lag-keep', 'lag-keep', ui.lagKeep)}
        </div>
      </div>
    </div>`;
  }

  function calmFactor() {
    if (!calm) return 1;
    const factor = Number(data.calm && data.calm.factor);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  }

  function measureTrack() {
    const lanes = root.querySelector('[data-testid="lanes"]');
    if (lanes && lanes.clientWidth >= 120) return lanes.clientWidth;
    const main = root.querySelector('.l13-main');
    if (main && main.clientWidth >= 120) return main.clientWidth;
    const shell = root.querySelector('.l13');
    if (shell && shell.clientWidth > 48) return shell.clientWidth - 32;
    return Math.max(160, Math.min(448, window.innerWidth) - 32);
  }

  function resetLanes() {
    laneState = null;
    goneTags = [];
    floatSig = '';
    finishQueued = false;
    announcedKey = '';
    announcedSet.clear();
    missedSrSet.clear();
  }

  function laneConfig(width) {
    const round = data.rounds[roundIndex] || {};
    const factor = calmFactor();
    const spawn = Number(round.spawnEvery) || 0;
    const stay = Number(round.stayFor) || 0;
    const sec = roundLimitSec(round);
    let spawnEveryMs = spawn * 1000 * factor;
    if (hookOn()) {
      const n = Number(params.get('l13spawn'));
      if (Number.isFinite(n) && n > 0 && n < spawn * factor) spawnEveryMs = n * 1000;
    }
    return {
      ideas: currentIdeas(),
      laneCount: LANE_COUNT,
      bubbleW: BUBBLE_W,
      bubbleH: BUBBLE_H,
      queueGap: QUEUE_GAP,
      trackW: width,
      spawnEveryMs,
      stayForMs: stay * 1000 * factor,
      timeLimitMs: sec > 0 ? sec * 1000 : 0
    };
  }

  function ensureLaneState() {
    const width = measureTrack();
    if (!laneState) {
      laneState = initLanes(laneConfig(width));
      return;
    }
    laneState = setTrackWidth(laneState, width);
  }

  function ideaById(id) {
    return currentIdeas().find(idea => idea.id === id) || null;
  }

  function laneTop(lane) {
    return 4 + (Number(lane) || 0) * LANE_PITCH;
  }

  function exposedPx(b) {
    if (!b || b.x == null || !laneState) return 0;
    const track = laneState.cfg.trackW;
    const left = Math.max(0, b.x);
    const right = Math.min(track, b.x + laneState.cfg.bubbleW);
    return Math.max(0, right - left);
  }

  function bubbleHit(b) {
    return exposedPx(b) >= HIT_MIN;
  }

  function visibleBubbles() {
    if (!laneState) return [];
    return laneState.bubbles.filter(b => b.status === 'moving' || b.status === 'stopped' || b.status === 'queued');
  }

  function selectedFloatIdea() {
    if (!laneState) return null;
    const b = laneState.bubbles.find(item => item.selected && (item.status === 'moving' || item.status === 'stopped' || item.status === 'queued'));
    return b ? ideaById(b.id) : null;
  }

  function bubbleLabel(idea, selected) {
    const tag = idea.needsClick ? `，${data.needsClickTag}` : '';
    const sel = selected ? `，${ui.srSelected}` : '';
    return `${idea.text}${tag}${sel}`;
  }

  function announceIdea(idea) {
    if (!live || !idea) return;
    live.textContent = `${ui.srNewIdea}：${idea.text}`;
  }

  function announceMissed(idea) {
    if (!live || !idea) return;
    const key = `${roundIndex}:${idea.id}`;
    if (missedSrSet.has(key)) return;
    missedSrSet.add(key);
    live.textContent = fill(MISSED_SR, [idea.text]);
  }

  function pointOnCold(e) {
    const lanes = root.querySelector('[data-testid="lanes"]');
    if (!lanes || !laneState) return false;
    const rect = lanes.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const b of laneState.bubbles) {
      if (b.status !== 'moving' && b.status !== 'stopped' && b.status !== 'queued') continue;
      if (bubbleHit(b)) continue;
      const top = laneTop(b.lane);
      const bx = Number(b.x) || 0;
      if (x >= bx && x <= bx + BUBBLE_W && y >= top && y <= top + BUBBLE_H) return true;
    }
    return false;
  }

  function absorbMisses(prev, next) {
    for (const b of next.bubbles) {
      if (b.status !== 'missed') continue;
      const old = prev.bubbles.find(item => item.id === b.id);
      if (old && old.status === 'missed') continue;
      if (marks[b.id] && !marks[b.id].missed) continue;
      if (!marks[b.id]) marks[b.id] = { toolId: null, grade: null, delta: 0, missed: true };
      if (b.reason !== 'stay') continue;
      // 只有正选中并停住的那只因停留时间到才播；飘走和排队超时不播。
      if (old && old.selected && old.status === 'stopped') announceMissed(ideaById(b.id));
      const prevX = old && old.x != null ? old.x : 0;
      const lane = old && old.lane != null ? old.lane : (b.lane || 0);
      const track = next.cfg.trackW || 0;
      let showX = prevX < 8 ? 8 : prevX;
      if (track > 80) showX = Math.min(showX, Math.max(8, track - 56));
      goneTags.push({ id: b.id, lane, x: showX, until: next.elapsedMs + GONE_MS });
    }
  }

  function expireTags(elapsed) {
    if (!goneTags.length) return;
    goneTags = goneTags.filter(tag => tag.until > elapsed);
  }

  function floatAllSettled() {
    const ideas = currentIdeas();
    if (!ideas.length || !laneState) return false;
    return ideas.every(idea => {
      const rec = marks[idea.id];
      if (rec) return true;
      const b = laneState.bubbles.find(item => item.id === idea.id);
      if (!b) return false;
      if (b.status === 'testing') return false;
      return b.status === 'missed' || b.status === 'done';
    });
  }

  function maybeFinishFloat() {
    if (finishQueued || rendersCards() || phase !== 'play' || roundEnding || judgeOpen || lagKind || lagArm || testing || inputLocked) return;
    if (goneTags.length || !floatAllSettled()) return;
    const limit = roundLimitSec(data.rounds[roundIndex]);
    if (limit > 0 && countdown && countdown.remaining <= 0) return;
    finishQueued = true;
    later(() => {
      finishQueued = false;
      if (disposed || phase !== 'play' || roundEnding || judgeOpen || lagKind || lagArm || testing || inputLocked) return;
      if (goneTags.length || !floatAllSettled()) return;
      const still = roundLimitSec(data.rounds[roundIndex]);
      if (still > 0 && countdown && countdown.remaining <= 0) return;
      finishRound();
    }, 0);
  }

  function bubbleNodeHTML(b) {
    const idea = ideaById(b.id);
    if (!idea) return '';
    const x = Number(b.x) || 0;
    const selected = !!b.selected;
    const cold = bubbleHit(b) ? '' : ' is-cold';
    const gesture = idea.needsClick
      ? `<span class="l13-gesture"><img src="${esc(own('l13-tag-gesture.svg'))}" alt="" draggable="false"><span>${esc(data.needsClickTag)}</span></span>`
      : '';
    const badge = selected
      ? `<span class="l13-badge" aria-hidden="true"><img src="${esc(shared('l11-icon-check.svg'))}" alt="" draggable="false"></span>`
      : '';
    return `<button type="button" class="l13-bubble${selected ? ' is-selected' : ''}${cold}" data-act="bubble" data-testid="bubble" data-id="${esc(idea.id)}" data-lane="${b.lane == null ? '' : b.lane}" data-status="${esc(b.status)}" data-x="${Math.round(x)}" aria-label="${esc(bubbleLabel(idea, selected))}" style="transform:${bubbleTransform(b)}">
      ${imgShared('l11-icon-bulb.svg', 'l13-bulb')}
      <span class="l13-idea">${esc(idea.text)}</span>
      ${gesture}
      ${badge}
    </button>`;
  }

  function goneNodeHTML(tag) {
    const y = laneTop(tag.lane) + Math.round((BUBBLE_H - 28) / 2);
    return `<span class="l13-gone" data-testid="gone-tag" data-lane="${tag.lane}" data-x="${Math.round(tag.x)}" style="transform:translate3d(${tag.x}px,${y}px,0)">${esc(ui.goneTag)}</span>`;
  }

  function floatSignature() {
    const parts = visibleBubbles().map(b => `${b.id}:${b.lane}:${b.status}:${b.selected ? 1 : 0}`);
    const tags = goneTags.map(tag => `${tag.id}:${tag.lane}:${Math.round(tag.x)}`);
    return `${parts.join('|')}#${tags.join(',')}`;
  }

  function paintMoves() {
    const nodes = root.querySelectorAll('[data-testid="bubble"]');
    for (const node of nodes) {
      const b = laneState.bubbles.find(item => item.id === node.getAttribute('data-id'));
      if (!b) continue;
      const x = Number(b.x) || 0;
      node.style.transform = bubbleTransform(b);
      const rounded = String(Math.round(x));
      if (node.getAttribute('data-x') !== rounded) node.setAttribute('data-x', rounded);
      node.classList.toggle('is-cold', !bubbleHit(b));
    }
  }

  function syncFloatDom(force) {
    const lanes = root.querySelector('[data-testid="lanes"]');
    if (!lanes || !laneState) return;
    const sig = floatSignature();
    const domCount = lanes.querySelectorAll('[data-testid="bubble"]').length;
    const domGone = lanes.querySelectorAll('[data-testid="gone-tag"]').length;
    if (force || sig !== floatSig || domCount !== visibleBubbles().length || domGone !== goneTags.length) {
      floatSig = sig;
      lanes.innerHTML = visibleBubbles().map(bubbleNodeHTML).join('') + goneTags.map(goneNodeHTML).join('');
      syncPromptAndTools();
    } else {
      paintMoves();
    }
  }

  function promptText() {
    if (judgeOpen) return '';
    if (testing) return ui.testing;
    if (selectedFloatIdea()) return '';
    return ui.pickFirst;
  }

  function syncPromptAndTools() {
    if (rendersCards()) return;
    const prompt = root.querySelector('[data-testid="prompt"]');
    const text = promptText();
    if (prompt && prompt.textContent !== text) prompt.textContent = text;
    const hard = inputLocked;
    const picked = !!selectedFloatIdea();
    const mute = hard || !!testing || (!picked && !judgeOpen);
    root.querySelectorAll('[data-act="tool"]').forEach(btn => {
      btn.classList.toggle('is-muted', mute);
      btn.setAttribute('aria-disabled', mute ? 'true' : 'false');
      const tool = toolBy(btn.getAttribute('data-tool'));
      const label = btn.querySelector('.l13-tool-label');
      const labelText = testing ? ui.testing : tool.label;
      const aria = testing ? ui.testing : fill(ui.srTool, [tool.name, tool.seconds]);
      if (label && label.textContent !== labelText) label.textContent = labelText;
      if (btn.getAttribute('aria-label') !== aria) btn.setAttribute('aria-label', aria);
    });
  }

  function announceFloatSpawns() {
    if (!live || !laneState || judgeOpen || lagKind || phase !== 'play') return;
    const fresh = [];
    for (const b of visibleBubbles()) {
      const key = `${roundIndex}:${b.id}`;
      if (announcedSet.has(key)) continue;
      announcedSet.add(key);
      const idea = ideaById(b.id);
      if (idea) fresh.push(idea);
    }
    if (!fresh.length) return;
    announceIdea(fresh[0]);
    for (let i = 1; i < fresh.length; i++) {
      const idea = fresh[i];
      later(() => {
        if (!disposed && phase === 'play' && !lagKind && !judgeOpen) announceIdea(idea);
      }, i * 400);
    }
  }

  function stepFloat(elapsed) {
    if (disposed || rendersCards() || phase !== 'play' || !laneState) return;
    const prev = laneState;
    const next = lanesStep(prev, elapsed);
    absorbMisses(prev, next);
    laneState = next;
    expireTags(next.elapsedMs);
    syncFloatDom(false);
    announceFloatSpawns();
    maybeFinishFloat();
  }

  function floatShellHTML() {
    return `<div class="l13-stage l13-stage-float" data-testid="stage" data-act="stage">
      <p class="l13-prompt" data-testid="prompt">${esc(promptText())}</p>
      <div class="l13-lanes" data-testid="lanes" data-act="lanes"></div>
    </div>`;
  }

  function totalScore() {
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      if (typeof scores[i] === 'number') sum += scores[i];
    }
    return sum;
  }

  function maxScore() {
    const n = Number(data.scoring && data.scoring.max);
    return Number.isFinite(n) ? n : 20;
  }

  function starsNow(total) {
    return starsFor(total, data.stars && data.stars.thresholds);
  }

  function passed(total) {
    return didPass(total, data.scoring && data.scoring.passAt);
  }

  function roundDeltas(index) {
    const attempt = attempts[index];
    if (!attempt) return [];
    return attempt.ideas.map(idea => {
      const rec = marks[idea.id];
      if (!rec || rec.missed) return 0;
      return Number(rec.delta) || 0;
    });
  }

  function buildAttempts(index, doShuffle) {
    const rng = makeRng(api);
    return data.rounds.map(round => {
      const variants = round.variants || [];
      const variant = variants[index % variants.length];
      const ideas = variant.ideas.slice();
      if (doShuffle) shuffle(ideas, rng);
      return { variant, ideas };
    });
  }

  function restoreAttempts(run) {
    attempts = data.rounds.map((round, i) => {
      const variants = round.variants || [];
      const vid = run.variantIds && run.variantIds[i];
      const variant = variants.find(item => item.id === vid) || variants[(Number(run.variantIndex) || 0) % variants.length];
      const map = new Map(variant.ideas.map(idea => [idea.id, idea]));
      const order = (run.orders && run.orders[i]) || variant.ideas.map(idea => idea.id);
      const ideas = order.map(id => map.get(id)).filter(Boolean);
      return { variant, ideas: ideas.length === variant.ideas.length ? ideas : variant.ideas.slice() };
    });
  }

  function persist(mode, restart) {
    if (disposed || hookOn()) return;
    const dialog = restart + 1;
    try { saveResume(bookId, levelId, dialog); } catch { /* ignore */ }
    try {
      writeLevelRun(bookId, levelId, {
        variantIndex,
        variantIds: attempts.map(item => item.variant.id),
        orders: attempts.map(item => item.ideas.map(idea => idea.id)),
        scores: scores.slice(),
        marks,
        mode,
        restart,
        calm,
        layout,
        layoutSource,
        lagRefused,
        ts: Date.now()
      });
    } catch { /* ignore */ }
  }

  function stopCountdown() {
    if (countdown) {
      if (typeof countdown.dispose === 'function') countdown.dispose();
      else countdown.stop();
    }
    countdown = null;
    timerTotalMs = 0;
  }

  function teamShouldBeStill() {
    if (reduceMotion || pauseReasons.size || judgeOpen || lagKind) return true;
    if (window.innerWidth < 360 || tightStage) return true;
    return false;
  }

  function syncTimer() {
    const el = root.querySelector('[data-testid="timer-bar"]');
    if (!el) return;
    const paused = phase === 'play' && pauseReasons.size > 0;
    el.setAttribute('data-paused', paused ? 'true' : 'false');
    const pause = el.querySelector('[data-testid="timer-paused"]');
    if (pause) {
      pause.hidden = !paused;
      pause.textContent = ui.paused;
    }
    if (!countdown || el.hasAttribute('data-untimed')) return;
    const leftMs = countdown.remaining;
    const sec = Math.max(0, Math.ceil(leftMs / 1000));
    el.setAttribute('data-remaining', String(sec));
    const num = el.querySelector('[data-testid="timer-seconds"]');
    if (num) num.textContent = String(sec);
    const bar = el.querySelector('i');
    if (bar && timerTotalMs) bar.style.width = `${Math.max(0, Math.min(100, leftMs / timerTotalMs * 100))}%`;
  }

  function syncBench() {
    const bar = root.querySelector('[data-testid="bench-bar"]');
    const left = root.querySelector('[data-testid="bench-left"]');
    if (!testing || !countdown || !bar) return;
    const total = testing.seconds * 1000;
    const used = Math.max(0, countdown.elapsed - testing.startElapsed);
    const pct = total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 100;
    bar.style.width = `${pct}%`;
    const remain = Math.max(0, Math.ceil((total - used) / 1000));
    const tool = toolBy(testing.toolId);
    if (left) left.textContent = fill(ui.benchLeft, [tool.label, remain]);
  }

  function syncTeam() {
    const team = root.querySelector('[data-testid="team"]');
    const bench = root.querySelector('[data-testid="bench"]');
    if (!team) {
      if (bench) bench.classList.remove('has-banner');
      return;
    }
    const inline = window.innerWidth < 360 || tightStage;
    team.classList.toggle('is-inline', inline);
    team.classList.toggle('is-banner', !inline);
    team.classList.toggle('is-still', teamShouldBeStill() || inline);
    if (bench) bench.classList.toggle('has-banner', !inline);
  }

  function syncChrome() {
    syncTimer();
    syncBench();
    syncTeam();
  }

  function setPause(reason, on) {
    if (on) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    if (countdown && !countdown.ended) {
      // 已锁轮时清掉暂停原因也不能把表重新跑起来。未锁时仍按原因集合决定。
      if (lockShown || pauseReasons.size) countdown.pause();
      else countdown.start();
    }
    syncChrome();
  }

  function startCountdown(ms, canEnd) {
    stopCountdown();
    timerTotalMs = ms;
    countdown = createCountdown({
      durationMs: ms,
      pauseOnHidden: true,
      onHiddenChange(hidden) {
        if (disposed) return;
        if (hidden) pauseReasons.add('hidden');
        else {
          pauseReasons.delete('hidden');
          restartLagWindow();
        }
        syncChrome();
      },
      onFrame(raw) {
        if (!disposed) noteLagFrame(raw);
      },
      onTick() {
        if (disposed || !countdown) return;
        if (!rendersCards() && phase === 'play') stepFloat(countdown.elapsed);
        syncChrome();
        if (!testing || judgeOpen || lagKind || lagArm || inputLocked || roundEnding) return;
        const used = countdown.elapsed - testing.startElapsed;
        if (used >= testing.seconds * 1000) finishTest();
      },
      onEnd() {
        if (!disposed && canEnd) onRoundEnd();
      }
    });
    if (hiddenNow()) pauseReasons.add('hidden');
    countdown.start();
    if (pauseReasons.size && !countdown.ended) countdown.pause();
    syncChrome();
  }

  function toast(text) {
    toastText = text;
    const gen = ++toastGen;
    draw();
    later(() => {
      if (toastGen !== gen) return;
      toastText = '';
      const el = root.querySelector('[data-testid="level-toast"]');
      if (el) el.remove();
    }, Number(ui.noteShowMs) || 3000);
  }

  function finishTest() {
    if (disposed || !testing || judgeOpen || lagKind || inputLocked || phase !== 'play') return;
    const idea = rendersCards() ? currentIdea() : ideaById(testing.ideaId);
    const toolId = testing.toolId;
    testing = null;
    if (!idea || marks[idea.id]) {
      if (!rendersCards() && idea && laneState) laneState = markBubbleDone(laneState, idea.id);
      return;
    }
    if (!rendersCards() && laneState) laneState = markBubbleDone(laneState, idea.id);
    const grade = gradeOf(idea, toolId);
    const delta = deltaOf(grade, data.scoring);
    marks[idea.id] = { toolId, grade, delta, missed: false };
    judgePayload = { idea, grade, delta, toolId };
    judgeOpen = true;
    judgeGen += 1;
    const gen = judgeGen;
    if (toolId === 'build') teamHold = true;
    // 先停再画。freeze 会同步重入 onTick 并补走；testing 已空、judgeOpen 已开，重入不会再次判定。
    setPause('judge', true);
    draw();
    armJudgeTimer(gen);
  }

  function closeJudge(opts) {
    if (!judgeOpen) return;
    const fromPop = !!(opts && opts.fromPop);
    judgeCloseFromPop = fromPop;
    judgeOpen = false;
    judgePayload = null;
    judgeGen += 1;
    teamHold = false;
    // 先卸对话框再恢复计时、重画。重画会播下一张，不能叠在还开着的对话框上。
    dismissJudgeDom({ fromPop });
    judgeCloseFromPop = false;
    if (disposed || phase !== 'play') return;
    setPause('judge', false);
    if (!rendersCards()) {
      if (roundEnding || (countdown && countdown.ended)) lockRound();
      else if (floatAllSettled() && !goneTags.length) finishRound();
      else draw();
    } else {
      ideaCursor += 1;
      if (ideaCursor >= currentIdeas().length) finishRound();
      else if (roundEnding || (countdown && countdown.ended)) lockRound();
      else draw();
    }
    focusReturnTool();
  }

  function markUnresolvedMissed() {
    const ideas = currentIdeas();
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      if (marks[idea.id] && !marks[idea.id].missed) continue;
      if (i < ideaCursor && marks[idea.id]) continue;
      marks[idea.id] = { toolId: null, grade: null, delta: 0, missed: true };
    }
  }

  function onRoundEnd() {
    if (disposed || phase !== 'play' || roundEnding) return;
    roundEnding = true;
    if (judgeOpen) return;
    lockRound();
  }

  function lockRound() {
    if (disposed || lockShown || phase === 'summary' || phase === 'result') return;
    lockShown = true;
    timeUpStarted = true;
    inputLocked = true;
    testing = null;
    teamHold = false;
    timeUpVisible = false;
    phase = 'play';
    // 脚本 't' 会在倒计时未结束时进来。先停表，且不写入 pauseReasons，条上不出现「暂停」。
    // 正常路径是 countdown 已 ended（onEnd / roundEnding）才进这里，不会 pause。
    if (countdown && !countdown.ended) countdown.pause();
    draw();
    later(() => {
      if (disposed || phase === 'summary' || phase === 'result') return;
      markUnresolvedMissed();
      phase = 'timeup';
      timeUpVisible = true;
      draw();
      later(() => {
        if (disposed || phase !== 'timeup') return;
        finishRound();
      }, 200);
    }, 80);
  }

  function finishRound() {
    if (disposed || phase === 'summary' || phase === 'result' || lagKind === 'now') return;
    const deltas = roundDeltas(roundIndex);
    scores[roundIndex] = roundScore(deltas, data.scoring);
    phase = 'summary';
    inputLocked = false;
    timeUpVisible = false;
    judgeOpen = false;
    judgePayload = null;
    testing = null;
    teamHold = false;
    stopCountdown();
    pauseReasons.delete('judge');
    offerLagNext();
    persist('summary', roundIndex);
    draw();
  }

  function startRound(index) {
    if (disposed) return;
    roundIndex = index;
    ideaCursor = 0;
    for (const idea of currentIdeas()) delete marks[idea.id];
    scores[index] = null;
    testing = null;
    teamHold = false;
    judgeOpen = false;
    judgePayload = null;
    inputLocked = false;
    timeUpStarted = false;
    timeUpVisible = false;
    roundEnding = false;
    lockShown = false;
    lagKind = '';
    lagNeedFocus = false;
    lagArm = false;
    phase = 'play';
    prepareLagForRound(index);
    resetLanes();
    stopCountdown();
    pauseReasons.clear();
    if (hiddenNow()) pauseReasons.add('hidden');
    autoArmed = true;
    persist('play', index);
    draw();
    const sec = roundLimitSec(data.rounds[index]);
    startCountdown(sec > 0 ? sec * 1000 : R1_CLOCK_MS, sec > 0);
  }

  function goNext() {
    if (disposed || lagKind) return;
    if (phase === 'summary') {
      if (roundIndex <= 0) {
        phase = 'hint';
        stopCountdown();
        persist('hint', 1);
        draw();
        return;
      }
      if (roundIndex >= data.rounds.length - 1) {
        showResult();
        return;
      }
      startRound(roundIndex + 1);
      return;
    }
    if (phase === 'hint') startRound(1);
  }

  function showResult() {
    if (disposed) return;
    const total = totalScore();
    const stars = starsNow(total);
    const pass = passed(total);
    phase = 'result';
    stopCountdown();
    pauseReasons.clear();
    judgeOpen = false;
    testing = null;
    teamHold = false;
    if (!committed) {
      committed = true;
      if (hookOn()) {
        failAuto = false;
      } else {
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

  function fresh(index, doShuffle, keep) {
    const kept = keep ? { calm, layout, source: layoutSource, refused: lagRefused } : null;
    variantIndex = index;
    attempts = buildAttempts(index, doShuffle);
    scores = data.rounds.map(() => null);
    marks = {};
    roundIndex = 0;
    ideaCursor = 0;
    testing = null;
    teamHold = false;
    inputLocked = false;
    timeUpStarted = false;
    timeUpVisible = false;
    judgeOpen = false;
    judgePayload = null;
    tapSeen = false;
    committed = false;
    failAuto = false;
    learnedOpen = true;
    toastText = '';
    lagRefused = false;
    lagState = null;
    lagKind = '';
    lagNeedFocus = false;
    lagArm = false;
    resetLanes();
    applyPrefs(prefsFromEnv());
    if (kept) {
      calm = !!kept.calm;
      layout = kept.layout === 'cards' ? 'cards' : 'float';
      layoutSource = kept.source || 'default';
      lagRefused = !!kept.refused;
    }
    phase = 'intro';
    stopCountdown();
    pauseReasons.clear();
    if (!hookOn()) {
      try { clearResume(bookId, levelId); } catch { /* ignore */ }
      try { clearLevelRun(bookId, levelId); } catch { /* ignore */ }
    }
    draw();
  }

  function replay() {
    const count = (data.rounds[0].variants || []).length || 1;
    const next = (variantIndex + 1) % count;
    const doShuffle = !!(data.replay && data.replay.shuffleIdeas);
    fresh(next, doShuffle, true);
  }

  function continueRun() {
    let run = null;
    try { run = readLevelRun(bookId, levelId); } catch { run = null; }
    if (!run) { fresh(0, false); return; }
    restoreAttempts(run);
    variantIndex = Number(run.variantIndex) || 0;
    scores = Array.isArray(run.scores) ? run.scores.slice() : data.rounds.map(() => null);
    while (scores.length < data.rounds.length) scores.push(null);
    marks = run.marks && typeof run.marks === 'object' ? { ...run.marks } : {};
    calm = !!run.calm;
    layout = run.layout === 'cards' ? 'cards' : 'float';
    layoutSource = run.layoutSource || 'default';
    lagRefused = !!run.lagRefused;
    pauseReasons.delete('resume');
    const restart = Number(run.restart) || 0;
    if (run.mode === 'hint') {
      startRound(1);
      return;
    }
    if (run.mode === 'summary') {
      const next = restart + 1;
      if (next >= data.rounds.length) showResult();
      else startRound(next);
      return;
    }
    startRound(restart);
  }

  function shouldTool(idea) {
    return idea && idea.needsClick ? toolBy('click') : toolBy('paper');
  }

  function feedbackOf(grade, toolId) {
    if (grade === 'right') {
      const tool = toolBy(toolId);
      return tool && tool.right ? tool.right : '';
    }
    if (grade === 'costly') return data.judge.costly;
    if (grade === 'unclear') return data.judge.unclear;
    if (grade === 'build') return data.judge.build;
    return '';
  }

  function statsCounts() {
    let tested = 0;
    let wanted = 0;
    let builds = 0;
    for (const attempt of attempts) {
      for (const idea of attempt.ideas) {
        const rec = marks[idea.id];
        if (!rec || rec.missed) continue;
        tested += 1;
        if (rec.grade !== 'unclear' && idea.real) wanted += 1;
        if (rec.toolId === 'build') builds += 1;
      }
    }
    return [tested, wanted, builds];
  }

  function primary(act, testid, label) {
    return `<button type="button" class="l13-primary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }
  function secondary(act, testid, label) {
    return `<button type="button" class="l13-secondary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }

  function timerHTML() {
    const round = data.rounds[roundIndex];
    const sec = roundLimitSec(round);
    const paused = phase === 'play' && pauseReasons.size > 0;
    if (!(sec > 0)) {
      return `<div class="l13-timer" data-testid="timer-bar" data-untimed="true" data-paused="${paused ? 'true' : 'false'}" role="timer">
        <span class="l13-untimed" data-testid="timer-untimed">${esc(ui.untimed)}</span>
        <span class="l13-timer-pause" data-testid="timer-paused"${paused ? '' : ' hidden'}>${esc(ui.paused)}</span>
      </div>`;
    }
    const leftMs = countdown ? countdown.remaining : sec * 1000;
    const show = Math.max(0, Math.ceil(leftMs / 1000));
    return timerBarHTML({
      remainingSec: show,
      paused,
      pausedLabel: esc(ui.paused),
      totalSec: sec,
      className: 'l13-timer'
    });
  }

  function cardLabel(idea) {
    const tag = idea.needsClick ? `，${data.needsClickTag}` : '';
    return `${idea.text}${tag}，${ui.srSelected}`;
  }

  function cardHTML() {
    const ideas = currentIdeas();
    const idea = ideas[ideaCursor];
    if (!idea) return '';
    const gesture = idea.needsClick
      ? `<span class="l13-gesture"><img src="${esc(own('l13-tag-gesture.svg'))}" alt="" draggable="false"><span>${esc(data.needsClickTag)}</span></span>`
      : '';
    return `<div class="l13-stage" data-testid="stage">
      <p class="l13-count" data-testid="card-count">${esc(fill(ui.cardCount, [ideaCursor + 1, ideas.length]))}</p>
      <button type="button" class="l13-card" data-act="card" data-testid="card" data-id="${esc(idea.id)}" aria-current="true" aria-label="${esc(cardLabel(idea))}">
        ${imgShared('l11-icon-bulb.svg', 'l13-bulb')}
        <span class="l13-idea">${esc(idea.text)}</span>
        ${gesture}
        <span class="visually-hidden">${esc(ui.srSelected)}</span>
      </button>
    </div>`;
  }

  function announceNewCard() {
    if (!live) return;
    if (judgeOpen || lagKind || phase === 'resume') return;
    if (!rendersCards()) return;
    if (phase !== 'play') {
      announcedKey = '';
      return;
    }
    const idea = currentIdea();
    if (!idea) return;
    const key = `${roundIndex}:${idea.id}`;
    if (key === announcedKey) return;
    announcedKey = key;
    announceIdea(idea);
  }

  function toolsHTML() {
    const floatHold = !rendersCards() && !testing && !selectedFloatIdea() && !judgeOpen;
    const muted = !!testing || floatHold;
    const hard = inputLocked;
    const buttons = data.tools.map(tool => {
      const label = muted ? ui.testing : tool.label;
      const aria = muted ? ui.testing : fill(ui.srTool, [tool.name, tool.seconds]);
      return `<button type="button" class="l13-tool${muted || hard ? ' is-muted' : ''}" style="--tool:${TOOL_COLOR[tool.id] || '#4C5FD5'}" data-act="tool" data-tool="${esc(tool.id)}" data-testid="tool-${esc(tool.id)}" aria-label="${esc(aria)}" aria-disabled="${muted || hard ? 'true' : 'false'}">
        <span class="l13-tool-top"><img src="${esc(toolIcon(tool.id))}" alt="" draggable="false"><span class="l13-tool-sec">${esc(fill(ui.toolSeconds, [tool.seconds]))}</span></span>
        <span class="l13-tool-label">${esc(label)}</span>
      </button>`;
    }).join('');
    return `<div class="l13-tools" data-testid="tools">${buttons}</div>`;
  }

  function benchHTML() {
    const showTeam = (testing && testing.toolId === 'build') || (teamHold && judgeOpen);
    if (!testing && !showTeam) return '';
    const tool = testing ? toolBy(testing.toolId) : toolBy('build');
    const total = testing ? testing.seconds * 1000 : 1;
    const used = testing && countdown ? Math.max(0, countdown.elapsed - testing.startElapsed) : total;
    const pct = testing ? Math.max(0, Math.min(100, used / total * 100)) : 100;
    const remain = testing ? Math.max(0, Math.ceil((total - used) / 1000)) : 0;
    const inline = window.innerWidth < 360 || tightStage;
    const still = teamShouldBeStill() || inline;
    const team = showTeam
      ? `<div class="l13-team ${inline ? 'is-inline' : 'is-banner'}${still ? ' is-still' : ''}" data-testid="team">${teamSvg}</div>`
      : '';
    const color = TOOL_COLOR[tool.id] || '#4C5FD5';
    return `<div class="l13-bench" data-testid="bench">
      ${team}
      <div class="l13-bench-main">
        <div class="l13-bench-name">${esc(testing ? tool.label : ui.testing)}</div>
        <div class="l13-bench-track" aria-hidden="true"><i data-testid="bench-bar" style="width:${pct}%;background:${color}"></i></div>
        <div class="l13-bench-left" data-testid="bench-left">${esc(testing ? fill(ui.benchLeft, [tool.label, remain]) : ui.testing)}</div>
      </div>
    </div>`;
  }

  function hintHTML() {
    if (tapSeen || roundIndex !== 0 || phase !== 'play') return '';
    return `<button type="button" class="l13-hint" data-act="hint" data-testid="hint-tap">${imgShared('l11-icon-tap.svg')}<span>${esc(data.tapHint)}</span></button>`;
  }

  function judgeDeltaSr(delta) {
    const n = Math.abs(Number(delta) || 0);
    if (Number(delta) < 0) return fill(JUDGE_MINUS_SR, [n]);
    if (Number(delta) > 0) return fill(JUDGE_PLUS_SR, [n]);
    return JUDGE_ZERO_SR;
  }

  function judgeMarkHTML(grade) {
    if (grade === 'right') {
      return `<span class="l13-mark is-right" data-testid="judge-mark" aria-hidden="true"><img src="${esc(shared('l11-icon-check.svg'))}" alt="" aria-hidden="true" draggable="false"></span>`;
    }
    if (grade === 'costly') {
      return `<span class="l13-mark is-costly" data-testid="judge-mark" aria-hidden="true"><i class="l13-minus" aria-hidden="true"></i></span>`;
    }
    if (grade === 'unclear') {
      return `<span class="l13-mark is-unclear" data-testid="judge-mark" aria-hidden="true"><img src="${esc(shared('l11-icon-question.svg'))}" alt="" aria-hidden="true" draggable="false"></span>`;
    }
    return `<span class="l13-mark is-build" data-testid="judge-mark" aria-hidden="true"><i class="l13-x" aria-hidden="true"></i></span>`;
  }

  function judgeBodyHTML() {
    const { idea, grade, delta, toolId } = judgePayload;
    const verdict = grade === 'unclear' ? '' : `<p class="l13-judge-row" data-testid="judge-verdict"><img class="l13-thumb" src="${esc(own(idea.real ? 'l13-thumb-up.svg' : 'l13-thumb-down.svg'))}" alt="" aria-hidden="true" draggable="false"><span>${esc(idea.real ? data.verdict.yes : data.verdict.no)}</span></p>`;
    const cont = rendersCards()
      ? `<button type="button" class="l13-judge-continue" data-testid="judge-continue">${esc((data.buttons && data.buttons.continue) || '')}</button>`
      : '';
    return `<div class="l13-judge-card is-${esc(grade)}" data-grade="${esc(grade)}">
      <i class="l13-judge-bar" aria-hidden="true"></i>
      <div class="l13-judge-body">
        <p class="l13-judge-row" data-testid="judge-grade">${judgeMarkHTML(grade)}<span id="l13-judge-l1">${esc(data.grade[grade] || '')}</span></p>
        <div class="l13-judge-l2" id="l13-judge-l2">
          ${verdict}
          <p class="l13-judge-row" data-testid="judge-feedback">${esc(feedbackOf(grade, toolId))}</p>
        </div>
        <p class="l13-judge-row l13-delta" id="l13-judge-l3">
          <span data-testid="judge-delta" aria-hidden="true">${esc(formatDelta(delta, ui.zeroDelta))}</span>
          <span class="visually-hidden" data-testid="judge-delta-sr">${esc(judgeDeltaSr(delta))}</span>
        </p>
        ${cont}
      </div>
    </div>`;
  }

  function clearInert() {
    for (const el of inerted) {
      try { el.removeAttribute('inert'); } catch { /* ignore */ }
    }
    inerted = [];
  }

  function applyInert() {
    clearInert();
    if (!judgeEl) return;
    for (const child of document.body.children) {
      if (child === judgeEl || child.id === 'l13-sr-live') continue;
      if (child.tagName === 'SCRIPT') continue;
      if (child.contains(judgeEl)) continue;
      if (child.hasAttribute('inert')) continue;
      child.setAttribute('inert', '');
      inerted.push(child);
    }
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); }
    catch {
      try { el.focus(); } catch { /* ignore */ }
    }
  }

  function focusReturnTool() {
    const id = judgeReturnTool;
    if (!id) return;
    focusEl(root.querySelector(`[data-testid="tool-${id}"]`));
  }

  function judgeStateOnTop() {
    try { return !!(history.state && history.state.l13Judge); }
    catch { return false; }
  }

  // 只做 Esc 和 popstate。打开时 pushState 一条；返回键的 popstate 只关弹窗。
  // 点掉、Esc、到时关掉时把这条历史退掉。hashchange 仍交给 main.js。
  function armJudgeHistory() {
    const push = () => {
      if (disposed || !judgeOpen || judgeHist === 1) return;
      try {
        history.pushState({ l13Judge: 1 }, '', location.href);
        judgeHist = 1;
      } catch { /* 没有历史接口时只剩 Esc */ }
    };
    if (judgeHist === 2) {
      histChain = histChain.then(push);
      return;
    }
    push();
  }

  function releaseJudgeHistory(fromPop) {
    if (fromPop) {
      judgeHist = 0;
      return;
    }
    if (judgeHist !== 1) return;
    // 当前条已经不是弹窗压上去的，别 back，否则会把关卡退掉。
    if (!judgeStateOnTop()) {
      judgeHist = 0;
      return;
    }
    judgeHist = 2;
    histChain = new Promise((resolve) => {
      const onPop = () => {
        window.removeEventListener('popstate', onPop);
        if (dropPopListener === onPop) dropPopListener = null;
        if (judgeHist === 2) judgeHist = 0;
        resolve();
      };
      dropPopListener = onPop;
      window.addEventListener('popstate', onPop);
      try { history.back(); }
      catch {
        window.removeEventListener('popstate', onPop);
        dropPopListener = null;
        if (judgeHist === 2) judgeHist = 0;
        resolve();
      }
    });
  }

  function dismissJudgeDom(opts) {
    const fromPop = !!(opts && opts.fromPop);
    clearInert();
    if (judgeEl) {
      judgeEl.hidden = true;
      judgeEl.removeAttribute('data-testid');
      judgeEl.removeAttribute('data-act');
      judgeEl.removeAttribute('role');
      judgeEl.removeAttribute('aria-modal');
      judgeEl.removeAttribute('aria-labelledby');
      judgeEl.removeAttribute('aria-describedby');
      judgeEl.removeAttribute('tabindex');
      judgeEl.innerHTML = '';
    }
    releaseJudgeHistory(fromPop);
  }

  function openJudgeDom() {
    if (!judgeEl || !judgePayload) return;
    judgeEl.hidden = false;
    judgeEl.setAttribute('data-testid', 'judge-pop');
    judgeEl.setAttribute('data-act', 'close-judge');
    judgeEl.setAttribute('role', 'dialog');
    judgeEl.setAttribute('aria-modal', 'true');
    judgeEl.setAttribute('tabindex', '-1');
    judgeEl.setAttribute('aria-labelledby', 'l13-judge-l1');
    judgeEl.setAttribute('aria-describedby', 'l13-judge-l2 l13-judge-l3');
    judgeEl.innerHTML = judgeBodyHTML();
    applyInert();
    focusEl(judgeEl.querySelector('[data-testid="judge-continue"]') || judgeEl);
    armJudgeHistory();
  }

  function syncJudge() {
    if (disposed || !judgeEl) return;
    if (judgeOpen && judgePayload) {
      if (judgeEl.hidden || judgeEl.getAttribute('data-testid') !== 'judge-pop') openJudgeDom();
      return;
    }
    if (!judgeEl.hidden || judgeEl.getAttribute('role') === 'dialog' || judgeHist === 1) {
      const fromPop = judgeCloseFromPop;
      judgeCloseFromPop = false;
      dismissJudgeDom({ fromPop });
    }
  }

  function armJudgeTimer(gen) {
    if (rendersCards()) return;
    const ms = Math.max(0, Number(data.judge && data.judge.showSeconds) || 0) * 1000;
    later(() => {
      if (disposed || judgeGen !== gen || !judgeOpen) return;
      closeJudge();
    }, ms);
  }

  function onJudgeClick(e) {
    if (disposed || !judgeOpen) return;
    e.preventDefault();
    e.stopPropagation();
    closeJudge();
  }

  function onJudgeKey(e) {
    if (disposed || !judgeOpen) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    e.preventDefault();
    e.stopPropagation();
    closeJudge();
  }

  function onJudgePop() {
    if (disposed) return;
    if (judgeHist === 2) return;
    if (judgeHist !== 1) return;
    judgeHist = 0;
    if (judgeOpen) closeJudge({ fromPop: true });
  }

  function summaryHTML() {
    const ideas = currentIdeas();
    const deltas = roundDeltas(roundIndex);
    const raw = deltas.reduce((sum, n) => sum + n, 0);
    const shown = roundScore(deltas, data.scoring);
    let judged = 0;
    const rows = ideas.map(idea => {
      const rec = marks[idea.id];
      const missed = !rec || rec.missed;
      if (!missed) judged += 1;
      const grade = missed ? data.missedLabel : (data.grade[rec.grade] || '');
      const delta = missed ? '0' : formatDelta(rec.delta, ui.zeroDelta);
      const use = shouldTool(idea);
      return `<li class="l13-idea-row" data-testid="summary-${esc(idea.id)}">
        <p>${esc(idea.text)}</p>
        <div class="l13-idea-meta">
          <span data-testid="summary-grade">${esc(grade)}</span>
          <span data-testid="summary-delta">${esc(delta)}</span>
          <span data-testid="summary-should">${esc(fill(ui.shouldUse, [use.label]))}</span>
        </div>
      </li>`;
    }).join('');
    const floor = raw < 0 ? `<p class="l13-floor" data-testid="round-floor">${esc(ui.roundFloor)}</p>` : '';
    return `<div class="l13-summary">
      <h2 data-testid="round-done">${esc(fill(data.roundDone, [judged, ideas.length]))}</h2>
      <p class="l13-round-score" data-testid="round-score">${esc(fill(ui.roundScore, [shown]))}</p>
      ${floor}
      <ul>${rows}</ul>
    </div>`;
  }

  function learnedHTML() {
    const open = learnedOpen;
    return `<section class="l13-learned" data-testid="learned-bar">
      <button type="button" class="l13-learned-btn" data-act="learned" data-testid="learned-toggle" aria-expanded="${open ? 'true' : 'false'}" aria-label="${esc(ui.learnedCollapsed)}">
        <span data-testid="learned-short"${open ? ' hidden' : ''}>${esc(ui.learnedCollapsed)}</span>
      </button>
      <div class="l13-learned-more" data-testid="learned-more"${open ? '' : ' hidden'}>
        <p data-testid="learned-summary">${esc(data.learned.summary)}</p>
        <p>${esc(data.learned.tomorrow)}</p>
        <p class="l13-note">${esc(data.learned.disclaimer)}</p>
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
    return `<div class="l13-stars" data-testid="stars" role="img" aria-label="${esc(fill(STARS_SR, [n, max]))}">${html}</div>`;
  }

  function feedbackText(total, stars) {
    if (!passed(total)) return failAuto ? data.fail.autoUnlockBody : data.fail.body;
    const map = data.stars.feedback || {};
    return map[String(stars)] || '';
  }

  function switchHTML(on, act, testid, name, note, sr) {
    const extra = sr ? `<span class="visually-hidden">${esc(sr)}</span>` : '';
    return `<button type="button" class="l13-switch" role="switch" aria-checked="${on ? 'true' : 'false'}" data-act="${act}" data-testid="${testid}">
      <span class="l13-switch-name">${esc(name)}</span>
      <span class="l13-switch-note">${esc(note)}</span>
      ${extra}
    </button>`;
  }

  function roundAttr() {
    if (phase === 'play' || phase === 'timeup' || phase === 'summary' || phase === 'hint') {
      const round = data.rounds[roundIndex];
      return round ? round.id : '';
    }
    return '';
  }

  function variantAttr() {
    if (!(phase === 'play' || phase === 'timeup' || phase === 'summary')) return '';
    const attempt = attempts[roundIndex];
    return attempt ? attempt.variant.id : '';
  }

  function armLearned() {
    later(() => {
      if (disposed || phase !== 'result') return;
      learnedOpen = false;
      const more = root.querySelector('[data-testid="learned-more"]');
      const btn = root.querySelector('[data-testid="learned-toggle"]');
      const short = root.querySelector('[data-testid="learned-short"]');
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', ui.learnedCollapsed);
      }
      if (more) more.hidden = true;
      if (short) short.hidden = false;
    }, 2000);
  }

  function applyScripted(toolId) {
    if (disposed || phase !== 'play' || inputLocked || judgeOpen || roundEnding) return false;
    const idea = currentIdea();
    if (!idea || marks[idea.id]) return false;
    const grade = gradeOf(idea, toolId);
    const delta = deltaOf(grade, data.scoring);
    marks[idea.id] = { toolId, grade, delta, missed: false };
    ideaCursor += 1;
    testing = null;
    teamHold = false;
    if (ideaCursor >= currentIdeas().length) {
      finishRound();
      return true;
    }
    draw();
    return true;
  }

  function kickAutoFloat(script) {
    let cursor = 0;
    const step = () => {
      if (disposed || autoStop || phase !== 'play') return;
      if (testing || judgeOpen || lagKind || lagArm || roundEnding || inputLocked || !laneState) {
        later(step, 40);
        return;
      }
      if (cursor >= script.length) return;
      const ch = script[cursor];
      if (ch === 't') {
        cursor += 1;
        lockRound();
        return;
      }
      if (ch !== 'p' && ch !== 'c' && ch !== 'b') {
        cursor += 1;
        later(step, 0);
        return;
      }
      const idea = currentIdeas()[cursor];
      if (!idea || marks[idea.id]) {
        cursor += 1;
        later(step, 0);
        return;
      }
      const b = laneState.bubbles.find(item => item.id === idea.id);
      if (!b || b.status === 'pending') {
        later(step, 40);
        return;
      }
      if (b.status === 'missed' || b.status === 'done' || b.status === 'testing') {
        cursor += 1;
        later(step, 0);
        return;
      }
      if (!bubbleHit(b)) {
        later(step, 40);
        return;
      }
      laneState = selectBubble(laneState, idea.id);
      syncFloatDom(true);
      syncPromptAndTools();
      cursor += 1;
      beginTest(ch === 'p' ? 'paper' : ch === 'c' ? 'click' : 'build');
      later(step, 40);
    };
    later(step, 0);
  }

  function kickAuto() {
    if (!seq || phase !== 'play' || autoStop) return;
    const script = seq[roundIndex] || '';
    tapSeen = true;
    if (!rendersCards()) {
      kickAutoFloat(script);
      return;
    }
    let cursor = 0;
    const step = () => {
      if (disposed || autoStop || phase !== 'play') return;
      if (testing || judgeOpen || lagKind || lagArm || roundEnding) {
        later(step, 20);
        return;
      }
      if (cursor >= script.length) return;
      const ch = script[cursor++];
      if (ch === 't') {
        lockRound();
        return;
      }
      if (ch === 'p' || ch === 'c' || ch === 'b') {
        applyScripted(ch === 'p' ? 'paper' : ch === 'c' ? 'click' : 'build');
        if (disposed || phase !== 'play') return;
        later(step, 0);
        return;
      }
      later(step, 0);
    };
    later(step, 0);
  }

  function driveAuto() {
    if (!seq || autoStop || disposed) return;
    const gen = ++driveGen;
    const still = () => !disposed && !autoStop && gen === driveGen;
    if (phase === 'intro') {
      later(() => { if (still() && phase === 'intro') startRound(0); }, 0);
      return;
    }
    if (phase === 'play') {
      if (autoArmed) {
        autoArmed = false;
        kickAuto();
      }
      return;
    }
    if (phase === 'timeup' || phase === 'resume') return;
    if (phase === 'hint' && stopAt === 'hint') { autoStop = true; return; }
    if (phase === 'summary' && stopAt === 'summary') { autoStop = true; return; }
    if (phase === 'result') { autoStop = true; return; }
    if (phase === 'summary' || phase === 'hint') {
      later(() => {
        if (!still()) return;
        if (phase === 'summary' || phase === 'hint') goNext();
      }, 0);
    }
  }

  function afterDraw() {
    const stage = root.querySelector('[data-testid="stage"]');
    const team = root.querySelector('[data-testid="team"]');
    if (rendersCards() && stage && stage.clientHeight > 0 && stage.clientHeight < 150) tightStage = true;
    if (team && teamSvg && !team.querySelector('svg')) team.innerHTML = teamSvg;
    if (!rendersCards() && phase === 'play') {
      ensureLaneState();
      stepFloat(countdown ? countdown.elapsed : 0);
      syncPromptAndTools();
    } else if (!rendersCards() && phase === 'timeup') {
      ensureLaneState();
      syncFloatDom(true);
    }
    syncTeam();
    syncChrome();
    focusLagDialog();
    syncJudge();
    if (phase === 'result' && resultArmed) {
      resultArmed = false;
      armLearned();
    }
    driveAuto();
  }

  function draw() {
    if (disposed || drawing) return;
    drawing = true;
    const total = totalScore();
    const stars = starsNow(total);
    let main = '';
    let dock = '';
    let overlay = '';
    if (phase === 'intro') {
      const boss = `<div class="l13-avatar" data-testid="boss"${roomForBoss() ? '' : ' hidden'}>${imgShared('l11-boss.svg')}</div>`;
      main = `<div class="l13-intro">
        ${boss}
        <div class="l13-quote">${imgShared('l11-bubble.svg')}<p data-testid="intro-body">${esc(data.intro.body)}</p></div>
        <div class="l13-switches">
          ${switchHTML(calm, 'toggle-calm', 'switch-calm', ui.calmToggle, ui.calmToggleNote)}
          ${switchHTML(layout === 'cards', 'toggle-cards', 'switch-cards', ui.cardsToggle, ui.cardsToggleNote, ui.cardsToggleSr)}
        </div>
      </div>`;
      dock = primary('start', 'btn-start', data.intro.button || data.buttons.start);
    } else if (phase === 'play' || phase === 'timeup') {
      const timeUp = timeUpVisible
        ? `<p class="l13-timeup" data-testid="time-up">${esc(fill(data.timeUp, [currentIdeas().filter(idea => marks[idea.id] && marks[idea.id].missed).length]))}</p>`
        : '';
      main = `${timerHTML()}${timeUp}${rendersCards() ? cardHTML() : floatShellHTML()}${hintHTML()}`;
      dock = `${benchHTML()}${toolsHTML()}`;
    } else if (phase === 'summary') {
      main = summaryHTML();
      dock = `<div class="l13-actions">${primary('next', 'btn-next', data.buttons.next)}</div>`;
    } else if (phase === 'hint') {
      const sec = roundLimitSec(data.rounds[1] || data.rounds[0]);
      main = `<p class="l13-hint-block" data-testid="timer-hint">${esc(fill(data.timerHint, [sec]))}</p>`;
      dock = `<div class="l13-actions">${primary('next', 'btn-next', data.buttons.next)}</div>`;
    } else if (phase === 'result') {
      const text = feedbackText(total, stars);
      main = `<p class="l13-score" data-testid="result-score">${esc(fill(ui.totalScore, [total, maxScore()]))}</p>
        ${starsHTML(stars)}
        <p class="l13-feedback" data-testid="result-feedback">${esc(text)}</p>
        <p class="l13-stats" data-testid="stats-line">${esc(fill(ui.statsLine, statsCounts()))}</p>`;
      const buttons = passed(total)
        ? `${primary('exit', 'btn-backToMap', data.buttons.backToMap)}${secondary('replay', 'btn-replay', data.buttons.replay)}`
        : `${primary('retry', 'btn-retry', data.buttons.retry)}${secondary('exit', 'btn-backToMap', data.buttons.backToMap)}`;
      dock = `${learnedHTML()}<div class="l13-actions">${buttons}</div>`;
    } else if (phase === 'resume') {
      overlay = `<div class="l13-mask" data-testid="resume-dialog" role="dialog">
        <div class="l13-panel">
          <p data-testid="resume-text">${esc(fill(ui.resumePrompt, [dialogRound]))}</p>
          <div class="l13-actions">
            ${primary('resume-go', 'resume-continue', ui.resumeContinue)}
            ${secondary('resume-new', 'resume-restart', ui.resumeRestart)}
          </div>
        </div>
      </div>`;
    }
    const toast = toastText ? `<div class="l13-toast" data-testid="level-toast" role="status">${esc(toastText)}</div>` : '';
    const starAttr = phase === 'result' ? ` data-stars="${stars}"` : '';
    // 关卡内部的 lagKind。只在本机且 l13test=1 时写到根节点，关着不写。
    const lagAttr = hookOn() ? ` data-lag-kind="${esc(lagKind)}"` : '';
    const roundLabel = (phase === 'play' || phase === 'timeup' || phase === 'summary')
      ? `<span class="l13-round" data-testid="round-label">${esc(fill(ui.roundLabel, [roundIndex + 1, data.rounds.length]))}</span>`
      : '';
    root.innerHTML = `<div class="l13" data-testid="level" data-screen="${phase}" data-round="${esc(roundAttr())}" data-variant="${esc(variantAttr())}" data-layout="${rendersCards() ? 'cards' : 'float'}" data-layout-choice="${esc(layout)}" data-layout-source="${esc(layoutSource)}" data-calm="${calm ? '1' : '0'}" data-locked="${inputLocked ? 'true' : 'false'}" data-score="${total}"${starAttr}${lagAttr}>
      <header class="l13-top">
        <button type="button" class="l13-back" data-act="back" data-testid="back" aria-label="返回">${imgShared('ui-back.svg')}<span class="visually-hidden">返回</span></button>
        <h1>${esc(data.title)}</h1>
        ${roundLabel}
      </header>
      <div class="l13-main">${main}</div>
      ${dock ? `<div class="l13-dock">${dock}</div>` : ''}
      ${overlay}
      ${lagHTML()}
      ${toast}
    </div>`;
    drawing = false;
    announceNewCard();
    afterDraw();
  }

  function beginTest(toolId) {
    if (phase !== 'play' || disposed || lagKind) return;
    if (inputLocked) return;
    let idea = null;
    if (rendersCards()) {
      idea = currentIdea();
      if (!idea || marks[idea.id]) {
        toast(ui.pickFirst);
        return;
      }
      if (testing) {
        toast(ui.testing);
        return;
      }
    } else {
      if (testing) {
        toast(ui.testing);
        return;
      }
      idea = selectedFloatIdea();
      if (!idea || marks[idea.id]) {
        toast(ui.pickFirst);
        return;
      }
    }
    if (!countdown) return;
    const tool = toolBy(toolId);
    let seconds = Number(tool.seconds) || 0;
    if (calm && data.calm && data.calm.scaleTools === true) {
      const factor = Number(data.calm.factor) || 1;
      seconds *= factor;
    }
    if (hookOn()) {
      const n = Number(params.get('l13ff'));
      if (Number.isFinite(n) && n > 0 && n < seconds) seconds = n;
    }
    judgeReturnTool = toolId;
    testing = { toolId, seconds, startElapsed: countdown.elapsed, ideaId: idea.id };
    if (!rendersCards() && laneState) laneState = benchBubble(laneState, idea.id);
    teamHold = toolId === 'build';
    draw();
  }

  onClick = function handleClick(e) {
    if (disposed) return;
    if (lagKind) {
      const hit = e.target.closest('[data-act]');
      const act = hit && root.contains(hit) ? hit.getAttribute('data-act') : '';
      if (act === 'lag-ok') acceptLag();
      else if (act === 'lag-keep') refuseLag();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (judgeOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeJudge();
      return;
    }
    if (!tapSeen && phase === 'play' && roundIndex === 0) {
      e.preventDefault();
      e.stopPropagation();
      tapSeen = true;
      const hint = root.querySelector('[data-testid="hint-tap"]');
      if (hint) hint.remove();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.getAttribute('data-act');
    if (act === 'back' || act === 'exit') {
      if (api && api.exit) api.exit();
      return;
    }
    if (act === 'start') { startRound(0); return; }
    if (act === 'toggle-calm' && phase === 'intro') { calm = !calm; draw(); return; }
    if (act === 'toggle-cards' && phase === 'intro') {
      layout = layout === 'cards' ? 'float' : 'cards';
      layoutSource = 'manual';
      draw();
      return;
    }
    if (act === 'card') {
      if (testing) toast(ui.waitTest);
      return;
    }
    if (act === 'bubble') {
      if (rendersCards() || phase !== 'play' || inputLocked) return;
      if (testing) { toast(ui.waitTest); return; }
      const id = el.getAttribute('data-id');
      const b = laneState && laneState.bubbles.find(item => item.id === id);
      if (!b || !bubbleHit(b)) return;
      if (b.status !== 'moving' && b.status !== 'stopped' && b.status !== 'queued') return;
      laneState = b.selected ? releaseBubble(laneState) : selectBubble(laneState, id);
      syncFloatDom(true);
      syncPromptAndTools();
      return;
    }
    if (act === 'lanes' || act === 'stage') {
      if (rendersCards() || phase !== 'play' || inputLocked || testing || judgeOpen) return;
      if (pointOnCold(e)) return;
      if (!laneState || !laneState.bubbles.some(item => item.selected)) return;
      laneState = releaseBubble(laneState);
      syncFloatDom(true);
      syncPromptAndTools();
      return;
    }
    if (act === 'tool') {
      // 原来靠 disabled 拦住的只有锁死（inputLocked）。置灰改成 aria-disabled 后这里自己拦。
      // 测试中、没选中只有 aria-disabled，仍交给 beginTest 弹原来的提示。
      if (inputLocked && (el.getAttribute('aria-disabled') === 'true' || el.disabled)) return;
      beginTest(el.getAttribute('data-tool'));
      return;
    }
    if (act === 'next') { goNext(); return; }
    if (act === 'replay' || act === 'retry') { replay(); return; }
    if (act === 'learned') {
      learnedOpen = !learnedOpen;
      const more = root.querySelector('[data-testid="learned-more"]');
      const btn = root.querySelector('[data-testid="learned-toggle"]');
      const short = root.querySelector('[data-testid="learned-short"]');
      if (btn) {
        btn.setAttribute('aria-expanded', learnedOpen ? 'true' : 'false');
        btn.setAttribute('aria-label', ui.learnedCollapsed);
      }
      if (more) more.hidden = !learnedOpen;
      if (short) short.hidden = learnedOpen;
      return;
    }
    if (act === 'resume-go') { continueRun(); return; }
    if (act === 'resume-new') { fresh(0, false); return; }
    if (act === 'hint') { tapSeen = true; draw(); }
  };

  onResize = function handleResize() {
    if (disposed) return;
    const boss = root.querySelector('[data-testid="boss"]');
    if (boss) boss.hidden = !roomForBoss();
    syncTeam();
    if (!rendersCards() && phase === 'play' && laneState) {
      ensureLaneState();
      stepFloat(countdown ? countdown.elapsed : laneState.elapsedMs);
      syncPromptAndTools();
    }
  };

  if (disposed) return unmount;
  clickBound = true;
  resizeBound = true;
  root.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onJudgeKey);
  window.addEventListener('popstate', onJudgePop);
  judgeKeyBound = true;
  judgePopBound = true;

  fetch(shared('l11-team.svg')).then(res => res.text()).then(text => {
    if (disposed) return;
    teamSvg = text;
    const host = root.querySelector('[data-testid="team"]');
    if (host) host.innerHTML = teamSvg;
  }).catch(() => {});

  let saved = null;
  let run = null;
  try { saved = readResume(bookId, levelId); } catch { saved = null; }
  try { run = readLevelRun(bookId, levelId); } catch { run = null; }
  if (!saved) {
    if (!hookOn()) {
      try { clearLevelRun(bookId, levelId); } catch { /* ignore */ }
    }
    run = null;
  }
  if (disposed) return unmount;
  if (saved && run && !seq) {
    dialogRound = Number(saved.screen) || 1;
    pauseReasons.add('resume');
    phase = 'resume';
    draw();
    return unmount;
  }
  fresh(0, false);
  return unmount;
}
