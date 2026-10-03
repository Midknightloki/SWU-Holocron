# Scanner Auto-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a calibrated swap rig, capture each card automatically once it settles, exactly once per card.

**Architecture:** A pure reducer (`autoCapture.js`) consumes small grayscale samples of the calibrated card area and emits `ready` and `capture` events according to an empty → arriving → captured → empty cycle. A browser-only sampler (`frameSampler.js`) produces those samples from the live video at ~10 Hz. `CardScanner` runs the loop, calls its existing `capture()` on `capture`, and shows a status chip that opens `AutoSettings`.

**Tech Stack:** React 18, Vitest + Testing Library + happy-dom (fake timers for the loop), Canvas 2D `getImageData`.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-03-scanner-auto-mode-design.md`

## Global Constraints

- Run all npm/npx from `SWU-Holocron/`. Lint with the **Bash** tool: `npx eslint src --ext js,jsx --quiet` (PowerShell splits `js,jsx`).
- Every hook before any conditional return; `no-console` except warn/error; ESLint errors stay at zero.
- `localStorage` keys `swu-`-prefixed; storage helpers never throw.
- Auto requires a saved rig calibration, and samples only the calibrated card area.
- Defaults: `presence = 0.08`, `stillness = 0.02`, `settleMs = 600`; tick `AUTO_TICK_MS = 100`; sample 48×64.
- Auto never captures while help, the set picker, calibration or auto settings are open, at the daily limit, or while a capture is in flight.
- Manual tap / Space capture keeps working with Auto on.
- Gate every commit: `npm run test:unit && npx eslint src --ext js,jsx --quiet && git commit …` (`&&`, never `;`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A card left in the rig for minutes** must produce one capture, never more. (Task 2: `a card left in place is captured once`.)
2. **The rig emptied with no new card** must not capture the empty rig. (Task 2: `removing a card without a new one captures nothing`.)
3. **Slow lighting change** (sun moving, a lamp warming up) must not read as a card. (Task 2: `slow lighting drift does not read as a card`.)
4. **An overlay opened mid-stack** (help, set picker, calibration, settings) must pause Auto, so no capture fires behind it. (Task 5: `pauses while an overlay is open`.)
5. **The video not ready yet, or zero-size** must make ticks no-ops, not crash or capture. (Task 3: `returns null without video dimensions`.)

---

### Task 1: `toStreamRect` in `rigCalibration`

**Files:** Modify `src/utils/rigCalibration.js`; test in `src/test/utils/rigCalibration.test.js`.

**Interfaces:** Produces `toStreamRect(rect, streamAspect, photoAspect) → Rect` (stream fractions; may extend beyond 0..1) and `clampRect(rect) → Rect` (clamped to 0..1). `guideStyle` uses `toStreamRect`, and its behaviour is unchanged.

- [ ] **Step 1: Failing tests.** Add to `describe('geometry')`:

```js
  it('converts photo fractions to stream fractions for a narrower stream', () => {
    // 9:16 stream shows the middle 75% of a 3:4 photo's width.
    const r = toStreamRect({ x: 0.15, y: 0.1, w: 0.7, h: 0.8 }, 9 / 16, 3 / 4);
    expect(r.x).toBeCloseTo(0.0333, 3);
    expect(r.w).toBeCloseTo(0.9333, 3);
    expect(r).toMatchObject({ y: 0.1, h: 0.8 });
  });

  it('leaves the rect alone when the aspects match or the photo aspect is unknown', () => {
    expect(toStreamRect(RECT, 0.75, 0.75)).toEqual(RECT);
    expect(toStreamRect(RECT, 0.5625, undefined)).toEqual(RECT);
  });

  it('clamps a rect to the frame', () => {
    expect(clampRect({ x: -0.1, y: 0.5, w: 0.5, h: 0.7 })).toEqual({ x: 0, y: 0.5, w: 0.4, h: 0.5 });
  });
