// 限时条。用累计已用毫秒计时（每帧增量），不用「现在减开始」的墙钟差。
// 暂停时不再累加。1-2、1-3 共用。
// pauseOnHidden / onFrame / elapsed 都是可选。不传时和原来一样。

export function createCountdown({ durationMs, onTick, onEnd, pauseOnHidden, onHiddenChange, onFrame }) {
  let elapsed = 0;
  let running = false;
  let ended = false;
  let disposed = false;
  let last = 0;
  let raf = 0;
  let externalHold = false;
  let hiddenHold = false;
  let skipFrame = false;
  let listening = false;
  const total = Math.max(0, Number(durationMs) || 0);
  const wantHidden = pauseOnHidden === true;
  const report = typeof onFrame === 'function' ? onFrame : null;

  function stopRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function hiddenNow() {
    return document.visibilityState === 'hidden' || document.hidden === true;
  }

  function onVis() {
    if (disposed) return;
    const hidden = hiddenNow();
    if (hidden) {
      if (!hiddenHold) {
        hiddenHold = true;
        if (running) freeze();
      }
    } else if (hiddenHold) {
      hiddenHold = false;
      if (!externalHold && !ended) begin();
    }
    if (typeof onHiddenChange === 'function') onHiddenChange(hidden);
  }

  function attach() {
    if (!wantHidden || listening || disposed) return;
    listening = true;
    document.addEventListener('visibilitychange', onVis);
  }

  function detach() {
    if (!listening) return;
    listening = false;
    document.removeEventListener('visibilitychange', onVis);
  }

  function tick() {
    if (onTick) onTick(Math.max(0, total - elapsed));
  }

  function freeze() {
    if (!running) return;
    const now = performance.now();
    elapsed += Math.min(500, Math.max(0, now - last));
    last = now;
    running = false;
    stopRaf();
    tick();
  }

  function begin() {
    if (disposed || ended || running || externalHold || hiddenHold) return;
    running = true;
    skipFrame = true;
    last = performance.now();
    tick();
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!running) return;
    const raw = Math.max(0, now - last);
    const delta = Math.min(500, raw);
    last = now;
    if (skipFrame) skipFrame = false;
    else if (report) report(raw);
    elapsed += delta;
    const left = Math.max(0, total - elapsed);
    tick();
    if (left <= 0) {
      running = false;
      ended = true;
      stopRaf();
      detach();
      if (onEnd) onEnd();
      return;
    }
    // onTick / onFrame 里若 pause() 把 running 关掉，不再多排一帧。
    if (!running) return;
    raf = requestAnimationFrame(frame);
  }

  if (wantHidden) {
    hiddenHold = hiddenNow();
    attach();
  }

  return {
    start() {
      if (disposed || ended || running) return;
      externalHold = false;
      attach();
      if (hiddenHold) {
        tick();
        return;
      }
      begin();
    },
    pause() {
      if (disposed || ended) return;
      externalHold = true;
      if (!running) return;
      freeze();
    },
    stop() {
      running = false;
      stopRaf();
      detach();
    },
    dispose() {
      disposed = true;
      running = false;
      stopRaf();
      detach();
    },
    get running() { return running; },
    get ended() { return ended; },
    get remaining() { return Math.max(0, total - elapsed); },
    get elapsed() { return elapsed; }
  };
}

export function timerBarHTML({
  remainingSec,
  paused,
  pausedLabel,
  totalSec,
  className = 'hud-timer'
}) {
  const total = Math.max(1, Number(totalSec) || 1);
  const sec = Math.max(0, Number(remainingSec) || 0);
  const pct = Math.max(0, Math.min(100, sec / total * 100));
  const flag = paused ? 'true' : 'false';
  const hidden = paused ? '' : ' hidden';
  return `<div class="${className}" data-testid="timer-bar" data-remaining="${sec}" data-paused="${flag}" role="timer">
    <div class="${className}-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <span class="${className}-num" data-testid="timer-seconds">${sec}</span>
    <span class="${className}-pause" data-testid="timer-paused"${hidden}>${pausedLabel}</span>
  </div>`;
}
