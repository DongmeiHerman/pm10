import { timeLimitMs } from './time.js';

// readTestParams(search, hookOn). Seed applies either way.
// l14seq / l14stop / l14t / l14time apply only when hookOn is true.
// l14t follows l13ff: finite, > 0, and strictly below the real seconds.
// Calm scales by factor first (timeLimitMs), then the compare.

const STOPS = ['hint', 'summary', 'result', 'book'];
const TIMES = ['std', 'calm', 'off'];
const LETTERS = { o: 'own', l: 'list', s: 'loud', b: 'block', t: 'timeout' };

function paramsOf(search) {
  const raw = String(search == null ? '' : search);
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(q);
}

export function readTestParams(search, hookOn) {
  let params;
  try {
    params = paramsOf(search);
  } catch {
    params = new URLSearchParams();
  }
  const seedRaw = params.get('seed');
  const out = {
    seq: null,
    stop: null,
    t: null,
    time: null,
    seed: seedRaw == null || seedRaw === '' ? null : seedRaw
  };
  if (hookOn !== true) return out;
  const seq = params.get('l14seq');
  out.seq = seq == null || seq === '' ? null : seq;
  const stop = params.get('l14stop');
  out.stop = STOPS.includes(stop) ? stop : null;
  const t = Number(params.get('l14t'));
  out.t = Number.isFinite(t) && t > 0 ? t : null;
  const time = params.get('l14time');
  out.time = TIMES.includes(time) ? time : null;
  return out;
}

// Seconds to run, or null when the node / mode is untimed.
// requested is used only when it is strictly below the scaled seconds.
export function applyL14t(baseSec, mode, factor, requested) {
  const ms = timeLimitMs({ timeLimit: Number(baseSec) }, mode, factor);
  if (ms == null) return null;
  const actual = ms / 1000;
  const n = Number(requested);
  if (Number.isFinite(n) && n > 0 && n < actual) return n;
  return actual;
}

// Pick by type letter, not by slot. t is the real timeout, not an option.
export function pickBySeq(node, letter) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (typeof letter !== 'string' || !Object.prototype.hasOwnProperty.call(LETTERS, letter)) return null;
  const type = LETTERS[letter];
  if (type === 'timeout') return { type: 'timeout', option: null };
  const options = Array.isArray(node.options) ? node.options : [];
  const option = options.find((opt) => opt && opt.type === type) || null;
  if (!option) return null;
  return { type, option };
}