```

  Then add `toStreamRect, clampRect` to the test's import list.

- [ ] **Step 2: Run and confirm failure.** Run `npx vitest run src/test/utils/rigCalibration.test.js`. Expected: FAIL, `toStreamRect is not a function`.

- [ ] **Step 3: Implement.** In `rigCalibration.js`, add above `guideStyle`:

```js
/**
 * Photo fractions -> stream fractions. A 16:9 stream is a centre crop of the
 * 4:3 sensor the still photo uses, so the same card sits at different
 * fractions in each. Without the photo's aspect, the two are assumed to match.
 */
export function toStreamRect(rect, streamAspect, photoAspect) {
  if (!(photoAspect > 0) || !(streamAspect > 0) || streamAspect === photoAspect) return rect;
  if (streamAspect < photoAspect) {
    const f = streamAspect / photoAspect;
    return { ...rect, x: (rect.x - (1 - f) / 2) / f, w: rect.w / f };
  }
  const f = photoAspect / streamAspect;
  return { ...rect, y: (rect.y - (1 - f) / 2) / f, h: rect.h / f };
}

export function clampRect(rect) {
  const left = clamp01(rect.x);
  const top = clamp01(rect.y);
  const right = clamp01(rect.x + rect.w);
  const bottom = clamp01(rect.y + rect.h);
  return rect4({ x: left, y: top, w: right - left, h: bottom - top });
}
```

  Then, in `guideStyle`, replace the two `if/else if` aspect branches with
  `rect = toStreamRect(rect, videoWidth / videoHeight, photoAspect);`.

- [ ] **Step 4: Run and confirm pass**, including the existing `guideStyle` tests. Run `npx vitest run src/test/utils/rigCalibration.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** — gated: `npm run test:unit && npx eslint src --ext js,jsx --quiet && git add src/utils/rigCalibration.js src/test/utils/rigCalibration.test.js && git commit -m "refactor(scanner): factor toStreamRect out of guideStyle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: `autoCapture` reducer and settings storage

**Files:** Create `src/utils/autoCapture.js`; test in `src/test/utils/autoCapture.test.js`.

**Interfaces:** Produces
`DEFAULT_AUTO_SETTINGS`, `AUTO_KEY = 'swu-scan-auto'`, `frameDiff(a, b) → 0..1`, `initialAutoState() → AutoState`,
`stepAuto(state, frame, now, settings?) → { state, event: null|'ready'|'capture' }`,
`AutoState = { phase: 'learning'|'empty'|'arriving'|'captured', baseline, previous, stillSince }`,
`loadAutoSettings(storage) → settings`, `saveAutoSettings(storage, settings) → settings` (clamped).

- [ ] **Step 1: Failing tests.** Create `src/test/utils/autoCapture.test.js`:

```js
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
    const { events } = run([...hand(3), ...times(4, CARD)], { state: run(times(5, EMPTY), { settings }).state, settings });
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
```

- [ ] **Step 2: Run and confirm failure.** Run `npx vitest run src/test/utils/autoCapture.test.js`. Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement.** Create `src/utils/autoCapture.js`:

```js
/**
 * Hands-free capture for a swap rig: the rig is empty between cards, so every
 * card produces empty -> motion -> still card -> (capture) -> empty. Capture
 * once each time a card settles after the rig was empty.
 *
 * Pure: frames are small grayscale arrays of the calibrated card area (see
 * frameSampler.js), `now` is a millisecond clock.
 *
 * @environment:web-localstorage (load/save settings only)
 */
export const AUTO_KEY = 'swu-scan-auto';
export const DEFAULT_AUTO_SETTINGS = { presence: 0.08, stillness: 0.02, settleMs: 600 };
const LIMITS = {
  presence: [0.02, 0.5],
  stillness: [0.005, 0.1],
  settleMs: [200, 3000],
};
// How fast the empty-rig baseline follows slow light changes, per still tick.
const BASELINE_BLEND = 0.05;

export function frameDiff(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

// Float baseline: with whole-number pixels, a 5% blend toward a frame one
// level brighter rounds back to the old value, so the baseline would never
// follow slow lighting drift at all.
const blend = (base, frame) => {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) out[i] = base[i] * (1 - BASELINE_BLEND) + frame[i] * BASELINE_BLEND;
  return out;
};

