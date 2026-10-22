import { readFailStreak, readLevelRun, readResume, readSeenEndings } from '../../../js/storage.js';
import { testHookOn } from '../../../js/test-hook.js';
import { createCountdown, timerBarHTML } from '../../../js/timer-bar.js';
import { STARS_SR, uiText } from '../../../js/ui-text.js';
import { ENDING_IDS } from './logic/data-check.js';
import { resultLines } from './logic/result.js';
import { actSummary, createRun, step } from './logic/run.js';
import { fillX, formatDelta } from './logic/score.js';
import { settlePlan } from './logic/settle.js';
import { makeRng, pickVariant } from './logic/shuffle.js';
import { pauseNext } from './logic/pause.js';
import { normalizeRun, resumeFrom, snapshotOf } from './logic/snapshot.js';
import { applyL14t, pickBySeq, readTestParams } from './logic/test-params.js';
import { cueDue, normalizeMode } from './logic/time.js';
import { createStorageSaver } from './save.js';
import { L14_UI_DEFAULTS } from './ui-defaults.js';
import {
  actCount,
  actLabelText,
  barViews,
  betterSayText,
  bossFace,
  deltaLine,
  endingArt,
  endingBodyLines,
  fillScale,
  globalNodeIndex,
  hintText,
  meterText,
  nodeAt,
  optionOrders,
  orderAt,
  orderedOptions,
  remainingSec,
  saysPrefix,
  seqLetter,
  speakerById,
  starRow,
  summaryRowView,
  tagView,
  timeModeChoices,
  variantNodes
} from './view-data.js';

export const L14_ASSETS = [
  { name: 'l14-sales.svg', from: 'own' },
  { name: 'l14-engineer.svg', from: 'own' },
  { name: 'l14-icon-morale.svg', from: 'own' },
  { name: 'l14-tag-list.svg', from: 'own' },
  { name: 'l14-tag-loud.svg', from: 'own' },
  { name: 'l14-tag-block.svg', from: 'own' },
  { name: 'l14-aya.svg', from: 'own' },
  { name: 'l14-ending-factory.svg', from: 'own' },
  { name: 'l14-ops.svg', from: 'own' },
  { name: 'l11-bg.svg', from: 'level-01' },
  { name: 'l11-boss.svg', from: 'level-01' },
  { name: 'l11-boss-frown.svg', from: 'level-01' },
  { name: 'l11-boss-happy.svg', from: 'level-01' },
  { name: 'l11-team.svg', from: 'level-01' },
  { name: 'l11-icon-data.svg', from: 'level-01' },
  { name: 'l11-icon-check.svg', from: 'level-01' },
  { name: 'l11-icon-tap.svg', from: 'level-01' },
  { name: 'ui-back.svg', from: 'level-01' },
  { name: 'ui-star-on.svg', from: 'ui' },
  { name: 'ui-star-off.svg', from: 'ui' }
];

const ownHref = name => new URL(`./assets/${name}`, import.meta.url).href;
const shared = name => new URL(`../level-01/assets/${name}`, import.meta.url).href;
const uiHref = name => new URL(`../../../assets/ui/${name}`, import.meta.url).href;

const HREF_BY_FROM = {
  own: ownHref,
  'level-01': shared,
  ui: uiHref
};

const BAR_ICON = {
  morale: 'l14-icon-morale.svg',
  result: 'l11-icon-data.svg'
};

