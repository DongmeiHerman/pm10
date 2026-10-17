// 进度存储：总键 pm10:progress:v1，内部按 "<book-id>/<level-id>" 记录每关；存储不可用时退回内存
export const PROGRESS_KEY = 'pm10:progress:v1';
export const levelKey = (bookId, levelId) => `${bookId}/${levelId}`;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const mem = {};
function ls(){try{const k='__pm10_t';localStorage.setItem(k,'1');localStorage.removeItem(k);return localStorage;}catch{return null;}}
const store = ls();
export const storageAvailable = !!store;
const empty = () => ({ version: 1, levels: {} });

function readRaw(){
  try{
    const raw = store ? store.getItem(PROGRESS_KEY) : mem[PROGRESS_KEY];
    const d = raw ? JSON.parse(raw) : empty();
    return d && d.version === 1 && d.levels ? d : empty();
  }catch{ return empty(); }
}

// resume.ts 超过 7 天则丢掉这份中途记录，已通关的星级保留
function expireResumes(p){
  const now = Date.now();
  let changed = false;
  for(const k of Object.keys(p.levels)){
    const rec = p.levels[k];
    const ts = rec && rec.resume && rec.resume.ts;
    if(typeof ts === 'number' && now - ts > WEEK_MS){
      rec.resume = null;
      changed = true;
    }
  }
  return changed;
}

export function loadProgress(){
  const p = readRaw();
  if(expireResumes(p)) saveProgress(p);
  return p;
}
export function saveProgress(p){const s=JSON.stringify(p);try{store?store.setItem(PROGRESS_KEY,s):(mem[PROGRESS_KEY]=s);}catch{mem[PROGRESS_KEY]=s;}}
export function isDone(p, b, l){ return !!p.levels[levelKey(b,l)]?.done; }

function clampStars(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(3, Math.round(x)));
}

// stars 只认星级字段，不把分数当成星。写入时取新旧最大值。
function bestStars(prev, incoming){
  const old = prev && prev.stars != null && prev.stars !== '' ? clampStars(prev.stars) : 0;
  if(incoming == null || incoming === '' || Number.isNaN(Number(incoming))) return old;
  return Math.max(old, clampStars(incoming));
}

export function completeLevel(b, l, data={}){
  const p = loadProgress();
  const key = levelKey(b, l);
  const prev = p.levels[key] || {};
  const stars = bestStars(prev, data.stars);
  const lastScore = data.score != null && data.score !== '' && Number.isFinite(Number(data.score))
    ? Number(data.score)
    : (prev.lastScore != null ? prev.lastScore : null);
  p.levels[key] = {
    done: true,
    at: Date.now(),
    stars,
    lastScore,
    resume: prev.resume && prev.resume.screen != null ? prev.resume : null
  };
  saveProgress(p);
  return p.levels[key];
}

export function readResume(b, l){
  const rec = loadProgress().levels[levelKey(b, l)];
  if(!rec || !rec.resume || rec.resume.screen == null) return null;
  return rec.resume;
}

export function saveResume(b, l, screen){
  const p = loadProgress();
  const key = levelKey(b, l);
  const prev = p.levels[key] || {};
  p.levels[key] = { ...prev, resume: { screen: Number(screen), ts: Date.now() } };
  saveProgress(p);
}

export function clearResume(b, l){
  const p = loadProgress();
  const rec = p.levels[levelKey(b, l)];
  if(!rec || !rec.resume) return;
  rec.resume = null;
  saveProgress(p);
}

// 连续没过、自动解锁、续玩快照。键都以 pm10: 开头，清除本机进度时一并删掉。
export const L12_FAILS_KEY = 'pm10:l12-fails:v1';
export const L12_RUN_KEY = 'pm10:l12-run:v1';

function readJsonMap(key){
  try{
    const raw = store ? store.getItem(key) : mem[key];
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }catch{ return {}; }
}

