import { describe, expect, it } from 'vitest';
import coverageAdapter from '../proteomics-coverage-adapter';

const data = {
  sequence: 'MKLVWXYZAB', // length 10
  features: [
    { begin: '1', end: '5', unique: true },
    { begin: '3', end: '7', unique: false },
    { begin: '10', end: '10', unique: true },
  ],
};

describe('proteomics-coverage-adapter', () => {
  it('computes per-residue depth for all and unique peptides', () => {
    const result = coverageAdapter(data)!;
    expect(result.map((s) => s.name)).toEqual([
      'all peptides',
      'unique peptides',
    ]);
    const all = result[0].values;
    const unique = result[1].values;
    // positions:      0  1  2  3  4  5  6  7  8  9  10
    expect(all.map((v) => v.value)).toEqual([0, 1, 1, 2, 2, 2, 1, 1, 0, 0, 1]);
    expect(unique.map((v) => v.value)).toEqual([
      0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1,
    ]);
    expect(result[0].range).toEqual([0, 2]);
  });

  it('counts a single-residue peptide on the last position', () => {
    const result = coverageAdapter(data)!;
    expect(result[0].values[10]).toEqual({ position: 10, value: 1 });
  });

  it('clamps out-of-range peptides instead of dropping the run', () => {
    const result = coverageAdapter({
      sequence: 'MKLV',
      features: [{ begin: '0', end: '99', unique: true }],
    })!;
    expect(result[0].values.map((v) => v.value)).toEqual([0, 1, 1, 1, 1]);
  });

  it('returns undefined without sequence or features', () => {
    expect(coverageAdapter({ features: [] })).toBe(undefined);
    expect(coverageAdapter({ sequence: 'MK' })).toBe(undefined);
  });
});
