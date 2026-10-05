/**
 * Background recognition for the scanner. Captures are queued by draft row
 * id and read a few at a time, so capturing never waits on Gemini.
 *
 * - network / unknown failures retry with backoff, then report the failure;
 * - quota pauses the whole queue (pending ids reported, kept for later);
 * - offline pauses until resume('offline') (the scanner calls it on
 *   'online'), which leaves a daily-limit pause alone;
 * - a card queued during a pause is reported as waiting straight away.
 * Pure apart from the injected callbacks.
 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const RETRYABLE = new Set(['network', 'unknown']);
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function createScanQueue({
  scan, getImage, onResult, onPause = () => {}, concurrency = 3, wait = defaultWait, isOnline = defaultOnline,
}) {
  const pending = [];
  const active = new Set();
  let paused = null;
  // Stopped for good (the scanner closed): nothing is read or reported after
  // this, or the next session's queue would read the same cards again.
  let stopped = false;

  const pause = (reason) => {
    if (paused) return;
    paused = reason;
    onPause(reason, [...pending, ...active]);
  };

  // Back to the front of the line -- and no longer in flight, or a pause
  // would report it twice.
  const requeue = (id) => {
    active.delete(id);
    if (!pending.includes(id)) pending.unshift(id);
  };

  async function run(id) {
    const image = await getImage(id);
    if (stopped) return;
    if (!image) {
      onResult(id, { status: 'failed', error: 'interrupted' });
      return;
    }
    for (let attempt = 0; ; attempt += 1) {
      if (!isOnline()) {
        requeue(id);
        pause('offline');
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await scan(image);
      if (stopped) return;
      if (result.status !== 'failed') {
        onResult(id, result);
        return;
      }
      if (result.error === 'quota') {
        requeue(id);
        pause('quota');
        return;
      }
      if (!RETRYABLE.has(result.error) || attempt >= RETRY_DELAYS_MS.length) {
        onResult(id, result);
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await wait(RETRY_DELAYS_MS[attempt]);
      if (stopped) return;
      // Paused while backing off (another read hit the limit, or the network
      // went): wait in line with the rest instead of reading anyway.
      if (paused) {
        requeue(id);
        return;
      }
    }
  }

  const pump = () => {
    while (!stopped && !paused && active.size < concurrency && pending.length) {
      const id = pending.shift();
      active.add(id);
      run(id).finally(() => {
        active.delete(id);
        pump();
      });
    }
  };

  return {
    enqueue(id) {
      if (!pending.includes(id) && !active.has(id)) pending.push(id);
      if (paused) onPause(paused, [id]);
      pump();
    },
    /** Lift the pause -- or, given a reason, only a pause for that reason. */
    resume(reason) {
      if (reason && paused !== reason) return;
      paused = null;
      pump();
    },
    pause,
    stop() {
      stopped = true;
      pending.length = 0;
    },
    size: () => pending.length + active.size,
    pendingIds: () => [...pending, ...active],
  };
}
