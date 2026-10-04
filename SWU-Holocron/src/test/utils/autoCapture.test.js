import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTO_SETTINGS, AUTO_KEY, frameDiff, shapeDiff, initialAutoState, stepAuto,
  loadAutoSettings, saveAutoSettings, REARM_MS,
} from '../../utils/autoCapture';

// Frames need structure: presence ignores overall brightness (a light switched
// on, or auto-exposure, shifts every pixel), so a flat grey "card" would look
// exactly like a flat grey "empty rig". These scenes are 16-pixel stand-ins:
// the empty rig is white paper with a dark ruler strip; a card is a dark
// border with bright text; a hand is a moving smudge.
const N = 16;
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const SCENES = {
  empty: [...Array(12).fill(180), ...Array(4).fill(40)],
  card: [40, 40, 200, 200, 40, 200, 40, 200, 200, 40, 40, 200, 40, 40, 200, 40],
};
const scene = (kind, offset = 0) => Uint8Array.from(SCENES[kind], (v) => clamp(v + offset));
const EMPTY = 'empty';
const CARD = 'card';

// The timing tests below were written against a 600 ms settle; keep them on
// it explicitly. The 350 ms default has its own test.
const S600 = { ...DEFAULT_AUTO_SETTINGS, settleMs: 600 };

