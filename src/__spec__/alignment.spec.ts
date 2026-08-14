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
    // Homopolymers have no unique k-mers, so the anchored fallback cannot
    // rescue them and the size refusal must surface
    const big = 'M'.repeat(Math.ceil(Math.sqrt(MAX_ALIGNMENT_CELLS)) + 10);
    expect(() => alignSequences(big, big)).toThrow(/too long/);
  });
});

describe('anchored alignment (TITIN-scale pairs)', () => {
  // Deterministic pseudo-random protein sequence (LCG, 20-aa alphabet)
  const ALPHABET = 'ACDEFGHIKLMNPQRSTVWY';
  // mulberry32: a power-of-two-modulus LCG's low bits are periodic and
  // produce repetitive "protein" sequences; this mixes properly
  const randomSequence = (length: number, seed: number): string => {
    let state = seed >>> 0;
    let out = '';
    for (let k = 0; k < length; k += 1) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      out += ALPHABET[Math.floor(value * ALPHABET.length)];
    }
    return out;
  };

  // 6000 x ~5990 = ~36M cells: over MAX_ALIGNMENT_CELLS, so this MUST go
  // through the anchored path (the plain path would throw)
  const reference = randomSequence(6000, 42);
  // Ortholog: substitution at reference position 3000 (1-based) and
  // deletion of reference positions 5001-5010
  const substituted = reference[2999] === 'P' ? 'D' : 'P';
  const ortholog =
    reference.slice(0, 2999) +
    substituted +
    reference.slice(3000, 5000) +
    reference.slice(5010);

  it('aligns a pair over the DP cap and recovers the exact mapping', () => {
    // Sanity: this pair is genuinely over the full-DP budget
    expect((reference.length + 1) * (ortholog.length + 1)).toBeGreaterThan(
      MAX_ALIGNMENT_CELLS
    );
    const result = alignSequences(reference, ortholog);
    // Before any edit: one-to-one
    expect(result.mapping[100]).toBe(100);
    expect(result.status[100]).toBe('identical');
    // The substitution is localised and classified
    expect(result.mapping[3000]).toBe(3000);
    expect(['different', 'similar']).toContain(result.status[3000]);
    expect(result.status[2999]).toBe('identical');
    expect(result.status[3001]).toBe('identical');
    // The deletion: 5001-5010 unaligned, everything after shifted by -10
    for (let p = 5001; p <= 5010; p += 1) {
      expect(result.status[p]).toBe('gap');
      expect(result.mapping[p]).toBe(0);
    }
    expect(result.mapping[5011]).toBe(5001);
    expect(result.mapping[5500]).toBe(5490);
    expect(result.mapping[6000]).toBe(5990);
    expect(result.identity).toBeGreaterThan(0.99);
    expect(result.alignedLength).toBe(5990);
  });

  it('still refuses long UNRELATED sequences', () => {
    const unrelated = randomSequence(6000, 777);
    expect(() => alignSequences(reference, unrelated)).toThrow(
      /not similar enough/
    );
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