export const initialAutoState = () => ({ phase: 'learning', baseline: null, previous: null, stillSince: null });

export function stepAuto(state, frame, now, settings = DEFAULT_AUTO_SETTINGS) {
  const { presence, stillness, settleMs } = settings;
  const moving = !state.previous || frameDiff(frame, state.previous) > stillness;
  const stillSince = moving ? null : (state.stillSince ?? now);
  const settled = stillSince !== null && now - stillSince >= settleMs;
  const next = { ...state, previous: frame, stillSince };
  const present = () => frameDiff(frame, state.baseline) > presence;

  switch (state.phase) {
    case 'learning':
      return settled
        ? { state: { ...next, phase: 'empty', baseline: Float32Array.from(frame) }, event: 'ready' }
        : { state: next, event: null };

    case 'empty':
      if (present()) return { state: { ...next, phase: 'arriving' }, event: null };
      // Still and empty: let the baseline follow slow lighting changes.
      return { state: { ...next, baseline: moving ? state.baseline : blend(state.baseline, frame) }, event: null };

    case 'arriving':
      if (!settled) return { state: next, event: null };
      return present()
        ? { state: { ...next, phase: 'captured' }, event: 'capture' }
        : { state: { ...next, phase: 'empty' }, event: null };

    case 'captured':
      // One capture per card: re-arm only once the rig is empty and still.
      return settled && !present()
        ? { state: { ...next, phase: 'empty' }, event: null }
        : { state: next, event: null };

    default:
      return { state: initialAutoState(), event: null };
  }
}

const clampSetting = (key, value) => {
  const [lo, hi] = LIMITS[key];
  const v = Number(value);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_AUTO_SETTINGS[key];
};

const normalise = (s) => ({
  presence: clampSetting('presence', s?.presence),
  stillness: clampSetting('stillness', s?.stillness),
  settleMs: Math.round(clampSetting('settleMs', s?.settleMs)),
});

export function loadAutoSettings(storage) {
  try {
    const raw = storage.getItem(AUTO_KEY);
    return raw ? normalise(JSON.parse(raw)) : { ...DEFAULT_AUTO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUTO_SETTINGS };
  }
}

export function saveAutoSettings(storage, settings) {
  const clean = normalise(settings);
  try {
    storage.setItem(AUTO_KEY, JSON.stringify(clean));
  } catch {
    // Storage unavailable: settings last for this session.
  }
  return clean;
}
```

- [ ] **Step 4: Run and confirm pass.** Run `npx vitest run src/test/utils/autoCapture.test.js`. Expected: PASS. If the drift test fails, the blend is too slow for the drift rate. Do not loosen the test; that rate (+1 brightness per second) is realistic.

- [ ] **Step 5: Commit** — gated, with the message `feat(scanner): auto-capture state machine and settings`.

---

### Task 3: `frameSampler`

**Files:** Create `src/utils/frameSampler.js`; test in `src/test/utils/frameSampler.test.js`.

**Interfaces:** Produces `createFrameSampler({ width = 48, height = 64, createCanvas }) → (video, streamRect) → Uint8Array | null`.

- [ ] **Step 1: Failing tests.** Create `src/test/utils/frameSampler.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createFrameSampler } from '../../utils/frameSampler';

const fakeCanvas = (rgba) => {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: rgba })),
  };
  return { canvas: { getContext: vi.fn(() => ctx) }, ctx };
};

