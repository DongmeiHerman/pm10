import { loadRegistry, loadLevel } from './loader.js';
import { loadProgress, completeLevel, isDone, storageAvailable, levelKey, vibrateEnabled, setVibrate, clearAllPm10, isClearedOrUnlocked } from './storage.js';
import { uiText } from './ui-text.js';

const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BOOK_COLORS = ['#4C5FD5', '#7A5AF8', '#2BA6DE', '#14B8A6', '#3FAE5A', '#E5A100', '#F47B2A', '#E5484D', '#D6409F', '#5E6AD2'];
const WARN_TEXT = '进度只存本机，清缓存或换手机会丢';

let toastTimer = 0;
let aboutClearTimer = 0;

function clearAboutTimer() {
  clearTimeout(aboutClearTimer);
  aboutClearTimer = 0;
}
let routeGen = 0;
let activeLevel = null;

function takeUnmount(ret) {
  if (typeof ret === 'function') return ret;
  if (ret && typeof ret.unmount === 'function') return ret.unmount;
  return null;
}

function leaveLevel() {
  const session = activeLevel;
  activeLevel = null;
  if (!session) return;
  session.alive = false;
  if (typeof session.unmount === 'function') {
    try { session.unmount(); } catch { /* ignore */ }
  }
}

function ensureWarn() {
  if (document.getElementById('local-warn')) return;
  const p = document.createElement('p');
  p.id = 'local-warn';
  p.className = 'local-warn';
  p.textContent = WARN_TEXT;
  document.body.prepend(p);
}

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.dataset.testid = 'toast';
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function bookNo(index) {
  return String(index + 1).padStart(2, '0');
}

const MAP_UI = uiText(null);

// 未解锁优先于施工中。上一关已通关或已解锁（autoUnlocked）才开下一关；本关仍是 wip 才提示「还在盖，敬请期待」。
function isUnlocked(books, book, index, p) {
  if (index > 0) return isClearedOrUnlocked(p, book.id, book.levels[index - 1].id);
  const bi = books.findIndex(b => b.id === book.id);
  if (bi <= 0) return true;
  const prev = books[bi - 1];
  const last = prev.levels[prev.levels.length - 1];
  return !!last && isClearedOrUnlocked(p, prev.id, last.id);
}

function nodeState(books, book, level, index, p) {
  if (!isUnlocked(books, book, index, p)) return 'locked';
  if (level.status === 'wip') return 'wip';
  if (isDone(p, book.id, level.id)) return 'cleared';
  const rec = p.levels[levelKey(book.id, level.id)];
  if (rec && rec.autoUnlocked) return 'unlocked';
  return 'open';
}

function nodeSrc(state, no) {
  if (state === 'locked') return './assets/map/map-node-locked.png';
  if (state === 'cleared') return `./assets/map/map-node-cleared-book-${no}.png`;
  return `./assets/map/map-node-unlocked-book-${no}.png`;
}

function starCount(rec) {
  if (!rec || !rec.done) return null;
  if (rec.stars == null || rec.stars === '') return null;
  return Math.max(0, Math.min(3, Number(rec.stars) || 0));
}

const STAR_ON = './assets/ui/ui-star-on.svg';
const STAR_OFF = './assets/ui/ui-star-off.svg';

function starIcons(onCount) {
  const n = Math.max(0, Math.min(3, Number(onCount) || 0));
  let html = '';
  for (let i = 1; i <= 3; i++) {
    html += `<img src="${i <= n ? STAR_ON : STAR_OFF}" alt="" width="14" height="14" draggable="false">`;
  }
  return html;
}

