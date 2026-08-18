import { describe, expect, it } from 'vitest';
import { editDistance, fuzzyScore, fuzzySearch, normalize } from '@shared/utils';

describe('normalize', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize('Spider-Man: Brand New Day!')).toBe('spider man brand new day');
    expect(normalize('  Mission   IMPOSSIBLE ')).toBe('mission impossible');
  });
});

describe('editDistance', () => {
  it('computes Damerau-Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'acb')).toBe(1); // transposition
    expect(editDistance('same', 'same')).toBe(0);
  });
});

describe('fuzzyScore', () => {
  it('scores exact matches highest', () => {
    expect(fuzzyScore('Moana', 'Moana')).toBe(1);
  });
  it('scores substrings highly for meaningful queries', () => {
    expect(fuzzyScore('odyssey', 'The Odyssey')).toBeGreaterThanOrEqual(0.9);
  });
  it('does NOT treat 1-2 char queries as substrings', () => {
    expect(fuzzyScore('i', 'jimi')).toBeLessThan(0.5);
    expect(fuzzyScore('to', 'towers')).toBeLessThan(0.6);
  });
  it('tolerates misspellings', () => {
    expect(fuzzyScore('mision imposible', 'Mission Impossible')).toBeGreaterThan(0.6);
    expect(fuzzyScore('tou story', 'Toy Story 5')).toBeGreaterThan(0.55);
  });
  it('rejects unrelated strings', () => {
    expect(fuzzyScore('spiderman', 'Lumivia The Five Magical Wishes')).toBeLessThan(0.5);
  });
});

describe('fuzzySearch', () => {
  const items = ['Spider-Man: Brand New Day', 'Toy Story 5', 'The Odyssey', 'Moana'];
  it('ranks the right movie first for partial queries', () => {
    const res = fuzzySearch('toy story', items, (i) => [i]);
    expect(res[0]?.item).toBe('Toy Story 5');
  });
  it('finds misspelled titles', () => {
    const res = fuzzySearch('the odyssee', items, (i) => [i]);
    expect(res[0]?.item).toBe('The Odyssey');
  });
  it('returns empty for garbage', () => {
    expect(fuzzySearch('qwzzxv jkllop', items, (i) => [i])).toHaveLength(0);
  });
});
