import { describe, it, expect } from 'vitest';
import {
  parseDeckLink, splitCardId, parseDeckApi, findMissingCards, isPreconProduct,
  deckSetCode, suggestProduct, planSync, deckApiUrl, sameCards, knownIdsFrom,
} from '../../utils/prebuiltDecks';

const PALPATINE = {
  metadata: { name: 'Emperor Palpatine (ASH)' },
  leader: { id: 'ASH_015', count: 1 },
  base: { id: 'ASH_021', count: 1 },
  deck: [
    { unit: 'Unit', id: 'ASH_118', count: 1 },
    { unit: 'Unit', id: 'SEC_185', count: 2 },
    { unit: 'Upgrade', id: 'LOF_091', count: 1 },
  ],
};
const TWIN_SUNS = {
  metadata: { name: 'Aggresive Negotiations (TS26)' },
  leader: { id: 'TS26_002', count: 1 },
  base: { id: 'TS26_011', count: 1 },
  deck: [{ unit: 'Leader', id: 'TS26_004', count: 1 }, { unit: 'Unit', id: 'SOR_160', count: 1 }],
};

describe('links and ids', () => {
  it('reads a deck id from a link or a bare number', () => {
    expect(parseDeckLink('https://sw-unlimited-db.com/decks/151901')).toBe(151901);
    expect(parseDeckLink('https://www.sw-unlimited-db.com/decks/151901/emperor-palpatine/')).toBe(151901);
    expect(parseDeckLink(' 151901 ')).toBe(151901);
    expect(parseDeckLink('https://swudb.com/deck/abc')).toBeNull();
    expect(parseDeckLink('')).toBeNull();
  });

  it('splits a card id at the last underscore', () => {
    expect(splitCardId('ASH_118')).toEqual({ set: 'ASH', number: '118' });
    expect(splitCardId('SOROP_010')).toEqual({ set: 'SOROP', number: '010' });
    expect(splitCardId('nope')).toBeNull();
  });

  it('builds the deck API url', () => {
    expect(deckApiUrl(151901)).toBe('https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=151901');
  });
});

describe('parseDeckApi', () => {
  it('merges leader, base and deck into one card list', () => {
    expect(parseDeckApi(PALPATINE, 151901)).toEqual({
      sourceId: 151901,
      sourceName: 'Emperor Palpatine (ASH)',
      leaders: ['ASH_015'],
      base: 'ASH_021',
      cards: [
        { id: 'ASH_015', qty: 1 }, { id: 'ASH_021', qty: 1 },
        { id: 'ASH_118', qty: 1 }, { id: 'SEC_185', qty: 2 }, { id: 'LOF_091', qty: 1 },
      ],
    });
  });

  it('collects both leaders of a Twin Suns deck once each', () => {
    const deck = parseDeckApi(TWIN_SUNS, 147115);
    expect(deck.leaders).toEqual(['TS26_002', 'TS26_004']);
    expect(deck.cards.filter((c) => c.id === 'TS26_004')).toEqual([{ id: 'TS26_004', qty: 1 }]);
  });

  it('adds up a card listed twice, and rejects a response with no cards', () => {
    const twice = { ...PALPATINE, deck: [{ id: 'ASH_118', count: 1 }, { id: 'ASH_118', count: 2 }] };
    expect(parseDeckApi(twice, 1).cards.find((c) => c.id === 'ASH_118').qty).toBe(3);
    expect(parseDeckApi({ metadata: { name: 'x' } }, 1)).toBeNull();
    expect(parseDeckApi(null, 1)).toBeNull();
  });
});

describe('findMissingCards', () => {
  it('flags cards missing from the database', () => {
    const known = new Set(['ASH_015', 'ASH_021', 'ASH_118', 'SEC_185']);
    expect(findMissingCards(parseDeckApi(PALPATINE, 1).cards, known)).toEqual([{ id: 'LOF_091', problem: 'unknown-card' }]);
  });
});

describe('card numbers in either format', () => {
  it('matches deck ids to database cards whose numbers are not zero-padded', () => {
    // swu-db stores TS26 numbers as "1"; sw-unlimited-db's deck ids say TS26_001.
    const known = knownIdsFrom([{ Set: 'TS26', Number: '1' }, { Set: 'TS26', Number: '10' }, { Set: 'SOR', Number: '010' }]);
    expect(findMissingCards([{ id: 'TS26_001', qty: 1 }, { id: 'TS26_010', qty: 1 }, { id: 'SOR_010', qty: 1 }, { id: 'TS26_002', qty: 1 }], known))
      .toEqual([{ id: 'TS26_002', problem: 'unknown-card' }]);
  });
});