function renderNode(books, book, level, index, bi, p, mark) {
  const state = nodeState(books, book, level, index, p);
  const no = bookNo(bi);
  const current = (state === 'open' || state === 'unlocked') && mark.open === 0 ? (mark.open = 1) : 0;
  const num = state === 'locked' ? '' : `<span class="node-num">${index + 1}</span>`;
  const flag = state === 'wip'
    ? '<span class="wip-flag">施工中</span>'
    : (state === 'unlocked' ? `<span class="unlock-flag">${esc(MAP_UI.unlocked)}</span>` : '');
  const nStars = starCount(p.levels[levelKey(book.id, level.id)]);
  const stars = state === 'cleared' && nStars != null
    ? `<span class="node-stars" aria-hidden="true">${starIcons(nStars)}</span>`
    : (state === 'unlocked' ? `<span class="node-stars" data-testid="empty-stars" aria-hidden="true">${starIcons(0)}</span>` : '');
  const comeBack = state === 'unlocked' ? `<span class="node-back" data-testid="come-back">${esc(MAP_UI.comeBack)}</span>` : '';
  const stateName = { locked: '未解锁', wip: '施工中', open: '可进入', cleared: '已通关', unlocked: MAP_UI.unlocked }[state];
  const starLabel = state === 'cleared' && nStars != null ? `，3 颗星中得 ${nStars} 颗` : '';
  const lockKind = isUnlocked(books, book, 0, p) ? 'level' : 'book';
  return `<button type="button" class="node${current ? ' is-current' : ''}${state === 'wip' ? ' is-wip' : ''}" data-node data-state="${state}" data-lock="${lockKind}" data-book="${esc(book.id)}" data-level="${esc(level.id)}" aria-label="${esc(level.title)}，${stateName}${starLabel}">
    <span class="node-face">
      <img src="${nodeSrc(state, no)}" alt="" width="72" height="72">
      ${num}${flag}
    </span>
    <span class="node-label">${esc(level.title)}</span>
    ${stars}
    ${comeBack}
  </button>`;
}

function renderBook(books, book, bi, p) {
  const done = book.levels.filter(l => isDone(p, book.id, l.id)).length;
  const total = book.levels.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const mark = { open: 0 };
  const nodes = book.levels.map((l, i) => renderNode(books, book, l, i, bi, p, mark)).join('');
  const color = book.color || BOOK_COLORS[bi] || BOOK_COLORS[0];
  const lockedBook = !isUnlocked(books, book, 0, p);
  const bookLock = lockedBook ? '<p class="book-lock" data-testid="book-lock">先通过上一本书</p>' : '';
  return `<section class="book-card" style="--book:${esc(color)}">
    <header class="book-head">
      <span class="book-no" aria-hidden="true">${bookNo(bi)}</span>
      <div class="book-meta">
        <h2>${esc(book.title)}</h2>
        <p class="hook">${esc(book.subtitle || '')}</p>
        <div class="bar" role="img" aria-label="本书进度 ${done}/${total}"><span style="width:${pct}%"></span></div>
      </div>
      <p class="book-count${done ? '' : ' is-zero'}">本书 ${done}/${total}</p>
    </header>
    ${bookLock}
    <div class="nodes">${nodes}</div>
  </section>`;
}

async function home(gen) {
  const books = await loadRegistry();
  if (gen !== routeGen) return;
  const p = loadProgress();
  let total = 0;
  let done = 0;
  let stars = 0;
  for (const b of books) {
    for (const l of b.levels) {
      total += 1;
      if (!isDone(p, b.id, l.id)) continue;
      done += 1;
      const n = starCount(p.levels[levelKey(b.id, l.id)]);
      if (n != null) stars += n;
    }
  }
  if (gen !== routeGen) return;
  const saveNote = storageAvailable ? '' : '<p class="small">当前浏览器无法保存，关闭页面后进度会丢失。</p>';
  app.innerHTML = `<header class="map-head"><h1>产品经理十本书</h1><p class="small">已通关 ${done} / ${total} · ★ ${stars} / ${total * 3}</p>${saveNote}</header>` +
    books.map((b, i) => renderBook(books, b, i, p)).join('') +
    '<p class="map-foot"><a href="#/about" data-testid="about-link">说明</a></p>';
  if (gen !== routeGen) return;
  const cur = app.querySelector('.is-current');
  if (cur) cur.scrollIntoView({ block: 'center', inline: 'nearest' });
}

