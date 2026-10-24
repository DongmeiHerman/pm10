import { insertSaveFailNote, resetSaveFailure } from '../../../js/save-fail.js';
import { testHookOn } from '../../../js/test-hook.js';
import { STARS_SR, uiText } from '../../../js/ui-text.js';
import { computeBars, kindsFromWall } from './logic/bars.js';
import { dragAllowed, dragThresholdExceeded } from './logic/drag.js';
import { settlePlan } from './logic/settle.js';
import { countResults, starsFromResultCount } from './logic/stars.js';
import {
  initialPoolIds,
  stickerCatalog,
  swapPoolForReplay
} from './logic/replay-swap.js';
import {
  emptyWall,
  filledCount,
  moveDown,
  moveOut,
  moveUp,
  pasteSticker,
  pasteStickerAt,
  startGate,
  swapSlots
} from './logic/wall.js';
import {
  buildRunSnapshot,
  restoreFromRun,
  resumeScreenNumber,
  stageIdFromScreen,
  stageLabel
} from './logic/run-snapshot.js';
import { createStorageSaver } from './save.js';
import { L05_UI_DEFAULTS } from './ui-defaults.js';

const ownHref = (name) => new URL(`./assets/${name}`, import.meta.url).href;
const shared = (name) => new URL(`../level-01/assets/${name}`, import.meta.url).href;
const uiHref = (name) => new URL(`../../../assets/ui/${name}`, import.meta.url).href;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function fillTokens(template, map) {
  return String(template == null ? '' : template).replace(/\{([a-zA-Z]+)\}/g, (all, key) => {
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return all;
    const v = map[key];
    return v == null ? '' : String(v);
  });
}

function fillX(template, values) {
  const list = Array.isArray(values) ? values : (values == null ? [] : [values]);
  let i = 0;
  return String(template == null ? '' : template).replace(/×/g, () => {
    if (i >= list.length) return '';
    const v = list[i];
    i += 1;
    return v == null ? '' : String(v);
  });
}

function ensureCss() {
  if (document.getElementById('l05-css')) return;
  const link = document.createElement('link');
  link.id = 'l05-css';
  link.rel = 'stylesheet';
  link.href = new URL('./level.css', import.meta.url).href;
  document.head.appendChild(link);
}

function stickerById(stickers, id) {
  const list = Array.isArray(stickers) ? stickers : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item && item.id === id) return item;
  }
  return null;
}

function bossFile(stars) {
  if (stars >= 3) return 'l11-boss-happy.svg';
  if (stars === 2) return 'l11-boss.svg';
  return 'l11-boss-frown.svg';
}

