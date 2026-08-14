import { describe, expect, it } from 'vitest';
import { alignSequences } from '../utils/alignment';
import { diffFeatures } from '../utils/feature-diff';

describe('diffFeatures', () => {
  //  ref:  MKLVWAGHRT (10)      ortho: MKWAGHRT (LV deleted)
  const { mapping } = alignSequences('MKLVWAGHRT', 'MKWAGHRT');

  it('classifies shared, reference-only and ortholog-only features', () => {
    const result = diffFeatures(
      [
        { start: 6, end: 6, type: 'MOD_RES', description: 'Phosphoserine' }, // ortho has it at 4
        { start: 3, end: 3, type: 'MOD_RES', description: 'Phosphothreonine' }, // in deleted region
        { start: 9, end: 9, type: 'ACT_SITE' }, // ortho lacks it
      ],
      [
        { start: 4, end: 4, type: 'MOD_RES', description: 'Phosphoserine' }, // = ref 6
        { start: 8, end: 8, type: 'CARBOHYD' }, // ortho-only, maps to ref 10
      ],
      mapping
    );
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]).toMatchObject({
      start: 6,
      type: 'MOD_RES',
      counterpartStart: 4,
    });
    expect(result.referenceOnly.map((f) => f.type).sort()).toEqual([
      'ACT_SITE',
      'MOD_RES',
    ]);
    expect(result.orthologOnly).toHaveLength(1);
    expect(result.orthologOnly[0]).toMatchObject({
      start: 10,
      type: 'CARBOHYD',
      counterpartStart: 8,
    });
  });

  it('matches large-scale PTMs against curated ones (type aliasing)', () => {
    const result = diffFeatures(
      [{ start: 6, end: 6, type: 'MOD_RES_LS' }],
      [{ start: 4, end: 4, type: 'MOD_RES' }],
      mapping
    );
    expect(result.shared).toHaveLength(1);
    expect(result.referenceOnly).toHaveLength(0);
  });

  it('tolerates small positional wobble but not distant sites', () => {
    const near = diffFeatures(
      [{ start: 7, end: 7, type: 'MOD_RES' }],
      [{ start: 4, end: 4, type: 'MOD_RES' }], // maps to ref 6: |7-6|<=2
      mapping
    );
    expect(near.shared).toHaveLength(1);
    const far = diffFeatures(
      [{ start: 10, end: 10, type: 'MOD_RES' }],
      [{ start: 1, end: 1, type: 'MOD_RES' }],
      mapping
    );
    expect(far.shared).toHaveLength(0);
  });

  it('prefers same-description counterparts over positional accidents', () => {
    // Two overlapping ortholog REGIONs; the closer one has the WRONG
    // description - the match must go to the same-description twin
    const result = diffFeatures(
      [{ start: 5, end: 8, type: 'REGION', description: 'Zinc-binding' }],
      [
        { start: 3, end: 6, type: 'REGION', description: 'Interaction' }, // maps to 5-8
        { start: 4, end: 7, type: 'REGION', description: 'Zinc-binding' }, // maps to 6-9
      ],
      mapping
    );
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0].counterpartStart).toBe(4);
    expect(result.orthologOnly).toHaveLength(1);
    expect(result.orthologOnly[0].description).toBe('Interaction');
  });

  it('excludes long features (covered by the conservation band)', () => {
    const result = diffFeatures(
      [{ start: 1, end: 100, type: 'DOMAIN' }],
      [],
      mapping
    );
    expect(result.referenceOnly).toHaveLength(0);
  });
});
