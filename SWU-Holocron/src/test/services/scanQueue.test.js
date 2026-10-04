import { describe, it, expect, vi } from 'vitest';
import { createScanQueue, RETRY_DELAYS_MS } from '../../services/scanQueue';

const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = (id) => ({ status: 'matched', set: 'SOR', number: id, name: id });

function setup({ scan, images = {}, online = () => true } = {}) {
  const results = [];
  const pauses = [];
  const waits = [];
  const queue = createScanQueue({
    scan: scan ?? vi.fn(async (img) => ok(img)),
    getImage: vi.fn(async (id) => (id in images ? images[id] : `img-${id}`)),
    onResult: (id, r) => results.push([id, r]),
    onPause: (reason, ids) => pauses.push([reason, ids]),
    wait: (ms) => { waits.push(ms); return Promise.resolve(); },
    isOnline: online,
  });
  return { queue, results, pauses, waits };
}

describe('scanQueue', () => {
  it('reads every queued card, in order of completion, reporting each result', async () => {
    const { queue, results } = setup();
    ['a', 'b', 'c', 'd'].forEach((id) => queue.enqueue(id));
    await flush(); await flush();
    expect(results.map(([id]) => id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(results[0][1]).toMatchObject({ status: 'matched' });
  });

  it('keeps at most 3 reads in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const gates = [];
    const scan = vi.fn(() => new Promise((resolve) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      gates.push(() => { inFlight -= 1; resolve(ok('x')); });
    }));
    const { queue } = setup({ scan });
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => queue.enqueue(id));
    await flush();
    expect(peak).toBe(3);
    expect(queue.size()).toBe(5);
    gates.shift()();
    await flush();
    expect(scan).toHaveBeenCalledTimes(4);
  });

  it('retries a network failure with backoff, then succeeds', async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', error: 'network' })
      .mockResolvedValueOnce({ status: 'failed', error: 'network' })
      .mockResolvedValueOnce(ok('a'));
    const { queue, results, waits } = setup({ scan });
    queue.enqueue('a');
    await flush(); await flush(); await flush();
    expect(waits).toEqual([1000, 2000]);
    expect(results).toEqual([['a', ok('a')]]);
  });

  it('gives up after the last retry and reports the failure', async () => {
    const scan = vi.fn(async () => ({ status: 'failed', error: 'network' }));
    const { queue, results, waits } = setup({ scan });
    queue.enqueue('a');
    for (let i = 0; i < 10; i += 1) await flush(); // eslint-disable-line no-await-in-loop
    expect(waits).toEqual(RETRY_DELAYS_MS);
    expect(results).toEqual([['a', { status: 'failed', error: 'network' }]]);
  });

  it('pauses on quota and reports the pending ids', async () => {
    const scan = vi.fn(async () => ({ status: 'failed', error: 'quota', limit: 5 }));
    const { queue, pauses, results } = setup({ scan });
    ['a', 'b', 'c', 'd'].forEach((id) => queue.enqueue(id));
    await flush(); await flush();
    expect(pauses[0][0]).toBe('quota');
    expect(pauses[0][1].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(results).toEqual([]);
    expect(queue.pendingIds().sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('fails a row whose photo is gone', async () => {
    const { queue, results } = setup({ images: { a: null } });
    queue.enqueue('a');
    await flush(); await flush();
    expect(results).toEqual([['a', { status: 'failed', error: 'interrupted' }]]);
  });

  it('pauses while offline and resumes on demand', async () => {
    let online = false;
    const { queue, pauses, results } = setup({ online: () => online });
    queue.enqueue('a');
    await flush();
    expect(pauses).toEqual([['offline', ['a']]]);
    online = true;
    queue.resume();
    await flush(); await flush();
    expect(results.map(([id]) => id)).toEqual(['a']);
  });

  it('does not retry a forbidden result', async () => {
    const scan = vi.fn(async () => ({ status: 'failed', error: 'forbidden' }));
    const { queue, results, waits } = setup({ scan });
    queue.enqueue('a');
    await flush(); await flush();
    expect(waits).toEqual([]);
    expect(results).toEqual([['a', { status: 'failed', error: 'forbidden' }]]);
  });

  it('stop() drops pending reads and ignores results that arrive afterwards', async () => {
    // Review finding: closing the scanner left the queue pumping, so every
    // pending card was read again by the next session's queue.
    const gates = [];
    const scan = vi.fn(() => new Promise((resolve) => { gates.push(() => resolve(ok('x'))); }));
    const { queue, results } = setup({ scan });
    ['a', 'b', 'c', 'd'].forEach((id) => queue.enqueue(id));
    await flush();
    expect(scan).toHaveBeenCalledTimes(3);
    queue.stop();
    gates.forEach((g) => g());
    await flush(); await flush();
    expect(scan).toHaveBeenCalledTimes(3);
    expect(results).toEqual([]);
    queue.enqueue('e');
    await flush();
    expect(scan).toHaveBeenCalledTimes(3);
  });
});
