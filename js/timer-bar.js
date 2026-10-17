// 限时条。用累计已用毫秒计时（每帧增量），不用「现在减开始」的墙钟差。
// 暂停时不再累加。1-2、1-3 共用。

export function createCountdown({ durationMs, onTick, onEnd }) {
  let elapsed = 0;
  let running = false;
  let ended = false;
  let last = 0;
  let raf = 0;
  const total = Math.max(0, Number(durationMs) || 0);

  function stopRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now) {
    if (!running) return;
    const delta = Math.min(500, Math.max(0, now - last));
    last = now;
    elapsed += delta;
    const left = Math.max(0, total - elapsed);
    if (onTick) onTick(left);
    if (left <= 0) {
      running = false;
      ended = true;
      stopRaf();
      if (onEnd) onEnd();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (ended || running) return;
      running = true;
      last = performance.now();
      if (onTick) onTick(Math.max(0, total - elapsed));
      raf = requestAnimationFrame(frame);
    },
    pause() {
      if (!running) return;
      const now = performance.now();
      elapsed += Math.min(500, Math.max(0, now - last));
      last = now;
      running = false;
      stopRaf();
      if (onTick) onTick(Math.max(0, total - elapsed));
    },
    stop() {
      running = false;
      stopRaf();
    },
    get running() { return running; },
    get ended() { return ended; },
    get remaining() { return Math.max(0, total - elapsed); }
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
