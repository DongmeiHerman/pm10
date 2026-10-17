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
