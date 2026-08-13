import { describe, expect, it } from 'vitest';
import {
  parseGoTo,
  genomeToProtein,
  selectCoordinate,
  clampWindow,
  GnCoordinate,
} from '../utils/coordinate-navigation';

describe('parseGoTo', () => {
  it('parses ranges', () => {
    expect(parseGoTo('188-198')).toEqual({
      kind: 'range',
      start: 188,
      end: 198,
    });
    expect(parseGoTo(' 188 - 198 ')).toEqual({
      kind: 'range',
      start: 188,
      end: 198,
    });
    // swapped bounds are normalised
    expect(parseGoTo('198-188')).toEqual({
      kind: 'range',
      start: 188,
      end: 198,
    });
  });

  it('parses residues with optional amino acid on either side', () => {
    expect(parseGoTo('185')).toEqual({
      kind: 'residue',
      position: 185,
      aa: undefined,
    });
    expect(parseGoTo('185S')).toEqual({
      kind: 'residue',
      position: 185,
      aa: 'S',
    });
    expect(parseGoTo('s185')).toEqual({
      kind: 'residue',
      position: 185,
      aa: 'S',
    });
    // a letter on both sides is ambiguous
    expect(parseGoTo('S185T')).toBe(null);
  });

  it('parses genomic coordinates', () => {
    expect(parseGoTo('g:21:25897620')).toEqual({
      kind: 'genomic',
      chromosome: '21',
      position: 25897620,
    });
    expect(parseGoTo('g:chr21:25,897,620')).toEqual({
      kind: 'genomic',
      chromosome: '21',
      position: 25897620,
    });
    expect(parseGoTo('g:25897620')).toEqual({
      kind: 'genomic',
      chromosome: undefined,
      position: 25897620,
    });
  });

  it('rejects garbage', () => {
    expect(parseGoTo('')).toBe(null);
    expect(parseGoTo('hello world')).toBe(null);
    expect(parseGoTo('0')).toBe(null);
  });
});

describe('genomeToProtein', () => {
  const forward: GnCoordinate = {
    genomicLocation: {
      chromosome: '1',
      reverseStrand: false,
      exon: [
        {
          proteinLocation: { begin: { position: 1 }, end: { position: 10 } },
          genomeLocation: {
            begin: { position: 1000 },
            end: { position: 1029 },
          },
        },
        {
          proteinLocation: { begin: { position: 11 }, end: { position: 20 } },
          genomeLocation: {
            begin: { position: 2000 },
            end: { position: 2029 },
          },
        },
      ],
    },
  };

  // Real exon 1 of APP (P05067) on chromosome 21, reverse strand
  const reverse: GnCoordinate = {
    genomicLocation: {
      chromosome: '21',
      reverseStrand: true,
      exon: [
        {
          proteinLocation: { begin: { position: 1 }, end: { position: 19 } },
          genomeLocation: {
            begin: { position: 26170620 },
            end: { position: 26170564 },
          },
        },
      ],
    },
  };

  it('maps forward-strand positions codon-wise', () => {
    expect(genomeToProtein(forward, 1000)).toBe(1);
    expect(genomeToProtein(forward, 1002)).toBe(1);
    expect(genomeToProtein(forward, 1003)).toBe(2);
    expect(genomeToProtein(forward, 2000)).toBe(11);
    expect(genomeToProtein(forward, 2029)).toBe(20);
  });

  it('maps reverse-strand positions downwards from begin', () => {
    expect(genomeToProtein(reverse, 26170620)).toBe(1);
    expect(genomeToProtein(reverse, 26170618)).toBe(1);
    expect(genomeToProtein(reverse, 26170617)).toBe(2);
    expect(genomeToProtein(reverse, 26170564)).toBe(19);
  });

  it('returns undefined for intronic/outside positions', () => {
    expect(genomeToProtein(forward, 1500)).toBe(undefined);
    expect(genomeToProtein(forward, 999)).toBe(undefined);
  });
});

describe('selectCoordinate', () => {
  const a: GnCoordinate = { genomicLocation: { chromosome: '21' } };
  const b: GnCoordinate = { genomicLocation: { chromosome: 'X' } };

  it('matches chromosome ignoring chr prefix and case', () => {
    expect(selectCoordinate([a, b], 'chrX')).toBe(b);
    expect(selectCoordinate([a, b], 'x')).toBe(b);
  });

  it('falls back to the first mapping', () => {
    expect(selectCoordinate([a, b])).toBe(a);
    expect(selectCoordinate([a, b], '7')).toBe(a);
  });
});

describe('clampWindow', () => {
  it('widens a single-residue window to the minimum span', () => {
    const { start, end } = clampWindow(185, 185, 770);
    expect(end - start + 1).toBeGreaterThanOrEqual(21);
    expect(start).toBeLessThanOrEqual(185);
    expect(end).toBeGreaterThanOrEqual(185);
  });

  it('keeps wide windows untouched', () => {
    expect(clampWindow(100, 300, 770)).toEqual({ start: 100, end: 300 });
  });

  it('clamps at the sequence start', () => {
    const { start, end } = clampWindow(1, 1, 770);
    expect(start).toBe(1);
    expect(end - start + 1).toBeGreaterThanOrEqual(21);
  });

  it('clamps at the sequence end', () => {
    const { start, end } = clampWindow(770, 770, 770);
    expect(end).toBe(770);
    expect(end - start + 1).toBeGreaterThanOrEqual(21);
  });

  it('handles sequences shorter than the minimum span', () => {
    expect(clampWindow(2, 2, 10)).toEqual({ start: 1, end: 10 });
  });
});
