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
