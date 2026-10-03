# Scanner Auto-Mode (Hands-Free Capture) — Design

**Date:** 2026-10-03
**Status:** Draft, awaiting review
**Builds on:** `2026-09-29-card-scanner-design.md` (phase C), `2026-10-02-rig-calibration-design.md`

## Goal

On a calibrated rig, the scanner captures each card by itself: the user takes
the previous card out, slides the next one in against the guides, and the
scanner takes the photo once the card has settled. No tap, no key.

The reference workflow is a **swap rig**: the rig is briefly empty between
cards. Every card therefore produces the sequence
**empty → motion → still card → (scan) → empty**, and the rule is:
*capture once each time a card settles after the rig was empty.*

Success: a stack goes through with exactly one capture per card — no missed
cards, no double scans of a card left in place, no captures of the empty rig —
at a pace limited by the user's hands, not by the app.

## Decisions

| Question | Decision |
|---|---|
| Trigger | Change detection on the live preview, inside the calibrated card area |
| Prerequisite | A saved rig calibration; without one, Auto asks the user to calibrate |
| "Empty" reference | Learned when Auto is switched on (rig must be empty); one-tap re-learn |
| Re-arm rule | Only after the rig is seen empty again — one capture per card |
| Sampling | ~10 Hz, 48×64 grayscale of the card area |
| Tuning | Presence threshold, stillness threshold, settle time — adjustable in-app, stored per device |
| Manual capture | Tap / Space keep working alongside Auto |
| Feedback | Existing green/red flashes, plus a status chip |

## Architecture

### 1. Change detection (`src/utils/autoCapture.js`, pure)

- `frameDiff(a, b)` → mean absolute difference of two equal-length grayscale
  arrays, normalised to 0..1.
- `createAutoCapture(settings)` → a reducer
  `step(state, frame, now) → { state, event }`, with `event` one of
  `null | 'ready' | 'capture'`. States:

| State | Meaning | Transition |
|---|---|---|
| `learning` | Learning the empty rig | still for `settleMs` → baseline = frame, `empty`, event `ready` |
| `empty` | Rig empty, armed | `frameDiff(frame, baseline) > presence` → `arriving` |
| `arriving` | Card / hand moving in | motion resets the timer; still for `settleMs` → if card present: `captured` + event `capture`, else back to `empty` |
| `captured` | Card scanned, waiting for it to leave | empty (≤ `presence`) and still for `settleMs` → `empty` |

- "Still" means `frameDiff(frame, previous) ≤ stillness`.
- **Lighting drift:** while `empty` and still, the baseline is blended toward
  the current frame (exponential moving average), so slow light changes don't
  read as a card.
- `relearn(state)` → `learning`.
- Defaults: `presence = 0.08`, `stillness = 0.02`, `settleMs = 600`.

### 2. Frame sampling (`src/utils/frameSampler.js`, browser only)

- `sampleFrame(video, streamRect, width = 48, height = 64)` → `Uint8Array` of
  grayscale values. It draws the calibrated region of the **video** onto a
  small canvas (`getImageData`).
- `streamRect` converts the calibration's photo fractions to stream
  fractions, using the same centre-crop maths the guide already uses
  (factored out of `guideStyle` as `toStreamRect` in `rigCalibration.js`).
- Not unit-testable in happy-dom: verified on device.

### 3. Scanner integration (`CardScanner.jsx`)

- An **Auto** toggle in the bottom bar. With no calibration, it opens
  calibration instead. Turning Auto on starts `learning`.
- A ~100 ms interval runs while Auto is on, the scanner is in camera mode,
  and nothing is pausing it. Each tick samples, steps the reducer, and calls
  the existing `capture()` on a `capture` event. Same path as a tap:
  cropping, flashes, draft, quota.
- Paused while the help panel, set picker or calibration is open, at the
  daily limit, or while a capture is in flight. Stopped on leaving the
  scanner.
- A status chip at the top of the preview: **Learning empty rig…**,
  **Ready — slide a card in**, **Card coming in**, **Scanned — remove card**.
  Tapping the chip opens **Auto settings**: three sliders (presence,
  stillness, settle time), **Re-learn empty rig**, and **Reset to defaults**.
  Settings are stored per device in `localStorage['swu-scan-auto']`.
- The how-to panel gains a step describing Auto.

## Error handling

| Case | Behaviour |
|---|---|
| Auto switched on with a card in the rig | It learns the card as "empty"; the "Ready" chip is the cue; Re-learn fixes it |
| Card left in place | `captured` until the rig is empty again: no rescans |
| Hand hovering, card nudged | Motion keeps it out of `capture`; once `captured`, nudges don't rescan |
| Removal with nothing new | `arriving` settles on empty → back to `empty`, no capture |
| Video not ready / no frame | The tick is skipped |
| Capture fails (photo error) | Existing red flash; the state stays `captured`, so the user removes the card and re-slides it, or taps to retry |
| Phone rotated / calibration source mismatch | Sampling uses the calibrated region; the amber crop warning already flags it |

## Testing

- `src/test/utils/autoCapture.test.js` (synthetic frames):
  - learning → ready;
  - empty rig stays idle, including small noise;
  - hand moving in, then a card settling → exactly one `capture`;
  - card left for 100 ticks → still one capture;
  - card removed → re-armed, and the next card is captured;
  - removal with no new card → no capture;
  - slow lighting drift → no capture;
  - a nudge after capture → no rescan;
  - `relearn`;
  - custom thresholds respected.
- `src/test/utils/rigCalibration.test.js`: `toStreamRect` (and `guideStyle`
  unchanged).
- `src/components/__tests__/CardScanner.test.jsx`, with the sampler mocked to
  replay a scripted frame sequence on fake timers:
  - the Auto toggle needs calibration;
  - the status chip progresses;
  - a capture fires once per card;
  - it pauses while overlays are open;
  - settings persist;
  - re-learn works.
- **Manual, on the rig:** tune the defaults, then run a full stack and count
  captures vs. cards (target: equal, zero empty captures, zero double scans).

## Out of scope

- Pile (B) and slide (C) rig workflows.
- Hand detection or ML: plain frame differencing is enough on a fixed rig.
- Audio cues.
