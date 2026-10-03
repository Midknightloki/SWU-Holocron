import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTO_SETTINGS, AUTO_KEY, frameDiff, initialAutoState, stepAuto,
  loadAutoSettings, saveAutoSettings,
} from '../../utils/autoCapture';

const N = 16;
const frame = (v) => new Uint8Array(N).fill(Math.max(0, Math.min(255, Math.round(v))));
const EMPTY = 100;
const CARD = 200;

// Feed frames 100 ms apart; return the events and final state.
function run(frames, { state = initialAutoState(), start = 0, settings } = {}) {
  const events = [];
  let s = state;
  let t = start;
  for (const f of frames) {
    const out = stepAuto(s, f, t, settings);
    s = out.state;
    if (out.event) events.push({ event: out.event, t });
    t += 100;
  }
  return { events, state: s, t };
}
const times = (n, v) => Array.from({ length: n }, () => frame(v));
const hand = (n) => Array.from({ length: n }, (_, i) => frame(i % 2 ? 30 : 70));
const learned = () => run(times(8, EMPTY));

describe('frameDiff', () => {
  it('is 0 for identical frames and 1 for opposite extremes', () => {
    expect(frameDiff(frame(10), frame(10))).toBe(0);
    expect(frameDiff(frame(0), frame(255))).toBe(1);
  });
  it('treats missing or mismatched frames as fully different', () => {
    expect(frameDiff(null, frame(1))).toBe(1);
    expect(frameDiff(new Uint8Array(4), new Uint8Array(5))).toBe(1);
  });
});

describe('stepAuto', () => {
  it('learns the empty rig after it has been still for the settle time', () => {
    const { events, state } = learned();
    expect(events).toEqual([{ event: 'ready', t: 700 }]);
    expect(state.phase).toBe('empty');
  });

  it('stays idle on an empty rig, including small sensor noise', () => {
    const noisy = Array.from({ length: 50 }, (_, i) => frame(EMPTY + (i % 3) - 1));
    const { events } = run(noisy, { state: learned().state });
    expect(events).toEqual([]);
  });

  it('captures a card once it settles after the hand has moved it in', () => {
    const { events, state } = run([...hand(5), ...times(8, CARD)], { state: learned().state });
    expect(events.map((e) => e.event)).toEqual(['capture']);
    expect(state.phase).toBe('captured');
  });

  it('a card left in place is captured once', () => {
    const { events } = run([...hand(3), ...times(120, CARD)], { state: learned().state });
    expect(events.filter((e) => e.event === 'capture')).toHaveLength(1);
  });

  it('re-arms once the rig is empty again, then captures the next card', () => {
    const cycle = [...hand(3), ...times(8, CARD), ...hand(2), ...times(8, EMPTY)];
    const { events } = run([...cycle, ...cycle], { state: learned().state });
    expect(events.filter((e) => e.event === 'capture')).toHaveLength(2);
  });

  it('removing a card without a new one captures nothing', () => {
    const { events, state } = run([...hand(4), ...times(10, EMPTY)], { state: learned().state });
    expect(events).toEqual([]);
    expect(state.phase).toBe('empty');
  });

  it('slow lighting drift does not read as a card', () => {
    // +60 brightness over 60 s, 1 step per second.
    const drift = Array.from({ length: 600 }, (_, i) => frame(EMPTY + Math.floor(i / 10)));
    const { events } = run(drift, { state: learned().state });
    expect(events).toEqual([]);
  });

  it('a nudge after capture does not rescan', () => {
    const first = run([...hand(3), ...times(8, CARD)], { state: learned().state });
    const { events } = run([frame(CARD + 25), ...times(10, CARD + 25)], { state: first.state, start: first.t });
    expect(events).toEqual([]);
  });

  it('starts over from learning', () => {
    expect(initialAutoState().phase).toBe('learning');
  });

  it('respects a shorter settle time', () => {
    const settings = { ...DEFAULT_AUTO_SETTINGS, settleMs: 300 };
    // 1 moving frame + 1 starting the still clock + 300 ms = 5 card frames.
    const { events } = run([...hand(3), ...times(5, CARD)], { state: run(times(5, EMPTY), { settings }).state, settings });
    expect(events.map((e) => e.event)).toEqual(['capture']);
  });
});

describe('settings storage', () => {
  const memory = () => {
    const d = new Map();
    return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)) };
  };

  it('defaults when nothing is stored', () => {
    expect(loadAutoSettings(memory())).toEqual(DEFAULT_AUTO_SETTINGS);
    expect(DEFAULT_AUTO_SETTINGS).toEqual({ presence: 0.08, stillness: 0.02, settleMs: 600 });
  });

  it('round-trips and clamps to sane ranges', () => {
    const storage = memory();
    expect(saveAutoSettings(storage, { presence: 5, stillness: -1, settleMs: 50 }))
      .toEqual({ presence: 0.5, stillness: 0.005, settleMs: 200 });
    expect(loadAutoSettings(storage)).toEqual({ presence: 0.5, stillness: 0.005, settleMs: 200 });
    expect(AUTO_KEY).toBe('swu-scan-auto');
  });

  it('never throws', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadAutoSettings(bad)).toEqual(DEFAULT_AUTO_SETTINGS);
    expect(() => saveAutoSettings(bad, DEFAULT_AUTO_SETTINGS)).not.toThrow();
    bad.getItem = () => '{garbage';
    expect(loadAutoSettings(bad)).toEqual(DEFAULT_AUTO_SETTINGS);
  });
});