export function mount(root, meta, api) {
  let node = null;
  let live = null;
  let toastEl = null;
  let disposed = false;
  let settleOnce = false;
  let screen = 'intro';
  let phase = 'first';
  let wall = emptyWall(3);
  let pool = [];
  let selected = -1;
  let lastSnap = null;
  let learnedOpen = true;
  let readySpoken = false;
  let dragGuardUntil = 0;
  let dragGhost = null;
  let dragEpoch = 0;
  let resumeOpen = false;
  let pendingRun = null;
  let resetFailedOn = false;
  let resetFailedSpoke = false;
  let resetFailedDone = false;
  const timers = new Set();
  const data = api && api.data;
  const ui = uiText(data, L05_UI_DEFAULTS);
  const hookOn = () => {
    if (typeof location === 'undefined' || !location) return false;
    return testHookOn(location.hostname, location.search, 'l05test');
  };
  const saver = createStorageSaver();
  const bookId = (api && api.bookId) || (data && data.book) || 'inspired';
  const levelId = (api && api.levelId) || (data && data.id) || 'level-05';
  const stickers = data && Array.isArray(data.stickers) ? data.stickers : [];
  const replaySwap = data && data.replaySwap && typeof data.replaySwap === 'object' ? data.replaySwap : null;
  const catalog = stickerCatalog(stickers, replaySwap);
  const weights = data && Array.isArray(data.weights) ? data.weights : [3, 2, 1];
  const slots = data && Number.isInteger(data.wallSlots) && data.wallSlots > 0 ? data.wallSlots : 3;
  const buttons = data && data.buttons && typeof data.buttons === 'object' ? data.buttons : {};
  const intro = data && data.intro && typeof data.intro === 'object' ? data.intro : {};
  const toastMs = typeof ui.noteShowMs === 'number' && ui.noteShowMs > 0 ? ui.noteShowMs : 1500;

  function unmount() {
    if (disposed) return;
    disposed = true;
    dragEpoch += 1;
    clearDragGhost();
    clearTimers();
    if (node) {
      node.remove();
      node = null;
    }
    live = null;
    toastEl = null;
  }

  if (api && typeof api.bindUnmount === 'function') {
    try { api.bindUnmount(unmount); } catch { /* ignore */ }
  }

  function clearTimers() {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  }

  function later(fn, ms) {
    const tid = setTimeout(() => {
      timers.delete(tid);
      if (disposed) return;
      fn();
    }, ms);
    timers.add(tid);
    return tid;
  }

  function speak(msg) {
    if (!live || !msg) return;
    if (live.textContent === msg) live.textContent = '';
    live.textContent = msg;
  }

  function showToast(msg) {
    if (!toastEl || !msg) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    later(() => {
      if (!toastEl) return;
      toastEl.classList.remove('is-on');
    }, toastMs);
  }

  function kindLabel(kind, sr) {
    if (kind === 'result') return sr ? ui.srResult : ui.kindResult;
    return sr ? ui.srOutput : ui.kindOutput;
  }

  function snapshot() {
    const kinds = kindsFromWall(wall, catalog);
    const bars = computeBars(kinds, data && data.barFormula, weights);
    const resultN = countResults(kinds);
    const table = data && data.stars && data.stars.byResultCount;
    const stars = starsFromResultCount(resultN, table);
    const comments = data && data.comments && typeof data.comments === 'object' ? data.comments : {};
    return {
      bars,
      stars,
      resultCount: resultN,
      comment: textOf(comments[String(stars)])
    };
  }

  function applyFreshRound(nextPool) {
    wall = emptyWall(slots);
    pool = nextPool;
    selected = -1;
    phase = 'first';
    lastSnap = null;
    settleOnce = false;
    readySpoken = false;
    learnedOpen = true;
    screen = 'intro';
  }

  function resetRound() {
    applyFreshRound(initialPoolIds(stickers));
  }

  // Paste takes ids off `pool` and onto the wall. The round's 8 are the union.
  function roundIds() {
    const ids = [];
    const seen = new Set();
    const push = (id) => {
      if (typeof id !== 'string' || id === '' || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    for (let i = 0; i < pool.length; i += 1) push(pool[i]);
    for (let i = 0; i < wall.length; i += 1) push(wall[i]);
    return ids;
  }

  function replayRandom() {
    if (api && typeof api.random === 'function') return api.random;
    return Math.random;
  }

  function makeImg(src, cls) {
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.draggable = false;
    if (cls) img.className = cls;
    img.src = src;
    return img;
  }

  function makeBtn(label, testId, act, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.draggable = false;
    btn.className = primary ? 'l05-primary' : 'l05-secondary';
    if (testId) btn.setAttribute('data-testid', testId);
    if (act) btn.setAttribute('data-act', act);
    btn.textContent = label;
    return btn;
  }

  function headerTitle() {
    if (resumeOpen || screen === 'intro') return textOf(intro.title) || textOf(meta && meta.title);
    if (screen === 'paste') return ui.wallTitle;
    if (screen === 'bars') return ui.stageBars;
    if (screen === 'comment') return ui.stageComment;
    return textOf(intro.title) || textOf(meta && meta.title);
  }

  function paintHeader() {
    const header = document.createElement('header');
    header.className = 'l05-top';
    const back = document.createElement('button');
    back.type = 'button';
    back.draggable = false;
    back.className = 'l05-back';
    back.setAttribute('data-act', 'back');
    back.setAttribute('data-testid', 'back');
    back.setAttribute('aria-label', ui.back);
    back.append(makeImg(shared('ui-back.svg')), (() => {
      const sr = document.createElement('span');
      sr.className = 'visually-hidden';
      sr.textContent = ui.back;
      return sr;
    })());
    const title = document.createElement('h1');
    title.className = 'l05-title';
    title.setAttribute('tabindex', '-1');
    title.textContent = headerTitle();
    const note = document.createElement('p');
    note.className = 'l05-notimer';
    note.textContent = ui.noTimer;
    header.append(back, title, note);
    return { header, title };
  }

  function stickerButton(sticker, extra) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.draggable = false;
    btn.className = 'l05-sticker';
    const kind = sticker && sticker.kind === 'result' ? 'result' : 'output';
    btn.setAttribute('data-kind', kind);
    btn.setAttribute('data-testid', 'l05-sticker-' + sticker.id);
    btn.setAttribute('data-id', sticker.id);
    if (extra && extra.act) btn.setAttribute('data-act', extra.act);
    if (extra && extra.drag) btn.classList.add('is-draggable');
    if (extra && extra.slot != null) btn.setAttribute('data-slot', String(extra.slot));
    if (extra && extra.on) btn.classList.add('is-on');
    const icon = makeImg(
      ownHref(kind === 'result' ? 'l05-kind-result.svg' : 'l05-kind-output.svg')
    );
    const tag = document.createElement('span');
    tag.className = 'l05-kind';
    tag.textContent = kindLabel(kind, false);
    const label = document.createElement('span');
    label.className = 'l05-sticker-text';
    label.textContent = textOf(sticker && sticker.text);
    btn.append(icon, tag, label);
    if (extra && extra.sr) btn.setAttribute('aria-label', extra.sr);
    if (extra && extra.pressed) btn.setAttribute('aria-pressed', extra.pressed ? 'true' : 'false');
    return btn;
  }

  function paintIntro(main) {
    main.setAttribute('data-testid', 'l05-intro');
    main.append(makeImg(shared('l11-boss.svg'), 'l05-intro-boss'));
    const title = document.createElement('h2');
    title.className = 'l05-intro-title';
    title.setAttribute('data-testid', 'intro-title');
    title.setAttribute('tabindex', '-1');
    title.textContent = textOf(intro.title);
    const body = document.createElement('p');
    body.className = 'l05-body';
    body.textContent = textOf(intro.body);
    const go = makeBtn(textOf(buttons.goPaste || intro.button), 'l05-go-paste', 'go-paste', true);
    main.append(title, body, go);
    if (resetFailedOn) insertResetFailedLine(main, title);
  }

  function insertResetFailedLine(main, title) {
    const sentence = textOf(ui.resetFailed);
    if (!sentence) return;
    const line = document.createElement('p');
    line.className = 'l05-reset-failed';
    line.setAttribute('data-testid', 'reset-failed');
    line.textContent = sentence;
    if (title && title.parentNode === main && typeof main.insertBefore === 'function') {
      main.insertBefore(line, title.nextSibling);
    } else {
      main.appendChild(line);
    }
  }

  function paintPaste(main) {
    const dragOn = dragAllowed(node);
    const hint = document.createElement('p');
    hint.className = 'l05-hint';
    hint.textContent = phase === 'repost' ? ui.repostOnce : ui.pasteHint;
    const score = document.createElement('p');
    score.className = 'l05-score';
    score.textContent = ui.scoreRule;
    const wallEl = document.createElement('div');
    wallEl.className = 'l05-wall';
    wallEl.setAttribute('data-testid', 'l05-wall');
    for (let i = 0; i < slots; i += 1) {
      const slot = document.createElement('div');
      slot.className = 'l05-slot';
      slot.setAttribute('data-testid', 'l05-slot-' + i);
      const cap = document.createElement('p');
      cap.className = 'l05-slot-label';
      cap.textContent = fillTokens(ui.slotWeight, { n: i + 1, w: weights[i] });
      slot.appendChild(cap);
      const id = wall[i];
      const sticker = id ? stickerById(catalog, id) : null;
      if (sticker) {
        const sr = fillTokens(ui.srWallSlot, {
          n: i + 1,
          text: textOf(sticker.text),
          kind: kindLabel(sticker.kind, true)
        });
        slot.appendChild(stickerButton(sticker, {
          act: 'wall-sticker',
          slot: i,
          on: selected === i,
          pressed: selected === i,
          drag: dragOn,
          sr
        }));
      } else {
        const empty = document.createElement('div');
        empty.className = 'l05-empty';
        empty.setAttribute('data-act', 'empty-slot');
        empty.setAttribute('data-slot', String(i));
        empty.textContent = ui.slotEmpty;
        slot.appendChild(empty);
      }
      wallEl.appendChild(slot);
    }
    main.append(hint, score, wallEl);
    if (selected >= 0 && typeof wall[selected] === 'string') {
      const moves = document.createElement('div');
      moves.className = 'l05-moves';
      const up = document.createElement('button');
      up.type = 'button';
      up.draggable = false;
      up.className = 'l05-move';
      up.setAttribute('data-testid', 'l05-move-up');
      up.setAttribute('data-act', 'move-up');
      up.textContent = textOf(buttons.moveUp);
      up.setAttribute('aria-label', ui.srMoveUp);
      if (selected <= 0) up.setAttribute('aria-disabled', 'true');
      const down = document.createElement('button');
      down.type = 'button';
      down.draggable = false;
      down.className = 'l05-move';
      down.setAttribute('data-testid', 'l05-move-down');
      down.setAttribute('data-act', 'move-down');
      down.textContent = textOf(buttons.moveDown);
      down.setAttribute('aria-label', ui.srMoveDown);
      if (selected >= slots - 1) down.setAttribute('aria-disabled', 'true');
      const out = document.createElement('button');
      out.type = 'button';
      out.draggable = false;
      out.className = 'l05-move';
      out.setAttribute('data-testid', 'l05-move-out');
      out.setAttribute('data-act', 'move-out');
      out.textContent = textOf(buttons.moveOut);
      out.setAttribute('aria-label', ui.srMoveOut);
      moves.append(up, down, out);
      main.appendChild(moves);
    }
    const wrap = document.createElement('div');
    wrap.className = 'l05-pool-wrap';
    const poolTitle = document.createElement('p');
    poolTitle.className = 'l05-pool-title';
    poolTitle.textContent = ui.poolTitle;
    const poolEl = document.createElement('div');
    poolEl.className = 'l05-pool';
    poolEl.setAttribute('data-testid', 'l05-pool');
    for (let i = 0; i < pool.length; i += 1) {
      const sticker = stickerById(catalog, pool[i]);
      if (!sticker) continue;
      const sr = fillTokens(ui.srPoolItem, {
        text: textOf(sticker.text),
        kind: kindLabel(sticker.kind, true)
      });
      poolEl.appendChild(stickerButton(sticker, { act: 'pool-sticker', drag: dragOn, sr }));
    }
    wrap.append(poolTitle, poolEl);
    const dock = document.createElement('div');
    dock.className = 'l05-dock';
    const gate = startGate(filledCount(wall), slots);
    const need = document.createElement('p');
    need.className = 'l05-need';
    if (!gate.enabled) {
      need.textContent = gate.reasonKey === 'startNeedMore'
        ? fillTokens(ui.startNeedMore, { n: gate.remaining })
        : ui.startNeedFull;
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.draggable = false;
    start.className = 'l05-start';
    start.setAttribute('data-testid', 'l05-start');
    start.setAttribute('data-act', 'start');
    start.textContent = textOf(buttons.startQuarter);
    if (!gate.enabled) start.setAttribute('aria-disabled', 'true');
    dock.append(need, start);
    main.append(wrap, dock);
    if (gate.enabled && !readySpoken) {
      readySpoken = true;
      speak(ui.startReady);
    }
    if (!gate.enabled) readySpoken = false;
  }

  function barRank(self, other) {
    if (self > other) return 'high';
    if (self < other) return 'low';
    return 'tie';
  }

  function paintBarCol(id, label, raw, pct, rank, icon) {
    const col = document.createElement('div');
    col.className = 'l05-bar';
    col.setAttribute('data-id', id);
    col.setAttribute('data-testid', 'l05-bar-' + id);
    const track = document.createElement('div');
    track.className = 'l05-bar-track';
    const fill = document.createElement('span');
    fill.className = 'l05-bar-fill';
    let h = Number(pct);
    if (!Number.isFinite(h) || h < 0) h = 0;
    if (h > 100) h = 100;
    fill.style.height = String(h) + '%';
    track.appendChild(fill);
    const meta = document.createElement('div');
    meta.className = 'l05-bar-meta';
    const name = document.createElement('p');
    name.className = 'l05-bar-label';
    name.textContent = label;
    const num = document.createElement('p');
    num.className = 'l05-bar-num';
    num.textContent = String(raw);
    const rankEl = document.createElement('p');
    rankEl.className = 'l05-bar-rank';
    rankEl.setAttribute('data-rank', rank);
    rankEl.textContent = rank === 'high' ? ui.barHigh : (rank === 'low' ? ui.barLow : '');
    meta.append(makeImg(ownHref(icon), 'l05-bar-icon'), name, num, rankEl);
    col.append(track, meta);
    return col;
  }

  function barsSummary(bars) {
    const work = bars.raw_work;
    const biz = bars.raw_biz;
    const workShort = data && Array.isArray(data.bars) && data.bars[0] ? textOf(data.bars[0].short) : '';
    const bizShort = data && Array.isArray(data.bars) && data.bars[1] ? textOf(data.bars[1].short) : '';
    const higher = work > biz ? workShort : bizShort;
    return fillTokens(ui.srBarsSummary, { work, biz, higher });
  }

  function paintBars(main) {
    const snap = lastSnap || snapshot();
    lastSnap = snap;
    const barsEl = document.createElement('div');
    barsEl.className = 'l05-bars';
    barsEl.setAttribute('data-testid', 'l05-bars');
    const summary = barsSummary(snap.bars);
    barsEl.setAttribute('aria-label', summary);
    const workRank = barRank(snap.bars.raw_work, snap.bars.raw_biz);
    const bizRank = barRank(snap.bars.raw_biz, snap.bars.raw_work);
    const workLabel = data && Array.isArray(data.bars) && data.bars[0] ? textOf(data.bars[0].label) : '';
    const bizLabel = data && Array.isArray(data.bars) && data.bars[1] ? textOf(data.bars[1].label) : '';
    barsEl.append(
      paintBarCol('work', workLabel, snap.bars.raw_work, snap.bars.heightPct_work, workRank, 'l05-icon-work.svg'),
      paintBarCol('biz', bizLabel, snap.bars.raw_biz, snap.bars.heightPct_biz, bizRank, 'l05-icon-biz.svg')
    );
    const note = document.createElement('p');
    note.className = 'l05-note';
    note.textContent = ui.barSimNote;
    const dock = document.createElement('div');
    dock.className = 'l05-dock';
    dock.appendChild(makeBtn(textOf(buttons.continue), 'l05-bars-continue', 'continue', true));
    main.append(barsEl, note, dock);
    speak(summary);
  }

  function paintComment(main) {
    const snap = lastSnap || snapshot();
    lastSnap = snap;
    const box = document.createElement('div');
    box.className = 'l05-comment';
    box.setAttribute('data-testid', 'l05-comment');
    box.append(makeImg(shared(bossFile(snap.stars)), 'l05-boss'));
    const text = document.createElement('p');
    text.className = 'l05-comment-text';
    text.textContent = snap.comment;
    box.appendChild(text);
    const actions = document.createElement('div');
    actions.className = 'l05-actions';
    actions.append(
      makeBtn(textOf(buttons.repost), 'l05-repost', 'repost', false),
      makeBtn(textOf(buttons.keepSettle), 'l05-keep-settle', 'keep-settle', true)
    );
    main.append(box, actions);
  }

  function paintStars(stars) {
    const row = document.createElement('div');
    row.className = 'l05-stars';
    row.setAttribute('data-testid', 'stars');
    row.setAttribute('role', 'img');
    const shown = stars == null ? 0 : stars;
    row.setAttribute('aria-label', fillX(STARS_SR, [shown, 3]));
    for (let i = 0; i < 3; i += 1) {
      const on = i < shown;
      row.appendChild(makeImg(uiHref(on ? 'ui-star-on.svg' : 'ui-star-off.svg')));
    }
    return row;
  }

  function paintSettle(main) {
    const snap = lastSnap || snapshot();
    lastSnap = snap;
    main.setAttribute('data-testid', 'l05-settle');
    main.classList.add('l05-settle');
    main.append(makeImg(shared(bossFile(snap.stars)), 'l05-boss'));
    const stars = paintStars(snap.stars);
    const comment = document.createElement('p');
    comment.className = 'l05-comment-text';
    comment.textContent = snap.comment;
    const pair = document.createElement('div');
    pair.className = 'l05-settle-bars';
    const workRank = barRank(snap.bars.raw_work, snap.bars.raw_biz);
    const bizRank = barRank(snap.bars.raw_biz, snap.bars.raw_work);
    const workLabel = data && Array.isArray(data.bars) && data.bars[0] ? textOf(data.bars[0].short) : '';
    const bizLabel = data && Array.isArray(data.bars) && data.bars[1] ? textOf(data.bars[1].short) : '';
    const work = document.createElement('p');
    work.className = 'l05-settle-bar';
    work.textContent = workLabel + ' ' + String(snap.bars.raw_work) + ' ' + (workRank === 'high' ? ui.barHigh : (workRank === 'low' ? ui.barLow : ''));
    const biz = document.createElement('p');
    biz.className = 'l05-settle-bar';
    biz.textContent = bizLabel + ' ' + String(snap.bars.raw_biz) + ' ' + (bizRank === 'high' ? ui.barHigh : (bizRank === 'low' ? ui.barLow : ''));
    pair.append(work, biz);
    const note = document.createElement('p');
    note.className = 'l05-note';
    note.textContent = ui.barSimNote;
    main.append(stars, comment, pair, note);
    insertSaveFailNote(stars);
    if (snap.stars <= 1) {
      const tip = document.createElement('p');
      tip.className = 'l05-note';
      tip.textContent = ui.oneStarTip;
      main.appendChild(tip);
    }
    const learnedBtn = document.createElement('button');
    learnedBtn.type = 'button';
    learnedBtn.draggable = false;
    learnedBtn.className = 'l05-learned';
    learnedBtn.setAttribute('data-testid', 'learned');
    learnedBtn.setAttribute('data-act', 'learned');
    fillLearned(learnedBtn);
    const actions = document.createElement('div');
    actions.className = 'l05-actions';
    actions.append(
      makeBtn(textOf(buttons.backMap), 'l05-back-map', 'back-map', true),
      makeBtn(textOf(buttons.replayStar), 'l05-replay', 'replay', false)
    );
    main.append(learnedBtn, actions);
  }

  function fillLearned(btn) {
    btn.replaceChildren();
    btn.setAttribute('aria-expanded', learnedOpen ? 'true' : 'false');
    if (!learnedOpen) {
      btn.textContent = ui.learnedCollapsed;
      return;
    }
    const learn = data && data.learn && typeof data.learn === 'object' ? data.learn : {};
    const lines = Array.isArray(learn.lines) ? learn.lines : [];
    for (let i = 0; i < lines.length; i += 1) {
      const p = document.createElement('span');
      p.textContent = textOf(lines[i]);
      btn.appendChild(p);
    }
    if (learn.footnote) {
      const foot = document.createElement('span');
      foot.textContent = textOf(learn.footnote);
      btn.appendChild(foot);
    }
  }

  function goSettle() {
    if (disposed) return;
    lastSnap = lastSnap || snapshot();
    const faults = [];
    if (!settleOnce) {
      settleOnce = true;
      const plan = settlePlan({
        stars: lastSnap.stars,
        score: lastSnap.stars,
        hookOn: hookOn()
      });
      resetSaveFailure();
      try { saver.clearResume(bookId, levelId); } catch (err) { faults.push(err); }
      try { saver.clearLevelRun(bookId, levelId); } catch (err) { faults.push(err); }
      if (!disposed) saver.applyPlan(bookId, levelId, plan, api);
    }
    screen = 'settle';
    paint();
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

  function noteStage() {
    if (disposed) return;
    if (resumeOpen) return;
    const stage = stageIdFromScreen(screen, phase);
    if (!stage) return;
    const run = buildRunSnapshot({
      screen,
      phase,
      wall,
      pool,
      snap: lastSnap,
      canRepost: phase !== 'repost'
    });
    if (!run || disposed) return;
    const screenNo = resumeScreenNumber(stage);
    if (!screenNo || disposed) return;
    try {
      saver.saveResume(bookId, levelId, screenNo);
    } catch { /* mid-run save must not block the screen */ }
    if (disposed) return;
    try {
      saver.writeLevelRun(bookId, levelId, run);
    } catch { /* mid-run save must not block the screen */ }
  }

  function paint() {
    if (disposed || !node) return;
    if (resumeOpen) return;
    syncScreenReader();
    node.setAttribute('data-screen', screen);
    if (screen === 'paste' || screen === 'bars' || screen === 'comment') {
      node.setAttribute('data-phase', phase === 'repost' ? 'repost' : 'first');
    } else {
      node.removeAttribute('data-phase');
    }
    const { header, title } = paintHeader();
    const main = document.createElement('div');
    main.className = 'l05-main';
    if (screen === 'intro') paintIntro(main);
    else if (screen === 'paste') paintPaste(main);
    else if (screen === 'bars') paintBars(main);
    else if (screen === 'comment') paintComment(main);
    else paintSettle(main);
    const keepLive = live;
    const keepToast = toastEl;
    node.replaceChildren(header, main);
    if (keepToast) node.appendChild(keepToast);
    else {
      toastEl = document.createElement('p');
      toastEl.className = 'l05-toast';
      toastEl.setAttribute('role', 'status');
      node.appendChild(toastEl);
    }
    if (keepLive) node.appendChild(keepLive);
    else {
      live = document.createElement('div');
      live.className = 'visually-hidden';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      node.appendChild(live);
    }
    try { title.focus(); } catch { /* ignore */ }
    bindPointerDrag();
    noteStage();
  }

  function syncScreenReader() {
    if (!node) return;
    if (root && typeof root.getAttribute === 'function' && root.getAttribute('data-l05-sr') === '1') {
      node.setAttribute('data-l05-sr', '1');
    }
  }

  function clearDragGhost() {
    if (dragGhost && typeof dragGhost.remove === 'function') dragGhost.remove();
    dragGhost = null;
  }

  function clearDropMarks() {
    if (!node) return;
    const marked = node.querySelectorAll('.l05-slot.drop');
    for (let i = 0; i < marked.length; i += 1) marked[i].classList.remove('drop');
  }

  function slotEmptyAt(index) {
    return index >= 0 && index < wall.length && (typeof wall[index] !== 'string' || wall[index] === '');
  }

  function slotAtPoint(x, y) {
    if (!node || typeof node.querySelectorAll !== 'function') return -1;
    const els = node.querySelectorAll('[data-slot]');
    let best = -1;
    let bestDist = 25;
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      if (!el || typeof el.getBoundingClientRect !== 'function') continue;
      const rect = el.getBoundingClientRect();
      const cx = Math.min(Math.max(x, rect.left), rect.right);
      const cy = Math.min(Math.max(y, rect.top), rect.bottom);
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= 24 && dist < bestDist) {
        bestDist = dist;
        const n = Number(el.getAttribute('data-slot'));
        if (Number.isInteger(n)) best = n;
      }
    }
    return best;
  }

  function markDrop(index) {
    if (!node || typeof node.querySelectorAll !== 'function') return;
    const slots = node.querySelectorAll('.l05-slot');
    for (let i = 0; i < slots.length; i += 1) {
      slots[i].classList.toggle('drop', i === index);
    }
  }

  function bindPointerDrag() {
    if (!node || screen !== 'paste') return;
    syncScreenReader();
    if (!dragAllowed(node)) return;
    const list = node.querySelectorAll('[data-act="pool-sticker"], [data-act="wall-sticker"]');
    for (let i = 0; i < list.length; i += 1) attachDrag(list[i]);
  }

  function attachDrag(btn) {
    if (!dragAllowed(node)) return;
    btn.addEventListener('pointerdown', (e) => {
      if (!dragAllowed(node)) return;
      if (disposed || screen !== 'paste') return;
      if (e.isPrimary === false) return;
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      const fromSlot = Number(btn.getAttribute('data-slot'));
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      let hover = -1;
      const epoch = dragEpoch;
      if (typeof btn.setPointerCapture === 'function' && e.pointerId != null) {
        try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      const move = (ev) => {
        if (disposed || epoch !== dragEpoch) return;
        if (!dragAllowed(node)) return;
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!dragging) {
          if (!dragThresholdExceeded(dx, dy)) return;
          dragging = true;
          clearDragGhost();
          const sticker = stickerById(catalog, id);
          dragGhost = document.createElement('div');
          dragGhost.className = 'drag-ghost';
          dragGhost.textContent = textOf(sticker && sticker.text);
          if (node) node.appendChild(dragGhost);
        }
        if (!dragGhost) return;
        dragGhost.style.left = ev.clientX + 'px';
        dragGhost.style.top = ev.clientY + 'px';
        const hit = slotAtPoint(ev.clientX, ev.clientY);
        if (act === 'pool-sticker') hover = slotEmptyAt(hit) ? hit : -1;
        else hover = hit >= 0 && hit !== fromSlot ? hit : -1;
        markDrop(hover);
      };
      const end = (apply) => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', endUp);
        btn.removeEventListener('pointercancel', endCancel);
        clearDragGhost();
        clearDropMarks();
        if (typeof btn.releasePointerCapture === 'function' && e.pointerId != null) {
          try {
            if (typeof btn.hasPointerCapture !== 'function' || btn.hasPointerCapture(e.pointerId)) {
              btn.releasePointerCapture(e.pointerId);
            }
          } catch { /* ignore */ }
        }
        if (!dragging || disposed || epoch !== dragEpoch) return;
        dragGuardUntil = Date.now() + 400;
        if (!apply || !dragAllowed(node)) return;
        if (act === 'pool-sticker') finishPoolDrag(id, hover);
        else finishWallDrag(fromSlot, hover);
      };
      const endUp = () => end(true);
      const endCancel = () => end(false);
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', endUp);
      btn.addEventListener('pointercancel', endCancel);
    });
  }

  function commitPaste(next, id) {
    const before = startGate(filledCount(wall), slots).enabled;
    wall = next.wall;
    pool = next.pool;
    selected = -1;
    const sticker = stickerById(catalog, id);
    const fb = data && data.feedbacks && typeof data.feedbacks === 'object' ? data.feedbacks : {};
    if (sticker && sticker.kind === 'result') showToast(textOf(fb.onResult));
    else showToast(textOf(fb.onOutput));
    const after = startGate(filledCount(wall), slots).enabled;
    if (after && !before) readySpoken = false;
    paint();
  }

  function onPasteId(id) {
    const next = pasteSticker(wall, pool, id);
    if (!next.ok) {
      if (next.reason === 'full') showToast(ui.wallFull);
      return;
    }
    commitPaste(next, id);
  }

  function finishPoolDrag(id, slotIndex) {
    if (typeof id !== 'string' || id === '' || slotIndex < 0) {
      showToast(ui.wallFull);
      return;
    }
    const next = pasteStickerAt(wall, pool, id, slotIndex);
    if (!next.ok) {
      if (next.reason === 'full' || next.reason === 'occupied' || next.reason === 'badSlot') {
        showToast(ui.wallFull);
      }
      return;
    }
    commitPaste(next, id);
  }

  function finishWallDrag(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || toIndex < 0 || toIndex === fromIndex) return;
    const next = swapSlots(wall, fromIndex, toIndex);
    wall = next;
    if (typeof next[toIndex] === 'string' && next[toIndex] !== '') selected = toIndex;
    else selected = -1;
    paint();
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

  function announceResetFailedOnce() {
    if (!resetFailedOn || resetFailedSpoke) return;
    const sentence = textOf(ui.resetFailed);
    if (!sentence) return;
    const title = focusIntroTitle();
    resetFailedSpoke = true;
    if (!live) return;
    const titleText = title ? textOf(title.textContent) : '';
    if (titleText && document && typeof document.createTextNode === 'function') {
      live.appendChild(document.createTextNode(titleText));
    }
    if (document && typeof document.createTextNode === 'function') {
      live.appendChild(document.createTextNode(sentence));
    }
  }

  function showIntro() {
    const fail = resetFailedOn;
    const spoke = resetFailedSpoke;
    const done = resetFailedDone;
    resumeOpen = false;
    pendingRun = null;
    clearTimers();
    resetRound();
    resetFailedOn = fail;
    resetFailedSpoke = spoke;
    resetFailedDone = done;
    paint();
  }

  function showResumeDialog(stageId) {
    resumeOpen = true;
    clearTimers();
    dragEpoch += 1;
    clearDragGhost();
    const label = stageLabel(ui, stageId);
    const { header } = paintHeader();
    const mask = document.createElement('div');
    mask.className = 'l05-mask';
    mask.setAttribute('data-testid', 'resume-dialog');
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-labelledby', 'l05-resume-title');
    const panel = document.createElement('div');
    panel.className = 'l05-panel';
    const title = document.createElement('p');
    title.id = 'l05-resume-title';
    title.setAttribute('data-testid', 'resume-text');
    title.setAttribute('tabindex', '-1');
    title.textContent = fillTokens(ui.resumePrompt, { stage: label });
    const actions = document.createElement('div');
    actions.className = 'l05-actions';
    const go = makeBtn(textOf(ui.resumeContinue), 'resume-continue', 'resume-continue', true);
    const fresh = makeBtn(textOf(ui.resumeRestart), 'resume-restart', 'resume-restart', false);
    actions.append(go, fresh);
    panel.append(title, actions);
    mask.appendChild(panel);
    live = null;
    toastEl = null;
    node.replaceChildren(header, mask);
    node.setAttribute('data-screen', 'resume');
    node.removeAttribute('data-phase');
    if (typeof go.focus === 'function') {
      try { go.focus(); } catch { /* ignore */ }
    }
  }

  function offerResume() {
    if (disposed) return false;
    let saved = null;
    let run = null;
    try { saved = saver.readResume(bookId, levelId); } catch { saved = null; }
    try { run = saver.readLevelRun(bookId, levelId); } catch { run = null; }
    if (!saved) return false;
    const restored = restoreFromRun(run);
    if (!restored) return false;
    pendingRun = run;
    showResumeDialog(restored.stage);
    return true;
  }

  function continueResume() {
    if (disposed || !resumeOpen) return;
    const restored = restoreFromRun(pendingRun);
    resumeOpen = false;
    pendingRun = null;
    clearTimers();
    if (!restored) {
      showIntro();
      return;
    }
    resetFailedOn = false;
    resetFailedDone = true;
    wall = restored.wall;
    pool = restored.pool.slice();
    phase = restored.phase === 'repost' ? 'repost' : 'first';
    screen = restored.screen;
    lastSnap = restored.snap;
    selected = -1;
    readySpoken = false;
    settleOnce = false;
    paint();
  }

  function restartResume() {
    if (disposed || !resumeOpen) return;
    resetFailedDone = false;
    const faults = [];
    try { saver.clearResume(bookId, levelId); } catch (err) { faults.push(err); }
    try { saver.clearLevelRun(bookId, levelId); } catch (err) { faults.push(err); }
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

  function onClick(ev) {
    if (disposed) return;
    if (Date.now() < dragGuardUntil) return;
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!t || !node.contains(t)) return;
    const act = t.getAttribute('data-act');
    if (act === 'back' || act === 'back-map') {
      if (api && typeof api.exit === 'function') api.exit();
      return;
    }
    if (act === 'resume-continue') {
      continueResume();
      return;
    }
    if (act === 'resume-restart') {
      restartResume();
      return;
    }
    if (resumeOpen) return;
    if (act === 'go-paste') {
      resetFailedOn = false;
      resetFailedDone = true;
      screen = 'paste';
      paint();
      return;
    }
    if (act === 'pool-sticker') {
      onPasteId(t.getAttribute('data-id'));
      return;
    }
    if (act === 'wall-sticker') {
      const i = Number(t.getAttribute('data-slot'));
      selected = selected === i ? -1 : i;
      paint();
      return;
    }
    if (act === 'empty-slot') {
      selected = -1;
      paint();
      return;
    }
    if (act === 'move-up') {
      if (t.getAttribute('aria-disabled') === 'true') return;
      wall = moveUp(wall, selected);
      if (selected > 0) selected -= 1;
      paint();
      return;
    }
    if (act === 'move-down') {
      if (t.getAttribute('aria-disabled') === 'true') return;
      wall = moveDown(wall, selected);
      if (selected >= 0 && selected < slots - 1) selected += 1;
      paint();
      return;
    }
    if (act === 'move-out') {
      const next = moveOut(wall, pool, selected);
      wall = next.wall;
      pool = next.pool;
      selected = -1;
      paint();
      return;
    }
    if (act === 'start') {
      const gate = startGate(filledCount(wall), slots);
      if (!gate.enabled) {
        const reason = gate.reasonKey === 'startNeedMore'
          ? fillTokens(ui.startNeedMore, { n: gate.remaining })
          : ui.startNeedFull;
        showToast(reason);
        return;
      }
      lastSnap = snapshot();
      screen = 'bars';
      paint();
      return;
    }
    if (act === 'continue') {
      if (phase === 'repost') goSettle();
      else {
        screen = 'comment';
        paint();
      }
      return;
    }
    if (act === 'repost') {
      phase = 'repost';
      selected = -1;
      screen = 'paste';
      paint();
      return;
    }
    if (act === 'keep-settle') {
      goSettle();
      return;
    }
    if (act === 'learned') {
      learnedOpen = !learnedOpen;
      fillLearned(t);
      return;
    }
    if (act === 'replay') {
      const swapped = swapPoolForReplay({
        poolIds: roundIds(),
        stickersOrCatalog: catalog,
        replaySwap,
        random: replayRandom()
      });
      applyFreshRound(swapped.poolIds);
      try { saver.clearResume(bookId, levelId); } catch { /* replay still returns to intro */ }
      try { saver.clearLevelRun(bookId, levelId); } catch { /* replay still returns to intro */ }
      paint();
    }
  }

  ensureCss();
  if (disposed) return unmount;
  resetRound();
  node = document.createElement('div');
  node.className = 'l05';
  node.setAttribute('data-testid', 'level');
  node.addEventListener('click', onClick);
  if (root) root.appendChild(node);
  try { saver.clearOrphanRun(bookId, levelId); } catch { /* ignore */ }
  if (disposed) return unmount;
  if (!offerResume()) paint();
  return unmount;
}
