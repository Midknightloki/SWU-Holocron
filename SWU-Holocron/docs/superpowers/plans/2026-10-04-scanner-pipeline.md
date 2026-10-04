# Scanner Pipeline (Whole Box) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 384-card box in one batch without pausing: instant sharp-frame capture, recognition in a background queue, and photos in IndexedDB.

**Architecture:**
- **Shared database opener.** The IndexedDB open logic (timeouts, reconnects) moves out of `cardCache` into `appDb.js` at version 2, with stores `cardSets` and `scanPhotos`.
- **New pure modules:**
  - `sharpness.js`: the variance of a Laplacian filter, for judging a frame's sharpness;
  - `scanQueue.js`: concurrency, retry and pause.
- **New photo store,** `photoStore.js`.
- **Changes to existing modules:**
  - `autoCapture`: re-arm after a brief empty glimpse, and a faster default settle;
  - `frameCapture`: a video-frame grab;
  - `rigCalibration`: `videoCropFor`.
- **Rewiring.** `CardScanner` sends captures through the photo store and the queue instead of calling `ScanService.scan` directly. Flashes are reduced to a red one for a bad photo. `ScanReview` loads photos from the store, and allows Add while cards are still reading.

**Tech Stack:** React 18, Vitest + Testing Library + happy-dom, fake-indexeddb, Canvas 2D.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-04-scanner-pipeline-design.md`

## Global Constraints

- Run npm/npx from `SWU-Holocron/`. Lint with the Bash tool: `npx eslint src --ext js,jsx --quiet`.
- Gate every commit: `npm run test:unit && npx eslint src --ext js,jsx --quiet && git add … && git commit …`.
- Every hook before any conditional return. No `console.log`. Storage and IndexedDB helpers never throw.
- **Live feedback:**
  - no flash on a successful capture or on recognition;
  - a red flash plus `navigator.vibrate(150)` only when no usable image was captured;
  - the NEW pop-up stays.
- Defaults: `settleMs 350`, `REARM_MS 200`, `sharpness 60` (range 10–300), `fullPhotos false`, queue `concurrency 3`, retry delays `[1000, 2000, 4000, 8000, 16000]`.
- IndexedDB: database `swu-holocron` **version 2**, stores `cardSets` (keyPath `setCode`) and `scanPhotos` (out-of-line keys).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Existing installs on database version 1** (with `cardSets` only) must upgrade to version 2 without losing cached sets, and the card cache must still open. (Task 1: `upgrades a version-1 database, keeping its card sets`.)
2. **A row whose photo is missing** (storage evicted, or written before this change) must not break Review or the queue: it shows "No photo", and the queue marks it failed. (Task 6: `fails a row whose photo is gone`; Task 9: `shows No photo when the store has none`.)
3. **Quota hit mid-box:** the queue pauses, pending rows become `waiting`, and Add still commits the matched cards. (Task 6: `pauses on quota and reports the pending ids`; Task 10: `Add works while cards are reading or waiting`.)
4. **A video frame from a phone in the other orientation** to its calibration must not be cropped wrongly. (Task 5: `videoCropFor skips a rotated stream`.)
5. **Removing, collapsing, committing or discarding rows** deletes their photos, so the store doesn't grow forever. (Task 10: `deletes photos of rows that leave the batch`.)

---

### Task 1: Shared IndexedDB opener (`appDb.js`), database version 2

**Files:**
- Create: `src/services/appDb.js`
- Modify: `src/services/cardCache.js`
- Test: `src/test/services/appDb.test.js`
- Existing tests: `src/test/services/cardCache.test.js` must still pass unchanged.

**Interfaces:**
- Produces:
  - `DB_NAME = 'swu-holocron'`, `DB_VERSION = 2`, `STORES = { cardSets: 'cardSets', scanPhotos: 'scanPhotos' }`;
  - `createDbOpener({ indexedDB = globalThis.indexedDB, openTimeoutMs = 2000 }) → { open(): Promise<IDBDatabase|null> }`.
- Behaviour, moved verbatim from `cardCache`:
  - timeout;
  - a late success after the timeout is closed;
  - `onclose` and `onversionchange` reset the connection;
  - a failed open is not cached.
- `onupgradeneeded` creates any missing store: `cardSets` with keyPath `setCode`, `scanPhotos` with no keyPath.

- [ ] **Step 1: Failing tests.** Create `src/test/services/appDb.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDbOpener, DB_NAME, DB_VERSION, STORES } from '../../services/appDb';

