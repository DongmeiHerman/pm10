// 关卡可选文案。策划写在 data.json 的 ui 里；缺了或类型不对就用默认值。
export const UI_DEFAULTS = {
  paused: '暂停',
  zeroDelta: '+0',
  unlocked: '已解锁',
  comeBack: '回来拿星',
  resumePrompt: '上次做到第 × 张单子，接着做吗？',
  resumeContinue: '接着做',
  resumeRestart: '从头开始',
  learnedCollapsed: '这关学到了',
  noteShowMs: 3000
};

export const STARS_SR = '得了 × 颗星，满分 × 颗';
export const MISSED_SR = '×，没测';
// 判定弹窗分数行的读屏句。× 换成数字。画面仍写 +2 / +0 / -1，不进 data.json。
export const JUDGE_PLUS_SR = '加 × 分';
export const JUDGE_ZERO_SR = '加 0 分';
export const JUDGE_MINUS_SR = '减 × 分';

export function uiText(data, defaults) {
  const src = data && typeof data === 'object' && data.ui && typeof data.ui === 'object' ? data.ui : {};
  const extra = defaults && typeof defaults === 'object' ? defaults : null;
  const base = extra ? { ...UI_DEFAULTS, ...extra } : UI_DEFAULTS;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const fallback = base[key];
    const value = src[key];
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}
