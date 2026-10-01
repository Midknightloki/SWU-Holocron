import { describe, it, expect } from 'vitest';
import { levelReading, LEVEL_TOLERANCE_DEG } from '../../utils/level';

// Phone lying flat, camera pointing down at the table: beta ≈ 0, gamma ≈ 0.
describe('levelReading', () => {
  it('is level when both tilts are within tolerance', () => {
    expect(LEVEL_TOLERANCE_DEG).toBe(3);
    expect(levelReading(1, -2)).toMatchObject({ isLevel: true });
  });

  it('is not level when tilted past tolerance on either axis combined', () => {
    expect(levelReading(2.5, 2.5)).toMatchObject({ isLevel: false });
    expect(levelReading(8, 0)).toMatchObject({ isLevel: false });
  });

  it('maps tilt to a bubble offset in -1..1, clamped at 15°', () => {
    expect(levelReading(0, 7.5)).toMatchObject({ x: 0.5, y: 0 });
    expect(levelReading(-30, 0)).toMatchObject({ x: 0, y: -1 });
  });

  it('returns null when the device reports no orientation', () => {
    expect(levelReading(null, null)).toBeNull();
    expect(levelReading(undefined, 3)).toBeNull();
  });
});