function hrefOf(name) {
  const row = L14_ASSETS.find((item) => item.name === name);
  if (!row) return '';
  const pick = HREF_BY_FROM[row.from];
  return pick ? pick(row.name) : '';
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function bossAvatar(data) {
  return speakerById(data, 'boss').avatar;
}

function ensureCss() {
  if (document.getElementById('l14-css')) return;
  const link = document.createElement('link');
  link.id = 'l14-css';
  link.rel = 'stylesheet';
  link.href = new URL('./level.css', import.meta.url).href;
  document.head.appendChild(link);
}

function setImgSrc(img, name) {
  const src = hrefOf(name);
  if (src) img.src = src;
  else img.removeAttribute('src');
}

function makeMeter(bar) {
  const holder = document.createElement('div');
  holder.innerHTML = '<div class="l14-meter" role="meter" aria-valuemin="0" aria-valuemax="16" aria-valuenow="0" aria-valuetext=""></div>';
  const root = holder.firstElementChild;
  if (bar.id === 'morale') root.setAttribute('data-testid', 'bar-morale');
  else if (bar.id === 'result') root.setAttribute('data-testid', 'bar-result');
  else root.setAttribute('data-testid', 'bar-' + bar.id);
  const icon = document.createElement('img');
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  icon.draggable = false;
  setImgSrc(icon, BAR_ICON[bar.id] || '');
  const track = document.createElement('span');
  track.className = 'l14-track';
  track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'l14-fill';
  track.appendChild(fill);
  const num = document.createElement('span');
  num.className = 'l14-bar-num';
  num.setAttribute('aria-hidden', 'true');
  root.append(icon, track, num);
  return { root, fill, num };
}

function fillIntro(host, data) {
  const intro = data && data.intro && typeof data.intro === 'object' ? data.intro : null;
  const buttons = data && data.buttons && typeof data.buttons === 'object' ? data.buttons : null;
  host.setAttribute('data-screen', 'intro');

  const img = document.createElement('img');
  img.className = 'l14-intro-boss';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  setImgSrc(img, bossAvatar(data));
  host.appendChild(img);

  const title = document.createElement('h1');
  title.className = 'l14-intro-title';
  title.setAttribute('data-testid', 'intro-title');
  title.setAttribute('tabindex', '-1');
  title.textContent = textOf(intro && intro.title);
  host.appendChild(title);

  const bubble = document.createElement('p');
  bubble.className = 'l14-bubble';
  bubble.textContent = textOf(intro && intro.body);
  host.appendChild(bubble);

  const timeSlot = document.createElement('div');
  timeSlot.className = 'l14-timemode';
  timeSlot.setAttribute('data-slot', 'time-mode');
  host.appendChild(timeSlot);

  const score = document.createElement('p');
  score.className = 'l14-score-note';
  score.setAttribute('data-slot', 'score-note');
  host.appendChild(score);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'l14-start';
  start.setAttribute('data-testid', 'start');
  start.textContent = textOf(buttons && buttons.start);
  host.appendChild(start);
}

export function mount(root, meta, api) {
  let node = null;
  let run = null;
  let els = null;
  let viewMode = 'intro';
  let paintedKey = '';
  let clock = null;
  let clockTotalMs = 1;
  let barsReady = false;
  let holdDialog = false;
  let tapSeen = false;
  let learnedTimer = 0;
  const timers = new Set();
  const listeners = [];
  let disposed = false;
  let playIndex = 0;
  let settleOnce = false;
  let seenBefore = [];
  let planAuto = false;
  let seqHeld = false;
  let stopLatched = false;
  let autoToken = '';
  let spokeThisHint = false;
  let cueSent = false;
  let cuePrevMs = null;
  let pauseState = null;
  const pauseReasons = new Set();
  let armHeld = false;
  let sayStartOnContinue = false;
  let heldAct = -1;
  let resumeOpen = false;
  // While true, dropPauseReasons keeps 'resume-offer' so releaseClock
  // between the dialog and the opening hold does not wipe the handoff.
  let keepResumeOffer = false;
  let pendingResume = null;
  let pendingRun = null;
  let live = null;
  let resetFailedOn = false;
  let resetFailedSpoke = false;
  let resetFailedDone = false;
  const rafIds = new Set();
  const data = api && api.data;
  const ui = uiText(data, L14_UI_DEFAULTS);
  const fail = data && data.fail && typeof data.fail === 'object' ? data.fail : {};
  const hookOn = () => testHookOn(location.hostname, location.search, 'l14test');
  const saver = createStorageSaver();
  const bookId = (api && api.bookId) || (data && data.book);
  const levelId = (api && api.levelId) || (data && data.id);
  const params = readTestParams(location.search, hookOn());
  let pickedMode = normalizeMode(params.time || (data && data.timeModeDefault));

  function unmount() {
    if (disposed) return;
    disposed = true;
    pauseState = null;
    armHeld = false;
    sayStartOnContinue = false;
    holdDialog = false;
    keepResumeOffer = false;
    releaseClock();
    cancelRafs();
    clearTimers();
    if (node) {
      node.remove();
      node = null;
    }
    if (live) {
      live.remove();
      live = null;
    }
    for (const item of listeners) item.target.removeEventListener(item.type, item.fn);
    listeners.length = 0;
  }

  if (api && typeof api.bindUnmount === 'function') {
    try { api.bindUnmount(unmount); } catch { /* ignore */ }
  }

  function rngFor(index) {
    if (params.seed != null && params.seed !== '') return makeRng(String(params.seed) + ':' + String(index));
    return Math.random;
  }

  function placeAttrs(state) {
    const actIndex = Number.isInteger(state.act) ? state.act : 0;
    // Not data-node / data-act: js/main.js treats any click inside #app under [data-node] as a map click.
    node.setAttribute('data-act-no', String(actIndex + 1));
    const current = nodeAt(data, state);
    const id = current && typeof current.id === 'string' ? current.id : '';
    if (id) node.setAttribute('data-node-id', id);
    else node.removeAttribute('data-node-id');
    node.setAttribute('data-locked', state.locked === true ? 'true' : 'false');
  }

  function updateChrome(state) {
    placeAttrs(state);
    els.actLabel.textContent = actLabelText(ui.actLabel, state.act, actCount(data));
    const bars = barViews(data, state.bars);
    const priming = barsReady !== true;
    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      const meter = els.meters[bar.id];
      if (!meter) continue;
      meter.root.setAttribute('aria-valuemax', String(bar.max));
      meter.root.setAttribute('aria-valuenow', String(bar.value));
      meter.root.setAttribute('aria-valuetext', meterText(ui.barValue, bar));
      meter.fill.style.width = '100%';
      meter.fill.style.transformOrigin = 'left';
      if (priming) meter.fill.style.transition = 'none';
      meter.fill.style.transform = 'scaleX(' + String(fillScale(bar.value, bar.max)) + ')';
      meter.num.textContent = String(bar.value) + ' / ' + String(bar.max);
    }
    if (!priming) return;
    for (let i = 0; i < bars.length; i += 1) {
      const meter = els.meters[bars[i].id];
      if (meter && meter.fill) meter.fill.getBoundingClientRect();
    }
    for (let i = 0; i < bars.length; i += 1) {
      const meter = els.meters[bars[i].id];
      if (meter && meter.fill) meter.fill.style.transition = '';
    }
    barsReady = true;
  }

  function redrawBody(state) {
    const current = nodeAt(data, state);
    const speaker = speakerById(data, current && current.speaker);
    setImgSrc(els.avatar, speaker.avatar);
    els.avatar.setAttribute('data-speaker', speaker.id);
    els.name.textContent = speaker.name;
    els.sr.textContent = saysPrefix(ui.srSays, speaker.name);
    els.lineText.nodeValue = textOf(current && current.line);
    els.choices.replaceChildren();
    const options = orderedOptions(current, orderAt(state));
    for (const opt of options) {
      if (!opt || typeof opt.id !== 'string') continue;
      const holder = document.createElement('div');
      holder.innerHTML = '<button type="button" class="l14-option" data-testid="option"></button>';
      const btn = holder.firstElementChild;
      btn.setAttribute('data-option', opt.id);
      btn.textContent = textOf(opt.text);
      els.choices.appendChild(btn);
    }
  }

  function lockOptions(pickedId) {
    node.setAttribute('data-locked', 'true');
    const list = els.choices.querySelectorAll('[data-testid="option"]');
    for (const btn of list) {
      btn.setAttribute('aria-disabled', 'true');
      if (pickedId && btn.getAttribute('data-option') === pickedId) {
        btn.classList.add('is-picked');
        btn.classList.remove('is-locked');
      } else {
        btn.classList.add('is-locked');
        btn.classList.remove('is-picked');
      }
    }
  }

  function releaseClock() {
    if (clock) {
      clock.stop();
      clock.dispose();
      clock = null;
    }
    if (node && node.getAttribute('data-timer') === 'run') node.setAttribute('data-timer', 'stop');
    dropPauseReasons();
  }

  function typeTag(id) {
    const types = data && Array.isArray(data.types) ? data.types : [];
    for (let i = 0; i < types.length; i += 1) {
      const item = types[i];
      if (item && item.id === id) return textOf(item.tag);
    }
    return '';
  }

  function makeDots() {
    const dots = document.createElement('span');
    dots.className = 'l14-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement('i'));
    return dots;
  }

  function makeBadge(type) {
    const view = tagView(type);
    const badge = document.createElement('span');
    badge.className = 'l14-badge';
    badge.style.background = view.color;
    if (view.dots) badge.appendChild(makeDots());
    else {
      const icon = document.createElement('img');
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.draggable = false;
      icon.width = 20;
      icon.height = 20;
      setImgSrc(icon, view.icon);
      badge.appendChild(icon);
    }
    return { badge, view };
  }

  function asideText(current, pending) {
    const type = pending && typeof pending.type === 'string' ? pending.type : '';
    if (type === 'timeout') return textOf(current && current.timeoutAfter);
    const options = current && Array.isArray(current.options) ? current.options : [];
    const id = pending && pending.optionId;
    for (let i = 0; i < options.length; i += 1) {
      const opt = options[i];
      if (opt && opt.id === id) return textOf(opt.after);
    }
    return '';
  }

  function applyBossFace(state, type) {
    if (!els || !els.avatar) return;
    const current = nodeAt(data, state);
    const speakerId = current && typeof current.speaker === 'string' ? current.speaker : '';
    const face = bossFace(speakerId, type);
    if (!face) return;
    setImgSrc(els.avatar, face);
  }

  function clearDialog() {
    if (!els || !els.stage) return;
    const old = els.stage.querySelector('.l14-dialog');
    if (old) old.remove();
  }

  function paintRemain(ms) {
    if (!els || !els.timeRow) return;
    const bar = els.timeRow.querySelector('[data-testid="timer-bar"]');
    if (!bar) return;
    const sec = remainingSec(ms);
    bar.setAttribute('data-remaining', String(sec));
    const num = bar.querySelector('.l14-timer-num');
    if (num) num.textContent = String(sec);
    const ink = bar.querySelector('.l14-timer-track i');
    if (!ink) return;
    const total = clockTotalMs > 0 ? clockTotalMs : 1;
    let pct = (Number(ms) / total) * 100;
    if (!Number.isFinite(pct) || pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    ink.style.width = String(pct) + '%';
  }

  function cueSecFor(mode) {
    const table = data && data.timeLeftCue && typeof data.timeLeftCue === 'object' ? data.timeLeftCue : null;
    if (!table) return null;
    const picked = normalizeMode(mode);
    if (picked === 'off') return null;
    const n = Number(table[picked]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  // 倒计时每一帧都问一次。暂停帧只问、不改上次剩余，放开后跨过播报点仍能播一次。
  function onClockTick(ms) {
    paintRemain(ms);
    if (!clock || !run) return;
    const mode = normalizeMode(run.mode);
    const cueSec = cueSecFor(mode);
    const paused = clock.running !== true;
    const due = cueDue({
      mode: mode,
      paused: paused,
      cued: cueSent,
      cueSec: cueSec,
      totalSec: remainingSec(clockTotalMs),
      remainingMs: ms,
      prevRemainingMs: cuePrevMs
    });
    if (!paused) cuePrevMs = ms;
    if (!due) return;
    cueSent = true;
    sayLive(fillX(textOf(ui.srTimeLeft), [cueSec]));
  }

  // Seconds on the limit bar. Same integer as data-remaining; empty when the row is untimed.
  function barRemainText() {
    const row = els && els.timeRow;
    const bar = row && typeof row.querySelector === 'function'
      ? row.querySelector('[data-testid="timer-bar"]')
      : null;
    if (!bar || typeof bar.getAttribute !== 'function') return '';
    const raw = bar.getAttribute('data-remaining');
    if (raw == null || String(raw) === '') return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || String(n) !== String(raw)) return '';
    return String(raw);
  }

  // Opening hold speaks once, with × filled from the bar. Continue speaks the timed line.
  // A redraw or a later manual pause does not repeat the hold line. Untimed rows do not speak it.
  function sayTimedStart(state, pausedOpen) {
    if (pausedOpen === true) {
      const sec = barRemainText();
      if (sec === '') return;
      sayLive(fillX(textOf(ui.pausedStartSay), [sec]));
      return;
    }
    const current = nodeAt(data, state);
    const wait = textOf(current && current.waitLabel);
    const sec = remainingSec(clockTotalMs);
    sayLive(fillX(textOf(ui.srTimed), [wait, sec]));
  }

  function armClock(ms, state, hold) {
    if (resumeOpen) return false;
    releaseClock();
    sayStartOnContinue = false;
    const total = Number(ms);
    clockTotalMs = Number.isFinite(total) && total > 0 ? total : 1;
    cueSent = false;
    cuePrevMs = null;
    clock = createCountdown({
      durationMs: clockTotalMs,
      pauseOnHidden: true,
      onTick: onClockTick,
      onEnd: onClockEnd
    });
    if (hold === true && beginHeld(state)) {
      if (hiddenNow()) applyHiddenPause();
      return true;
    }
    // Not the opening hold. Drop the dialog reason and do not leave wait.
    releaseResumeOffer();
    pauseState = null;
    if (node) node.setAttribute('data-timer', 'run');
    sayTimedStart(state);
    clock.start();
    if (hiddenNow()) applyHiddenPause();
    return true;
  }

  // First timed node after a mid-quit resume waits for continue. Full limit, clock not running.
  // Reasons first, then the look: drop resume-offer, keep wait (and hidden if already backgrounded).
  function beginHeld(state) {
    const next = pauseNext({
      mode: state && state.mode,
      screen: 'node',
      status: 'idle',
      timed: true,
      outcome: null,
      remainingMs: null,
      limitMs: null,
      pauseCount: 0
    }, { type: 'reenter', limitMs: clockTotalMs });
    if (next.paused !== true) {
      releaseResumeOffer();
      return false;
    }
    setPause('wait', true);
    keepResumeOffer = false;
    setPause('resume-offer', false);
    if (hiddenNow()) setPause('hidden', true);
    pauseState = next;
    setPauseLook(next.paused);
    if (node) node.setAttribute('data-timer', 'stop');
    sayStartOnContinue = true;
    sayTimedStart(state, true);
    return true;
  }

  // Appearance only. Clock pause/start stays with the caller so cueSent is left alone.
  let waitPhrase = '';

  function setPauseLook(paused) {
    if (!node) return;
    const on = paused === true;
    node.setAttribute('data-paused', on ? 'true' : 'false');
    const btn = node.querySelector('[data-testid="pause"]');
    if (btn) btn.textContent = textOf(on ? ui.resume : ui.paused);
    const wait = node.querySelector('[data-testid="wait-label"]');
    if (wait) wait.textContent = on ? textOf(ui.pausedNote) : waitPhrase;
  }

  // Move focus before hiding. A focused control that disappears drops focus on body.
  function moveFocusOffPause(btn, prefer) {
    if (typeof document === 'undefined' || !btn || document.activeElement !== btn) return;
    const body = document.body || null;
    const line = node && typeof node.querySelector === 'function'
      ? node.querySelector('[data-testid="line"]')
      : null;
    const stance = node && typeof node.querySelector === 'function'
      ? node.querySelector('[data-testid="no-stance"]')
      : null;
    const go = node && typeof node.querySelector === 'function'
      ? node.querySelector('[data-testid="consequence-continue"]')
      : null;
    const ordered = [];
    if (prefer) ordered.push(prefer);
    if (line && line.getAttribute('tabindex') === '-1') ordered.push(line);
    if (go) ordered.push(go);
    if (stance) ordered.push(stance);
    if (line) ordered.push(line);
    for (let i = 0; i < ordered.length; i += 1) {
      const el = ordered[i];
      if (!el || el === btn || typeof el.focus !== 'function') continue;
      const tag = el.tagName;
      const tab = typeof el.getAttribute === 'function' ? el.getAttribute('tabindex') : null;
      const naturally = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!naturally && tab == null && typeof el.setAttribute === 'function') el.setAttribute('tabindex', '-1');
      try { el.focus(); } catch { /* ignore */ }
      const active = document.activeElement;
      if (active && active !== btn && active !== body) return;
    }
  }

  function tuckPauseButton(prefer) {
    if (!node || typeof node.querySelector !== 'function') return;
    const btn = node.querySelector('[data-testid="pause"]');
    if (!btn) return;
    moveFocusOffPause(btn, prefer);
    const parked = typeof document !== 'undefined' ? document.activeElement : null;
    btn.hidden = true;
    btn.setAttribute('hidden', '');
    const body = typeof document !== 'undefined' ? document.body : null;
    if (parked && parked !== btn && parked !== body && typeof document !== 'undefined' && document.activeElement !== parked && typeof parked.focus === 'function') {
      try { parked.focus(); } catch { /* ignore */ }
    }
  }

  function foldPauseChrome(prefer) {
    pauseState = null;
    sayStartOnContinue = false;
    setPauseLook(false);
    tuckPauseButton(prefer);
    dropPauseReasons();
  }

  function noteHeldAct(state) {
    const actIndex = Number.isInteger(state && state.act) ? state.act : -1;
    if (!armHeld || actIndex === heldAct) return;
    armHeld = false;
    heldAct = -1;
  }

  function livePauseInput() {
    const remain = clock && typeof clock.remaining === 'number' ? clock.remaining : null;
    const held = !!(pauseState && pauseState.paused === true);
    const running = !!(clock && clock.running === true);
    const count = pauseState && Number.isFinite(pauseState.pauseCount) ? pauseState.pauseCount : 0;
    return {
      mode: run && run.mode,
      screen: 'node',
      status: held ? 'paused' : (running ? 'running' : 'idle'),
      timed: true,
      outcome: null,
      remainingMs: remain,
      limitMs: clockTotalMs,
      pauseCount: count
    };
  }

  function nodeLocked() {
    if (run && run.locked === true) return true;
    if (node && node.getAttribute('data-locked') === 'true') return true;
    return false;
  }

  function writePauseReasons() {
    if (!node) return;
    const names = [...pauseReasons].sort();
    node.setAttribute('data-pause-reasons', names.join(','));
  }

  // Non-empty reasons or a locked node hold the clock.
  // Starting only happens when a reason was really removed and none remain.
  // Clearing an empty set does not start the clock.
  function setPause(reason, on) {
    if (typeof reason !== 'string' || reason === '') return;
    const had = pauseReasons.has(reason);
    if (on) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    if (clock && clock.ended !== true) {
      if (nodeLocked() || pauseReasons.size > 0) clock.pause();
      else if (had) clock.start();
    }
    writePauseReasons();
  }

  function clearPauseReasons() {
    const names = [...pauseReasons];
    for (let i = 0; i < names.length; i += 1) setPause(names[i], false);
  }

  // Leaving the timed row drops reasons without starting a clock that is going away.
  // resume-offer stays only for the handoff into beginHeld.
  function dropPauseReasons() {
    const keepOffer = keepResumeOffer && pauseReasons.has('resume-offer');
    pauseReasons.clear();
    if (keepOffer) pauseReasons.add('resume-offer');
    writePauseReasons();
  }

  // Dialog reason only. Does not add wait, and does not touch the clock when the reason is already gone.
  function releaseResumeOffer() {
    keepResumeOffer = false;
    if (!pauseReasons.has('resume-offer')) return;
    setPause('resume-offer', false);
  }

  function hiddenNow() {
    if (typeof document === 'undefined') return false;
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  // Timed node, clock running or already held, not chosen, not time-up, dialog shut, unlocked.
  function canPauseForHide() {
    if (disposed || resumeOpen || !node || !run || !clock || clock.ended === true) return false;
    if (run.screen !== 'node' || run.locked === true) return false;
    if (node.getAttribute('data-screen') === 'settle') return false;
    if (node.getAttribute('data-locked') === 'true') return false;
    const phase = node.getAttribute('data-phase');
    if (phase === 'consequence' || phase === 'no-stance') return false;
    if (node.getAttribute('data-timer') === 'off') return false;
    if (typeof node.querySelector === 'function' && node.querySelector('[data-testid="untimed"]')) return false;
    const remain = clock.remaining;
    if (!(typeof remain === 'number' && remain > 0)) return false;
    const held = !!(pauseState && pauseState.paused === true);
    const going = clock.running === true || node.getAttribute('data-timer') === 'run';
    if (!going && !held) return false;
    return true;
  }

  // Sample pauseNext before setPause stops the clock. A stopped clock reads as idle.
  function applyHiddenPause() {
    if (!canPauseForHide()) return;
    const input = livePauseInput();
    if (input.status !== 'running' && input.status !== 'paused') input.status = 'running';
    const next = pauseNext(input, { type: 'hide' });
    if (next.paused !== true) return;
    setPause('hidden', true);
    pauseState = next;
    setPauseLook(next.paused);
    node.setAttribute('data-timer', 'stop');
  }

  function onVisibility() {
    if (disposed) return;
    if (hiddenNow()) {
      applyHiddenPause();
      return;
    }
    if (!canPauseForHide() || !pauseReasons.has('hidden')) return;
    // Add wait first so removing hidden never leaves the set empty and restarts the clock.
    setPause('wait', true);
    setPause('hidden', false);
  }

  // Enter: setPause(reason, true), then the look. Leave: clear reasons, then the look, then start.
  function onPauseClick(btn) {
    if (disposed || !node || !run || !clock || clock.ended === true) return;
    if (btn && (btn.hidden === true || btn.getAttribute('hidden') != null)) return;
    if (run.screen !== 'node' || run.locked === true) return;
    if (node.getAttribute('data-locked') === 'true') return;
    if (node.getAttribute('data-phase') === 'consequence') return;
    const held = !!(pauseState && pauseState.paused === true);
    const next = pauseNext(livePauseInput(), { type: held ? 'continue' : 'pause' });
    if (!held && next.paused === true) {
      setPause('manual', true);
      pauseState = next;
      setPauseLook(next.paused);
      node.setAttribute('data-timer', 'stop');
      return;
    }
    if (held && next.paused !== true && next.status === 'running') {
      clearPauseReasons();
      const speakStart = sayStartOnContinue === true;
      sayStartOnContinue = false;
      setPauseLook(next.paused);
      pauseState = next;
      clock.start();
      if (clock.running === true) node.setAttribute('data-timer', 'run');
      if (speakStart) sayTimedStart(run);
    }
  }

  function paintTimeRow(state) {
    const row = els.timeRow;
    const current = nodeAt(data, state);
    row.replaceChildren();
    noteHeldAct(state);
    if (state.limitMs == null) {
      releaseResumeOffer();
      const span = document.createElement('span');
      span.className = 'l14-untimed';
      span.setAttribute('data-testid', 'untimed');
      span.textContent = textOf(ui.untimed);
      row.appendChild(span);
      if (node) node.setAttribute('data-timer', 'off');
      return;
    }
    const totalMs = Number(state.limitMs);
    const sec = remainingSec(totalMs);
    const totalSec = sec > 0 ? sec : 1;
    const holder = document.createElement('div');
    holder.innerHTML = timerBarHTML({
      remainingSec: sec,
      totalSec: totalSec,
      paused: false,
      pausedLabel: '',
      className: 'l14-timer'
    });
    const bar = holder.firstElementChild;
    if (bar) row.appendChild(bar);
    const pause = row.querySelector('.l14-timer-pause');
    if (pause) pause.hidden = true;
    const wait = document.createElement('span');
    wait.className = 'l14-wait';
    wait.setAttribute('data-testid', 'wait-label');
    waitPhrase = textOf(current && current.waitLabel);
    wait.textContent = waitPhrase;
    row.appendChild(wait);
    const playable = state.screen === 'node' && state.locked !== true;
    if (!playable) {
      releaseResumeOffer();
      if (node) node.setAttribute('data-timer', 'stop');
      return;
    }
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('type', 'button');
    pauseBtn.className = 'l14-pause';
    pauseBtn.setAttribute('data-testid', 'pause');
    pauseBtn.textContent = textOf(ui.paused);
    row.appendChild(pauseBtn);
    const calm = data && data.calm && typeof data.calm === 'object' ? data.calm.factor : undefined;
    const seconds = applyL14t(current && current.timeLimit, state.mode, calm, params.t);
    const runMs = seconds == null ? totalMs : seconds * 1000;
    if (bar) bar.setAttribute('data-total', String(remainingSec(runMs)));
    const hold = armHeld === true;
    if (armClock(runMs, state, hold) && hold) {
      armHeld = false;
      heldAct = -1;
    }
  }

  function showNoStance() {
    if (!els || !els.choices) return;
    const list = els.choices.querySelectorAll('[data-testid="option"]');
    for (const btn of list) {
      btn.classList.add('is-hidden');
      btn.setAttribute('aria-disabled', 'true');
    }
    if (els.choices.querySelector('[data-testid="no-stance"]')) return;
    const label = document.createElement('div');
    label.className = 'l14-stance';
    label.setAttribute('data-testid', 'no-stance');
    const made = makeBadge('timeout');
    const text = document.createElement('span');
    text.textContent = typeTag('timeout');
    label.append(made.badge, text);
    els.choices.appendChild(label);
  }

  // Reading comes from the countdown. A click that already locked the node bails out.
  function onClockEnd() {
    if (disposed || !clock) return;
    const left = clock.remaining;
    if (!(left <= 0)) return;
    const open = run && run.screen === 'node' && run.locked !== true && node && node.getAttribute('data-locked') !== 'true';
    releaseClock();
    foldPauseChrome();
    if (!open || !node) return;
    run = step(run, { type: 'timeout', at: performance.now() });
    if (!run || !run.pending || run.pending.type !== 'timeout') return;
    holdDialog = true;
    node.setAttribute('data-locked', 'true');
    node.setAttribute('data-timer', 'stop');
    node.setAttribute('data-phase', 'no-stance');
    applyBossFace(run, 'timeout');
    showNoStance();
    const pauseBtn = node.querySelector('[data-testid="pause"]');
    if (pauseBtn && typeof document !== 'undefined' && document.activeElement === pauseBtn) {
      const stance = node.querySelector('[data-testid="no-stance"]');
      moveFocusOffPause(pauseBtn, stance);
    }
    const tid = setTimeout(function () {
      timers.delete(tid);
      holdDialog = false;
      if (disposed) return;
      openConsequence(run);
    }, 1000);
    timers.add(tid);
  }

  function makeHeader(withActLabel) {
    const header = document.createElement('header');
    header.className = 'l14-top';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'l14-back';
    back.setAttribute('data-act', 'back');
    back.setAttribute('data-testid', 'back');
    back.setAttribute('aria-label', textOf(ui.back));
    const backImg = document.createElement('img');
    backImg.alt = '';
    backImg.draggable = false;
    setImgSrc(backImg, 'ui-back.svg');
    const backSr = document.createElement('span');
    backSr.className = 'visually-hidden';
    backSr.textContent = textOf(ui.back);
    back.append(backImg, backSr);

    let actLabel = null;
    const mid = document.createElement('span');
    if (withActLabel) {
      actLabel = mid;
      mid.className = 'l14-act';
      mid.setAttribute('data-testid', 'act-label');
    } else {
      mid.className = 'l14-spacer';
      mid.setAttribute('aria-hidden', 'true');
    }

    const balance = document.createElement('span');
    balance.className = 'l14-balance';
    balance.setAttribute('aria-hidden', 'true');
    header.append(back, mid, balance);
    return { header: header, actLabel: actLabel };
  }

  function buildPlay() {
    barsReady = false;
    const madeHeader = makeHeader(true);
    const header = madeHeader.header;
    const actLabel = madeHeader.actLabel;

    const barsRow = document.createElement('div');
    barsRow.className = 'l14-bars';
    const meters = {};
    const bars = barViews(data, {});
    for (const bar of bars) {
      const made = makeMeter(bar);
      meters[bar.id] = made;
      barsRow.appendChild(made.root);
    }

    const timeRow = document.createElement('div');
    timeRow.className = 'l14-time';
    timeRow.setAttribute('data-testid', 'time-row');

    const talk = document.createElement('div');
    talk.className = 'l14-talk';
    const body = document.createElement('div');
    body.className = 'l14-talk-body';
    const who = document.createElement('div');
    who.className = 'l14-who';
    const avatar = document.createElement('img');
    avatar.className = 'l14-avatar';
    avatar.alt = '';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.setAttribute('data-testid', 'avatar');
    avatar.setAttribute('data-speaker', '');
    avatar.width = 48;
    avatar.height = 48;
    avatar.draggable = false;
    const name = document.createElement('span');
    name.className = 'l14-name';
    name.setAttribute('aria-hidden', 'true');
    who.append(avatar, name);
    const line = document.createElement('p');
    line.className = 'l14-bubble';
    line.setAttribute('data-testid', 'line');
    line.setAttribute('tabindex', '-1');
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    const lineText = document.createTextNode('');
    line.append(sr, lineText);
    body.append(who, line);
    talk.appendChild(body);

    const choices = document.createElement('div');
    choices.className = 'l14-choices';

    const stage = document.createElement('div');
    stage.className = 'l14-body';
    stage.append(talk, choices);

    node.replaceChildren(header, barsRow, timeRow, stage);
    els = { actLabel, meters, avatar, name, sr, lineText, choices, timeRow, stage };
    viewMode = 'play';
    paintedKey = '';
  }

  function showHold(state) {
    releaseClock();
    placeAttrs(state);
    node.setAttribute('data-screen', typeof state.screen === 'string' ? state.screen : '');
    node.setAttribute('data-locked', 'false');
    node.removeAttribute('data-phase');
    node.setAttribute('data-timer', 'off');
    const box = document.createElement('div');
    box.className = 'l14-hold';
    node.replaceChildren(box);
    els = null;
    viewMode = 'hold';
    paintedKey = '';
  }

  // 幕号是「接着做」会重开的那一幕：玩到一半是当前幕，小结和限时提示屏是下一幕。
  function resumeActNo(state) {
    const act = Number.isInteger(state.act) ? state.act : 0;
    if (state.screen === 'actSummary' || state.screen === 'hint') return act + 2;
    return act + 1;
  }

  function shouldNote(state) {
    if (!state) return false;
    if (state.screen === 'actSummary' || state.screen === 'hint') return true;
    return state.screen === 'node' && state.node === 0;
  }

  function noteProgress(state) {
    if (disposed || !shouldNote(state)) return;
    const actNo = resumeActNo(state);
    if (actNo < 1) return;
    const snap = snapshotOf(state);
    if (!snap) return;
    saver.saveResume(bookId, levelId, actNo);
    saver.writeLevelRun(bookId, levelId, snap);
  }

  function paint(state) {
    if (resumeOpen) return;
    if (!state || typeof state !== 'object') return;
    noteProgress(state);
    if (state.screen === 'actSummary') {
      showActSummary(state);
      return;
    }
    if (state.screen === 'hint') {
      showHint(state);
      return;
    }
    if (state.screen === 'settle') {
      showSettle(state);
      return;
    }
    if (state.screen !== 'node' && state.screen !== 'consequence') {
      holdDialog = false;
      showHold(state);
      return;
    }
    if (viewMode !== 'play') buildPlay();
    node.setAttribute('data-screen', 'node');
    updateChrome(state);
    const actIndex = Number.isInteger(state.act) ? state.act : 0;
    const nodeIndex = Number.isInteger(state.node) ? state.node : 0;
    const key = String(actIndex) + ':' + String(nodeIndex);
    if (key !== paintedKey) {
      holdDialog = false;
      releaseClock();
      clearDialog();
      dropTapLayer();
      redrawBody(state);
      paintTimeRow(state);
      paintedKey = key;
      if (actIndex !== 0 || nodeIndex !== 0) {
        if (node.getAttribute('data-tap') === 'open') node.setAttribute('data-tap', 'done');
      } else if (state.screen === 'node') {
        openTap();
      }
    }
    if (holdDialog) return;
    if (state.screen === 'consequence') {
      node.setAttribute('data-phase', 'consequence');
      openConsequence(state);
    } else {
      node.setAttribute('data-phase', 'choose');
      queueAuto(state);
    }
  }

  function beginRun(input) {
    if (disposed) return;
    dismissResetFailed();
    closeResumeUi();
    const bag = input && typeof input === 'object' ? input : {};
    const nextPlay = Number(bag.playIndex);
    playIndex = Number.isInteger(nextPlay) && nextPlay >= 0 ? nextPlay : 0;
    const mode = bag.mode;
    if (mode != null) pickedMode = normalizeMode(mode);
    stampTimeMode();
    spokeThisHint = false;
    cueSent = false;
    cuePrevMs = null;
    releaseClock();
    clearTimers();
    cancelRafs();
    holdDialog = false;
    settleOnce = false;
    planAuto = false;
    seenBefore = [];
    seqHeld = false;
    stopLatched = false;
    autoToken = '';
    tapSeen = false;
    barsReady = false;
    els = null;
    viewMode = 'intro';
    paintedKey = '';
    const from = bag.from;
    armHeld = false;
    heldAct = -1;
    pauseState = null;
    sayStartOnContinue = false;
    if (from && from.startPaused === true) {
      armHeld = true;
      heldAct = Number.isInteger(from.act) ? from.act : 0;
    }
    if (from && typeof from === 'object') {
      run = from;
    } else {
      const rng = rngFor(playIndex);
      const acts = data && Array.isArray(data.acts) ? data.acts : [];
      const picked = pickVariant(acts, playIndex);
      const variant = picked && Number.isInteger(picked.index) && picked.index >= 0 ? picked.index : 0;
      const orders = optionOrders(data, variant, rng, playIndex);
      const spec = data && typeof data === 'object' ? data : {};
      run = createRun(spec, { mode, variant, orders });
      run = step(run, { type: 'start', at: performance.now() });
    }
    // Clear the dialog reason before painting anything that is not an opening hold.
    if (!(armHeld === true && run && run.screen === 'node' && run.limitMs != null)) {
      releaseResumeOffer();
    }
    if (node) {
      node.removeAttribute('data-tap');
      node.removeAttribute('data-learned');
      node.removeAttribute('data-phase');
      node.removeAttribute('data-stopped');
      node.removeAttribute('data-plan');
      node.removeAttribute('data-paused');
      const variantNo = run && Number.isInteger(run.variant) ? run.variant : 0;
      node.setAttribute('data-variant', String(variantNo));
      node.setAttribute('data-play', String(playIndex));
    }
    paint(run);
  }

  function choose(optionId) {
    if (!run || run.screen !== 'node' || run.locked === true) return;
    if (node.getAttribute('data-locked') === 'true') return;
    if (typeof optionId !== 'string' || optionId === '') return;
    cancelRafs();
    // 顺序：锁按钮，停倒计时，算分，画后果框。
    lockOptions(optionId);
    if (clock) { clock.stop(); clock.dispose(); clock = null; if (node) node.setAttribute('data-timer', 'stop'); }
    dropPauseReasons();
    run = step(run, { type: 'pick', optionId, at: performance.now() });
    openConsequence(run);
  }

  function laterTimed(state) {
    const acts = data && Array.isArray(data.acts) ? data.acts : [];
    const actIndex = Number.isInteger(state.act) ? state.act : 0;
    const nodeIndex = Number.isInteger(state.node) ? state.node : 0;
    for (let a = actIndex; a < acts.length; a += 1) {
      const nodes = variantNodes(data, a, state.variant);
      const from = a === actIndex ? nodeIndex + 1 : 0;
      for (let i = from; i < nodes.length; i += 1) {
        const limit = nodes[i] ? Number(nodes[i].timeLimit) : Number.NaN;
        if (Number.isFinite(limit) && limit > 0) return true;
      }
    }
    return false;
  }

  // 第 2 幕（act 下标 1）第一次没表态。firstTimeoutAct 记的是幕号 2，方便以后写进快照。
  function firstTimeoutHere(state) {
    if (!state || !state.pending || state.pending.type !== 'timeout') return false;
    if (state.act !== 1 || state.firstTimeoutAct !== 2) return false;
    if (normalizeMode(state.mode) === 'off') return false;
    const log = Array.isArray(state.log) ? state.log : [];
    let seen = 0;
    for (let i = 0; i < log.length; i += 1) {
      if (log[i] && log[i].type === 'timeout') seen += 1;
    }
    if (seen !== 1) return false;
    return laterTimed(state);
  }

  function openConsequence(state) {
    if (!els || !els.stage || !state || state.screen !== 'consequence') return;
    holdDialog = false;
    node.setAttribute('data-screen', 'node');
    node.setAttribute('data-locked', 'true');
    node.setAttribute('data-phase', 'consequence');
    const pending = state.pending;
    const type = pending && typeof pending.type === 'string' ? pending.type : '';
    applyBossFace(state, type);
    const current = nodeAt(data, state);
    const made = makeBadge(type);
    clearDialog();
    const holder = document.createElement('div');
    holder.innerHTML = '<div class="l14-dialog" role="dialog" aria-modal="true" aria-labelledby="l14-tag-title" data-testid="consequence"></div>';
    const dialog = holder.firstElementChild;
    dialog.style.borderLeftColor = made.view.color;

    const head = document.createElement('div');
    head.className = 'l14-tagline';
    const title = document.createElement('span');
    title.id = 'l14-tag-title';
    title.setAttribute('data-testid', 'tag');
    title.setAttribute('data-type', type);
    title.textContent = typeTag(type);
    head.append(made.badge, title);

    const aside = document.createElement('p');
    aside.setAttribute('data-testid', 'aside');
    aside.textContent = asideText(current, pending);

    const deltas = document.createElement('p');
    deltas.setAttribute('data-testid', 'deltas');
    const bars = data && Array.isArray(data.bars) ? data.bars : [];
    deltas.textContent = deltaLine(ui.barDelta, bars, pending && pending.delta, ui.zeroDelta);
    dialog.append(head, aside, deltas);

    if (type !== 'own') {
      const better = document.createElement('p');
      better.setAttribute('data-testid', 'better-say');
      better.textContent = betterSayText(current, type, ui.betterSay);
      dialog.appendChild(better);
    }

    // 第五行只在第 2 幕第一次没表态、后面还有限时节点时出。出过与否在 run 上。
    if (firstTimeoutHere(state)) {
      const tip = document.createElement('p');
      tip.className = 'l14-timeout-tip';
      tip.id = 'l14-timeout-tip';
      tip.setAttribute('data-testid', 'timeout-tip');
      tip.setAttribute('data-slot', 'timeout-tip');
      tip.textContent = textOf(ui.timeoutTip);
      dialog.appendChild(tip);
    }

    const buttons = data && data.buttons && typeof data.buttons === 'object' ? data.buttons : null;
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'l14-start';
    go.setAttribute('data-testid', 'consequence-continue');
    go.textContent = textOf(buttons && buttons.continue);
    dialog.appendChild(go);
    els.stage.appendChild(dialog);
    foldPauseChrome(go);
    queueAuto(state);
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    learnedTimer = 0;
  }

  function later(fn) {
    if (typeof requestAnimationFrame !== 'function') return;
    let id = 0;
    id = requestAnimationFrame(function () {
      rafIds.delete(id);
      if (disposed) return;
      fn();
    });
    rafIds.add(id);
  }

  function cancelRafs() {
    if (typeof cancelAnimationFrame === 'function') {
      for (const id of rafIds) cancelAnimationFrame(id);
    }
    rafIds.clear();
  }

  function markStop(screen) {
    if (!params.stop || stopLatched) return false;
    let hit = false;
    if (params.stop === 'hint' && screen === 'hint') hit = true;
    else if (params.stop === 'summary' && screen === 'actSummary') hit = true;
    else if ((params.stop === 'result' || params.stop === 'book') && screen === 'settle') hit = true;
    if (!hit) return false;
    stopLatched = true;
    if (node) node.setAttribute('data-stopped', params.stop);
    return true;
  }

  function queueAuto(state) {
    if (disposed || resumeOpen || !state) return;
    const screen = typeof state.screen === 'string' ? state.screen : '';
    const token = screen + ':' + String(state.act) + ':' + String(state.node) + ':' + String(state.hintWhich || 0);
    if (token === autoToken) return;
    autoToken = token;
    if (markStop(screen)) return;
    if (params.seq == null || params.seq === '' || seqHeld) return;
    if (screen === 'hint' || screen === 'actSummary') {
      later(function () { goNext(); });
      return;
    }
    if (screen === 'consequence') {
      later(function () { advance(); });
      return;
    }
    if (screen === 'node' && node && node.getAttribute('data-phase') === 'choose') {
      later(function () { autoPick(); });
    }
  }

  function autoPick() {
    if (disposed || seqHeld || !run || run.screen !== 'node' || run.locked === true) return;
    if (!node || node.getAttribute('data-phase') !== 'choose') return;
    if (node.getAttribute('data-locked') === 'true') return;
    if (node.getAttribute('data-tap') === 'open') {
      closeTap();
      later(function () { autoPick(); });
      return;
    }
    const index = globalNodeIndex(data, run.variant, run.act, run.node);
    const letter = seqLetter(params.seq, index, run.act, run.node);
    if (letter == null) {
      seqHeld = true;
      return;
    }
    const picked = pickBySeq(nodeAt(data, run), letter);
    if (!picked) {
      seqHeld = true;
      return;
    }
    if (picked.type === 'timeout') return;
    const option = picked.option;
    if (!option || typeof option.id !== 'string') {
      seqHeld = true;
      return;
    }
    choose(option.id);
  }

  function buttonBag() {
    return data && data.buttons && typeof data.buttons === 'object' ? data.buttons : null;
  }

  function makeAction(label, testId, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'l14-start' : 'l14-secondary';
    btn.setAttribute('data-testid', testId);
    btn.textContent = label;
    return btn;
  }

  function closeResumeUi() {
    resumeOpen = false;
    pendingResume = null;
    pendingRun = null;
  }

  function resumeActIndex(rec) {
    const n = Number(rec && rec.screen);
    if (!Number.isInteger(n) || n < 1) return -1;
    return n - 1;
  }

  function syntheticSnap(actIndex) {
    return {
      variant: 0,
      orders: null,
      done: [],
      actStart: {},
      bars: {},
      screen: 'node',
      act: actIndex < 0 ? 0 : actIndex,
      mode: pickedMode,
      entry1Seen: false,
      entry2Seen: false,
      at: null
    };
  }

  function showIntro() {
    keepResumeOffer = false;
    closeResumeUi();
    run = null;
    els = null;
    viewMode = 'intro';
    paintedKey = '';
    releaseClock();
    clearTimers();
    cancelRafs();
    if (!node) return;
    node.removeAttribute('data-act-no');
    node.removeAttribute('data-node-id');
    node.removeAttribute('data-phase');
    node.removeAttribute('data-locked');
    node.removeAttribute('data-timer');
    node.removeAttribute('data-paused');
    node.removeAttribute('data-tap');
    node.removeAttribute('data-variant');
    node.removeAttribute('data-learned');
    node.removeAttribute('data-stopped');
    node.removeAttribute('data-plan');
    node.replaceChildren();
    fillIntro(node, data);
    mountTimeRadios(node);
    if (resetFailedOn) insertResetFailedLine();
    focusIntroTitle();
  }

  function dismissResetFailed() {
    resetFailedOn = false;
    resetFailedDone = true;
    if (!node || typeof node.querySelector !== 'function') return;
    const line = node.querySelector('[data-testid="reset-failed"]');
    if (line && typeof line.remove === 'function') line.remove();
  }

  function insertResetFailedLine() {
    if (!resetFailedOn || !node) return;
    const sentence = textOf(ui.resetFailed);
    if (!sentence) return;
    const title = node.querySelector('[data-testid="intro-title"]');
    let line = node.querySelector('[data-testid="reset-failed"]');
    if (!line) {
      line = document.createElement('p');
      line.className = 'l14-reset-failed';
      line.setAttribute('data-testid', 'reset-failed');
    }
    line.textContent = sentence;
    if (title && title.parentNode === node) {
      const after = title.nextSibling;
      if (after !== line) node.insertBefore(line, after);
    } else if (line.parentNode !== node) {
      node.appendChild(line);
    }
  }

  function focusIntroTitle() {
    if (!node || typeof node.querySelector !== 'function') return null;
    const title = node.querySelector('[data-testid="intro-title"]');
    if (!title) return null;
    if (title.getAttribute('tabindex') == null) title.setAttribute('tabindex', '-1');
    if (typeof title.focus === 'function') {
      try { title.focus(); } catch { /* ignore */ }
    }
    return title;
  }

  // Failed clear only. Focus the title, then append text nodes once.
  function announceResetFailedOnce() {
    if (!resetFailedOn || resetFailedSpoke) return;
    const sentence = textOf(ui.resetFailed);
    if (!sentence) return;
    const title = focusIntroTitle();
    resetFailedSpoke = true;
    const region = ensureLive();
    const titleText = title ? textOf(title.textContent) : '';
    if (titleText) region.appendChild(document.createTextNode(titleText));
    region.appendChild(document.createTextNode(sentence));
  }

  function continueResume() {
    if (disposed || !resumeOpen) return;
    const saved = pendingResume;
    const snap = pendingRun;
    const actIndex = resumeActIndex(saved);
    closeResumeUi();
    const resumed = resumeFrom(normalizeRun(snap), data) || resumeFrom(syntheticSnap(actIndex), data);
    if (!resumed) {
      beginRun({ mode: pickedMode, playIndex });
      return;
    }
    beginRun({ mode: resumed.mode, playIndex: 0, from: resumed });
  }

  function restartResume() {
    if (disposed || !resumeOpen) return;
    // Drop the dialog reason before the intro is painted. Do not leave wait.
    keepResumeOffer = false;
    setPause('resume-offer', false);
    // Each new attempt can show and speak the line again. Repaint does not come through here.
    resetFailedDone = false;
    const faults = [];
    try { saver.clearResume(bookId, levelId); } catch (err) { faults.push(err); }
    try { saver.clearLevelRun(bookId, levelId); } catch (err) { faults.push(err); }
    // Section 10: still return to the intro. Either failed clear shows the line, then rethrow.
    if (faults.length > 0 && !resetFailedDone) {
      resetFailedOn = true;
      resetFailedSpoke = false;
    }
    showIntro();
    if (resetFailedOn) announceResetFailedOnce();
    if (faults.length === 1) throw faults[0];
    if (faults.length > 1) {
      const parts = [];
      for (let i = 0; i < faults.length; i += 1) {
        const err = faults[i];
        parts.push(err && typeof err.message === 'string' && err.message !== '' ? err.message : String(err));
      }
      throw new AggregateError(faults, parts.join('\n'));
    }
  }

  function onResumeKey(event) {
    if (!resumeOpen || disposed || !node) return;
    const dialog = node.querySelector('[data-testid="resume-dialog"]');
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      continueResume();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = dialog.querySelectorAll('button');
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function showResumeDialog(actNo) {
    resumeOpen = true;
    if (clock) clock.pause();
    keepResumeOffer = false;
    releaseClock();
    clearTimers();
    cancelRafs();
    // Reason before the dialog is painted. The clock stays down while the offer is open.
    keepResumeOffer = true;
    setPause('resume-offer', true);
    const header = makeHeader(false).header;
    const mask = document.createElement('div');
    mask.className = 'l14-mask';
    mask.setAttribute('data-testid', 'resume-dialog');
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-labelledby', 'l14-resume-title');
    const panel = document.createElement('div');
    panel.className = 'l14-panel';
    const title = document.createElement('p');
    title.id = 'l14-resume-title';
    title.setAttribute('data-testid', 'resume-text');
    title.textContent = fillX(ui.resumePrompt, [actNo]);
    const actions = document.createElement('div');
    actions.className = 'l14-actions';
    const go = makeAction(textOf(ui.resumeContinue), 'resume-continue', true);
    const fresh = makeAction(textOf(ui.resumeRestart), 'resume-restart', false);
    actions.append(go, fresh);
    panel.append(title, actions);
    mask.appendChild(panel);
    node.replaceChildren(header, mask);
    node.setAttribute('data-screen', 'resume');
    node.removeAttribute('data-phase');
    node.setAttribute('data-timer', 'off');
    node.setAttribute('data-locked', 'false');
    els = null;
    viewMode = 'resume';
    paintedKey = '';
    if (typeof go.focus === 'function') go.focus();
  }

  function offerResume() {
    if (params.seq) return;
    let saved = null;
    let snap = null;
    try { saved = readResume(bookId, levelId); } catch { saved = null; }
    try { snap = readLevelRun(bookId, levelId); } catch { snap = null; }
    const actIndex = resumeActIndex(saved);
    if (actIndex < 0) return;
    pendingResume = saved;
    pendingRun = snap;
    showResumeDialog(actIndex + 1);
  }

  function makeSumMark(type) {
    const view = tagView(type);
    const badge = document.createElement('span');
    badge.className = 'l14-sum-mark';
    badge.style.background = view.color;
    if (view.dots) badge.appendChild(makeDots());
    else {
      const icon = document.createElement('img');
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.draggable = false;
      icon.width = 16;
      icon.height = 16;
      setImgSrc(icon, view.icon);
      badge.appendChild(icon);
    }
    return badge;
  }

  function openScreen(state, screen, withActLabel) {
    releaseClock();
    clearTimers();
    holdDialog = false;
    placeAttrs(state);
    node.setAttribute('data-screen', screen);
    node.setAttribute('data-locked', 'false');
    node.removeAttribute('data-phase');
    node.setAttribute('data-timer', 'off');
    const made = makeHeader(withActLabel);
    if (made.actLabel) {
      made.actLabel.textContent = actLabelText(ui.actLabel, state.act, actCount(data));
    }
    return made.header;
  }

  function showActSummary(state) {
    const header = openScreen(state, 'actSummary', true);
    const summary = actSummary(state) || { rows: [], line: '', scoreLine: '' };
    const sheet = document.createElement('div');
    sheet.className = 'l14-sheet';

    const title = document.createElement('h2');
    title.className = 'l14-act-done';
    title.setAttribute('data-testid', 'act-done');
    title.textContent = textOf(summary.line);

    const score = document.createElement('p');
    score.className = 'l14-act-score';
    score.setAttribute('data-testid', 'act-score');
    score.textContent = textOf(summary.scoreLine);

    const list = document.createElement('ul');
    list.className = 'l14-rows';
    list.setAttribute('data-testid', 'act-rows');
    const rows = Array.isArray(summary.rows) ? summary.rows : [];
    const count = rows.length > 3 ? 3 : rows.length;
    for (let i = 0; i < count; i += 1) {
      const view = summaryRowView(rows[i], typeTag);
      const li = document.createElement('li');
      li.className = 'l14-row';
      li.setAttribute('data-testid', 'act-row');
      li.setAttribute('data-type', view.type);
      const choice = document.createElement('p');
      choice.className = 'l14-row-choice';
      choice.textContent = view.choice;
      const meta = document.createElement('p');
      meta.className = 'l14-row-meta';
      const parts = [];
      if (view.tag) parts.push(view.tag);
      const changes = Array.isArray(view.changes) ? view.changes : [];
      for (let c = 0; c < changes.length; c += 1) {
        if (changes[c]) parts.push(changes[c]);
      }
      meta.textContent = parts.join(' ');
      li.append(makeSumMark(view.type), choice, meta);
      list.appendChild(li);
    }
    sheet.append(title, score, list);

    const foot = document.createElement('div');
    foot.className = 'l14-foot';
    const buttons = buttonBag();
    foot.appendChild(makeAction(textOf(buttons && buttons.next), 'act-next', true));
    node.replaceChildren(header, sheet, foot);
    els = null;
    viewMode = 'hold';
    paintedKey = '';
    queueAuto(state);
  }

  function shownMode() {
    if (run && typeof run.mode === 'string' && run.screen !== 'opening') return normalizeMode(run.mode);
    return pickedMode;
  }

  // Selected gear on the node (std/calm/off). Resume copies this from beginRun, not storage.
  function stampTimeMode() {
    if (!node) return;
    node.setAttribute('data-time-mode', pickedMode);
  }

  function paintHintLine() {
    if (!node || !run || run.screen !== 'hint') return;
    const line = node.querySelector('[data-testid="hint-line"]');
    if (line) line.textContent = hintText(data, run);
  }

  // 挂在关卡根节点外：重画提示屏不会把已经播过的句子清掉再堆一次。
  function ensureLive() {
    if (live && live.isConnected) return live;
    const stale = document.getElementById('l14-sr-live');
    if (stale) stale.remove();
    live = document.createElement('div');
    live.id = 'l14-sr-live';
    live.className = 'visually-hidden';
    live.setAttribute('data-testid', 'sr-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    // 后加的句子单独读。atomic 开着会把前面的提示句再读一遍。
    live.setAttribute('aria-atomic', 'false');
    live.style.position = 'fixed';
    live.style.top = '0';
    live.style.left = '0';
    live.style.width = '1px';
    live.style.height = '1px';
    live.style.overflow = 'hidden';
    live.style.clip = 'rect(0, 0, 0, 0)';
    live.style.whiteSpace = 'nowrap';
    live.style.pointerEvents = 'none';
    const liveHost = node && node.parentNode;
    if (liveHost) liveHost.insertBefore(live, node.nextSibling);
    else document.body.appendChild(live);
    return live;
  }

  // 打开单选时播一次。改选只改看得见的提示句，不改播报区。
  // 限时开始和剩 10 秒跟这句共用一个区：往后面加，不把还没读完的换掉。
  function sayLive(text) {
    const sentence = typeof text === 'string' ? text : '';
    if (!sentence) return;
    const region = ensureLive();
    const piece = document.createElement('span');
    piece.textContent = sentence;
    region.appendChild(piece);
  }

  function announceHintOnce() {
    if (spokeThisHint || !run) return;
    spokeThisHint = true;
    const region = ensureLive();
    region.replaceChildren(document.createTextNode(hintText(data, run)));
  }

  function focusCheckedRadio() {
    if (!node || typeof node.querySelector !== 'function') return;
    const on = node.querySelector('[data-testid="time-mode"] [role="radio"][aria-checked="true"]');
    if (on && typeof on.focus === 'function') on.focus();
  }

  function expandHintRadios() {
    if (!node || !run || run.screen !== 'hint') return;
    const slot = node.querySelector('[data-slot="time-mode"]');
    if (!slot) return;
    const change = node.querySelector('[data-testid="hint-change"]');
    const open = slot.getAttribute('data-open') === 'true' && slot.querySelector('[role="radiogroup"]');
    if (open) {
      if (change) change.setAttribute('aria-expanded', 'true');
      return;
    }
    slot.hidden = false;
    slot.setAttribute('data-open', 'true');
    if (change) change.setAttribute('aria-expanded', 'true');
    if (!slot.querySelector('[role="radiogroup"]')) mountTimeRadios(node, { focus: true });
    else focusCheckedRadio();
    announceHintOnce();
  }

  function showHint(state) {
    const which = Number(state.hintWhich);
    // 同一屏重画不再播。换到下一屏（入口一再到入口二）才再播一次。
    const redraw = !!(node
      && node.getAttribute('data-screen') === 'hint'
      && node.getAttribute('data-hint-which') === String(which));
    if (!redraw) spokeThisHint = false;
    const header = openScreen(state, 'hint', true);
    const sheet = document.createElement('div');
    sheet.className = 'l14-sheet';
    const line = document.createElement('p');
    line.className = 'l14-hint-line';
    line.setAttribute('data-testid', 'hint-line');
    line.textContent = hintText(data, state);
    const slot = document.createElement('div');
    slot.className = 'l14-timemode';
    slot.id = 'l14-hint-time';
    slot.setAttribute('data-slot', 'time-mode');
    const opened = which === 2;
    if (!opened) slot.hidden = true;
    slot.setAttribute('data-open', opened ? 'true' : 'false');
    sheet.append(line, slot);
    const foot = document.createElement('div');
    foot.className = 'l14-foot';
    const buttons = buttonBag();
    if (which === 1) {
      const change = makeAction(textOf(ui.changeTime), 'hint-change', false);
      change.setAttribute('aria-expanded', 'false');
      change.setAttribute('aria-controls', 'l14-hint-time');
      foot.appendChild(change);
    }
    foot.appendChild(makeAction(textOf(buttons && buttons.next), 'hint-next', true));
    node.replaceChildren(header, sheet, foot);
    node.setAttribute('data-hint-which', String(which));
    els = null;
    viewMode = 'hold';
    paintedKey = '';
    if (opened) {
      mountTimeRadios(node, { focus: true });
      announceHintOnce();
    }
    queueAuto(state);
  }

  function appendEndingArt(host, id) {
    const art = endingArt(id);
    const cell = document.createElement('div');
    cell.className = 'l14-ending-art';
    cell.setAttribute('data-testid', 'ending-art');
    cell.setAttribute('data-ending', typeof id === 'string' ? id : '');
    if (art.kind === 'badge') {
      const badge = document.createElement('span');
      badge.className = 'l14-ending-badge';
      if (art.color) badge.style.background = art.color;
      const size = art.height > 0 ? art.height : 96;
      badge.style.width = String(size) + 'px';
      badge.style.height = String(size) + 'px';
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.draggable = false;
      img.width = 64;
      img.height = 64;
      setImgSrc(img, art.icon);
      badge.appendChild(img);
      cell.appendChild(badge);
    } else {
      const img = document.createElement('img');
      img.className = 'l14-ending-img';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.draggable = false;
      if (art.height > 0) img.height = art.height;
      if (id === 'empowered') img.width = 144;
      setImgSrc(img, art.icon);
      cell.appendChild(img);
    }
    host.appendChild(cell);
  }

  function paintStars(stars) {
    const row = document.createElement('div');
    row.className = 'l14-stars';
    row.setAttribute('data-testid', 'stars');
    row.setAttribute('role', 'img');
    const shown = stars == null ? 0 : stars;
    row.setAttribute('aria-label', fillX(STARS_SR, [shown, 3]));
    const marks = starRow(shown, 3);
    for (let i = 0; i < marks.length; i += 1) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.draggable = false;
      img.width = 24;
      img.height = 24;
      setImgSrc(img, marks[i] === 'on' ? 'ui-star-on.svg' : 'ui-star-off.svg');
      row.appendChild(img);
    }
    return row;
  }

  function setLearned(open) {
    if (!node) return;
    node.setAttribute('data-learned', open ? 'open' : 'closed');
    const btn = node.querySelector('[data-testid="learned"]');
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.replaceChildren();
    if (!open) {
      btn.textContent = textOf(ui.learnedCollapsed);
      return;
    }
    const learned = data && data.learned && typeof data.learned === 'object' ? data.learned : null;
    const summary = document.createElement('span');
    summary.textContent = textOf(learned && learned.summary);
    const tomorrow = document.createElement('span');
    tomorrow.textContent = textOf(learned && learned.tomorrow);
    const note = document.createElement('span');
    note.textContent = textOf(learned && learned.disclaimer);
    btn.append(summary, tomorrow, note);
  }

  function armLearned() {
    if (learnedTimer) {
      clearTimeout(learnedTimer);
      timers.delete(learnedTimer);
      learnedTimer = 0;
    }
    const tid = setTimeout(function () {
      timers.delete(tid);
      if (learnedTimer === tid) learnedTimer = 0;
      if (disposed || !node) return;
      if (node.getAttribute('data-screen') !== 'settle') return;
      if (node.getAttribute('data-learned') !== 'open') return;
      setLearned(false);
    }, 2000);
    learnedTimer = tid;
    timers.add(tid);
  }

  function toggleLearned() {
    if (learnedTimer) {
      clearTimeout(learnedTimer);
      timers.delete(learnedTimer);
      learnedTimer = 0;
    }
    const open = node && node.getAttribute('data-learned') === 'open';
    setLearned(open !== true);
  }

  // Two block lines, not a newline character. textContent stays one sentence,
  // and presentation spans are not named, so a screen reader reads the original.
  function fillEndingBody(el, endingId, raw) {
    const sentence = textOf(raw);
    const lines = endingBodyLines(endingId, sentence);
    if (!lines) {
      el.textContent = sentence;
      return;
    }
    const head = document.createElement('span');
    head.className = 'l14-ending-line';
    head.setAttribute('role', 'presentation');
    head.textContent = lines[0];
    const tail = document.createElement('span');
    tail.className = 'l14-ending-line';
    tail.setAttribute('role', 'presentation');
    tail.textContent = lines[1];
    el.replaceChildren(head, tail);
  }

  function showSettle(state) {
    // 只做一次：先读已见结局和连败次数，开关开着也读。结局用局面里已有的 ending、stars、pass、short。再排动作表，交给 saver，最后用刚读到的已见结局画两行。
    const faults = [];
    if (!settleOnce) {
      settleOnce = true;
      planAuto = false;
      seenBefore = readSeenEndings(bookId, levelId);
      const failStreak = readFailStreak(bookId, levelId);
      const stars = state.stars;
      const short = state.short;
      const ending = state.ending;
      const plan = settlePlan({
        passed: state.pass,
        stars,
        short,
        ending,
        failStreak,
        autoUnlockAfter: fail.autoUnlockAfter,
        seenEndingsOn: data && data.seenEndingsOn,
        hookOn: hookOn()
      });
      // 这一局已经结束。没过的动作表不清中途记录，这里两种结局都清。
      // A failed clear still finishes the plan and the settle screen, then rethrows.
      try { saver.clearResume(bookId, levelId); } catch (err) { faults.push(err); }
      try { saver.clearLevelRun(bookId, levelId); } catch (err) { faults.push(err); }
      saver.applyPlan(bookId, levelId, plan, api);
      const ops = [];
      for (let i = 0; i < plan.length; i += 1) {
        const action = plan[i];
        if (!action || typeof action.op !== 'string' || action.op === '') continue;
        ops.push(action.op);
        if (action.op === 'markAutoUnlocked') planAuto = true;
      }
      if (node) node.setAttribute('data-plan', ops.join(','));
    }
    const header = openScreen(state, 'settle', false);
    const sheet = document.createElement('div');
    sheet.className = 'l14-sheet';
    const endingId = typeof state.ending === 'string' ? state.ending : '';
    appendEndingArt(sheet, endingId);

    const endings = data && data.endings && typeof data.endings === 'object' ? data.endings : {};
    const endingRow = endings[endingId] && typeof endings[endingId] === 'object' ? endings[endingId] : {};
    const passed = state.pass === true;
    const lines = resultLines({
      passed: state.pass,
      stars: state.stars,
      ending: state.ending,
      seenBefore,
      known: ENDING_IDS,
      ui,
      fail,
      endings: data && data.endings
    });

    const title = document.createElement('h2');
    title.className = 'l14-ending-name';
    title.setAttribute('data-testid', 'ending-name');
    title.textContent = lines.first;

    const body = document.createElement('p');
    body.className = 'l14-ending-body';
    body.setAttribute('data-testid', 'ending-body');
    fillEndingBody(body, endingId, endingRow.body);

    const bars = state.bars && typeof state.bars === 'object' ? state.bars : {};
    const morale = bars.morale != null ? bars.morale : 0;
    const result = bars.result != null ? bars.result : 0;
    const stats = document.createElement('p');
    stats.className = 'l14-stats';
    stats.setAttribute('data-testid', 'stats');
    stats.textContent = fillX(ui.statsLine, [morale, result]);

    const last = document.createElement('p');
    last.className = 'l14-result-last';
    last.setAttribute('data-testid', 'result-last');
    last.setAttribute('data-slot', 'result-last');
    last.textContent = lines.last;

    sheet.append(title, body, paintStars(state.stars), stats, last);

    const foot = document.createElement('div');
    foot.className = 'l14-foot';
    if (planAuto) {
      const note = document.createElement('p');
      note.className = 'l14-auto-unlock';
      note.setAttribute('data-testid', 'auto-unlock');
      note.setAttribute('role', 'status');
      note.textContent = textOf(fail.autoUnlockBody);
      // Above the buttons (item 49).
      foot.insertBefore(note, foot.firstChild);
    }
    const actions = document.createElement('div');
    actions.className = 'l14-actions';
    const buttons = buttonBag();
    if (passed) {
      actions.append(
        makeAction(textOf(buttons && buttons.backToMap), 'to-map', true),
        makeAction(textOf(buttons && buttons.replay), 'replay', false)
      );
    } else {
      actions.append(
        makeAction(textOf(buttons && buttons.retry), 'retry', true),
        makeAction(textOf(buttons && buttons.backToMap), 'to-map', false)
      );
    }
    const learnedBtn = document.createElement('button');
    learnedBtn.type = 'button';
    learnedBtn.className = 'l14-learned';
    learnedBtn.setAttribute('data-testid', 'learned');
    foot.append(actions, learnedBtn);
    node.replaceChildren(header, sheet, foot);
    els = null;
    viewMode = 'hold';
    paintedKey = '';
    setLearned(true);
    armLearned();
    queueAuto(state);
    if (faults.length === 1) throw faults[0];
    if (faults.length > 1) {
      const parts = [];
      for (let i = 0; i < faults.length; i += 1) {
        const err = faults[i];
        parts.push(err && typeof err.message === 'string' && err.message !== '' ? err.message : String(err));
      }
      throw new AggregateError(faults, parts.join('\n'));
    }
  }

  function goNext() {
    if (!run) return;
    if (run.screen !== 'actSummary' && run.screen !== 'hint') return;
    cancelRafs();
    run = step(run, { type: 'next', at: performance.now() });
    paint(run);
  }

  function dropTapLayer() {
    if (!node) return;
    const layer = node.querySelector('[data-testid="tap-hint"]');
    if (layer) layer.remove();
  }

  function openTap() {
    if (tapSeen || !els || !els.stage || !node) return;
    if (node.getAttribute('data-tap') === 'done') return;
    tapSeen = true;
    node.setAttribute('data-tap', 'open');
    const layer = document.createElement('div');
    layer.className = 'l14-tap';
    layer.setAttribute('data-testid', 'tap-hint');
    layer.setAttribute('role', 'note');
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.width = 48;
    img.height = 48;
    img.draggable = false;
    setImgSrc(img, 'l11-icon-tap.svg');
    const caption = document.createElement('span');
    caption.textContent = textOf(data && data.tapHint);
    layer.append(img, caption);
    els.stage.appendChild(layer);
    const list = els.choices.querySelectorAll('[data-testid="option"]');
    for (const btn of list) btn.setAttribute('aria-disabled', 'true');
  }

  function closeTap() {
    if (!node || node.getAttribute('data-tap') !== 'open') return;
    dropTapLayer();
    node.setAttribute('data-tap', 'done');
    if (!els || !els.choices) return;
    if (node.getAttribute('data-locked') === 'true') return;
    const list = els.choices.querySelectorAll('[data-testid="option"]');
    for (const btn of list) btn.removeAttribute('aria-disabled');
  }

  function reduceMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  }

  function floatId(barId) {
    if (barId === 'morale') return 'float-morale';
    if (barId === 'result') return 'float-result';
    return 'float-' + barId;
  }

  function spawnFloat(barId, label, up) {
    const meter = els && els.meters ? els.meters[barId] : null;
    if (!meter) return;
    const prev = meter.root.querySelector('[data-testid="' + floatId(barId) + '"]');
    if (prev) prev.remove();
    const span = document.createElement('span');
    span.className = 'l14-float';
    span.setAttribute('data-testid', floatId(barId));
    span.setAttribute('aria-hidden', 'true');
    const arrow = document.createElement('i');
    arrow.className = up ? 'l14-arrow is-up' : 'l14-arrow is-down';
    arrow.setAttribute('aria-hidden', 'true');
    span.appendChild(arrow);
    span.appendChild(document.createTextNode(label));
    let tid = 0;
    let gone = false;
    const drop = () => {
      if (gone) return;
      gone = true;
      if (tid) {
        clearTimeout(tid);
        timers.delete(tid);
      }
      span.remove();
    };
    span.addEventListener('animationend', drop);
    meter.root.appendChild(span);
    tid = setTimeout(drop, 1200);
    timers.add(tid);
  }

  function showFloats(delta) {
    if (!delta || !els || !els.meters || reduceMotion()) return;
    const bars = data && Array.isArray(data.bars) ? data.bars : [];
    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      if (!bar || typeof bar.id !== 'string') continue;
      const raw = Number(delta[bar.id]);
      if (!Number.isFinite(raw) || raw === 0) continue;
      spawnFloat(bar.id, formatDelta(raw, ui.zeroDelta), raw > 0);
    }
  }

  function advance() {
    if (!run || run.screen !== 'consequence') return;
    cancelRafs();
    const pending = run.pending;
    const delta = pending && pending.delta ? pending.delta : null;
    releaseClock();
    run = step(run, { type: 'close', at: performance.now() });
    paint(run);
    if (viewMode === 'play') showFloats(delta);
  }

  function onClick(event) {
    if (disposed || !node) return;
    const origin = event.target;
    if (!origin || typeof origin.closest !== 'function') return;

    // Dismiss consumes the click so it is not an option pick.
    if (node.getAttribute('data-tap') === 'open') {
      closeTap();
      return;
    }

    const back = origin.closest('[data-act="back"]');
    if (back && node.contains(back)) {
      if (api && typeof api.exit === 'function') api.exit();
      return;
    }

    if (resumeOpen) {
      const go = origin.closest('[data-testid="resume-continue"]');
      if (go && node.contains(go)) {
        continueResume();
        return;
      }
      const fresh = origin.closest('[data-testid="resume-restart"]');
      if (fresh && node.contains(fresh)) {
        restartResume();
        return;
      }
      return;
    }

    const screen = node.getAttribute('data-screen');
    if (screen === 'intro') {
      const hit = origin.closest('[data-testid="start"]');
      if (!hit || !node.contains(hit)) return;
      // l14time 在测试开关打开时盖过单选。l14t 在 paintTimeRow 里再缩短倒计时。
      const mode = params.time || pickedMode;
      beginRun({ mode, playIndex });
      return;
    }

    if (screen === 'hint') {
      const change = origin.closest('[data-testid="hint-change"]');
      if (change && node.contains(change)) {
        expandHintRadios();
        return;
      }
    }

    if (screen === 'actSummary' || screen === 'hint') {
      const id = screen === 'actSummary' ? 'act-next' : 'hint-next';
      const hit = origin.closest('[data-testid="' + id + '"]');
      if (hit && node.contains(hit)) goNext();
      return;
    }

    if (screen === 'settle') {
      const learnedHit = origin.closest('[data-testid="learned"]');
      if (learnedHit && node.contains(learnedHit)) {
        toggleLearned();
        return;
      }
      const mapHit = origin.closest('[data-testid="to-map"]');
      if (mapHit && node.contains(mapHit)) {
        if (api && typeof api.exit === 'function') api.exit();
        return;
      }
      const replayHit = origin.closest('[data-testid="replay"]');
      const retryHit = origin.closest('[data-testid="retry"]');
      if ((replayHit && node.contains(replayHit)) || (retryHit && node.contains(retryHit))) {
        const mode = run && run.mode;
        playIndex += 1;
        beginRun({ mode, playIndex });
        return;
      }
      return;
    }

    if (screen !== 'node') return;

    const pauseHit = origin.closest('[data-testid="pause"]');
    if (pauseHit && node.contains(pauseHit)) {
      onPauseClick(pauseHit);
      return;
    }

    const go = origin.closest('[data-testid="consequence-continue"]');
    if (go && node.contains(go)) {
      advance();
      return;
    }

    if (node.getAttribute('data-locked') === 'true') return;
    if (run && (run.locked === true || run.screen !== 'node')) return;

    const opt = origin.closest('[data-testid="option"]');
    if (!opt || !node.contains(opt)) return;
    if (opt.getAttribute('aria-disabled') === 'true') return;
    choose(opt.getAttribute('data-option'));
  }

  function mountTimeRadios(host, opts) {
    const focusSelected = !!(opts && opts.focus === true);
    const slot = host && typeof host.querySelector === 'function'
      ? host.querySelector('[data-slot="time-mode"]')
      : null;
    if (!slot) return;
    slot.replaceChildren();
    const choices = timeModeChoices(data, ui);
    const label = document.createElement('p');
    label.className = 'l14-time-label';
    label.id = 'l14-time-label';
    label.setAttribute('data-testid', 'time-label');
    label.textContent = textOf(ui.timeMode);
    const group = document.createElement('div');
    group.className = 'l14-time-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    group.setAttribute('data-testid', 'time-mode');
    const buttons = [];
    for (let i = 0; i < choices.length; i += 1) {
      const choice = choices[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'l14-time-opt';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('data-mode', choice.id);
      btn.setAttribute('data-testid', 'time-' + choice.id);
      btn.setAttribute('aria-label', choice.label);
      const lines = Array.isArray(choice.lines) ? choice.lines : [];
      for (let j = 0; j < lines.length; j += 1) {
        const span = document.createElement('span');
        span.className = j === 0 ? 'l14-time-name' : 'l14-time-sec';
        span.textContent = textOf(lines[j]);
        btn.appendChild(span);
      }
      buttons.push(btn);
      group.appendChild(btn);
    }
    const note = document.createElement('p');
    note.className = 'l14-time-note';
    note.setAttribute('data-testid', 'time-note');
    note.textContent = textOf(ui.timeNote);
    slot.append(label, group, note);

    function applyMode(id, focusIt) {
      const want = normalizeMode(id);
      const known = choices.some((row) => row.id === want);
      if (!known) return;
      pickedMode = want;
      stampTimeMode();
      // 开局以后改选走局面，后面的限时节点按新的秒数给。开场屏还没有 run。
      if (run && run.screen === 'hint' && run.mode !== want) {
        run = step(run, { type: 'mode', mode: want, at: performance.now() });
        paintHintLine();
        noteProgress(run);
      }
      for (let i = 0; i < buttons.length; i += 1) {
        const btn = buttons[i];
        const on = btn.getAttribute('data-mode') === pickedMode;
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        btn.setAttribute('tabindex', on ? '0' : '-1');
        if (on && focusIt) btn.focus();
      }
    }

    function onTimeClick(event) {
      const origin = event.target;
      if (!origin || typeof origin.closest !== 'function') return;
      const radio = origin.closest('[role="radio"]');
      if (!radio || !group.contains(radio)) return;
      applyMode(radio.getAttribute('data-mode'), false);
    }

    function onTimeKey(event) {
      const origin = event.target;
      if (!origin || typeof origin.closest !== 'function') return;
      const radio = origin.closest('[role="radio"]');
      if (!radio || !group.contains(radio)) return;
      const key = event.key;
      const ids = [];
      for (let i = 0; i < choices.length; i += 1) ids.push(choices[i].id);
      const index = ids.indexOf(radio.getAttribute('data-mode'));
      const at = index < 0 ? 0 : index;
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        const step = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
        applyMode(ids[(at + step + ids.length) % ids.length], true);
        return;
      }
      if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        applyMode(radio.getAttribute('data-mode'), true);
      }
    }

    applyMode(shownMode(), focusSelected);
    group.addEventListener('click', onTimeClick);
    group.addEventListener('keydown', onTimeKey);
  }

  ensureCss();
  node = document.createElement('div');
  node.className = 'l14';
  if (hookOn()) {
    node.repaintIntro = showIntro;
    node.reofferResume = offerResume;
    node.setPauseLook = setPauseLook;
    node.readPause = function () {
      return { pauseState: pauseState, armHeld: armHeld === true };
    };
  }
  node.setAttribute('data-testid', 'level');
  node.setAttribute('aria-live', 'off');
  node.setAttribute('data-hook', hookOn() ? 'on' : 'off');
  node.setAttribute('data-pause-reasons', '');
  fillIntro(node, data);
  mountTimeRadios(node);
  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('click', onClick);
    listeners.push({ target: root, type: 'click', fn: onClick });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', onResumeKey);
    listeners.push({ target: document, type: 'keydown', fn: onResumeKey });
    // Before any countdown listener, so a later show cannot resume ahead of the reason set.
    document.addEventListener('visibilitychange', onVisibility);
    listeners.push({ target: document, type: 'visibilitychange', fn: onVisibility });
  }
  if (root && typeof root.appendChild === 'function') root.appendChild(node);
  saver.clearOrphanRun(bookId, levelId);
  offerResume();
  return unmount;
}