async function openLevel(bookId, levelId, gen) {
  const books = await loadRegistry();
  if (gen !== routeGen) return;
  const book = books.find(x => x.id === bookId);
  const index = book ? book.levels.findIndex(l => l.id === levelId) : -1;
  if (!book || index < 0) {
    history.replaceState(null, '', '#/');
    await home(gen);
    return;
  }
  const level = book.levels[index];
  const state = nodeState(books, book, level, index, loadProgress());
  const host = String(location.hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (state === 'locked' || (state === 'wip' && !localHost)) {
    await home(gen);
    if (gen !== routeGen) return;
    const lockedBook = state === 'locked' && !isUnlocked(books, book, 0, loadProgress());
    toast(state === 'wip' ? '还在盖，敬请期待' : (lockedBook ? '先通过上一本书' : '先通过上一关'));
    if (location.hash !== '#/') history.replaceState(null, '', '#/');
    return;
  }
  const loaded = await loadLevel(bookId, levelId);
  if (gen !== routeGen) return;
  app.innerHTML = '';
  const session = { alive: true, unmount: null };
  activeLevel = session;
  let ret;
  try {
    ret = await loaded.mod.mount(app, loaded.meta, {
      bookTitle: book.title,
      bookId,
      levelId,
      data: loaded.data,
      bindUnmount(fn) {
        if (typeof fn === 'function') session.unmount = fn;
      },
      complete: (data) => {
        if (!session.alive || gen !== routeGen) return;
        completeLevel(bookId, levelId, data);
        if (!data || !data.stay) location.hash = '#/';
      },
      exit: () => { location.hash = '#/'; }
    });
  } catch (err) {
    session.alive = false;
    if (typeof session.unmount === 'function') {
      try { session.unmount(); } catch { /* ignore */ }
    }
    if (activeLevel === session) activeLevel = null;
    throw err;
  }
  const fn = takeUnmount(ret) || session.unmount;
  session.unmount = fn;
  if (gen !== routeGen || activeLevel !== session) {
    session.alive = false;
    if (typeof fn === 'function') {
      try { fn(); } catch { /* ignore */ }
    }
    if (activeLevel === session) activeLevel = null;
  }
}

function about(gen) {
  if (gen !== routeGen) return;
  const on = vibrateEnabled();
  app.innerHTML = `<article class="about" data-testid="about">
    <h1>说明</h1>
    <section class="card">
      <h2>隐私</h2>
      <p>不登录，不收集个人信息，不联网上报，不用 cookie。</p>
      <p>本机只存下面这些记录，都不含个人信息：</p>
      <ul>
        <li>localStorage 的 pm10:progress:v1：通关、星级、停在哪一屏</li>
        <li>localStorage 的 pm10:seen-intro:v1：若有，表示看过开场</li>
        <li>localStorage 的 pm10:l11-hint:v1：看过点卡片的提示</li>
        <li>localStorage 的 pm10:settings:v1：出星时震不震，默认开</li>
        <li>sessionStorage 里以 pm10:l11-run: 开头的键：这一局的牌序，关掉页面就没了</li>
        <li>localStorage 的 pm10:l12-fails:v1：第 2、3 关连续没过的次数，按书和关卡分开记，过关就清掉</li>
        <li>localStorage 的 pm10:l12-run:v1：第 2 到 5 关（按关分开）这一局做到哪张单子、哪个版本、句子顺序和前面几张的分数。这一局用的从容模式、出题方式，以及是否因为卡顿改成逐张</li>
        <li>pm10:progress:v1 里的 autoUnlocked：连续没过达到次数后先解锁下一关，本关还没通关</li>
      </ul>
      <button type="button" class="btn" data-testid="clear-progress">清除本机进度</button>
      <div data-testid="clear-confirm" hidden>
        <p>确定删掉本机所有以 pm10: 开头的记录？删了不能恢复。</p>
        <button type="button" class="btn" data-testid="clear-yes">确定清除</button>
        <button type="button" class="btn secondary" data-testid="clear-no">取消</button>
      </div>
      <p class="small" data-testid="clear-done" hidden>已清除。</p>
    </section>
    <section class="card">
      <h2>内容声明</h2>
      <p>这不是官方产品，与原书作者和出版社无关。观点是团队自己的提炼。数据是游戏模拟。</p>
    </section>
    <section class="card">
      <h2>版权</h2>
      <p>书名仅作引用。图形为团队自绘。字体为基于思源黑体裁剪的子集，已按 OFL 改名为 PM10 Sans 发布。许可证见 <a href="./fonts/LICENSE.txt" data-testid="license-link">fonts/LICENSE.txt</a>。</p>
    </section>
    <section class="card">
      <h2>出星震动</h2>
      <p>星星亮起时手机会短震一下。默认开。</p>
      <button type="button" class="btn secondary" data-testid="vibrate-toggle" aria-pressed="${on ? 'true' : 'false'}">出星震动：${on ? '开' : '关'}</button>
    </section>
    <button type="button" class="btn" data-testid="about-back">返回</button>
  </article>`;
  if (gen !== routeGen) return;
  const confirmBox = app.querySelector('[data-testid="clear-confirm"]');
  const doneNote = app.querySelector('[data-testid="clear-done"]');
  const armConfirm = () => {
    clearAboutTimer();
    aboutClearTimer = setTimeout(() => {
      aboutClearTimer = 0;
      if (!confirmBox.isConnected) return;
      confirmBox.hidden = true;
    }, 5000);
  };
  app.querySelector('[data-testid="clear-progress"]').addEventListener('click', () => {
    confirmBox.hidden = false;
    doneNote.hidden = true;
    armConfirm();
  });
  app.querySelector('[data-testid="clear-no"]').addEventListener('click', () => {
    clearAboutTimer();
    confirmBox.hidden = true;
  });
  app.querySelector('[data-testid="clear-yes"]').addEventListener('click', () => {
    clearAboutTimer();
    clearAllPm10();
    confirmBox.hidden = true;
    doneNote.hidden = false;
    const toggle = app.querySelector('[data-testid="vibrate-toggle"]');
    toggle.setAttribute('aria-pressed', 'true');
    toggle.textContent = '出星震动：开';
  });
  app.querySelector('[data-testid="vibrate-toggle"]').addEventListener('click', (e) => {
    const next = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    setVibrate(next);
    e.currentTarget.setAttribute('aria-pressed', next ? 'true' : 'false');
    e.currentTarget.textContent = `出星震动：${next ? '开' : '关'}`;
  });
  app.querySelector('[data-testid="about-back"]').addEventListener('click', () => {
    clearAboutTimer();
    location.hash = '#/';
  });
}

async function route() {
  const gen = ++routeGen;
  clearAboutTimer();
  leaveLevel();
  app.innerHTML = '';
  const hash = location.hash;
  const m = hash.match(/^#\/([\w-]+)\/([\w-]+)$/);
  try {
    if (hash === '#/about') about(gen);
    else if (m) await openLevel(m[1], m[2], gen);
    else await home(gen);
  } catch (e) {
    if (gen !== routeGen) return;
    app.innerHTML = `<p>加载失败，请刷新重试。</p><p class="small">${esc(e.message)}</p>`;
  }
}

function onMapClick(e) {
  const btn = e.target.closest('[data-node]');
  if (!btn || !app.contains(btn)) return;
  const state = btn.getAttribute('data-state');
  if (state === 'locked') { toast(btn.getAttribute('data-lock') === 'book' ? '先通过上一本书' : '先通过上一关'); return; }
  if (state === 'wip') { toast('还在盖，敬请期待'); return; }
  location.hash = `#/${btn.getAttribute('data-book')}/${btn.getAttribute('data-level')}`;
}
app.removeEventListener('click', onMapClick);
app.addEventListener('click', onMapClick);

ensureWarn();
addEventListener('hashchange', route);
route();