describe('createFrameSampler', () => {
  it('draws the calibrated region of the video and returns grayscale', () => {
    // 2x1 sample: one pure red pixel, one white pixel.
    const { canvas, ctx } = fakeCanvas(new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255]));
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas: () => canvas });
    const video = { videoWidth: 1000, videoHeight: 2000 };
    const out = sample(video, { x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 100, 400, 500, 500, 0, 0, 2, 1);
    expect(Array.from(out)).toEqual([76, 255]);
  });

  it('reuses one canvas across samples', () => {
    const { canvas } = fakeCanvas(new Uint8ClampedArray(8));
    const createCanvas = vi.fn(() => canvas);
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas });
    const video = { videoWidth: 10, videoHeight: 10 };
    sample(video, { x: 0, y: 0, w: 1, h: 1 });
    sample(video, { x: 0, y: 0, w: 1, h: 1 });
    expect(createCanvas).toHaveBeenCalledTimes(1);
  });

  it('returns null without video dimensions', () => {
    const sample = createFrameSampler({ createCanvas: () => fakeCanvas(new Uint8ClampedArray(0)).canvas });
    expect(sample({ videoWidth: 0, videoHeight: 0 }, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(sample(null, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });

  it('returns null when drawing throws (video not ready)', () => {
    const canvas = { getContext: () => ({ drawImage: () => { throw new Error('InvalidStateError'); }, getImageData: vi.fn() }) };
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas: () => canvas });
    expect(sample({ videoWidth: 10, videoHeight: 10 }, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** Create `src/utils/frameSampler.js`:

```js
/**
 * Tiny grayscale samples of the calibrated card area of the live video, for
 * auto-capture change detection (~10 per second). One reused canvas; any
 * failure (no frame yet, video not ready) returns null and the tick is skipped.
 *
 * @environment:web-media
 */
const defaultCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export function createFrameSampler({ width = 48, height = 64, createCanvas = defaultCanvas } = {}) {
  let ctx = null;
  return (video, rect) => {
    const vw = video?.videoWidth;
    const vh = video?.videoHeight;
    if (!vw || !vh) return null;
    try {
      if (!ctx) ctx = createCanvas(width, height).getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const sx = Math.max(0, Math.floor(rect.x * vw));
      const sy = Math.max(0, Math.floor(rect.y * vh));
      const sw = Math.max(1, Math.min(vw - sx, Math.round(rect.w * vw)));
      const sh = Math.max(1, Math.min(vh - sy, Math.round(rect.h * vh)));
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const out = new Uint8Array(width * height);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
      }
      return out;
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 4: Run and confirm pass.** (Red `255*0.299 = 76.2 → 76`; white → 255.)

- [ ] **Step 5: Commit** — gated, `feat(scanner): frame sampler for auto-capture`.

---

### Task 4: `AutoSettings` panel

**Files:** Create `src/components/AutoSettings.jsx`; test in `src/components/__tests__/AutoSettings.test.jsx`.

**Interfaces:** `<AutoSettings settings onChange(settings) onRelearn() onClose() />`, role `dialog` named `Auto settings`. Sliders are labelled `Card detection`, `Stillness`, `Settle time`. Buttons: `Re-learn empty rig`, `Reset to defaults`, `Done`.

- [ ] **Step 1: Failing tests.** Create `src/components/__tests__/AutoSettings.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AutoSettings from '../AutoSettings';
import { DEFAULT_AUTO_SETTINGS } from '../../utils/autoCapture';

const renderSettings = (settings = DEFAULT_AUTO_SETTINGS) => {
  const h = { onChange: vi.fn(), onRelearn: vi.fn(), onClose: vi.fn() };
  render(<AutoSettings settings={settings} {...h} />);
  return h;
};

describe('AutoSettings', () => {
  it('shows the three settings with their current values', () => {
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Auto settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Card detection')).toHaveValue('0.08');
    expect(screen.getByLabelText('Stillness')).toHaveValue('0.02');
    expect(screen.getByLabelText('Settle time')).toHaveValue('600');
    expect(screen.getByText('0.6 s')).toBeInTheDocument();
  });

  it('reports a changed setting', () => {
    const { onChange } = renderSettings();
    fireEvent.change(screen.getByLabelText('Settle time'), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AUTO_SETTINGS, settleMs: 900 });
  });

  it('re-learns, resets and closes', () => {
    const { onRelearn, onChange, onClose } = renderSettings({ presence: 0.2, stillness: 0.05, settleMs: 1500 });
    fireEvent.click(screen.getByRole('button', { name: 'Re-learn empty rig' }));
    expect(onRelearn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_AUTO_SETTINGS);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** Create `src/components/AutoSettings.jsx`:

```jsx
import React from 'react';
import { DEFAULT_AUTO_SETTINGS } from '../utils/autoCapture';

/**
 * Tuning for hands-free capture on a particular rig. Opened from the auto
 * status chip; values are saved per device by the scanner.
 *
 * @environment:react
 */
const SLIDERS = [
  { key: 'presence', label: 'Card detection', min: 0.02, max: 0.5, step: 0.01,
    help: 'How different from the empty rig counts as a card. Raise it if the empty rig triggers scans.',
    show: (v) => v.toFixed(2) },
  { key: 'stillness', label: 'Stillness', min: 0.005, max: 0.1, step: 0.005,
    help: 'How much change still counts as "not moving". Raise it if a still card never scans.',
    show: (v) => v.toFixed(3) },
  { key: 'settleMs', label: 'Settle time', min: 200, max: 3000, step: 100,
    help: 'How long a card must be still before it is scanned.',
    show: (v) => `${(v / 1000).toFixed(1)} s` },
];

export default function AutoSettings({ settings, onChange, onRelearn, onClose }) {
  return (
    <div role="dialog" aria-label="Auto settings" className="absolute inset-0 z-20 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-lg font-bold text-white">Auto settings</h2>
        <p className="text-sm text-gray-400">Tune hands-free capture for your rig.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-5">
        {SLIDERS.map(({ key, label, min, max, step, help, show }) => (
          <div key={key}>
            <div className="flex justify-between text-sm">
              <label htmlFor={`auto-${key}`} className="font-bold">{label}</label>
              <span className="text-yellow-400">{show(settings[key])}</span>
            </div>
            <input
              id={`auto-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
              className="w-full accent-yellow-500"
            />
            <p className="text-xs text-gray-500">{help}</p>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onRelearn} className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
            Re-learn empty rig
          </button>
          <button type="button" onClick={() => onChange(DEFAULT_AUTO_SETTINGS)} className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gray-900 border-t border-gray-800">
        <button type="button" onClick={onClose} className="w-full py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold">
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm pass.**

- [ ] **Step 5: Commit** — gated, `feat(scanner): auto-capture settings panel`.

---

### Task 5: Wire Auto into `CardScanner`

**Files:** Modify `src/components/CardScanner.jsx`, `src/components/__tests__/CardScanner.test.jsx`.

**Interfaces:** Consumes Tasks 1–4. Produces:
- an `Auto` toggle button named `Auto capture` with `aria-pressed`;
- a status chip `data-testid="auto-status"` whose button name is `Auto settings: <status>`;
- the export `AUTO_TICK_MS = 100`.

- [ ] **Step 1: Failing tests.** In `CardScanner.test.jsx`:
  - Add a sampler mock beside the other mocks:

```jsx
const sampler = vi.hoisted(() => ({ queue: [], fn: null }));
vi.mock('../../utils/frameSampler', () => ({
  createFrameSampler: () => {
    sampler.fn = vi.fn(() => (sampler.queue.length ? sampler.queue.shift() : null));
    return (...args) => sampler.fn(...args);
  },
}));
```

  - In `beforeEach`, add `sampler.queue = [];`.
  - Add a `describe('auto mode')` block:

```jsx
  describe('auto mode', () => {
    const F = (v) => new Uint8Array(16).fill(v);
    const many = (n, v) => Array.from({ length: n }, () => F(v));
    const handFrames = (n) => Array.from({ length: n }, (_, i) => F(i % 2 ? 30 : 70));
    const CAL = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    const tick = async (n) => {
      for (let i = 0; i < n; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { vi.advanceTimersByTime(AUTO_TICK_MS); });
      }
    };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('needs a calibration: without one, Auto opens calibration', () => {
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Auto capture' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('learns the empty rig, then captures a settled card exactly once', async () => {
      rigStored = CAL;
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/learning/i);
      sampler.queue.push(...many(8, 100));
      await tick(8);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/ready/i);
      sampler.queue.push(...handFrames(4), ...many(40, 200));
      await tick(44);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/remove card/i);
    });

    it('pauses while an overlay is open', async () => {
      rigStored = CAL;
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      fireEvent.click(screen.getByRole('button', { name: 'How to scan' }));
      sampler.queue.push(...many(8, 100), ...handFrames(4), ...many(20, 200));
      await tick(32);
      expect(sampler.fn).not.toHaveBeenCalled();
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
    });

    it('opens auto settings from the chip, saves changes, and re-learns', async () => {
      rigStored = CAL;
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      sampler.queue.push(...many(8, 100));
      await tick(8);
      fireEvent.click(screen.getByRole('button', { name: /^Auto settings/ }));
      fireEvent.change(screen.getByLabelText('Settle time'), { target: { value: '900' } });
      expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-auto', expect.stringContaining('"settleMs":900'));
      fireEvent.click(screen.getByRole('button', { name: 'Re-learn empty rig' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/learning/i);
    });

    it('turning Auto off stops sampling', async () => {
      rigStored = CAL;
      renderScanner();
      const toggle = screen.getByRole('button', { name: 'Auto capture' });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      sampler.queue.push(...many(10, 100));
      await tick(10);
      expect(sampler.fn ?? vi.fn()).not.toHaveBeenCalled();
      expect(screen.queryByTestId('auto-status')).not.toBeInTheDocument();
    });
  });
```

  - Add `import CardScanner, { AUTO_TICK_MS } from '../CardScanner';` (replace the existing default import) and `afterEach` to the vitest import.
  - In the `RigCalibration` mock, nothing changes: the `dialog` named `Calibrate rig` is already there.

- [ ] **Step 2: Run and confirm failure.** Run `npx vitest run src/components/__tests__/CardScanner.test.jsx`. Expected: the new tests FAIL (no `Auto capture` button); the existing tests pass.

- [ ] **Step 3: Implement** in `CardScanner.jsx`:
  - Imports:

```jsx
import { ScanLine as AutoIcon } from 'lucide-react';
import { initialAutoState, loadAutoSettings, saveAutoSettings, stepAuto } from '../utils/autoCapture';
import { createFrameSampler } from '../utils/frameSampler';
import { clampRect, toStreamRect } from '../utils/rigCalibration';
import AutoSettings from './AutoSettings';
```

    Then merge `toStreamRect, clampRect` into the existing `rigCalibration` import, and `ScanLine as AutoIcon` into the existing `lucide-react` import.
  - Above the component: `export const AUTO_TICK_MS = 100;` and

```jsx
const AUTO_STATUS = {
  learning: 'Learning empty rig…',
  empty: 'Ready — slide a card in',
  arriving: 'Card coming in',
  captured: 'Scanned — remove card',
};
```

  - State and refs (with the other hooks, above the account-switch block):

```jsx
  const [autoOn, setAutoOn] = useState(false);
  const [autoPhase, setAutoPhase] = useState('learning');
  const [autoSettings, setAutoSettings] = useState(() => loadAutoSettings(getStorage()));
  const [showAutoSettings, setShowAutoSettings] = useState(false);
  const autoStateRef = useRef(initialAutoState());
  const autoSettingsRef = useRef(autoSettings);
  autoSettingsRef.current = autoSettings;
  const showAutoSettingsRef = useRef(false);
  showAutoSettingsRef.current = showAutoSettings;
  const captureRef = useRef(null);
  const samplerRef = useRef(null);
```

  - After `capture` is defined: `captureRef.current = capture;`.
  - In the key listener and the `capture` guard, add `showAutoSettingsRef.current` to the conditions that already include `pickingSetsRef.current`.
  - The loop:

```jsx
  // Hands-free capture: sample the calibrated card area ~10x a second and let
  // the reducer decide when a card has settled. Any open overlay, the daily
  // limit, or a capture in flight skips the tick.
  useEffect(() => {
    if (!autoOn || mode !== 'camera' || !calibration) return undefined;
    if (!samplerRef.current) samplerRef.current = createFrameSampler();
    const timer = setInterval(() => {
      if (helpOpenRef.current || calibratingRef.current || pickingSetsRef.current
        || showAutoSettingsRef.current || quotaRef.current || capturingRef.current) return;
      const video = videoRef.current;
      const vw = video?.videoWidth;
      const vh = video?.videoHeight;
      const rect = vw && vh
        ? clampRect(toStreamRect(calibration.rect, vw / vh, calibration.aspect))
        : calibration.rect;
      const frame = samplerRef.current(video, rect);
      if (!frame) return;
      const { state, event } = stepAuto(autoStateRef.current, frame, Date.now(), autoSettingsRef.current);
      autoStateRef.current = state;
      setAutoPhase(state.phase);
      if (event === 'capture') captureRef.current?.();
    }, AUTO_TICK_MS);
    return () => clearInterval(timer);
  }, [autoOn, mode, calibration]);
```

  - Handlers:

```jsx
  const toggleAuto = () => {
    if (autoOn) {
      setAutoOn(false);
      return;
    }
    if (!calibration) {
      setCalibrating(true);
      return;
    }
    autoStateRef.current = initialAutoState();
    setAutoPhase('learning');
    setAutoOn(true);
  };

  const relearnAuto = () => {
    autoStateRef.current = initialAutoState();
    setAutoPhase('learning');
  };
```

    These are plain functions, not hooks, defined before the review-mode early return so they sit with the other handlers.
  - Bottom bar: after the `Choose sets` button, add:

```jsx
        <button
          type="button"
          aria-label="Auto capture"
          aria-pressed={autoOn}
          title="Hands-free: scan each card once it settles (needs a calibrated rig)"
          onClick={toggleAuto}
          className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border ${
            autoOn ? 'bg-green-500/20 border-green-400 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-400'
          }`}
        >
          <AutoIcon size={14} aria-hidden="true" />Auto
        </button>
```

  - Status chip, inside the preview container after the level:

```jsx
        {autoOn && (
          <button
            type="button"
            data-testid="auto-status"
            aria-label={`Auto settings: ${AUTO_STATUS[autoPhase]}`}
            onClick={(e) => { e.stopPropagation(); setShowAutoSettings(true); }}
            className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold border ${
              autoPhase === 'captured' ? 'bg-green-500/20 border-green-400 text-green-300'
                : autoPhase === 'arriving' ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                  : 'bg-gray-900/80 border-gray-700 text-gray-200'
            }`}
          >
            {AUTO_STATUS[autoPhase]}
          </button>
        )}
```

  - Settings overlay, next to the set picker overlay:

```jsx
      {showAutoSettings && (
        <AutoSettings
          settings={autoSettings}
          onChange={(next) => setAutoSettings(saveAutoSettings(getStorage(), next))}
          onRelearn={relearnAuto}
          onClose={() => setShowAutoSettings(false)}
        />
      )}
```

  - How-to: add after the "Tap the screen or press Space" item:
    `<li>Calibrated? Turn on Auto with the rig empty: once it says Ready, slide each card in and it scans by itself once the card is still. Take it out before the next one.</li>`

- [ ] **Step 4: Run and confirm pass.** Run `npx vitest run src/components/__tests__/CardScanner.test.jsx`. Expected: all pass. If the fake timers stall the camera `getUserMedia` promise, it still resolves through microtasks; if a test depends on it, advance with `await act(async () => {})`.

- [ ] **Step 5: Full suite, lint, build, and commit** — gated, `feat(scanner): hands-free auto capture on a calibrated rig`.

---

### Task 6: Docs and hand-off

- [ ] **Step 1:** Update `CLAUDE.md`'s Card scanner section with an Auto bullet:
  - the swap-rig rule;
  - `autoCapture.js` (reducer) and `frameSampler.js` (browser only);
  - that it requires a calibration;
  - `swu-scan-auto` settings.

  Also add `swu-scan-auto` to the localStorage key list.
- [ ] **Step 2:** Update `TESTING.md` manual checks:
  - Auto learns an empty rig ("Ready").
  - A full stack gives one capture per card.
  - There are zero empty-rig captures and zero double scans.
  - Note the tuned settings in the PR.
- [ ] **Step 3: Commit** — gated, `docs: scanner auto mode`.
- [ ] **Step 4: Hand-off.** No function deploy is needed. The user replies "merge", then tunes on the rig.
