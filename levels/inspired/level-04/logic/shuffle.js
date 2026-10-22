export function hashSeed(text) {
  let n = 0;
  for (const ch of String(text)) n = (Math.imul(n, 31) + ch.charCodeAt(0)) >>> 0;
  return n;
}

// Caller passes the seed. Numbers stay numeric; anything else is hashed. Same seed, same sequence.
export function makeRng(seed) {
  let state;
  if (typeof seed === 'number' && Number.isFinite(seed)) state = seed >>> 0;
  else if (typeof seed === 'string' && seed.trim() !== '' && Number.isFinite(Number(seed))) state = Number(seed) >>> 0;
  else state = hashSeed(seed == null ? '' : String(seed));
  return function rng() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function variantCount(acts) {
  let count = 0;
  for (const act of acts) {
    const n = act && Array.isArray(act.variants) ? act.variants.length : 0;
    if (n > count) count = n;
  }
  return count || 1;
}

// playIndex 0 is the first play (variant 1). Later plays share one index and wrap.
export function pickVariant(acts, playIndex) {
  const list = Array.isArray(acts) ? acts : [];
  const count = variantCount(list);
  const n = Number(playIndex);
  const play = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const index = play % count;
  const picked = list.map((act) => {
    const variants = act && Array.isArray(act.variants) ? act.variants : [];
    const local = variants.length ? index % variants.length : 0;
    return {
      actId: act && act.id,
      index: local,
      variant: variants.length ? variants[local] : null
    };
  });
  return { index, acts: picked };
}

function shouldShuffle(replay, playIndex) {
  if (!replay || !replay.shuffleOptions) return false;
  const n = Number(playIndex);
  const first = !(Number.isFinite(n) && n > 0);
  if (first && !replay.shuffleFirstPlay) return false;
  return true;
}

// Shuffles options inside each node. The caller passes the random function.
export function shuffleOptions(nodes, rng, replay, playIndex) {
  const list = Array.isArray(nodes) ? nodes : [];
  const shuffle = shouldShuffle(replay, playIndex);
  if (shuffle && typeof rng !== 'function') throw new TypeError('rng required');
  return list.map((node) => {
    const options = node && Array.isArray(node.options) ? node.options.slice() : [];
    if (shuffle) {
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = options[i];
        options[i] = options[j];
        options[j] = tmp;
      }
    }
    return { ...node, options };
  });
}