function run(frames, { state = initialAutoState(), start = 0, settings = S600 } = {}) {
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
const times = (n, kind, offset = 0) => Array.from({ length: n }, () => scene(kind, offset));
const hand = (n) => Array.from({ length: n }, (_, i) => Uint8Array.from({ length: N }, (_, j) => ((i + j) % 2 ? 30 : 110)));
const learned = () => run(times(8, EMPTY));

describe('frameDiff and shapeDiff', () => {
  it('frameDiff is 0 for identical frames and 1 for opposite extremes', () => {
    expect(frameDiff(new Uint8Array(4).fill(10), new Uint8Array(4).fill(10))).toBe(0);
    expect(frameDiff(new Uint8Array(4).fill(0), new Uint8Array(4).fill(255))).toBe(1);
  });

  it('treats missing or mismatched frames as fully different', () => {
    expect(frameDiff(null, scene(EMPTY))).toBe(1);
    expect(shapeDiff(new Uint8Array(4), new Uint8Array(5))).toBe(1);
  });

  it('shapeDiff ignores an overall brightness shift but sees a different scene', () => {
    expect(shapeDiff(scene(EMPTY), scene(EMPTY, 40))).toBeCloseTo(0, 5);
    expect(shapeDiff(scene(EMPTY), scene(CARD))).toBeGreaterThan(DEFAULT_AUTO_SETTINGS.presence);
  });
});

describe('stepAuto', () => {
  it('learns the empty rig after it has been still for the settle time', () => {
    const { events, state } = learned();
    expect(events).toEqual([{ event: 'ready', t: 700 }]);
    expect(state.phase).toBe('empty');
  });

  it('stays idle on an empty rig, including small sensor noise', () => {
    const noisy = Array.from({ length: 50 }, (_, i) => scene(EMPTY, (i % 3) - 1));
    expect(run(noisy, { state: learned().state }).events).toEqual([]);
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
    const drift = Array.from({ length: 600 }, (_, i) => scene(EMPTY, Math.floor(i / 10)));
    expect(run(drift, { state: learned().state }).events).toEqual([]);
  });

  it('a sudden lighting change on an empty rig is not a card, and Auto keeps working after it', () => {
    // Review finding: a room light switched on captured the empty rig and then
    // stalled Auto for good, because the rig never matched the old baseline.
    const lit = run(times(20, EMPTY, 40), { state: learned().state });
    expect(lit.events).toEqual([]);
    const next = run([...hand(3), ...times(8, CARD, 40)], { state: lit.state, start: lit.t });
    expect(next.events.map((e) => e.event)).toEqual(['capture']);
  });

  it('a card slid in slowly is captured only once it is fully in place', () => {
    // Review finding: one row per tick looked "still" tick-to-tick, so the card
    // was captured a third of the way in and the real card was then missed.
    const ROWS = 64;
    const rowScene = (covered) => Uint8Array.from({ length: ROWS }, (_, r) => {
      if (r < covered) return r % 3 ? 40 : 200; // card rows
      return r % 5 ? 180 : 40; // paper with ruler marks
    });
    const learnedRows = run(Array.from({ length: 8 }, () => rowScene(0)));
    const slide = Array.from({ length: ROWS }, (_, k) => rowScene(k + 1));
    const { events } = run([...slide, ...Array.from({ length: 8 }, () => rowScene(ROWS))], { state: learnedRows.state });
    const captures = events.filter((e) => e.event === 'capture');
    expect(captures).toHaveLength(1);
    expect(captures[0].t).toBeGreaterThanOrEqual((ROWS - 1) * 100);
  });

  it('a nudge after capture does not rescan', () => {
    const first = run([...hand(3), ...times(8, CARD)], { state: learned().state });
    const nudged = Uint8Array.from(scene(CARD), (v, i) => (i === 0 ? 120 : v));
    const { events } = run([nudged, ...Array.from({ length: 10 }, () => nudged)], { state: first.state, start: first.t });
    expect(events).toEqual([]);
  });

  it('records when it captured, for the "stuck?" hint', () => {
    const { state } = run([...hand(3), ...times(8, CARD)], { state: learned().state });
    expect(state.capturedAt).toBe(1000); // hand 0-200, card from 300, still from 400, +600
  });

  it('re-arms after a brief empty glimpse, so a quick swap is caught', () => {
    // Review of the first full box: the rig was empty only for a moment while
    // the hand swapped cards, so the 600 ms still-empty rule never re-armed.
    const first = run([...hand(3), ...times(8, CARD)], { state: learned().state });
    const swap = [...hand(2), ...times(3, EMPTY), ...hand(2), ...times(8, CARD)];
    const { events } = run(swap, { state: first.state, start: first.t });
    expect(events.map((e) => e.event)).toEqual(['capture']);
    expect(REARM_MS).toBe(200);
  });

  it('settles in 350 ms by default', () => {
    const learnedDefault = run(times(6, EMPTY), { settings: DEFAULT_AUTO_SETTINGS });
    // 1 moving + still clock start + 350 ms (reached on the 400 ms tick) -> the 6th card frame.
    const { events } = run([...hand(3), ...times(6, CARD)], { state: learnedDefault.state, settings: DEFAULT_AUTO_SETTINGS });
    expect(events.map((e) => e.event)).toEqual(['capture']);
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
    expect(DEFAULT_AUTO_SETTINGS).toEqual({ presence: 0.08, stillness: 0.02, settleMs: 350, sharpness: 60, fullPhotos: false });
  });

  it('round-trips and clamps to sane ranges', () => {
    const storage = memory();
    expect(saveAutoSettings(storage, { presence: 5, stillness: -1, settleMs: 50, sharpness: 9999, fullPhotos: 'yes' }))
      .toEqual({ presence: 0.5, stillness: 0.005, settleMs: 200, sharpness: 300, fullPhotos: false });
    expect(loadAutoSettings(storage)).toEqual({ presence: 0.5, stillness: 0.005, settleMs: 200, sharpness: 300, fullPhotos: false });
    expect(AUTO_KEY).toBe('swu-scan-auto');
  });

  it('loads settings saved before sharpness/fullPhotos existed with the new defaults', () => {
    const storage = { getItem: () => JSON.stringify({ presence: 0.1, stillness: 0.03, settleMs: 500 }) };
    expect(loadAutoSettings(storage)).toEqual({ presence: 0.1, stillness: 0.03, settleMs: 500, sharpness: 60, fullPhotos: false });
  });

  it('never throws', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadAutoSettings(bad)).toEqual(DEFAULT_AUTO_SETTINGS);
    expect(() => saveAutoSettings(bad, DEFAULT_AUTO_SETTINGS)).not.toThrow();
    bad.getItem = () => '{garbage';
    expect(loadAutoSettings(bad)).toEqual(DEFAULT_AUTO_SETTINGS);
  });
});
