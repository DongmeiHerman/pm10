import { testHookOn } from './test-hook.js';
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

const TEST_HOOK_FLAGS = ['l12test', 'l13test', 'l14test'];
function hookSkipsExpireWrite(){
  try{
    if(typeof location === 'undefined' || !location) return false;
    return TEST_HOOK_FLAGS.some(flag => testHookOn(location.hostname, location.search, flag));
  }catch{ return false; }
}

export function loadProgress(){
  const p = readRaw();
  // 过期的 resume 先在返回值里置空。测试开关开着时不写回；没有 location 时照常写回。
  if(expireResumes(p) && !hookSkipsExpireWrite()) saveProgress(p);
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

// Checked clears. Real storage must read back clear. A failed write, or a
// resume / run that is still there, throws. No real storage: clear memory
// and do not throw. clearResume / clearLevelRun above stay as they are.
const CLEAR_RESUME_CHECKED_FAILED = 'pm10 clearResumeChecked failed';
const CLEAR_LEVEL_RUN_CHECKED_FAILED = 'pm10 clearLevelRunChecked failed';

function resumeStillThere(key){
  let raw;
  try{ raw = store.getItem(PROGRESS_KEY); }
  catch{ return true; }
  if(raw == null || raw === '') return false;
  let data;
  try{ data = JSON.parse(raw); }
  catch{ return true; }
  if(!data || data.version !== 1 || !data.levels || typeof data.levels !== 'object') return false;
  const rec = data.levels[key];
  if(!rec || !rec.resume || rec.resume.screen == null) return false;
  const ts = rec.resume.ts;
  if(typeof ts === 'number' && Date.now() - ts > WEEK_MS) return false;
  return true;
}

function levelRunStillThere(key){
  let raw;
  try{ raw = store.getItem(L12_RUN_KEY); }
  catch{ return true; }
  if(raw == null || raw === '') return false;
  let data;
  try{ data = JSON.parse(raw); }
  catch{ return true; }
  if(!data || typeof data !== 'object' || Array.isArray(data)) return true;
  return data[key] != null;
}

export function clearResumeChecked(b, l){
  if(!store){
    clearResume(b, l);
    return;
  }
  const key = levelKey(b, l);
  const p = loadProgress();
  const rec = p.levels[key];
  if(rec && rec.resume){
    rec.resume = null;
    let text;
    try{ text = JSON.stringify(p); }
    catch{ throw new Error(CLEAR_RESUME_CHECKED_FAILED); }
    try{ store.setItem(PROGRESS_KEY, text); }
    catch{
      mem[PROGRESS_KEY] = text;
      throw new Error(CLEAR_RESUME_CHECKED_FAILED);
    }
  }
  if(resumeStillThere(key)) throw new Error(CLEAR_RESUME_CHECKED_FAILED);
}

export function clearLevelRunChecked(b, l){
  if(!store){
    clearLevelRun(b, l);
    return;
  }
  const key = levelKey(b, l);
  let raw;
  try{ raw = store.getItem(L12_RUN_KEY); }
  catch{ throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED); }
  let map;
  if(raw == null || raw === '') map = {};
  else{
    let data;
    try{ data = JSON.parse(raw); }
    catch{ throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED); }
    if(!data || typeof data !== 'object' || Array.isArray(data)){
      throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED);
    }
    map = data;
  }
  if(map[key] != null){
    delete map[key];
    let text;
    try{ text = JSON.stringify(map); }
    catch{ throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED); }
    try{ store.setItem(L12_RUN_KEY, text); }
    catch{
      mem[L12_RUN_KEY] = text;
      throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED);
    }
  }
  if(levelRunStillThere(key)) throw new Error(CLEAR_LEVEL_RUN_CHECKED_FAILED);
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

// Seen endings, separate key. Bad JSON, non-objects and arrays read as an empty map.
// One level entry: non-arrays become []; non-empty strings only; first-seen order; keep the latest 16.
// The four ending ids are filtered again in the level pure function. Do not import levels/.
export const ENDINGS_KEY = 'pm10:endings:v1';
const SEEN_LIMIT = 16;

function cleanSeenList(value){
  if(!Array.isArray(value)) return [];
  const out = [];
  const got = new Set();
  for(let i = 0; i < value.length; i++){
    const item = value[i];
    if(typeof item !== 'string' || item === '' || got.has(item)) continue;
    got.add(item);
    out.push(item);
  }
  // First-seen order. Past 16, drop the front and keep the latest 16. Read and write share this.
  if(out.length <= SEEN_LIMIT) return out;
  return out.slice(out.length - SEEN_LIMIT);
}

function sameSeen(a, b){
  if(a.length !== b.length) return false;
  for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) return false;
  return true;
}

export function readSeenEndings(b, l){
  return cleanSeenList(readJsonMap(ENDINGS_KEY)[levelKey(b, l)]);
}

export function addSeenEnding(b, l, ending){
  const map = readJsonMap(ENDINGS_KEY);
  const key = levelKey(b, l);
  const prev = cleanSeenList(map[key]);
  const extra = typeof ending === 'string' && ending !== '' ? [ending] : [];
  const next = cleanSeenList(prev.concat(extra));
  if(sameSeen(prev, next)) return next;
  map[key] = next;
  writeJsonMap(ENDINGS_KEY, map);
  return next.slice();
}
