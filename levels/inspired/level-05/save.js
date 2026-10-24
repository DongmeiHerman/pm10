// Level 5 write gate. Each method first rejects any book/level other than
// inspired/level-05, then checks hookOn. A wrong id throws even when the hook
// is on. When the hook is on, do not touch store and do not call api.complete.
// Real writes use the BOOK and LEVEL constants, never the arguments.
// STORAGE_STORE is the real store, built only here. It is not exported.
// createSaver is not exported. Other level-5 files must not name STORAGE_STORE.
// They call createStorageSaver() with no arguments; save.js reads l05test itself.

import { testHookOn } from '../../../js/test-hook.js';
import {
  clearFailStreak,
  clearLevelRunChecked,
  clearResumeChecked,
  readLevelRun,
  readResume,
  saveResume,
  writeLevelRun
} from '../../../js/storage.js';

const STORAGE_STORE = Object.freeze({
  saveResume,
  clearResume: clearResumeChecked,
  writeLevelRun,
  clearLevelRun: clearLevelRunChecked,
  readResume,
  readLevelRun,
  clearFailStreak
});

const BOOK = 'inspired';
const LEVEL = 'level-05';

function assertLevel5(bookId, levelId) {
  if (bookId !== BOOK || levelId !== LEVEL) {
    throw new TypeError('level-5 saver only writes inspired/level-05');
  }
}

function hookOn() {
  if (typeof location === 'undefined' || !location) return false;
  return testHookOn(location.hostname, location.search, 'l05test');
}

function createSaver({ hookOn, store }) {
  return {
    saveResume(bookId, levelId, screen) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      store.saveResume(BOOK, LEVEL, screen);
    },

    clearResume(bookId, levelId) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      store.clearResume(BOOK, LEVEL);
    },

    writeLevelRun(bookId, levelId, run) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      store.writeLevelRun(BOOK, LEVEL, run);
    },

    clearLevelRun(bookId, levelId) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      store.clearLevelRun(BOOK, LEVEL);
    },

    readResume(bookId, levelId) {
      assertLevel5(bookId, levelId);
      return store.readResume(BOOK, LEVEL);
    },

    readLevelRun(bookId, levelId) {
      assertLevel5(bookId, levelId);
      return store.readLevelRun(BOOK, LEVEL);
    },

    clearOrphanRun(bookId, levelId) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      const resume = store.readResume(BOOK, LEVEL);
      if (resume) return;
      store.clearLevelRun(BOOK, LEVEL);
    },

    applyPlan(bookId, levelId, actions, api) {
      assertLevel5(bookId, levelId);
      if (hookOn()) return;
      const list = Array.isArray(actions) ? actions : [];
      for (let i = 0; i < list.length; i += 1) {
        const action = list[i];
        if (!action || typeof action !== 'object') continue;
        if (action.op === 'clearResume') store.clearResume(BOOK, LEVEL);
        else if (action.op === 'clearLevelRun') store.clearLevelRun(BOOK, LEVEL);
        else if (action.op === 'clearFailStreak') store.clearFailStreak(BOOK, LEVEL);
        else if (action.op === 'complete') {
          api.complete({ stars: action.stars, score: action.score, stay: action.stay === true });
        }
      }
    }
  };
}

export function createStorageSaver() {
  if (arguments.length > 0) {
    throw new TypeError('createStorageSaver takes no arguments; save.js reads the l05test hook itself');
  }
  return createSaver({ hookOn, store: STORAGE_STORE });
}
