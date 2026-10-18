// 本机自动驾驶开关。默认认 l12test；第 3 关传入 l13test。
export function testHookOn(hostname, search, flag = 'l12test') {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local) return false;
  const raw = String(search || '');
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(q).get(flag) === '1';
}
