/**
 * Bubble level for overhead card shots. With the phone lying flat and the
 * camera pointing down at the table, DeviceOrientation reports beta ≈ 0 and
 * gamma ≈ 0; any tilt shows up as keystoning in the photo, which shrinks and
 * skews the collector line Gemini has to read.
 *
 * Pure: the component feeds it the event's beta/gamma.
 */
export const LEVEL_TOLERANCE_DEG = 3;
const FULL_SCALE_DEG = 15;

const toOffset = (deg) => Math.max(-1, Math.min(1, deg / FULL_SCALE_DEG));

export function levelReading(beta, gamma, tolerance = LEVEL_TOLERANCE_DEG) {
  if (typeof beta !== 'number' || typeof gamma !== 'number') return null;
  return {
    x: toOffset(gamma),
    y: toOffset(beta),
    isLevel: Math.hypot(beta, gamma) <= tolerance,
  };
}