const openRaw = (factory, version, upgrade) => new Promise((resolve, reject) => {
  const req = factory.open(DB_NAME, version);
  req.onupgradeneeded = () => upgrade?.(req.result);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

describe('appDb', () => {
  it('opens version 2 with both stores', async () => {
    const db = await createDbOpener({ indexedDB: new IDBFactory() }).open();
    expect(DB_VERSION).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual([STORES.cardSets, STORES.scanPhotos].sort());
  });

  it('upgrades a version-1 database, keeping its card sets', async () => {
    const factory = new IDBFactory();
    const v1 = await openRaw(factory, 1, (db) => db.createObjectStore('cardSets', { keyPath: 'setCode' }));
    await new Promise((resolve) => {
      const tx = v1.transaction('cardSets', 'readwrite');
      tx.objectStore('cardSets').put({ setCode: 'SOR', cards: [1, 2] });
      tx.oncomplete = resolve;
    });
    v1.close();

    const db = await createDbOpener({ indexedDB: factory }).open();
    expect(db.objectStoreNames.contains(STORES.scanPhotos)).toBe(true);
    const record = await new Promise((resolve) => {
      const req = db.transaction('cardSets').objectStore('cardSets').get('SOR');
      req.onsuccess = () => resolve(req.result);
    });
    expect(record.cards).toEqual([1, 2]);
  });

  it('gives up on a hung open', async () => {
    const opener = createDbOpener({ indexedDB: { open: () => ({}) }, openTimeoutMs: 20 });
    await expect(opener.open()).resolves.toBeNull();
  });

  it('returns null without IndexedDB', async () => {
    await expect(createDbOpener({ indexedDB: undefined }).open()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Run `npx vitest run src/test/services/appDb.test.js`. Expected: import not resolved.

- [ ] **Step 3: Implement.** Create `src/services/appDb.js` by **moving** these out of `cardCache.js`:
  - the `OPEN_TIMEOUT_MS` constant;
  - the `openOnce` and `open` closures, together with their comments.

  Wrap them as `createDbOpener` and widen the upgrade step:

```js
/**
 * The app's one IndexedDB database. Every store is created here, so a
 * version bump can never leave one module opening an older version than
 * another (a lower requested version fails with VersionError).
 *
 * Opening never throws and never hangs: IndexedDB can stall without firing
 * success/error/blocked (WebKit has shipped this), so an open gives up after
 * 2 s and resolves null; callers degrade to fetching / memory.
 *
 * @environment:web-indexeddb
 */
export const DB_NAME = 'swu-holocron';
export const DB_VERSION = 2;
export const STORES = { cardSets: 'cardSets', scanPhotos: 'scanPhotos' };
const OPEN_TIMEOUT_MS = 2000;

export function createDbOpener({ indexedDB = globalThis.indexedDB, openTimeoutMs = OPEN_TIMEOUT_MS } = {}) {
  let dbPromise = null;

  const openOnce = () => new Promise((resolve) => {
    let settled = false;
    const done = (db) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => done(null), openTimeoutMs);
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.cardSets)) db.createObjectStore(STORES.cardSets, { keyPath: 'setCode' });
      if (!db.objectStoreNames.contains(STORES.scanPhotos)) db.createObjectStore(STORES.scanPhotos);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => {
        try { db.close(); } catch { /* already closed */ }
        dbPromise = null;
      };
      done(db);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
  });

  return {
    open() {
      if (!indexedDB) return Promise.resolve(null);
      if (!dbPromise) {
        const attempt = openOnce();
        dbPromise = attempt;
        attempt.then((db) => { if (!db && dbPromise === attempt) dbPromise = null; });
      }
      return dbPromise;
    },
  };
}
```

  In `cardCache.js`:
  - delete the moved code and the local `DB_NAME`, `DB_VERSION` and `OPEN_TIMEOUT_MS`;
  - import `{ createDbOpener, STORES }` from `./appDb`;
  - inside `createCardCache`, create `const opener = createDbOpener({ indexedDB, openTimeoutMs }); const open = () => opener.open();`;
  - set `const STORE = STORES.cardSets;`;
  - keep `_connectionForTests() { return open(); }`.

- [ ] **Step 4: Run and confirm pass.** Run `npx vitest run src/test/services/appDb.test.js src/test/services/cardCache.test.js src/test/services/setLoader.test.js`. Expected: PASS, with the card cache tests unchanged.

- [ ] **Step 5: Commit** — gated, with the message `refactor(storage): one IndexedDB opener for every store, version 2`.

---

### Task 2: `photoStore`

**Files:** Create `src/services/photoStore.js`; test in `src/test/services/photoStore.test.js`.

**Interfaces:**
- Produces:
  - `createPhotoStore({ indexedDB, openTimeoutMs })` → `{ put(id, base64): Promise<boolean>, get(id): Promise<string|null>, remove(ids: string[]): Promise<void>, clear(): Promise<void> }`;
  - `export const PhotoStore = createPhotoStore()`.
- Without IndexedDB it falls back to an in-memory `Map`. It never throws.

- [ ] **Step 1: Failing tests.** Create `src/test/services/photoStore.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPhotoStore } from '../../services/photoStore';

describe('photoStore', () => {
  it('stores, reads, removes and clears photos', async () => {
    const store = createPhotoStore({ indexedDB: new IDBFactory() });
    expect(await store.put('a', 'AAA')).toBe(true);
    await store.put('b', 'BBB');
    expect(await store.get('a')).toBe('AAA');
    await store.remove(['a']);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBe('BBB');
    await store.clear();
    expect(await store.get('b')).toBeNull();
  });

  it('survives a new store instance on the same database (an app restart)', async () => {
    const factory = new IDBFactory();
    await createPhotoStore({ indexedDB: factory }).put('a', 'AAA');
    expect(await createPhotoStore({ indexedDB: factory }).get('a')).toBe('AAA');
  });

  it('falls back to memory without IndexedDB', async () => {
    const store = createPhotoStore({ indexedDB: undefined });
    expect(await store.put('a', 'AAA')).toBe(true);
    expect(await store.get('a')).toBe('AAA');
    await store.remove(['a']);
    expect(await store.get('a')).toBeNull();
  });

  it('falls back to memory when IndexedDB hangs, and never throws', async () => {
    const store = createPhotoStore({ indexedDB: { open: () => ({}) }, openTimeoutMs: 10 });
    await expect(store.put('a', 'AAA')).resolves.toBe(true);
    await expect(store.get('a')).resolves.toBe('AAA');
    await expect(store.remove(['x'])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** Create `src/services/photoStore.js`:

```js
import { createDbOpener, STORES } from './appDb';

/**
 * Scanner photos, keyed by draft row id, in IndexedDB -- so a whole box
 * (hundreds of ~0.5 MB JPEGs) never sits in memory, and an app restart
 * mid-batch keeps the photos for review and for reads still to do.
 *
 * Never throws. Without IndexedDB (or if it hangs) photos live in memory for
 * the session, which is how the scanner worked before.
 *
 * @environment:web-indexeddb
 */
const STORE = STORES.scanPhotos;

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export function createPhotoStore({ indexedDB = globalThis.indexedDB, openTimeoutMs } = {}) {
  const opener = createDbOpener({ indexedDB, openTimeoutMs });
  const memory = new Map();

  return {
    async put(id, base64) {
      const db = await opener.open();
      if (db) {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(base64, id);
          await done(tx);
          return true;
        } catch {
          // fall through to memory
        }
      }
      memory.set(id, base64);
      return true;
    },

    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const db = await opener.open();
      if (!db) return null;
      try {
        const value = await new Promise((resolve, reject) => {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },

    async remove(ids) {
      ids.forEach((id) => memory.delete(id));
      const db = await opener.open();
      if (!db || ids.length === 0) return;
      try {
        const tx = db.transaction(STORE, 'readwrite');
        ids.forEach((id) => tx.objectStore(STORE).delete(id));
        await done(tx);
      } catch {
        // best effort
      }
    },

    async clear() {
      memory.clear();
      const db = await opener.open();
      if (!db) return;
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        await done(tx);
      } catch {
        // best effort
      }
    },
  };
}

export const PhotoStore = createPhotoStore();
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(scanner): photo store in IndexedDB`.

---

### Task 3: `sharpness`

**Files:** Create `src/utils/sharpness.js`; test in `src/test/utils/sharpness.test.js`.

**Interfaces:** `laplacianVariance(gray: ArrayLike<number>, width, height) → number` (0 for images smaller than 3×3).

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { laplacianVariance } from '../../utils/sharpness';

const W = 32;
const H = 32;
const checker = (block) => Uint8Array.from({ length: W * H }, (_, i) => {
  const x = i % W;
  const y = Math.floor(i / W);
  return (Math.floor(x / block) + Math.floor(y / block)) % 2 ? 230 : 20;
});
const boxBlur = (img, passes) => {
  let src = Float32Array.from(img);
  for (let p = 0; p < passes; p += 1) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < W && yy >= 0 && yy < H) { sum += src[yy * W + xx]; n += 1; }
          }
        }
        out[y * W + x] = sum / n;
      }
    }
    src = out;
  }
  return src;
};

describe('laplacianVariance', () => {
  it('is zero for a flat image', () => {
    expect(laplacianVariance(new Uint8Array(W * H).fill(128), W, H)).toBe(0);
  });

  it('is high for sharp edges and drops as the image blurs', () => {
    const sharp = laplacianVariance(checker(4), W, H);
    const soft = laplacianVariance(boxBlur(checker(4), 1), W, H);
    const softer = laplacianVariance(boxBlur(checker(4), 3), W, H);
    expect(sharp).toBeGreaterThan(1000);
    expect(soft).toBeLessThan(sharp);
    expect(softer).toBeLessThan(soft);
  });

  it('returns 0 for images too small to filter', () => {
    expect(laplacianVariance(new Uint8Array(4), 2, 2)).toBe(0);
    expect(laplacianVariance(null, 0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `src/utils/sharpness.js`:

```js
/**
 * Sharpness of a grayscale image: the variance of its 4-neighbour Laplacian.
 * Sharp edges give large positive and negative responses (high variance);
 * blur flattens them. The scanner uses it to decide whether an instant
 * video frame is good enough or a full photo is needed.
 */
export function laplacianVariance(gray, width, height) {
  if (!gray || width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(scanner): Laplacian sharpness check`.

---

### Task 4: Auto timing and new settings

**Files:** Modify `src/utils/autoCapture.js`; test in `src/test/utils/autoCapture.test.js`.

**Interfaces:**
- `DEFAULT_AUTO_SETTINGS = { presence: 0.08, stillness: 0.02, settleMs: 350, sharpness: 60, fullPhotos: false }`.
- `REARM_MS = 200`.
- `AutoState` gains `emptySince`.
- `captured → empty` once the rig has been empty (`!present`) continuously for `REARM_MS`, regardless of motion.

- [ ] **Step 1: Failing tests.** In `autoCapture.test.js`:
  - Add a constant `const S600 = { ...DEFAULT_AUTO_SETTINGS, settleMs: 600 };`, and in `run`, default `settings` to `S600`, so the existing timing tests keep their meaning. Then replace the `defaults when nothing is stored` expectation with
    `expect(DEFAULT_AUTO_SETTINGS).toEqual({ presence: 0.08, stillness: 0.02, settleMs: 350, sharpness: 60, fullPhotos: false });`
  - In `round-trips and clamps`, call `saveAutoSettings(storage, { presence: 5, stillness: -1, settleMs: 50, sharpness: 9999, fullPhotos: 'yes' })` and expect `{ presence: 0.5, stillness: 0.005, settleMs: 200, sharpness: 300, fullPhotos: false }`.
  - Add:

```js
  it('loads settings saved before sharpness/fullPhotos existed with the new defaults', () => {
    const storage = { getItem: () => JSON.stringify({ presence: 0.1, stillness: 0.03, settleMs: 500 }) };
    expect(loadAutoSettings(storage)).toEqual({ presence: 0.1, stillness: 0.03, settleMs: 500, sharpness: 60, fullPhotos: false });
  });
```

  - And in `describe('stepAuto')`:

```js
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
```

  Add `REARM_MS` to the import list.

- [ ] **Step 2: Run and confirm failure.** The new tests fail. Existing tests pass, because `run` defaults to S600.

- [ ] **Step 3: Implement** in `autoCapture.js`:
  - Change `DEFAULT_AUTO_SETTINGS` to the new defaults. Add `export const REARM_MS = 200;` and `sharpness: [10, 300]` to `LIMITS`.
  - Update `normalise`: add `sharpness: Math.round(clampSetting('sharpness', s?.sharpness))` and `fullPhotos: s?.fullPhotos === true`.
  - Update `initialAutoState`: add `emptySince: null`.
  - Replace the `captured` case:

```js
    case 'captured': {
      // One capture per card: re-arm once the rig has looked empty for
      // REARM_MS, moving or not -- a quick swap shows the empty rig only for a
      // moment while the hand is still in motion.
      if (present()) return { state: { ...next, emptySince: null }, event: null };
      const emptySince = state.emptySince ?? now;
      return now - emptySince >= REARM_MS
        ? { state: { ...next, phase: 'empty', emptySince: null }, event: null }
        : { state: { ...next, emptySince }, event: null };
    }
```

- [ ] **Step 4: Run and confirm pass** (all of `autoCapture.test.js`). **Step 5: Commit** — gated, `feat(scanner): re-arm on a brief empty glimpse; settle in 350 ms`.

---

### Task 5: Video-frame capture and `videoCropFor`

**Files:**
- Modify: `src/utils/rigCalibration.js`, `src/utils/frameCapture.js`.
- Tests: `src/test/utils/rigCalibration.test.js`, `src/test/utils/frameCapture.test.js`.

**Interfaces:**
- `videoCropFor(calibration, width, height) → Rect | null`: the margin-applied calibration rect converted to stream fractions and clamped. Null if uncalibrated or the orientation differs.
- `captureVideoFrame({ video, crop, encode = encodeJpeg, toGray = grayscaleOf }) → { image, gray, grayWidth, grayHeight, source: 'video', width, height, cropped } | null`.
  - `crop(source, width, height)` is the same callback signature `capturePhoto` uses.
  - `gray` is at most 512 px on its long edge.

- [ ] **Step 1: Failing tests.**
  - In `rigCalibration.test.js`, add `videoCropFor` to the import list, and inside `describe('cropFor')` add:

```js
  it('videoCropFor maps the margined calibration onto the stream', () => {
    const r = videoCropFor({ ...CAL, aspect: 0.75 }, 1080, 1920);
    // withMargin(RECT) then a 9:16 stream showing the middle 75% of the width.
    expect(r.x).toBeCloseTo(0.068, 2);
    expect(r.w).toBeCloseTo(0.864, 2);
    expect(r).toMatchObject({ y: 0.068, h: 0.864 });
  });

  it('videoCropFor skips a rotated stream and an uncalibrated rig', () => {
    expect(videoCropFor({ ...CAL, aspect: 0.75 }, 1920, 1080)).toBeNull();
    expect(videoCropFor(null, 1080, 1920)).toBeNull();
  });
```

  - In `frameCapture.test.js`, add `captureVideoFrame` to the import list and append:

```js
describe('captureVideoFrame', () => {
  it('grabs the cropped region of the stream and a small grayscale copy', () => {
    const encode = vi.fn(() => 'FRAME');
    const toGray = vi.fn(() => new Uint8Array(4));
    const video4k = { videoWidth: 2160, videoHeight: 3840 };
    const out = captureVideoFrame({ video: video4k, crop: () => ({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }), encode, toGray });
    expect(encode).toHaveBeenCalledWith(video4k, { width: 1080, height: 1920 }, { sx: 540, sy: 960, sw: 1080, sh: 1920 });
    expect(toGray).toHaveBeenCalledWith(video4k, { width: 288, height: 512 }, { sx: 540, sy: 960, sw: 1080, sh: 1920 });
    expect(out).toMatchObject({ image: 'FRAME', grayWidth: 288, grayHeight: 512, source: 'video', width: 2160, height: 3840, cropped: true });
  });

  it('returns null when the video has no frame', () => {
    expect(captureVideoFrame({ video: { videoWidth: 0, videoHeight: 0 }, encode: vi.fn(), toGray: vi.fn() })).toBeNull();
  });

  it('returns null if drawing fails', () => {
    const encode = () => { throw new Error('InvalidStateError'); };
    expect(captureVideoFrame({ video: { videoWidth: 10, videoHeight: 10 }, encode, toGray: vi.fn() })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.**
  - In `rigCalibration.js`, after `cropFor`:

```js
/**
 * Crop for a frame of the live video stream. The calibration's fractions are
 * of the still photo; the stream is usually a centre crop of it (16:9 of a
 * 4:3 sensor), so the margined rect is converted to stream fractions.
 */
export function videoCropFor(calibration, width, height) {
  if (!calibration || calibration.orientation !== orientationOf(width, height)) return null;
  return clampRect(toStreamRect(withMargin(calibration.rect), width / height, calibration.aspect));
}
```

  - In `frameCapture.js`, add:

```js
/** Draw the region of a source at the given size and return grayscale pixels. */
export function grayscaleOf(source, { width, height }, region) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  }
  return out;
}

const SHARPNESS_EDGE = 512;

/**
 * An instant capture: the current frame of the live stream, cropped to the
 * card at full stream resolution, plus a small grayscale copy for the
 * sharpness check. No shutter wait -- the card can be pulled immediately.
 */
export function captureVideoFrame({ video, crop = () => null, encode = encodeJpeg, toGray = grayscaleOf }) {
  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return null;
  try {
    const rect = crop('video', width, height);
    const region = rect ? cropPixels(rect, width, height) : { sx: 0, sy: 0, sw: width, sh: height };
    const image = encode(video, fitWithin(region.sw, region.sh, CAPTURE_MAX_EDGE), region);
    const graySize = fitWithin(region.sw, region.sh, SHARPNESS_EDGE);
    const gray = toGray(video, graySize, region);
    if (!image || !gray) return null;
    return { image, gray, grayWidth: graySize.width, grayHeight: graySize.height, source: 'video', width, height, cropped: Boolean(rect) };
  } catch {
    return null;
  }
}
```

  - Add `videoCropFor` to `rigCalibration`'s exports if it isn't already there.

- [ ] **Step 4: Run and confirm pass.** (Arithmetic check: `round(1080 × 512 / 1920) = 288`.) **Step 5: Commit** — gated, `feat(scanner): instant video-frame capture cropped to the card`.

---

### Task 6: `scanQueue`

**Files:** Create `src/services/scanQueue.js`; test in `src/test/services/scanQueue.test.js`.

**Interfaces:**
- `RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]`.
- `createScanQueue({ scan, getImage, onResult, onPause, concurrency = 3, wait, isOnline })` returns:
  - `enqueue(id)`, `resume()`, `pause(reason)`, `size()`, `pendingIds()`.
- Callbacks:
  - `scan(image) → Promise<result>`; it never throws, because `ScanService.scan` doesn't;
  - `getImage(id) → Promise<string|null>`;
  - `onResult(id, result)`;
  - `onPause(reason, ids)`.
- Results:
  - `{ status: 'failed', error: 'quota' }` → the id goes back to the front, the queue pauses with `'quota'`, and `onPause('quota', [ids not yet read])`;
  - a missing image → `onResult(id, { status: 'failed', error: 'interrupted' })`;
  - `network` / `unknown` → retry after each delay, then `onResult` with the failure;
  - `forbidden` → `onResult` immediately;
  - offline (`!isOnline()`) before a call → the id goes back to the front, and the queue pauses with `'offline'`.

- [ ] **Step 1: Failing tests:**

```js
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
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `src/services/scanQueue.js`:

```js
/**
 * Background recognition for the scanner. Captures are queued by draft row
 * id and read a few at a time, so capturing never waits on Gemini.
 *
 * - network / unknown failures retry with backoff, then report the failure;
 * - quota pauses the whole queue (pending ids reported, kept for later);
 * - offline pauses until resume() (the scanner calls it on 'online').
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

  const pause = (reason) => {
    if (paused) return;
    paused = reason;
    onPause(reason, [...pending, ...active]);
  };

  async function run(id) {
    const image = await getImage(id);
    if (!image) {
      onResult(id, { status: 'failed', error: 'interrupted' });
      return;
    }
    for (let attempt = 0; ; attempt += 1) {
      if (!isOnline()) {
        pending.unshift(id);
        pause('offline');
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await scan(image);
      if (result.status !== 'failed') {
        onResult(id, result);
        return;
      }
      if (result.error === 'quota') {
        pending.unshift(id);
        pause('quota');
        return;
      }
      if (!RETRYABLE.has(result.error) || attempt >= RETRY_DELAYS_MS.length) {
        onResult(id, result);
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  const pump = () => {
    while (!paused && active.size < concurrency && pending.length) {
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
      pump();
    },
    resume() {
      paused = null;
      pump();
    },
    pause,
    size: () => pending.length + active.size,
    pendingIds: () => [...pending, ...active],
  };
}
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(scanner): background recognition queue`.

---

### Task 7: Draft model: photos by reference, `waiting` status

**Files:** Modify `src/utils/scanDraft.js`; test in `src/test/utils/scanDraft.test.js`.

**Interfaces:**
- `addCapture(draft, { id, isFoil })` → the row gains `hasPhoto: true`. There is no `photo` field any more; a passed `photo` is ignored.
- `markWaiting(draft, ids, reason)` → `status: 'waiting'`.
- `countByStatus` gains `waiting`.
- `loadDraft` keeps `reading` rows as `reading`, and the scanner decides whether to re-queue them. It drops any legacy `photo` field.
- `saveDraft` stores rows as they are.
- `groupRows` exposes `hasPhoto` (replacing `photo` and `hadPhoto`).

- [ ] **Step 1: Update and add tests** in `scanDraft.test.js`:
  - The `capture` helper becomes `addCapture(draft, { id, isFoil })`.
  - `adds a capture as a reading row` expects `{ id: 'a', status: 'reading', isFoil: true, qty: 1, hasPhoto: true }`.
  - `applies an unidentified result…` drops `photo: 'photo-a'` from the expectation.
  - `round-trips a draft without its photos` becomes `round-trips a draft` and expects `{ id: 'a', status: 'matched', hasPhoto: true }`.
  - `turns a row still reading at reload into an interrupted failure` becomes:

```js
  it('keeps a row still reading at reload, for the scanner to queue again', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', capture(emptyDraft(), 'a'));
    expect(loadDraft(storage, 'uid-1').rows[0]).toMatchObject({ status: 'reading', hasPhoto: true });
  });

  it('drops a legacy in-row photo when loading', () => {
    const storage = memoryStorage();
    storage.setItem(draftKey('uid-1'), JSON.stringify({ rows: [{ id: 'a', status: 'matched', isFoil: false, qty: 1, photo: 'BIG' }] }));
    expect(loadDraft(storage, 'uid-1').rows[0].photo).toBeUndefined();
  });

  it('marks rows waiting with a reason, and counts them', () => {
    const d = markWaiting(capture(capture(emptyDraft(), 'a'), 'b'), ['a'], 'quota');
    expect(d.rows[0]).toMatchObject({ status: 'waiting', reason: 'quota' });
    expect(countByStatus(d)).toEqual({ reading: 1, matched: 0, unidentified: 0, failed: 0, waiting: 1 });
  });
```

  - The other `countByStatus` expectations gain `waiting: 0`.
  - Add `markWaiting` to the import list.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** in `scanDraft.js`:
  - `addCapture` builds `{ id, status: 'reading', isFoil: Boolean(isFoil), qty: 1, hasPhoto: true }`.
  - Add:

```js
export function markWaiting(draft, ids, reason) {
  return mapRows(draft, ids, (row) => ({ ...row, status: 'waiting', reason }));
}
```

  - `countByStatus` initial: `{ reading: 0, matched: 0, unidentified: 0, failed: 0, waiting: 0 }`, and ignore unknown statuses (`if (row.status in counts)`).
  - `groupRows`: replace `photo: row.photo, hadPhoto: Boolean(row.hadPhoto)` with `hasPhoto: Boolean(row.hasPhoto)`.
  - `saveDraft`: `storage.setItem(draftKey(uid), JSON.stringify({ rows: draft.rows }))`.
  - `loadDraft`: map rows to `({ photo, hadPhoto, ...row }) => ({ ...row, hasPhoto: Boolean(row.hasPhoto) })`, with no reading → failed conversion.
  - Update the header comment: photos live in the photo store, keyed by row id.

- [ ] **Step 4: Run and confirm pass.** `ScanReview` and `CardScanner` tests will fail until Tasks 9–10. Run only `scanDraft.test.js` here, and commit with the test file (gated on that suite plus lint).

  Ruling for the executor: the full suite cannot be green between Tasks 7 and 10, because the components still read `photo`. Commit Tasks 7–10 as one gated commit at the end of Task 10, or keep the components compiling with interim edits. Prefer the single commit.

---

### Task 8: Auto settings: sharpness and full photos

**Files:** Modify `src/components/AutoSettings.jsx`; test in `src/components/__tests__/AutoSettings.test.jsx`.

**Interfaces:** It adds a `Sharpness` slider (10–300, step 5, shown as an integer) and a checkbox labelled `Always use full photos`.

- [ ] **Step 1: Failing tests:**

```jsx
  it('tunes sharpness and can force full photos', () => {
    const { onChange } = renderSettings();
    expect(screen.getByLabelText('Sharpness')).toHaveValue('60');
    fireEvent.change(screen.getByLabelText('Sharpness'), { target: { value: '120' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_AUTO_SETTINGS, sharpness: 120 });
    fireEvent.click(screen.getByLabelText('Always use full photos'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_AUTO_SETTINGS, fullPhotos: true });
  });
```

  Also update the existing `Settle time` expectations for the new default: `toHaveValue('350')` and `getByText('0.4 s')`. `(350/1000).toFixed(1)` is `'0.3'` in V8 because of binary rounding, so render with `Math.round(v / 100) / 10` and expect `'0.4 s'`.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement:**
  - append to `SLIDERS`: `{ key: 'sharpness', label: 'Sharpness', min: 10, max: 300, step: 5, help: 'How crisp an instant frame must be; blurrier frames fall back to a full photo. Raise it if reads suffer.', show: (v) => String(Math.round(v)) }`;
  - change the settle `show` to `(v) => \`${Math.round(v / 100) / 10} s\``;
  - after the sliders, add:

```jsx
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.fullPhotos}
            onChange={(e) => onChange({ ...settings, fullPhotos: e.target.checked })}
            className="w-5 h-5 accent-yellow-500"
          />
          Always use full photos
        </label>
        <p className="text-xs text-gray-500 -mt-3">Slower (hold still for each photo), for rigs where instant frames read poorly.</p>
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(scanner): sharpness and full-photo settings`. Run this before Task 7's suite-breaking change, or fold it into the Task 10 commit.

---

### Task 9: Review reads photos from the store; Add while reading

**Files:** Modify `src/components/ScanReview.jsx`; test in `src/components/__tests__/ScanReview.test.jsx`.

**Interfaces:**
- `ScanReview` gets photos through a `getPhoto(id) → Promise<string|null>` prop. It defaults to `PhotoStore.get`.
- Rows show:
  - **waiting:** the text "Waiting: daily limit" (reason `quota`) or "Waiting: offline", with Retry;
  - **failed:** Retry only when the row `hasPhoto`.
- **Add:** enabled when `matched > 0` and not committing. The note lists the cards needing attention, and "N still reading will stay in the batch".

- [ ] **Step 1: Update tests.** In `ScanReview.test.jsx`:
  - `build` passes no photo; `addCapture` sets `hasPhoto`.
  - `renderReview` passes `getPhoto={(id) => Promise.resolve(\`p-${id}\`)}` by default.
  - Photo assertions become async (`await screen.findByRole('img', { name: 'Captured photo' })`). The viewer `src` is still `data:image/jpeg;base64,p-<id>`.
  - Replace `disables commit while any card is still reading` with:

```jsx
  it('Add works while cards are reading or waiting, and says they stay', () => {
    const d = markWaiting(build([['a', LUKE], ['r', null], ['w', null]]), ['w'], 'quota');
    renderReview(d);
    expect(screen.getByRole('button', { name: 'Add 1 card to collection' })).toBeEnabled();
    expect(screen.getByText(/1 still reading will stay in the batch/)).toBeInTheDocument();
    expect(screen.getByText(/waiting: daily limit/i)).toBeInTheDocument();
  });

  it('shows No photo when the store has none', async () => {
    renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]), { getPhoto: () => Promise.resolve(null) });
    expect(await screen.findByText('No photo')).toBeInTheDocument();
  });
```

  - The "photo lost" test changes to the same "No photo" expectation.
  - Add `markWaiting` to the imports.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** in `ScanReview.jsx`:
  - A small hook, `useStoredPhoto(id, getPhoto)`, using `useState` and an `useEffect` keyed on `id`. It cancels on unmount, and returns `undefined` (loading), `null` (none) or a base64 string.
  - Change `Photo({ id, getPhoto, onView })` to use the hook:
    - a string → today's button and thumbnail;
    - `null` → "No photo";
    - `undefined` → a gray placeholder box.
  - The matched thumbnail's `View photo of` click loads `await getPhoto(id)` and falls back to the card image.
  - `REASON_TEXT` gains `quota: 'Waiting: daily limit'`, which already existed as "Daily scan limit reached" (change it), and `offline: 'Waiting: offline'`.
  - `waiting` rows render like `failed` rows, with Retry always available.
  - `canCommit = counts.matched > 0 && !committing`. Add a line under the attention note: `{counts.reading > 0 && <p>{counts.reading} still reading will stay in the batch.</p>}`.
  - Replace every `group.photo` / `group.hadPhoto` use with `group.hasPhoto` / `getPhoto`.

- [ ] **Step 4: Run** `npx vitest run src/components/__tests__/ScanReview.test.jsx` until it passes. Commit with Task 10.

---

### Task 10: `CardScanner`: queue, photo store, frame capture, reduced feedback

**Files:** Modify `src/components/CardScanner.jsx`; test in `src/components/__tests__/CardScanner.test.jsx`.

**Interfaces:** Consumes Tasks 2–9.

- [ ] **Step 1: Update tests.** In `CardScanner.test.jsx`:
  - Mock the photo store with an in-memory map:

```jsx
const photos = vi.hoisted(() => ({ map: new Map(), remove: vi.fn() }));
vi.mock('../../services/photoStore', () => ({
  PhotoStore: {
    put: vi.fn(async (id, b) => { photos.map.set(id, b); return true; }),
    get: vi.fn(async (id) => photos.map.get(id) ?? null),
    remove: (...a) => { photos.remove(...a); a[0].forEach((id) => photos.map.delete(id)); return Promise.resolve(); },
    clear: vi.fn(async () => photos.map.clear()),
  },
}));
```

    with `photos.map.clear(); photos.remove.mockClear();` in `beforeEach`.
  - Mock `captureVideoFrame` alongside `capturePhoto` (`mocks.captureVideoFrame`, default `null`, so existing manual-path tests are unchanged). Also mock `laplacianVariance` via `vi.mock('../../utils/sharpness', …)`, returning `mocks.sharpness` (default 200).
  - Flash tests:
    - `flashes when a card cannot be identified` → `stays silent when a card cannot be identified, and the badge counts it`: no `scan-flash`, and the `review-badge` shows `1`.
    - `flashes green when a card is read` → `no flash on a good read`.
    - `never lets a green flash cover…` → delete it (no green flash exists).
    - `flashes when the frame cannot be captured` stays (red, `data-kind="error"`).
  - Add:

```jsx
  it('stores each capture as a photo and reads it through the queue', async () => {
    renderScanner();
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR'], { hintSets: [], baseSets: [] }));
    expect([...photos.map.values()]).toEqual(['IMG']);
  });

  it('re-queues cards still reading when the scanner reopens', async () => {
    const saved = JSON.stringify({ rows: [{ id: 'old', status: 'reading', isFoil: false, qty: 1, hasPhoto: true }] });
    localStorage.getItem.mockImplementation((key) => (key === 'swu-scan-draft-uid-1' ? saved : (key === 'swu-scan-help-seen' ? '1' : null)));
    photos.map.set('old', 'OLDIMG');
    renderScanner();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('OLDIMG', ['SOR'], expect.any(Object)));
  });

  it('deletes photos of rows that leave the batch', async () => {
    const user = userEvent.setup();
    mocks.commitDraft.mockImplementation(async () => ({ rows: [] }));
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    await waitFor(() => expect(photos.remove).toHaveBeenCalled());
  });
```

  - In `describe('auto mode')`, add:

```jsx
    it('uses an instant video frame when it is sharp enough', async () => {
      rigStored = CAL;
      mocks.captureVideoFrame.mockReturnValue({ image: 'FRAME', gray: new Uint8Array(9), grayWidth: 3, grayHeight: 3, source: 'video', width: 2160, height: 3840, cropped: true });
      mocks.sharpness = 200;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(8, 200));
      await tick(11);
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('FRAME', expect.any(Array), expect.any(Object)));
    });

    it('falls back to a full photo when the frame is blurry', async () => {
      rigStored = CAL;
      mocks.captureVideoFrame.mockReturnValue({ image: 'FRAME', gray: new Uint8Array(9), grayWidth: 3, grayHeight: 3, source: 'video', width: 2160, height: 3840, cropped: true });
      mocks.sharpness = 5;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(8, 200));
      await tick(11);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
    });
```

  - Update `Add 1 card to collection` flows: commit now also deletes photos. Tests asserting `Review (1)` and the badge are unchanged.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** in `CardScanner.jsx`:
  - Imports: `PhotoStore` from `../services/photoStore`; `createScanQueue` from `../services/scanQueue`; `captureVideoFrame` from `../utils/frameCapture`; `laplacianVariance` from `../utils/sharpness`; `videoCropFor` and `markWaiting` (from `rigCalibration` and `scanDraft` respectively).
  - Replace `runScan` with a result handler plus a queue held in a ref:

```jsx
  // Each capture's result, whenever the background queue gets to it. No
  // flash: recognition problems show only as the Review badge.
  const handleResult = useCallback((id, result) => {
    if (!mountedRef.current) return;
    if (result.status === 'matched'
      && getCardQuantities(collectionRefData.current, result.set, result.number).total === 0
      && !draftRef.current.rows.some((r) => r.id !== id && r.status === 'matched'
        && r.set === result.set && r.number === result.number)) {
      setNewCard(result.name);
      clearTimeout(newCardTimer.current);
      newCardTimer.current = setTimeout(() => { if (mountedRef.current) setNewCard(null); }, 1500);
    }
    setDraft((d) => applyResult(d, id, result));
  }, []);

  const scanOptionsRef = useRef({});
  scanOptionsRef.current = { setCodes, hintSets: pickedSets, baseSets };
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createScanQueue({
      scan: (image) => {
        const { setCodes: codes, hintSets, baseSets: bases } = scanOptionsRef.current;
        return ScanService.scan(image, codes, { hintSets, baseSets: bases });
      },
      getImage: (id) => PhotoStore.get(id),
      onResult: (id, result) => handleResultRef.current(id, result),
      onPause: (reason, ids) => {
        if (!mountedRef.current) return;
        if (reason === 'quota') {
          quotaRef.current = quotaRef.current ?? { limit: null, resetsAt: null };
          setQuota(quotaRef.current);
        }
        setDraft((d) => markWaiting(d, ids, reason));
      },
    });
  }
  const handleResultRef = useRef(handleResult);
  handleResultRef.current = handleResult;
```

    `handleResultRef` must be declared before `queueRef`'s initialiser runs. Put both `useRef`s first, then the `if (!queueRef.current)` block.
  - Quota details: `ScanService.scan` returns `{ error: 'quota', limit, resetsAt }`. To keep the banner's numbers, wrap `scan` so that on `quota` it sets `quotaRef.current = { limit, resetsAt }` before returning.
  - Effects:
    - **On mount:** for every row still `reading`, check `PhotoStore.get(id)`. If there's a photo, `queueRef.current.enqueue(id)`; otherwise `applyResult(…, { status: 'failed', error: 'interrupted' })`.
    - Resume the queue on `window` `online`.
    - Track `prevIdsRef` and, on every draft change, `PhotoStore.remove(ids that disappeared)`.
  - `capture(options)` changes:
    - After the guards:
      - if `options?.auto === true && !autoSettingsRef.current.fullPhotos`, try `captureVideoFrame({ video: videoRef.current, crop: (s, w, h) => videoCropFor(calibration, w, h) })`;
      - accept it when `laplacianVariance(frame.gray, frame.grayWidth, frame.grayHeight) >= autoSettingsRef.current.sharpness`;
      - otherwise `capturePhoto(…)` exactly as now.
    - With an image:
      - `const id = newId(); await PhotoStore.put(id, shot.image);`
      - `setDraft((d) => addCapture(d, { id, isFoil }));`
      - `queueRef.current.enqueue(id);`
      - **no** `signal` call.
    - Without one: `signal('error')`, as now.
  - `retry(id)`: `setDraft((d) => markReading(d, id))`, clear the quota pause if any (`quotaRef.current = null; setQuota(null); queueRef.current.resume();`), then `queueRef.current.enqueue(id)`.
  - `signal`: delete the `'success'` path. `signal()` becomes `signal('error')` only. Keep the function, with an error-only body.
  - Remove `runScan` and its uses. The NEW pop-up logic now lives in `handleResult`.
  - The Review button gains a reading counter: `{counts.reading > 0 && <span className="ml-1 text-xs font-normal">· reading {counts.reading}</span>}` inside the button. The aria-label stays `Review (${total})`.
  - Discard also calls `PhotoStore.clear()`.

- [ ] **Step 4: Run.** Run `npx vitest run src/components/__tests__/CardScanner.test.jsx src/components/__tests__/ScanReview.test.jsx src/test/utils/scanDraft.test.js` until green, then the full gate.

- [ ] **Step 5: Commit** (Tasks 7, 9 and 10 together) — gated, `feat(scanner): background reading queue, photos on disk, instant sharp frames`.

---

### Task 11: Docs

- [ ] Update `CLAUDE.md`'s Card scanner section to describe the pipeline:
  - instant frame plus the sharpness check, with a full-photo fallback;
  - the `scanQueue` (3 in flight, backoff, quota and offline pause);
  - photos in IndexedDB `scanPhotos` (database v2 via `appDb.js`, shared with `cardSets`);
  - no flash except for a bad photo;
  - Add while reading.

  Remove the "photos stay in memory" notes.
- [ ] Update `TESTING.md` manual checks:
  - the share of frames passing the sharpness check;
  - read accuracy, frames vs. full photos;
  - a full box with no mid-stream saves;
  - kill and reopen mid-batch.
- [ ] Commit — gated, `docs: scanner pipeline`.
