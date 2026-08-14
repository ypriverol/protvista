import { describe, expect, it } from 'vitest';
import {
  alignSequences,
  conservationRuns,
  projectToReference,
  MAX_ALIGNMENT_CELLS,
} from '../utils/alignment';

describe('alignSequences', () => {
  it('maps identical sequences one-to-one', () => {
    const result = alignSequences('MKLVWA', 'MKLVWA');
    expect(result.identity).toBe(1);
    for (let i = 1; i <= 6; i++) expect(result.mapping[i]).toBe(i);
    expect(result.status.slice(1)).toEqual(new Array(6).fill('identical'));
  });

  it('handles an internal deletion in the ortholog', () => {
    //  ref: MKLVWA      ortho: MKWA  (LV deleted)
    const result = alignSequences('MKLVWA', 'MKWA');
    expect(result.mapping[1]).toBe(1);
    expect(result.mapping[2]).toBe(2);
    expect(result.status[3]).toBe('gap'); // L unaligned
    expect(result.status[4]).toBe('gap'); // V unaligned
    expect(result.mapping[5]).toBe(3); // W
    expect(result.mapping[6]).toBe(4); // A
  });

  it('classifies similar and different residues', () => {
    // I vs L: same group (ILMV) -> similar; I vs D -> different
    const result = alignSequences('MI', 'ML');
    expect(result.status[2]).toBe('similar');
    const result2 = alignSequences('MI', 'MD');
    expect(result2.status[2]).toBe('different');
  });

  it('computes identity over aligned positions only', () => {
    const result = alignSequences('MKLV', 'MKIV'); // L/I similar
    expect(result.identity).toBeCloseTo(3 / 4);
  });

  it('refuses browser-hostile sizes honestly', () => {
    const big = 'M'.repeat(Math.ceil(Math.sqrt(MAX_ALIGNMENT_CELLS)) + 10);
    expect(() => alignSequences(big, big)).toThrow(/too long/);
  });
});

describe('conservationRuns', () => {
  it('compresses statuses into contiguous runs', () => {
    const { status } = alignSequences('MKLVWA', 'MKLVCA'); // W->C different
    expect(conservationRuns(status)).toEqual([
      { start: 1, end: 4, status: 'identical' },
      { start: 5, end: 5, status: 'different' },
      { start: 6, end: 6, status: 'identical' },
    ]);
  });
});

describe('projectToReference', () => {
  it('projects ortholog ranges through the mapping', () => {
    const { mapping } = alignSequences('MKLVWA', 'MKWA');
    // ortholog W..A (3..4) correspond to reference 5..6
    expect(projectToReference(mapping, 3, 4)).toEqual({ start: 5, end: 6 });
    // ortholog M..K (1..2) -> reference 1..2
    expect(projectToReference(mapping, 1, 2)).toEqual({ start: 1, end: 2 });
  });

  it('returns undefined for regions absent from the reference', () => {
    const { mapping } = alignSequences('MK', 'MKLVWA');
    expect(projectToReference(mapping, 3, 6)).toBe(undefined);
  });
});
