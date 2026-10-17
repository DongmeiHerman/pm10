import { readResume, saveResume, clearResume, vibrateEnabled } from '../../../js/storage.js';

const ENABLE_DRAG = false;

const ICONS = {
  interview: 'l11-icon-interview.svg',
  paper: 'l11-icon-paper.svg',
  metrics: 'l11-icon-data.svg',
  points: 'l11-icon-points.svg',
  reserve: 'l11-icon-delivery.svg',
  bundle: 'l11-icon-cart.svg'
};
const HINT_KEY = 'pm10:l11-hint:v1';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const asset = name => new URL(`./assets/${name}`, import.meta.url).href;
const img = (name, cls = '') => `<img class="${cls}" src="${esc(asset(name))}" alt="" draggable="false">`;

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
  if (document.getElementById('l11-css')) return;
  const link = document.createElement('link');
  link.id = 'l11-css';
  link.rel = 'stylesheet';
  link.href = new URL('./level.css', import.meta.url).href;
  document.head.appendChild(link);
}

export async function mount(root, meta, api) {
  let disposed = false;
  let animToken = 0;
  let animFrame = 0;
  let animTimer = 0;
  let bossTimer = 0;
  let sheetFrame = 0;
  let animAbort = null;
  let toastTimer = 0;
  let timerId = 0;
  let timeLeft = 0;
  let clickBound = false;

  function cleanupAnim() {
    animToken += 1;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = 0;
    if (sheetFrame) cancelAnimationFrame(sheetFrame);
    sheetFrame = 0;
    if (animTimer) { window.clearTimeout(animTimer); animTimer = 0; }
    if (bossTimer) { window.clearTimeout(bossTimer); bossTimer = 0; }
    if (animAbort) { animAbort.abort(); animAbort = null; }
  }

  function kickSheet(sheet) {
    if (!sheet || disposed) return;
    if (sheetFrame) cancelAnimationFrame(sheetFrame);
    sheetFrame = requestAnimationFrame(() => {
      sheetFrame = 0;
      if (disposed) return;
      sheet.classList.add('in');
    });
  }

  function unmount() {
    if (disposed) return;
    disposed = true;
    cleanupAnim();
    window.clearTimeout(toastTimer);
    toastTimer = 0;
    window.clearInterval(timerId);
    timerId = 0;
    if (clickBound) {
      root.removeEventListener('click', onClick);
      clickBound = false;
    }
  }

  if (api && typeof api.bindUnmount === 'function') {
    try { api.bindUnmount(unmount); } catch { /* ignore */ }
  }

  const data = (api && api.data) || await (await fetch(new URL('./data.json', import.meta.url))).json();
  if (disposed) return unmount;
  ensureCss();
  const bookId = (api && api.bookId) || data.book;
  const levelId = (api && api.levelId) || data.id;
  const rngFor = () => makeRng(api);
  const cols = data.grid.columns;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const runKey = `pm10:l11-run:${bookId}/${levelId}`;
  let svgCache = {};
  try {
    const names = ['l11-team.svg', 'l11-chart-up.svg', 'l11-chart-small.svg', 'l11-chart-flat.svg'];
    await Promise.all(names.map(async name => {
      svgCache[name] = await (await fetch(asset(name))).text();
    }));
  } catch { svgCache = {}; }
  if (disposed) return unmount;

  let cards = [];
  let trueId = data.firstRunTrueProblem;
  let replay = false;
  let slots = emptySlots();
  let playing = 1;
  let round1 = null;
  let round2 = null;
  let screen = 0;
  let pending = false;
  let dragGuardUntil = 0;
  let seenHint = false;
  try { seenHint = localStorage.getItem(HINT_KEY) === '1'; } catch { /* ignore */ }

  const SCREEN = {
    1: { id: 'intro', timed: false },
    2: { id: 'round1', timed: false },
    3: { id: 'settle1', timed: false },
    4: { id: 'transition', timed: false },
    5: { id: 'round2', timed: false },
    6: { id: 'ceremony', timed: false },
    7: { id: 'result', timed: false }
  };

  function emptySlots() { return Array.from({ length: data.slots }, () => null); }
  function cardBy(id) { return cards.find(c => c.id === id); }
  function usedCount() { return slots.filter(Boolean).length; }
  function chartFile(stars) {
    if (stars >= 3) return 'l11-chart-up.svg';
    if (stars === 2) return 'l11-chart-small.svg';
    return 'l11-chart-flat.svg';
  }
  function bossFile(stars) {
    if (stars >= 3) return 'l11-boss-happy.svg';
    if (stars <= 1) return 'l11-boss-frown.svg';
    return 'l11-boss.svg';
  }
  function grade() {
    const ids = new Set(slots.filter(Boolean));
    const list = cards.filter(c => ids.has(c.id));
    const hasVerify = list.some(c => c.type === 'verify');
    const hasTrue = list.some(c => c.id === trueId);
    if (hasVerify && hasTrue) return 3;
    if (!hasVerify && hasTrue) return 2;
    return 1;
  }
  function canPlaceAt(index, days) {
    if (index < 0 || index + days > slots.length) return false;
    if ((index % cols) + days > cols) return false;
    for (let k = 0; k < days; k++) if (slots[index + k]) return false;
    return true;
  }
  function firstFit(days) {
    for (let i = 0; i < slots.length; i++) if (canPlaceAt(i, days)) return i;
    return -1;
  }
  function placeAt(index, card) {
    for (let k = 0; k < card.days; k++) slots[index + k] = card.id;
  }
  function removeCard(id) {
    for (let i = 0; i < slots.length; i++) if (slots[i] === id) slots[i] = null;
  }
  function revealed() {
    return slots.some(id => id && cardBy(id) && cardBy(id).type === 'verify');
  }

  function deal(isReplay) {
    replay = !!isReplay;
    cards = data.cards.map(c => ({ ...c }));
    trueId = data.firstRunTrueProblem;
    if (replay && data.replay && data.replay.shuffleCards) {
      const rng = rngFor();
      shuffle(cards, rng);
      const pool = cards.filter(c => c.type === data.replay.trueProblemFrom);
      if (pool.length) {
        const pick = pool[Math.floor(rng() * pool.length)];
        if (pick && pick.id !== trueId) {
          const origin = cards.find(c => c.id === trueId);
          if (origin) {
            const tmp = origin.feedback;
            origin.feedback = pick.feedback;
            pick.feedback = tmp;
          }
          trueId = pick.id;
        }
      }
    }
  }

  function persist() {
    if (disposed) return;
    try {
      sessionStorage.setItem(runKey, JSON.stringify({
        replay, trueId, playing,
        order: cards.map(c => c.id),
        feedback: cards.map(c => [c.id, c.feedback]),
        round1, round2
      }));
    } catch { /* ignore */ }
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(runKey);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.order)) return false;
      const byId = new Map(data.cards.map(c => [c.id, { ...c }]));
      const next = saved.order.map(id => byId.get(id)).filter(Boolean);
      if (next.length !== data.cards.length) return false;
      cards = next;
      if (Array.isArray(saved.feedback)) {
        for (const pair of saved.feedback) {
          const found = cards.find(c => c.id === pair[0]);
          if (found) found.feedback = pair[1];
        }
      }
      replay = !!saved.replay;
      trueId = saved.trueId || data.firstRunTrueProblem;
      round1 = saved.round1 || null;
      round2 = saved.round2 || null;
      playing = saved.playing === 2 ? 2 : 1;
      return true;
    } catch { return false; }
  }

  function forgetRun() {
    try { sessionStorage.removeItem(runKey); } catch { /* ignore */ }
  }

  function remember(n) {
    if (disposed) return;
    try { saveResume(bookId, levelId, n); } catch { /* ignore */ }
  }

  function resetTimer(n) {
    window.clearInterval(timerId);
    timerId = 0;
    if (disposed) return;
    const spec = SCREEN[n];
    if (!spec || !spec.timed) { timeLeft = 0; return; }
    timeLeft = spec.durationMs;
    const started = Date.now();
    timerId = window.setInterval(() => {
      if (disposed) {
        window.clearInterval(timerId);
        timerId = 0;
        return;
      }
      timeLeft = Math.max(0, spec.durationMs - (Date.now() - started));
      const el = root.querySelector('[data-testid="timer"]');
      if (el) el.textContent = String(Math.ceil(timeLeft / 1000));
      if (timeLeft <= 0) window.clearInterval(timerId);
    }, 200);
  }

  function toast(msg) {
    if (disposed) return;
    let el = root.querySelector('[data-testid="level-toast"]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'l11-toast';
      el.dataset.testid = 'level-toast';
      el.setAttribute('role', 'status');
      const host = root.querySelector('.l11') || root;
      host.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (disposed) return;
      el.hidden = true;
    }, 2000);
  }

  function markHintSeen() {
    seenHint = true;
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
  }

  function chartSvg(stars) {
    return svgCache[chartFile(stars)] || '';
  }

  function prepareChart(host, stars) {
    host.innerHTML = chartSvg(stars);
    const svg = host.querySelector('svg');
    const path = svg && svg.querySelector('path[stroke-width="6"]');
    const dot = svg && svg.querySelector('circle');
    if (!path) return null;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    if (dot) dot.style.opacity = '0';
    return { path, dot, len };
  }

  function setChartProgress(chart, p) {
    if (!chart) return;
    const clamped = Math.max(0, Math.min(1, p));
    chart.path.style.strokeDashoffset = String(chart.len * (1 - clamped));
    if (chart.dot) {
      const point = chart.path.getPointAtLength(chart.len * clamped);
      chart.dot.setAttribute('cx', point.x);
      chart.dot.setAttribute('cy', point.y);
      chart.dot.style.opacity = clamped > 0 ? '1' : '0';
    }
  }

  function playSettle(stars, done) {
    if (disposed) return;
    const host = root.querySelector('[data-testid="chart"]');
    const sheet = root.querySelector('.sheet');
    kickSheet(sheet);
    if (reduceMotion || !host) { done(); return; }
    const chart = prepareChart(host, stars);
    const token = ++animToken;
    const t0 = performance.now();
    const go = () => {
      if (disposed || animToken !== token) return;
      cleanupAnim();
      if (disposed) return;
      done();
    };
    animAbort = new AbortController();
    root.addEventListener('click', (e) => {
      if (disposed || animToken !== token) return;
      if (e.target.closest('[data-act="back"]')) return;
      e.preventDefault();
      e.stopPropagation();
      go();
    }, { signal: animAbort.signal });
    const frame = (now) => {
      if (disposed || animToken !== token) return;
      const t = now - t0;
      setChartProgress(chart, t / 1200);
      if (t >= 1500) { go(); return; }
      animFrame = requestAnimationFrame(frame);
    };
    animFrame = requestAnimationFrame(frame);
    animTimer = window.setTimeout(go, 2500);
  }

  function playCeremony(stars) {
    if (disposed) return;
    const host = root.querySelector('[data-testid="chart"]');
    const sheet = root.querySelector('.sheet');
    const team = root.querySelector('[data-testid="team"]');
    kickSheet(sheet);
    const finish = () => enter(7);
    if (reduceMotion || !host) { finish(); return; }
    const chart = prepareChart(host, stars);
    const token = ++animToken;
    const t0 = performance.now();
    const starred = [false, false, false];
    let bossSwapped = false;
    let stopped = false;
    const go = () => {
      if (disposed || animToken !== token) return;
      cleanupAnim();
      if (disposed) return;
      finish();
    };
    animAbort = new AbortController();
    root.addEventListener('click', (e) => {
      if (disposed || animToken !== token) return;
      if (e.target.closest('[data-act="back"]')) return;
      e.preventDefault();
      e.stopPropagation();
      go();
    }, { signal: animAbort.signal });
    const frame = (now) => {
      if (disposed || animToken !== token) return;
      const t = now - t0;
      setChartProgress(chart, (t - 300) / 1200);
      if (!stopped && t >= 1500 && team) { team.classList.add('is-still'); stopped = true; }
      [1700, 1900, 2100].forEach((at, i) => {
        if (t < at || starred[i]) return;
        starred[i] = true;
        const el = root.querySelector(`[data-testid="star-${i + 1}"]`);
        if (!el) return;
        if (i < stars) {
          el.src = asset('ui-star-on.svg');
          el.classList.add('pop');
          if (i === 0 && vibrateEnabled()) { try { navigator.vibrate && navigator.vibrate(15); } catch { /* ignore */ } }
        } else {
          el.classList.add('dim');
        }
      });
      if (!bossSwapped && t >= 2300) {
        bossSwapped = true;
        const boss = root.querySelector('[data-testid="boss"]');
        if (boss) {
          boss.classList.add('swap');
          bossTimer = window.setTimeout(() => {
            bossTimer = 0;
            if (disposed || animToken !== token) return;
            boss.src = asset(bossFile(stars));
            boss.classList.remove('swap');
          }, 150);
        }
      }
      if (t >= 2600) { go(); return; }
      animFrame = requestAnimationFrame(frame);
    };
    animFrame = requestAnimationFrame(frame);
    animTimer = window.setTimeout(go, 4000);
  }

  function shell(body, dock) {
    const chip = (screen === 2 || screen === 5)
      ? esc(playing === 1 ? data.compare.round1Label : data.compare.round2Label)
      : '';
    return `<div class="l11" data-testid="level" data-screen="${screen}">
      <header class="l11-top">
        <button type="button" class="icon-btn" data-act="back" data-testid="back" aria-label="返回">${img('ui-back.svg')}<span class="visually-hidden">返回</span></button>
        <h1>${esc(data.title)}</h1>
        <span class="round-chip" data-testid="round-label">${chip}</span>
      </header>
      <div class="l11-scroll">${body}</div>
      <footer class="l11-dock">${dock}</footer>
    </div>`;
  }

  function primary(act, testid, label) {
    return `<button type="button" class="l11-primary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }
  function secondary(act, testid, label) {
    return `<button type="button" class="l11-secondary" data-act="${act}" data-testid="${testid}">${esc(label)}</button>`;
  }

  function boardHTML() {
    let html = '';
    for (let i = 0; i < slots.length; i++) {
      if (i > 0 && slots[i] && slots[i] === slots[i - 1]) continue;
      const row = Math.floor(i / cols) + 1;
      const col = (i % cols) + 1;
      if (!slots[i]) {
        html += `<div class="cell empty" data-index="${i}" data-testid="slot-${i}" style="grid-column:${col};grid-row:${row}"></div>`;
        continue;
      }
      const id = slots[i];
      let days = 1;
      while (slots[i + days] === id) days += 1;
      const card = cardBy(id);
      const kind = card && card.type === 'verify' ? 'verify' : 'build';
      html += `<button type="button" class="bar-card ${kind}" data-act="remove" data-id="${esc(id)}" data-testid="placed-${esc(id)}" style="grid-column:${col} / span ${days};grid-row:${row}">
        <span class="bar-name">${esc(card ? card.text : id)}</span>
        ${img('l11-cell-remove.svg', 'rm')}
      </button>`;
    }
    return `<div class="board" data-testid="board">${html}</div>`;
  }

  function trayHTML() {
    const show = revealed();
    return `<div class="tray" data-testid="tray">${cards.map(card => {
      const placed = slots.includes(card.id);
      const disabled = !placed && usedCount() + card.days > data.slots || (!placed && firstFit(card.days) < 0);
      const face = card.type === 'verify' ? 'l11-card-verify.svg' : (card.type === 'build' && !show ? 'l11-card-dev.svg' : 'l11-card-dev.svg');
      const icon = ICONS[card.id] || 'l11-icon-question.svg';
      const bubble = card.type === 'build' && show
        ? `<span class="bubble" data-testid="bubble-${esc(card.id)}">${esc(card.feedback)}</span>` : '';
      return `<div class="tray-item">
        <button type="button" class="tray-card" data-act="card" data-id="${esc(card.id)}" data-testid="card-${esc(card.id)}" ${disabled ? 'data-disabled="1"' : ''}>
          ${img(face, 'face')}
          <span class="card-body">
            ${img(icon, 'card-ico')}
            <span class="card-name">${esc(card.text)}</span>
            <span class="card-days">${esc(String(card.days))} 天</span>
          </span>
          ${placed ? `${img('l11-card-selected.svg', 'overlay')}${img('l11-icon-check.svg', 'badge-check')}` : ''}
          ${disabled ? `${img('l11-card-disabled.svg', 'overlay')}<span class="fit-tag">${esc(data.cannotFit)}</span>` : ''}
          ${card.type === 'build' && !show && !placed ? img('l11-icon-question.svg', 'qmark') : ''}
        </button>
        ${bubble}
      </div>`;
    }).join('')}</div>`;
  }

  function resourceHTML() {
    const used = usedCount();
    const pct = data.slots ? Math.round(used / data.slots * 100) : 0;
    const label = playing === 1 ? data.compare.round1Label : data.compare.round2Label;
    return `<div class="res" data-testid="resource">
      ${img('l11-icon-person.svg')}
      <strong data-testid="days">${used} / ${data.slots}</strong>
      <span class="meter" aria-hidden="true"><i style="width:${pct}%"></i></span>
      ${img('l11-icon-calendar.svg')}
      <span>${esc(label)}</span>
    </div>`;
  }

  function scheduleHTML() {
    const hint = (screen === 2 && !seenHint)
      ? `<button type="button" class="tap-hint" data-act="hint" data-testid="hint-tap">${img('l11-icon-tap.svg')}<span>${esc(data.scheduleHint)}</span></button>`
      : '';
    return `${resourceHTML()}${boardHTML()}${hint}${trayHTML()}`;
  }

  function verdictHTML(stars) {
    const icon = stars >= 3 ? 'l11-icon-check.svg' : 'l11-icon-question.svg';
    const text = data.stars.feedback[String(stars)] || '';
    const luck = stars === 2 ? `<p class="luck" data-testid="luck">${esc(data.stars.luckLine)}</p>` : '';
    return `<div class="verdict is-${stars}" data-testid="feedback"><span class="mark">${img(icon)}</span><p>${esc(text)}</p></div>${luck}`;
  }

  function starsHTML(stars, final) {
    const named = final ? ` role="img" aria-label="${stars} 颗星"` : '';
    return `<div class="stars" data-testid="stars"${named}>${[1, 2, 3].map(i => {
      const on = final && i <= stars;
      const cls = final ? 'star shown' : 'star';
      return `<img data-testid="star-${i}" class="${cls}" src="${esc(asset(on ? 'ui-star-on.svg' : 'ui-star-off.svg'))}" alt="">`;
    }).join('')}</div>`;
  }

  function compareHTML() {
    if (!round1 || !round2) return '';
    const fig = (which, stars, label) => `<figure data-testid="compare-${which}">
      <figcaption>${esc(label)}</figcaption>
      ${img(chartFile(stars))}
      <p class="curve-name">${esc(data.stars.curve[String(stars)] || '')}</p>
    </figure>`;
    return `<section data-testid="compare">
      <h2>${esc(data.compare.title)}</h2>
      <div class="pair">
        ${fig('round1', round1.stars, data.compare.round1Label)}
        ${fig('round2', round2.stars, data.compare.round2Label)}
      </div>
      <p class="note">${esc(data.compare.note)}</p>
    </section>`;
  }

  function learnedHTML() {
    return `<section class="learned" data-testid="learned">
      ${img('l11-icon-bulb.svg')}
      <div>
        <p data-testid="learned-summary">${esc(data.learned.summary)}</p>
        <p>${esc(data.learned.tomorrow)}</p>
        <p class="note">${esc(data.learned.disclaimer)}</p>
      </div>
    </section>`;
  }

  function teamHTML(still) {
    const svg = svgCache['l11-team.svg'] || '';
    return `<div class="l11-team${still ? ' is-still' : ''}" data-testid="team">${svg}</div>`;
  }

  function draw() {
    if (disposed) return;
    cleanupAnim();
    pending = screen === 2 || screen === 5 ? pending : false;
    let body = '';
    let dock = '';
    if (screen === 1) {
      body = `${img('l11-boss.svg', 'intro-boss')}
        <h2 data-testid="intro-title">${esc(data.intro.title)}</h2>
        <p class="intro-copy" data-testid="intro-body">${esc(data.intro.body)}</p>`;
      dock = primary('start', 'btn-start', data.intro.button);
    } else if (screen === 2 || screen === 5) {
      body = scheduleHTML();
      dock = primary('commit', 'btn-commit', data.buttons.commit);
    } else if (screen === 3) {
      const stars = round1 ? round1.stars : 1;
      body = `<div class="sheet" data-testid="screen-settle">${teamHTML(false)}
        <div class="chart-wrap" data-testid="chart"></div>
        <p class="curve-name">${esc(data.stars.curve[String(stars)] || '')}</p></div>`;
    } else if (screen === 4) {
      body = `<div class="sheet in" data-testid="screen-transition"><p class="intro-copy">${esc(data.transition.body)}</p></div>`;
      dock = primary('next-round', 'btn-transition', data.transition.button);
    } else if (screen === 6) {
      body = `<div class="sheet" data-testid="screen-ceremony">${teamHTML(false)}
        <div class="chart-wrap" data-testid="chart"></div>
        ${starsHTML(round2 ? round2.stars : 1, false)}
        <img class="boss" data-testid="boss" src="${esc(asset('l11-boss.svg'))}" alt="" draggable="false"></div>`;
    } else if (screen === 7) {
      const stars = round2 ? round2.stars : 1;
      body = `<div class="sheet in" data-testid="screen-result" data-stars="${stars}">
        ${teamHTML(true)}
        <img class="boss" data-testid="boss" src="${esc(asset(bossFile(stars)))}" alt="" draggable="false">
        ${starsHTML(stars, true)}
        ${verdictHTML(stars)}
        ${compareHTML()}
        ${learnedHTML()}
      </div>`;
      dock = `${primary('exit', 'btn-back-map', data.buttons.backToMap)}${secondary('replay', 'btn-replay', data.buttons.replay)}`;
    }
    root.innerHTML = shell(body, dock);
    root.dataset.screen = String(screen);
    if (pending && (screen === 2 || screen === 5)) {
      const remain = data.slots - usedCount();
      const text = String(data.partialConfirm).replaceAll('×', String(remain));
      root.querySelector('.l11').insertAdjacentHTML('beforeend', `<div class="mask" data-testid="partial-dialog">
        <div class="panel">
          <p>${esc(text)}</p>
          <div class="l11-dock">${primary('partial-yes', 'partial-yes', data.buttons.partialYes)}${secondary('partial-no', 'partial-no', data.buttons.partialNo)}</div>
        </div>
      </div>`);
    }
    if (ENABLE_DRAG && (screen === 2 || screen === 5)) {
      root.querySelectorAll('[data-act="card"]').forEach(attachDrag);
    }
    if (screen === 3) playSettle(round1 ? round1.stars : 1, () => enter(4));
    if (screen === 6) playCeremony(round2 ? round2.stars : 1);
  }

  function attachDrag(btn) {
    if (!ENABLE_DRAG) return;
    btn.addEventListener('pointerdown', (e) => {
      if (!ENABLE_DRAG) return;
      if (btn.dataset.disabled === '1') return;
      const id = btn.getAttribute('data-id');
      if (!id || slots.includes(id)) return;
      const card = cardBy(id);
      if (!card) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      let ghost = null;
      let hover = -1;
      const move = (ev) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!dragging) {
          if (Math.hypot(dx, dy) < 8) return;
          dragging = true;
          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = card.text;
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        hover = -1;
        root.querySelectorAll('.cell.empty').forEach(el => {
          const rect = el.getBoundingClientRect();
          const cx = Math.min(Math.max(ev.clientX, rect.left), rect.right);
          const cy = Math.min(Math.max(ev.clientY, rect.top), rect.bottom);
          const near = Math.hypot(ev.clientX - cx, ev.clientY - cy) <= 24;
          const index = Number(el.dataset.index);
          el.classList.toggle('drop', near && canPlaceAt(index, card.days));
          if (near && canPlaceAt(index, card.days)) hover = index;
        });
      };
      const up = () => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        if (ghost) ghost.remove();
        if (!dragging) return;
        dragGuardUntil = Date.now() + 400;
        if (hover >= 0 && canPlaceAt(hover, card.days)) {
          placeAt(hover, card);
          markHintSeen();
          pending = false;
          draw();
        } else toast(data.cannotFit);
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
  }

  function finishRound() {
    if (disposed) return;
    pending = false;
    const stars = grade();
    if (playing === 1) {
      round1 = { stars };
      slots = emptySlots();
      enter(3);
      return;
    }
    round2 = { stars };
    enter(6);
  }

  function enter(n) {
    if (disposed) return;
    if (n === 6 && reduceMotion) n = 7;
    if ((n === 3 || n === 4) && !round1) n = 2;
    if ((n === 6 || n === 7) && !round2) n = 5;
    screen = n;
    if (n === 2) playing = 1;
    if (n === 5) playing = 2;
    // 进度只在结果屏仍然挂载时写入。仪式中返回不得记 done/stars。
    if (n === 7 && round2 && api && api.complete) {
      try { api.complete({ stars: round2.stars, score: round2.stars, stay: true }); } catch { /* ignore */ }
    }
    if (disposed) return;
    resetTimer(n);
    remember(n);
    persist();
    if (disposed) return;
    draw();
  }

  function fresh() {
    forgetRun();
    deal(false);
    playing = 1;
    round1 = null;
    round2 = null;
    slots = emptySlots();
    pending = false;
    enter(1);
  }

  function onClick(e) {
    if (disposed) return;
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    if (Date.now() < dragGuardUntil) return;
    const act = el.getAttribute('data-act');
    if (act === 'back') { api.exit(); return; }
    if (act === 'start') { slots = emptySlots(); enter(2); return; }
    if (act === 'hint') { markHintSeen(); draw(); return; }
    if (act === 'card') {
      const card = cardBy(el.getAttribute('data-id'));
      if (!card) return;
      if (slots.includes(card.id)) return;
      if (el.dataset.disabled === '1' || firstFit(card.days) < 0) { toast(data.cannotFit); return; }
      placeAt(firstFit(card.days), card);
      markHintSeen();
      draw();
      return;
    }
    if (act === 'remove') {
      removeCard(el.getAttribute('data-id'));
      draw();
      return;
    }
    if (act === 'commit') {
      if (usedCount() < data.slots) { pending = true; draw(); return; }
      finishRound();
      return;
    }
    if (act === 'partial-yes') { finishRound(); return; }
    if (act === 'partial-no') { pending = false; draw(); return; }
    if (act === 'next-round') { playing = 2; slots = emptySlots(); enter(5); return; }
    if (act === 'exit') {
      try { clearResume(bookId, levelId); } catch { /* ignore */ }
      api.exit();
      return;
    }
    if (act === 'replay') {
      deal(true);
      playing = 1;
      round1 = null;
      round2 = null;
      slots = emptySlots();
      pending = false;
      enter(1);
      return;
    }
    if (act === 'resume-go') {
      const n = normalize(Number(el.getAttribute('data-screen')));
      if (n === 5 || n === 6 || n === 7) playing = 2;
      if (n === 2 || n === 5) slots = emptySlots();
      enter(n);
      return;
    }
    if (act === 'resume-new') { fresh(); }
  }

  function normalize(n) {
    if (!cards.length) deal(false);
    if ((n === 3 || n === 4) && !round1) return 2;
    if ((n === 6 || n === 7) && !round2) return round1 ? 5 : 2;
    if (!SCREEN[n]) return 1;
    return n;
  }

  if (disposed) return unmount;
  clickBound = true;
  root.addEventListener('click', onClick);
  const saved = (() => { try { return readResume(bookId, levelId); } catch { return null; } })();
  if (disposed) { unmount(); return unmount; }
  if (saved && saved.screen >= 2) {
    restore();
    if (disposed) { unmount(); return unmount; }
    screen = 0;
    root.innerHTML = `<div class="l11" data-testid="level">
      <div class="mask" data-testid="resume-dialog">
        <div class="panel">
          <div class="l11-dock">
            ${primary('resume-go', 'resume-continue', `从第 ${saved.screen} 屏继续`)}
            ${secondary('resume-new', 'resume-restart', '从头开始')}
          </div>
        </div>
      </div>
    </div>`;
    const go = root.querySelector('[data-act="resume-go"]');
    if (go) go.setAttribute('data-screen', String(saved.screen));
    return unmount;
  }
  fresh();
  return unmount;
}
