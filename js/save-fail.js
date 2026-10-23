// Settlement hint copy lives only in SAVE_FAIL_NOTE.
// Call resetSaveFailure() before this round's writes. A missed progress-key write
// stays flagged until the next reset; a later success in the same round does not clear it.
// The star row is role=img, so the note is the next sibling. Text inside that node is not read.

export const SAVE_FAIL_NOTE = '这局没存上，可能是手机空间满了';

let failed = false;

export function resetSaveFailure() {
  failed = false;
}

export function noteProgressWriteFailed() {
  failed = true;
}

export function lastWriteFailed() {
  return failed;
}

export function insertSaveFailNote(starsEl) {
  if (!failed || !starsEl || typeof starsEl.insertAdjacentElement !== 'function') return null;
  if (!starsEl.parentNode) return null;
  const next = starsEl.nextElementSibling;
  if (next && typeof next.getAttribute === 'function' && next.getAttribute('data-testid') === 'save-fail-note') {
    return next;
  }
  const note = document.createElement('p');
  note.className = 'save-fail-note';
  note.setAttribute('data-testid', 'save-fail-note');
  note.textContent = SAVE_FAIL_NOTE;
  starsEl.insertAdjacentElement('afterend', note);
  return note;
}
