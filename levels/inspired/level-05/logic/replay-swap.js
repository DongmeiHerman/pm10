// Replay pool swap for level 5. Pure: no DOM, no storage.
// Prefer an unused replaySwap sticker of the same kind. If every alt of that
// kind is already in this round, take a same-kind catalog id that is not.
// Skip the kind when nothing can come in, so a 4/4 pool stays 4/4.

function isStickerId(id) {
  return typeof id === 'string' && id !== '';
}

function copyIdList(poolIds) {
  if (!Array.isArray(poolIds)) return [];
  const out = [];
  for (let i = 0; i < poolIds.length; i += 1) {
    const id = poolIds[i];
    if (isStickerId(id)) out.push(id);
  }
  return out;
}

function pushStickers(list, seen, out) {
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || !isStickerId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
}

function idsOfKindFromList(list, kind) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || item.kind !== kind || !isStickerId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item.id);
  }
  return out;
}

function kindMap(catalog, replaySwap) {
  const map = new Map();
  const put = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (!item || !isStickerId(item.id)) continue;
      if (item.kind !== 'output' && item.kind !== 'result') continue;
      if (!map.has(item.id)) map.set(item.id, item.kind);
    }
  };
  put(catalog);
  const alt = replaySwap && replaySwap.pool;
  put(alt);
  return map;
}

function drawUnit(random) {
  const rng = typeof random === 'function' ? random : Math.random;
  let n = Number(rng());
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n >= 1) n = 0.999999999999;
  return n;
}

function pickIndex(length, random) {
  if (length <= 0) return 0;
  const i = Math.floor(drawUnit(random) * length);
  return i >= length ? length - 1 : i;
}

export function initialPoolIds(stickers) {
  const list = Array.isArray(stickers) ? stickers : [];
  const ids = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || !isStickerId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

export function stickerCatalog(stickers, replaySwap) {
  const out = [];
  const seen = new Set();
  pushStickers(stickers, seen, out);
  pushStickers(replaySwap && replaySwap.pool, seen, out);
  return out;
}

export function idsOfKind(poolIds, catalog, kind) {
  const map = kindMap(catalog, null);
  const ids = copyIdList(poolIds);
  const out = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (map.get(ids[i]) === kind) out.push(ids[i]);
  }
  return out;
}

export function countByKind(poolIds, catalog) {
  return {
    output: idsOfKind(poolIds, catalog, 'output').length,
    result: idsOfKind(poolIds, catalog, 'result').length
  };
}

export function swapPoolForReplay(input) {
  const src = input && typeof input === 'object' ? input : {};
  const catalog = Array.isArray(src.stickersOrCatalog) ? src.stickersOrCatalog : [];
  const replaySwap = src.replaySwap && typeof src.replaySwap === 'object' ? src.replaySwap : null;
  const random = src.random;
  const working = copyIdList(src.poolIds);
  const kinds = kindMap(catalog, replaySwap);
  const original = new Set(working);
  const removed = [];
  const added = [];
  const kindOrder = ['output', 'result'];
  for (let k = 0; k < kindOrder.length; k += 1) {
    const kind = kindOrder[k];
    const indexes = [];
    for (let i = 0; i < working.length; i += 1) {
      if (kinds.get(working[i]) === kind) indexes.push(i);
    }
    let choices = idsOfKindFromList(replaySwap && replaySwap.pool, kind).filter((id) => !original.has(id));
    if (choices.length === 0) {
      choices = idsOfKindFromList(catalog, kind).filter((id) => !original.has(id));
    }
    if (indexes.length === 0 || choices.length === 0) continue;
    const at = indexes[pickIndex(indexes.length, random)];
    const addId = choices[pickIndex(choices.length, random)];
    removed.push(working[at]);
    added.push(addId);
    working[at] = addId;
  }
  return { poolIds: working, removed, added };
}
