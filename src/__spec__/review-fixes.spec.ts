import { describe, expect, it, vi } from 'vitest';

import { formatProformaWithLink } from '../tooltips/feature-tooltip';
import variationGraphAdapter from '../adapters/variation-graph-adapter';
import rnaEditingGraphAdapter from '../adapters/rna-editing-graph-adapter';
import type { RnaEditing } from '../adapters/types/rna-editing';

describe('formatProformaWithLink (XSS hardening)', () => {
  it('escapes HTML outside brackets', () => {
    const out = formatProformaWithLink(
      'PEPT<img src=x onerror=alert(1)>IDE[Phospho]'
    );
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes HTML inside brackets when the modification is unknown', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = formatProformaWithLink('X[<script>alert(1)</script>]Y');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('still links known modifications', () => {
    const out = formatProformaWithLink('PEPS[Phospho]TIDE');
    expect(out).toContain('unimod.org');
    expect(out).toContain('>Phospho</a>');
  });
});

describe('graph adapters: last-residue counting', () => {
  it('variation-graph counts a variant on the last residue', () => {
    const sequence = 'MKLV';
    const result = variationGraphAdapter({
      sequence,
      features: [
        { begin: '4', wildType: 'V', alternativeSequence: 'A' },
      ] as never,
    } as never);
    expect(result).toBeTruthy();
    const variantSeries = result!.find((s) => s.name === 'variant')!;
    const last = variantSeries.values.find((v) => v.position === 4);
    expect(last?.value).toBe(1);
  });

  it('rna-editing-graph counts an event on the last residue', () => {
    const sequence = 'MKLV';
    const data = {
      sequence,
      features: [
        {
          locationType: { position: { position: '4' } },
          variantType: { consequenceType: 'missense' },
        },
      ],
    } as unknown as RnaEditing;
    const result = rnaEditingGraphAdapter(data);
    expect(result).toBeTruthy();
    const missense = result!.find((s) => s.name === 'missense')!;
    const last = missense.values.find((v) => v.position === 4);
    expect(last?.value).toBe(1);
  });
});
