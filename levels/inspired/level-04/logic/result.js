import { fillX } from './score.js';
import { countLeft, endingName, mergeSeen } from './endings.js';

function endingId(ending) {
  if (typeof ending === 'string') return ending;
  if (ending && typeof ending === 'object' && typeof ending.id === 'string') return ending.id;
  return '';
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

// Copy is passed in: ui.endingLabel, ui.failEndingLabel, ui.endingsLeft,
// ui.endingsAll, ui.threeStarTip, fail.body. Names come from endings.<id>.name.
// 3 stars counts this run's ending before the "left" number.
export function resultLines(input) {
  const src = input && typeof input === 'object' ? input : {};
  const ui = src.ui && typeof src.ui === 'object' ? src.ui : {};
  const fail = src.fail && typeof src.fail === 'object' ? src.fail : {};
  const id = endingId(src.ending);
  const name = endingName(src.ending, src.endings);
  if (src.passed !== true) {
    return { first: fillX(text(ui.failEndingLabel), name), last: text(fail.body) };
  }
  const first = fillX(text(ui.endingLabel), name);
  if (Number(src.stars) !== 3) return { first, last: text(ui.threeStarTip) };
  const seen = mergeSeen(src.seenBefore, id, src.known);
  const left = countLeft(seen, src.known);
  return {
    first,
    last: left > 0 ? fillX(text(ui.endingsLeft), left) : text(ui.endingsAll)
  };
}
