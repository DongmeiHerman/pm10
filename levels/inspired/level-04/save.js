// Level 4 write gate. Each method first rejects any book/level other than
// inspired/level-04, then checks hookOn. A wrong id throws even when the hook
// is on. When the hook is on, do not touch store and do not call api.complete.
// Real writes use the BOOK and LEVEL constants, never the arguments.
// STORAGE_STORE is the real store, built only here. It is not exported.
// createSaver is not exported. Other level-4 files must not name STORAGE_STORE
// (gate rule 'raw store'). They call createStorageSaver() with no arguments;
// save.js computes the hook from location on every write.

import { testHookOn } from '../../../js/test-hook.js';
import {
  addSeenEnding,
  bumpFailStreak,
  clearFailStreak,
  clearLevelRunChecked,
  clearResumeChecked,
  markAutoUnlocked,
  readResume,
  rememberScore,
  saveResume,
  writeLevelRun
} from '../../../js/storage.js';

// clearResume / clearLevelRun on this store are the checked clears.
// Saver method names stay the same. A wrong id still throws before any write.
const STORAGE_STORE = Object.freeze({
  saveResume,
  clearResume: clearResumeChecked,
  writeLevelRun,
  clearLevelRun: clearLevelRunChecked,
  readResume,
  clearFailStreak,
  bumpFailStreak,
  rememberScore,
  markAutoUnlocked,
  addSeenEnding
});

const BOOK = 'inspired';
const LEVEL = 'level-04';

function assertLevel4(bookId, levelId) {
  if (bookId !== BOOK || levelId !== LEVEL) {
    throw new TypeError('level-4 saver only writes inspired/level-04');
  }
}

function hookOn() {
  if (typeof location === 'undefined' || !location) return false;
  return testHookOn(location.hostname, location.search, 'l14test');
}

function createSaver({ hookOn, store }) {
  return {
    saveResume(bookId, levelId, screen) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      store.saveResume(BOOK, LEVEL, screen);
    },

    clearResume(bookId, levelId) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      store.clearResume(BOOK, LEVEL);
    },

    writeLevelRun(bookId, levelId, run) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      store.writeLevelRun(BOOK, LEVEL, run);
    },

    clearLevelRun(bookId, levelId) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      store.clearLevelRun(BOOK, LEVEL);
    },

    // Mount: no resume means drop the run snapshot, including an orphan run.
    clearOrphanRun(bookId, levelId) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      const resume = store.readResume(BOOK, LEVEL);
      if (resume) return;
      store.clearLevelRun(BOOK, LEVEL);
    },

    applyPlan(bookId, levelId, actions, api) {
      assertLevel4(bookId, levelId);
      if (hookOn()) return;
      const list = Array.isArray(actions) ? actions : [];
      for (let i = 0; i < list.length; i++) {
        const action = list[i];
        if (!action || typeof action !== 'object') continue;
        if (action.op === 'clearResume') store.clearResume(BOOK, LEVEL);
        else if (action.op === 'clearLevelRun') store.clearLevelRun(BOOK, LEVEL);
        else if (action.op === 'clearFailStreak') store.clearFailStreak(BOOK, LEVEL);
        else if (action.op === 'bumpFailStreak') store.bumpFailStreak(BOOK, LEVEL);
        else if (action.op === 'rememberScore') store.rememberScore(BOOK, LEVEL, action.stars, action.score);
        else if (action.op === 'markAutoUnlocked') store.markAutoUnlocked(BOOK, LEVEL);
        else if (action.op === 'addSeenEnding') store.addSeenEnding(BOOK, LEVEL, action.ending);
        else if (action.op === 'complete') {
          api.complete({ stars: action.stars, score: action.score, stay: action.stay === true });
        }
      }
    }
  };
}

export function createStorageSaver() {
  if (arguments.length > 0) {
    throw new TypeError('createStorageSaver takes no arguments; save.js reads the l14test hook itself');
  }
  return createSaver({ hookOn, store: STORAGE_STORE });
}
