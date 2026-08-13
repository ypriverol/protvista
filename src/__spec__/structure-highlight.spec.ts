import { describe, expect, it } from 'vitest';
import {
  collectIntervals,
  mergeIntervals,
  buildHighlight,
} from '../utils/structure-highlight';

describe('collectIntervals', () => {
  it('reads start/end from feature arrays', () => {
    expect(
      collectIntervals([
        { start: '10', end: '20' },
        { begin: 30, end: 35 },
        { start: 50 }, // point feature
      ])
    ).toEqual([
      { start: 10, end: 20 },
      { start: 30, end: 35 },
      { start: 50, end: 50 },
    ]);
  });

  it('reads variants from variation-shaped data', () => {
    expect(
      collectIntervals({
        sequence: 'MKLV',
        variants: [{ start: 2, end: 2 }],
      })
    ).toEqual([{ start: 2, end: 2 }]);
  });

  it('skips malformed features', () => {
    expect(collectIntervals([{ start: 'abc' }, { start: 0 }, {}])).toEqual([]);
  });
});

describe('mergeIntervals', () => {
  it('merges overlapping and adjacent intervals', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 15, end: 25 },
        { start: 26, end: 30 }, // adjacent
        { start: 40, end: 45 },
      ])
    ).toEqual([
      { start: 10, end: 30 },
      { start: 40, end: 45 },
    ]);
  });
});

describe('buildHighlight', () => {
  it('builds the nightingale highlight string across tracks', () => {
    const { highlight, truncated } = buildHighlight([
      [{ start: 1, end: 5 }],
      [
        { start: 4, end: 9 },
        { start: 20, end: 22 },
      ],
    ]);
    expect(highlight).toBe('1:9,20:22');
    expect(truncated).toBe(false);
  });

  it('returns an empty string for no selection (clears the highlight)', () => {
    expect(buildHighlight([]).highlight).toBe('');
  });

  it('caps the number of intervals', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      start: i * 10 + 1,
      end: i * 10 + 3,
    }));
    const { highlight, truncated } = buildHighlight([many], 500);
    expect(truncated).toBe(true);
    expect(highlight.split(',')).toHaveLength(500);
  });
});
