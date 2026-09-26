import { describe, it, expect } from 'vitest';
import { rankSearchResults } from '../../utils/cardSearchRanking.js';

/**
 * Relevance ordering for the deck-builder card search.
 *
 * The search always matched substrings correctly — "trooper" really did match
 * "Death Star Stormtrooper". The problem was the ordering: results were sorted
 * alphabetically, and a trait match ranked exactly as highly as a name match.
 * Against the live database "trooper" returns 29 cards by name and 178 by
 * trait, so what the player asked for sat scattered among six times as many
 * cards they did not.
 *
 * Deck building means doing this 30-50 times per deck, so where the right card
 * lands in the list is the whole experience.
 */

const card = (name, over = {}) => ({
  Name: name,
  Subtitle: '',
  Traits: [],
  Keywords: [],
  FrontText: '',
  Set: 'SOR',
  Number: '001',
  ...over,
});

describe('rankSearchResults', () => {
  it('puts an exact name match first', () => {
    const cards = [
      card('Clone Trooper'),
      card('Trooper'),
      card('Dark Trooper'),
    ];
    expect(rankSearchResults(cards, 'trooper')[0].Name).toBe('Trooper');
  });

  it('ranks a name match above a trait-only match', () => {
    const byTrait = card('Emperor Palpatine', { Traits: ['Imperial', 'Trooper'] });
    const byName = card('Death Star Stormtrooper');

    expect(rankSearchResults([byTrait, byName], 'trooper')[0].Name)
      .toBe('Death Star Stormtrooper');
  });

  it('ranks a word-start match above a mid-word one', () => {
    // "Death Trooper" starts a word with the query; "Stormtrooper" buries it.
    const midWord = card('Death Star Stormtrooper');
    const wordStart = card('Death Trooper');

    expect(rankSearchResults([midWord, wordStart], 'trooper')[0].Name)
      .toBe('Death Trooper');
  });

  it('still returns the mid-word match rather than dropping it', () => {
    const results = rankSearchResults(
      [card('Death Star Stormtrooper'), card('Death Trooper')],
      'trooper',
    );
    expect(results.map((c) => c.Name)).toContain('Death Star Stormtrooper');
  });

  it('ranks a name prefix above a name containing the query elsewhere', () => {
    const prefix = card('Trooper Squad');
    const contains = card('Elite Trooper Guard');

    expect(rankSearchResults([contains, prefix], 'trooper')[0].Name).toBe('Trooper Squad');
  });

  it('ranks subtitle matches below name matches but above traits', () => {
    const subtitle = card('Some Leader', { Subtitle: 'Trooper Commander' });
    const trait = card('Other Card', { Traits: ['Trooper'] });
    const name = card('Clone Trooper');

    const order = rankSearchResults([trait, subtitle, name], 'trooper').map((c) => c.Name);
    expect(order).toEqual(['Clone Trooper', 'Some Leader', 'Other Card']);
  });

  it('ranks rules-text matches last', () => {
    const text = card('Unrelated Card', { FrontText: 'Deal 1 damage to a Trooper unit.' });
    const trait = card('Other Card', { Traits: ['Trooper'] });

    const order = rankSearchResults([text, trait], 'trooper').map((c) => c.Name);
    expect(order).toEqual(['Other Card', 'Unrelated Card']);
  });

  it('breaks ties alphabetically so the order is stable', () => {
    const cards = [card('Zeta Trooper'), card('Alpha Trooper'), card('Mid Trooper')];
    expect(rankSearchResults(cards, 'trooper').map((c) => c.Name))
      .toEqual(['Alpha Trooper', 'Mid Trooper', 'Zeta Trooper']);
  });

  it('is case-insensitive', () => {
    const cards = [card('Other', { Traits: ['Trooper'] }), card('STORMTROOPER')];
    expect(rankSearchResults(cards, 'TrOoPeR')[0].Name).toBe('STORMTROOPER');
  });

  it('leaves the list alphabetical when there is no query', () => {
    const cards = [card('Zeta'), card('Alpha')];
    expect(rankSearchResults(cards, '').map((c) => c.Name)).toEqual(['Alpha', 'Zeta']);
  });

  it('handles missing fields without throwing', () => {
    const cards = [{ Name: 'Bare Card' }, {}];
    expect(() => rankSearchResults(cards, 'trooper')).not.toThrow();
  });

  it('returns an empty array for no input', () => {
    expect(rankSearchResults([], 'x')).toEqual([]);
    expect(rankSearchResults(null, 'x')).toEqual([]);
  });
});