describe('products', () => {
  const P = (name, setCode, tcgplayerProductId = name.length) => ({ tcgplayerProductId, name, setCode, imageUrl: 'i', releasedOn: 'r' });
  const PRODUCTS = [
    P('Ashes of the Empire - Spotlight Deck: Luke Skywalker', 'ASH', 1),
    P('Ashes of the Empire - Spotlight Deck: Emperor Palpatine', 'ASH', 2),
    P('Twin Suns - Aggressive Negotiations Deck', 'TS26', 3),
    P('Twin Suns - Blood Brothers Deck', 'TS26', 4),
    P('Intro Battle: Hoth - Learn to Play Kit', 'IBH', 5),
    P('Spark of Rebellion - Two-Player Starter', 'SOR', 6),
  ];

  it('keeps only single-deck precon products', () => {
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck: Emperor Palpatine')).toBe(true);
    expect(isPreconProduct('Twin Suns - Master and Apprentice Deck')).toBe(true);
    expect(isPreconProduct('Shadows of the Galaxy - Two-Player Starter')).toBe(true);
    expect(isPreconProduct('Intro Battle: Hoth - Learn to Play Kit')).toBe(true);
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck Display')).toBe(false);
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck Pair: Emperor Palpatine & Luke Skywalker')).toBe(false);
    expect(isPreconProduct('Shadows of the Galaxy - Two-Player Starter Case')).toBe(false);
    expect(isPreconProduct('Twin Suns - 4 Deck Bundle')).toBe(false);
    expect(isPreconProduct('Imperial Deck Officer')).toBe(false);
    expect(isPreconProduct('Greef Karga - Introductions are in Order')).toBe(false);
  });

  it('takes the set code from the name, else from the leader', () => {
    expect(deckSetCode(parseDeckApi(PALPATINE, 1))).toBe('ASH');
    expect(deckSetCode({ sourceName: 'Master and Apprentice', leaders: ['TS26_001'] })).toBe('TS26');
  });

  it('suggests the product with the same set and the most shared name words', () => {
    expect(suggestProduct(parseDeckApi(PALPATINE, 1), PRODUCTS).tcgplayerProductId).toBe(2);
    expect(suggestProduct(parseDeckApi(TWIN_SUNS, 1), PRODUCTS).tcgplayerProductId).toBe(3); // despite the typo
    expect(suggestProduct({ sourceName: 'Intro Battle: Hoth Vader Preset', leaders: ['IBH_053'] }, PRODUCTS).tcgplayerProductId).toBe(5);
  });

  it('suggests nothing without a product in the same set or any shared word', () => {
    expect(suggestProduct({ sourceName: 'Boba Aggression', leaders: ['JTL_010'] }, PRODUCTS)).toBeNull();
    expect(suggestProduct({ sourceName: 'Zzz (ASH)', leaders: ['ASH_001'] }, PRODUCTS)).toBeNull();
    // A personal deck is not the set's only precon just because it shares the set.
    expect(suggestProduct({ sourceName: 'Aggression', leaders: ['SOR_010'] }, PRODUCTS)).toBeNull();
  });
});

describe('planSync', () => {
  it('fetches new decks and decks edited since they were stored, and skips ignored ones', () => {
    const listed = [
      { id: 1, updatedDate: '2026-07-01T00:00:00Z' },
      { id: 2, updatedDate: '2026-07-02T00:00:00Z' },
      { id: 3, updatedDate: '2026-09-01T00:00:00Z' },
      { id: 4, updatedDate: '2026-09-01T00:00:00Z' },
    ];
    const stored = {
      2: { status: 'published', sourceUpdatedAt: '2026-07-02T00:00:00Z' },
      3: { status: 'published', sourceUpdatedAt: '2026-07-01T00:00:00Z' },
      4: { status: 'ignored', sourceUpdatedAt: '2026-07-01T00:00:00Z' },
    };
    expect(planSync(listed, stored)).toEqual([{ sourceId: 1, reason: 'new' }, { sourceId: 3, reason: 'update' }]);
  });

  it('refetches a deck added by link (no source date) once, and a changed deck only when edited again', () => {
    const listed = [{ id: 5, updatedDate: '2026-07-01' }, { id: 6, updatedDate: '2026-08-01' }, { id: 7, updatedDate: '2026-09-01' }];
    const stored = {
      5: { status: 'published', sourceUpdatedAt: null },
      6: { status: 'changed', sourceUpdatedAt: '2026-07-01', pending: { sourceUpdatedAt: '2026-08-01' } },
      7: { status: 'changed', sourceUpdatedAt: '2026-07-01', pending: { sourceUpdatedAt: '2026-08-01' } },
    };
    expect(planSync(listed, stored)).toEqual([{ sourceId: 5, reason: 'update' }, { sourceId: 7, reason: 'update' }]);
  });
});

describe('sameCards', () => {
  it('compares card lists regardless of order', () => {
    expect(sameCards([{ id: 'A', qty: 1 }, { id: 'B', qty: 2 }], [{ id: 'B', qty: 2 }, { id: 'A', qty: 1 }])).toBe(true);
    expect(sameCards([{ id: 'A', qty: 1 }], [{ id: 'A', qty: 2 }])).toBe(false);
    expect(sameCards([{ id: 'A', qty: 1 }], [])).toBe(false);
  });
});