function writeJsonMap(key, data){
  const s = JSON.stringify(data);
  try{ store ? store.setItem(key, s) : (mem[key] = s); }catch{ mem[key] = s; }
}

export function readFailStreak(b, l){
  const n = Number(readJsonMap(L12_FAILS_KEY)[levelKey(b, l)]);
  if(!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function bumpFailStreak(b, l){
  const map = readJsonMap(L12_FAILS_KEY);
  const key = levelKey(b, l);
  const n = readFailStreak(b, l) + 1;
  map[key] = n;
  writeJsonMap(L12_FAILS_KEY, map);
  return n;
}

export function clearFailStreak(b, l){
  const map = readJsonMap(L12_FAILS_KEY);
  const key = levelKey(b, l);
  if(map[key] == null) return;
  delete map[key];
  writeJsonMap(L12_FAILS_KEY, map);
}

export function readLevelRun(b, l){
  const rec = readJsonMap(L12_RUN_KEY)[levelKey(b, l)];
  return rec && typeof rec === 'object' ? rec : null;
}

export function writeLevelRun(b, l, run){
  const map = readJsonMap(L12_RUN_KEY);
  map[levelKey(b, l)] = run;
  writeJsonMap(L12_RUN_KEY, map);
}

export function clearLevelRun(b, l){
  const map = readJsonMap(L12_RUN_KEY);
  const key = levelKey(b, l);
  if(map[key] == null) return;
  delete map[key];
  writeJsonMap(L12_RUN_KEY, map);
}

// 连续没过达到上限：不写 done，不当作通关。已通关的记录原样返回。已有星只升不降。
// 没过关也记下这一次的分数和星。星只升不降。不写 done。
export function rememberScore(b, l, stars, score){
  const p = loadProgress();
  const key = levelKey(b, l);
  const prev = p.levels[key] || {};
  const next = {
    ...prev,
    stars: bestStars(prev, stars),
    lastScore: Number(score)
  };
  if(!prev.done) delete next.done;
  p.levels[key] = next;
  saveProgress(p);
  return next;
}

export function markAutoUnlocked(b, l){
  const p = loadProgress();
  const key = levelKey(b, l);
  const prev = p.levels[key] || {};
  if(prev.done) return prev;
  const stars = prev.stars != null && prev.stars !== '' ? clampStars(prev.stars) : 0;
  const next = { ...prev, autoUnlocked: true, stars };
  if(!prev.done) delete next.done;
  p.levels[key] = next;
  saveProgress(p);
  return next;
}

export function isClearedOrUnlocked(p, b, l){
  const rec = p && p.levels ? p.levels[levelKey(b, l)] : null;
  return !!(rec && (rec.done || rec.autoUnlocked));
}

export const SETTINGS_KEY = 'pm10:settings:v1';

export function vibrateEnabled(){
  try{
    const raw = store ? store.getItem(SETTINGS_KEY) : mem[SETTINGS_KEY];
    if(raw == null || raw === '') return true;
    const data = JSON.parse(raw);
    if(!data || typeof data.vibrate !== 'boolean') return true;
    return data.vibrate;
  }catch{ return true; }
}

export function setVibrate(on){
  const s = JSON.stringify({ vibrate: !!on });
  try{ store ? store.setItem(SETTINGS_KEY, s) : (mem[SETTINGS_KEY] = s); }catch{ mem[SETTINGS_KEY] = s; }
}

export function clearAllPm10(){
  const wipe = (area) => {
    try{
      const keys = [];
      for(let i = 0; i < area.length; i++) keys.push(area.key(i));
      for(const k of keys) if(k && k.startsWith('pm10:')) area.removeItem(k);
    }catch{ /* ignore */ }
  };
  try{ wipe(localStorage); }catch{ /* ignore */ }
  try{ wipe(sessionStorage); }catch{ /* ignore */ }
  for(const k of Object.keys(mem)) if(k.startsWith('pm10:')) delete mem[k];
}
