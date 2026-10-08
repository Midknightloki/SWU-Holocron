import { describe, it, expect } from 'vitest';
import {
  isOfficialImageUrl, setFromImageUrl, normalizeName, earlierBaseSets, resolveDecklistLine, titleCase, deckCounts, buildPrebuiltDeck,
} from '../../utils/decklistImage';

const REGISTRY = [
  { code: 'SOR', isBaseSet: true, releaseDate: '2024-03-08' },
  { code: 'SHD', isBaseSet: true, releaseDate: '2024-07-12' },
  { code: 'TWI', isBaseSet: true, releaseDate: '2024-11-08' },
  { code: 'JTL', isBaseSet: true, releaseDate: '2025-03-14' },
  { code: 'JTLOP', isBaseSet: false, releaseDate: '2025-03-14' },
  { code: 'LAW', isBaseSet: true, releaseDate: '2026-03-13' },
];
const c = (Set, Number, Name, Type = 'Unit') => ({ Set, Number, Name, Subtitle: '', Type });
const CARDS = {
  JTL: [c('JTL', '009', 'Boba Fett', 'Leader'), c('JTL', '189', 'Boba Fett'), c('JTL', '240', "Fett's Firespray"), c('JTL', '130', 'Somebody Else'), c('JTL', '024', 'Echo Base', 'Base')],
  TWI: [c('TWI', '184', "Fett's Firespray")],
  SHD: [c('SHD', '130', 'First Legion Snowtrooper'), c('SHD', '184', 'Not It')],
  SOR: [],
};
const ctx = { setCode: 'JTL', cardsBySet: CARDS, earlierSets: ['TWI', 'SHD', 'SOR'] };
const line = (number, name, fromPreviousSet = false, qty = 1) => ({ number, name, fromPreviousSet, qty });

describe('links and sets', () => {
  it('accepts only official CDN links', () => {
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com//large_SWH_04_x.jpg')).toBe(true);
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com.evil.com/x.png')).toBe(false);
  });
  it('reads the set number from the file name', () => {
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg', REGISTRY)).toBe('JTL');
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com//large_SWH_07_P2_Spotlight.png', REGISTRY)).toBe('LAW');
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com/other.png', REGISTRY)).toBeNull();
    expect(setFromImageUrl(null, REGISTRY)).toBeNull();
  });
  it('lists earlier base sets, newest first', () => {
    expect(earlierBaseSets('JTL', REGISTRY)).toEqual(['TWI', 'SHD', 'SOR']);
  });
  it('normalises names', () => {
    expect(normalizeName("LEIA’S DISGUISE")).toBe(normalizeName("Leia's Disguise"));
    expect(normalizeName('Daimyo’s Palace')).toBe(normalizeName("Daimyo's Palace"));
    expect(normalizeName('BoShek')).toBe(normalizeName('Bo-Shek'));
  });
  it('title-cases a shouted heading', () => {
    expect(titleCase('BOBA FETT')).toBe('Boba Fett');
    expect(titleCase('THE MANDALORIAN')).toBe('The Mandalorian');
  });
});

describe('resolveDecklistLine', () => {
  it('resolves a plain line in the deck set by number and name', () => {
    expect(resolveDecklistLine(line('9', 'Boba Fett'), ctx).card.Number).toBe('009');
    expect(resolveDecklistLine(line('189', 'BOBA FETT'), ctx).card.Number).toBe('189');
  });
  it('resolves a starred line in an earlier set, even when the number exists in this set', () => {
    const r = resolveDecklistLine(line('130', 'First Legion Snowtrooper', true), ctx);
    expect(r.card).toMatchObject({ Set: 'SHD', Number: '130' });
  });
  it('takes the newest earlier set that agrees on number and name', () => {
    expect(resolveDecklistLine(line('184', "Fett's Firespray", true), ctx).card.Set).toBe('TWI');
  });
  it('never accepts a number whose name disagrees', () => {
    const r = resolveDecklistLine(line('240', 'Boba Fett'), ctx);
    expect(r).toMatchObject({ error: 'name-mismatch' });
    expect(r.candidate.Name).toBe("Fett's Firespray");
  });
  it('falls back to earlier sets for an unstarred line, and says not-found otherwise', () => {
    expect(resolveDecklistLine(line('130', 'First Legion Snowtrooper'), ctx).card.Set).toBe('SHD');
    expect(resolveDecklistLine(line('777', 'Nobody'), ctx)).toEqual({ error: 'not-found' });
  });
});

describe('building the deck', () => {
  const entries = [
    { card: CARDS.JTL[0], qty: 1 }, { card: CARDS.JTL[4], qty: 1 },
    { card: CARDS.JTL[1], qty: 2 }, { card: CARDS.TWI[0], qty: 1 }, { card: CARDS.JTL[1], qty: 1 },
  ];
  it('counts leaders, bases and the main deck', () => {
    expect(deckCounts(entries)).toEqual({ leaders: 1, bases: 1, main: 4 });
  });
  it('builds a prebuilt deck with merged quantities, leaders and base', () => {
    expect(buildPrebuiltDeck({ title: 'BOBA FETT', entries, setCode: 'JTL' })).toEqual({
      sourceId: 'img-jtl-boba-fett',
      sourceName: 'Boba Fett',
      leaders: ['JTL_009'],
      base: 'JTL_024',
      cards: [{ id: 'JTL_009', qty: 1 }, { id: 'JTL_024', qty: 1 }, { id: 'JTL_189', qty: 3 }, { id: 'TWI_184', qty: 1 }],
      issues: [],
      removedLines: [],
    });
  });

  it('keeps a removed in-set line as a flagged card, so adding the deck names it as skipped', () => {
    const deck = buildPrebuiltDeck({ title: 'BOBA FETT', entries, setCode: 'JTL', removed: [
      { number: '200', name: 'Shuttle Tydirium', qty: 3, fromPreviousSet: false },
      { number: '131', name: 'Fifth Brother', qty: 2, fromPreviousSet: true },
    ] });
    expect(deck.cards).toContainEqual({ id: 'JTL_200', qty: 3 });
    expect(deck.issues).toEqual([{ id: 'JTL_200', problem: 'unknown-card' }]);
    expect(deck.removedLines).toEqual([
      { number: '200', name: 'Shuttle Tydirium', qty: 3, fromPreviousSet: false },
      { number: '131', name: 'Fifth Brother', qty: 2, fromPreviousSet: true },
    ]);
  });
});
