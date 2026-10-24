function copyWall(wall, slots) {
  const cap = Number.isInteger(slots) && slots > 0
    ? slots
    : (Array.isArray(wall) && wall.length > 0 ? wall.length : 3);
  const src = Array.isArray(wall) ? wall : [];
  const out = [];
  for (let i = 0; i < cap; i += 1) {
    const id = src[i];
    out.push(typeof id === 'string' && id !== '' ? id : null);
  }
  return out;
}

function copyPool(pool) {
  return Array.isArray(pool) ? pool.slice() : [];
}

export function emptyWall(slots) {
  return copyWall([], slots);
}

export function filledCount(wall) {
  const slots = Array.isArray(wall) ? wall : [];
  let n = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (typeof slots[i] === 'string' && slots[i] !== '') n += 1;
  }
  return n;
}

export function firstEmptyIndex(wall) {
  const slots = Array.isArray(wall) ? wall : [];
  for (let i = 0; i < slots.length; i += 1) {
    if (typeof slots[i] !== 'string' || slots[i] === '') return i;
  }
  return -1;
}

export function isFull(wall) {
  return Array.isArray(wall) && wall.length > 0 && firstEmptyIndex(wall) < 0;
}

export function startGate(filled, slots) {
  const cap = Number.isFinite(Number(slots)) && Number(slots) > 0 ? Math.floor(Number(slots)) : 3;
  const n = Number.isFinite(Number(filled)) && Number(filled) > 0 ? Math.floor(Number(filled)) : 0;
  const remaining = Math.max(0, cap - n);
  if (remaining <= 0) {
    return { enabled: true, remaining: 0, reasonKey: 'startReady' };
  }
  if (n <= 0) {
    return { enabled: false, remaining, reasonKey: 'startNeedFull' };
  }
  return { enabled: false, remaining, reasonKey: 'startNeedMore' };
}

export function pasteSticker(wall, pool, stickerId) {
  const nextWall = copyWall(wall);
  const nextPool = copyPool(pool);
  const id = typeof stickerId === 'string' ? stickerId : '';
  if (!id) return { ok: false, reason: 'invalid', wall: nextWall, pool: nextPool };
  for (let i = 0; i < nextWall.length; i += 1) {
    if (nextWall[i] === id) {
      return { ok: false, reason: 'onWall', wall: nextWall, pool: nextPool };
    }
  }
  const empty = firstEmptyIndex(nextWall);
  if (empty < 0) return { ok: false, reason: 'full', wall: nextWall, pool: nextPool };
  const at = nextPool.indexOf(id);
  if (at < 0) return { ok: false, reason: 'notInPool', wall: nextWall, pool: nextPool };
  nextWall[empty] = id;
  nextPool.splice(at, 1);
  return { ok: true, reason: '', wall: nextWall, pool: nextPool, index: empty };
}

export function moveUp(wall, index) {
  const next = copyWall(wall);
  const i = Number(index);
  if (!Number.isInteger(i) || i <= 0 || i >= next.length) return next;
  if (typeof next[i] !== 'string' || next[i] === '') return next;
  const tmp = next[i - 1];
  next[i - 1] = next[i];
  next[i] = tmp;
  return next;
}

export function moveDown(wall, index) {
  const next = copyWall(wall);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= next.length - 1) return next;
  if (typeof next[i] !== 'string' || next[i] === '') return next;
  const tmp = next[i + 1];
  next[i + 1] = next[i];
  next[i] = tmp;
  return next;
}

export function moveOut(wall, pool, index) {
  const nextWall = copyWall(wall);
  const nextPool = copyPool(pool);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= nextWall.length) {
    return { wall: nextWall, pool: nextPool, id: null };
  }
  const id = nextWall[i];
  if (typeof id !== 'string' || id === '') {
    return { wall: nextWall, pool: nextPool, id: null };
  }
  nextWall[i] = null;
  nextPool.push(id);
  return { wall: nextWall, pool: nextPool, id };
}

export function pasteStickerAt(wall, pool, stickerId, slotIndex) {
  const nextWall = copyWall(wall);
  const nextPool = copyPool(pool);
  const id = typeof stickerId === 'string' ? stickerId : '';
  if (!id) return { ok: false, reason: 'invalid', wall: nextWall, pool: nextPool };
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || index >= nextWall.length) {
    return { ok: false, reason: 'badSlot', wall: nextWall, pool: nextPool };
  }
  for (let i = 0; i < nextWall.length; i += 1) {
    if (nextWall[i] === id) {
      return { ok: false, reason: 'onWall', wall: nextWall, pool: nextPool };
    }
  }
  if (isFull(nextWall)) return { ok: false, reason: 'full', wall: nextWall, pool: nextPool };
  if (typeof nextWall[index] === 'string' && nextWall[index] !== '') {
    return { ok: false, reason: 'occupied', wall: nextWall, pool: nextPool };
  }
  const at = nextPool.indexOf(id);
  if (at < 0) return { ok: false, reason: 'notInPool', wall: nextWall, pool: nextPool };
  nextWall[index] = id;
  nextPool.splice(at, 1);
  return { ok: true, reason: '', wall: nextWall, pool: nextPool, index };
}

export function swapSlots(wall, fromIndex, toIndex) {
  const next = copyWall(wall);
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  if (typeof next[from] !== 'string' || next[from] === '') return next;
  if (from === to) return next;
  const tmp = next[to];
  next[to] = next[from];
  next[from] = typeof tmp === 'string' && tmp !== '' ? tmp : null;
  return next;
}
