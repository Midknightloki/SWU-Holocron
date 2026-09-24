/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * Set registry reads.
 *
 * The set list used to be hardcoded in six places, so the app could not see a
 * set until someone edited code. getAvailableSets() now reads the registry the
 * seeder publishes, which is what makes a new set appear without a redeploy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDoc = vi.fn();

vi.mock('../../firebase', () => ({
  db: { _type: 'firestore' },
  APP_ID: 'test-app-id',
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ _path: args.slice(1).join('/') }),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: vi.fn(),
  collection: (...args) => ({ _path: args.slice(1).join('/') }),
}));

const registryDoc = (sets) => ({
  exists: () => true,
  data: () => ({ sets, setCount: sets.length, discoveredAt: Date.now() }),
});

let CardService;

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear?.();
  vi.unstubAllGlobals?.();
  ({ CardService } = await import('../../services/CardService'));
});

describe('CardService.getSetRegistry', () => {
  it('returns the registry the seeder published', async () => {
    mockGetDoc.mockResolvedValue(registryDoc([
      { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true, releaseDate: '2024-03-08' },
      { code: 'HMW', name: 'Homeworlds', isBaseSet: true, releaseDate: '2026-10-09' },
      { code: 'SOROP', name: 'Spark of Rebellion - OP Promo', isBaseSet: false, releaseDate: null },
    ]));

    const registry = await CardService.getSetRegistry();

    expect(registry.map((s) => s.code)).toEqual(['SOR', 'HMW', 'SOROP']);
  });

  it('reads the registry in a single call, not one probe per known set', async () => {
    mockGetDoc.mockResolvedValue(registryDoc([{ code: 'SOR', name: 'SOR', isBaseSet: true }]));

    await CardService.getSetRegistry();

    // The previous implementation issued one getDoc per hardcoded set code.
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
  });

  it('surfaces sets that no hardcoded list ever contained', async () => {
    mockGetDoc.mockResolvedValue(registryDoc([
      { code: 'TS26', name: 'Twin Suns 2026', isBaseSet: true, releaseDate: '2026-05-08' },
      { code: 'ASH', name: 'Ashes of the Empire', isBaseSet: true, releaseDate: '2026-07-17' },
    ]));

    const codes = (await CardService.getSetRegistry()).map((s) => s.code);

    expect(codes).toContain('TS26');
    expect(codes).toContain('ASH');
  });

  it('falls back to the bundled SETS when the registry document is absent', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const registry = await CardService.getSetRegistry();

    expect(registry.length).toBeGreaterThan(0);
    expect(registry.map((s) => s.code)).toContain('SOR');
  });

  it('falls back when the registry exists but carries no sets', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ sets: [] }) });

    const registry = await CardService.getSetRegistry();

    expect(registry.length).toBeGreaterThan(0);
  });

  it('falls back rather than throwing when Firestore rejects the read', async () => {
    mockGetDoc.mockRejectedValue(new Error('Missing or insufficient permissions'));

    const registry = await CardService.getSetRegistry();

    expect(registry.length).toBeGreaterThan(0);
    expect(registry.map((s) => s.code)).toContain('SOR');
  });

  it('keeps the legacy PROMO bucket reachable so old collection docs resolve', async () => {
    // Collection documents are keyed PROMO_001_std. If PROMO stops resolving,
    // those cards are orphaned.
    mockGetDoc.mockResolvedValue(registryDoc([
      { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true },
    ]));

    const codes = (await CardService.getAvailableSets()).map?.((s) => s.code ?? s) ?? [];

    expect(codes).toContain('PROMO');
  });
});
