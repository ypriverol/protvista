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

describe('buildStructureLegend', () => {
  const categories = [
    {
      name: 'DOMAINS',
      label: 'Domains',
      color: '#123456',
      tracks: [
        { name: 'domain', label: 'Domain', color: '#654321' },
        { name: 'repeat', label: 'Repeat' },
      ],
    },
  ];

  it('uses track label and colour, falling back to category colour', async () => {
    const { buildStructureLegend } =
      await import('../utils/structure-highlight');
    const data = {
      'DOMAINS-domain': [
        { start: 1, end: 5 },
        { start: 20, end: 30 },
      ],
      'DOMAINS-repeat': [{ start: 40, end: 45 }],
    };
    const legend = buildStructureLegend(
      categories,
      ['DOMAINS-domain', 'DOMAINS-repeat'],
      data
    );
    expect(legend).toEqual([
      {
        key: 'DOMAINS-domain',
        label: 'Domain',
        color: '#654321',
        count: 2,
        intervals: [
          { start: 1, end: 5 },
          { start: 20, end: 30 },
        ],
      },
      {
        key: 'DOMAINS-repeat',
        label: 'Repeat',
        color: '#123456',
        count: 1,
        intervals: [{ start: 40, end: 45 }],
      },
    ]);
  });

  it('tolerates unknown keys and missing data', async () => {
    const { buildStructureLegend } =
      await import('../utils/structure-highlight');
    const legend = buildStructureLegend(categories, ['X-y'], {});
    expect(legend[0]).toEqual({
      key: 'X-y',
      label: 'y',
      color: '#00639a',
      count: 0,
      intervals: [],
    });
  });
});

describe('coverage clipping helpers', () => {
  it('parses coverage strings', async () => {
    const { parseCoverage } = await import('../utils/structure-highlight');
    expect(parseCoverage('672-711')).toEqual({ start: 672, end: 711 });
    expect(parseCoverage('1-770')).toEqual({ start: 1, end: 770 });
    expect(parseCoverage(undefined)).toBe(undefined);
    expect(parseCoverage('n/a')).toBe(undefined);
  });

  it('clips highlight intervals to a fragment and measures overlap', async () => {
    const { parseHighlightString, clipIntervalsToRange, overlapLength } =
      await import('../utils/structure-highlight');
    const intervals = parseHighlightString('28:189,291:341,374:565');
    const fragment = { start: 672, end: 711 };
    // The APP fibril case: domains have zero overlap with the fragment
    expect(clipIntervalsToRange(intervals, fragment)).toEqual([]);
    expect(overlapLength(intervals, fragment)).toBe(0);
    const full = { start: 1, end: 770 };
    expect(overlapLength(intervals, full)).toBe(162 + 51 + 192);
    expect(clipIntervalsToRange(intervals, { start: 100, end: 300 })).toEqual([
      { start: 100, end: 189 },
      { start: 291, end: 300 },
    ]);
  });
});
