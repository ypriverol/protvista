import { describe, expect, it } from 'vitest';
import {
  parseAlphaFoldPdb,
  computeSpatialNeighbours,
  collectDossierFeatures,
  buildResidueDossier,
  dossierToText,
  plddtBucket,
} from '../utils/residue-dossier';

// Minimal AlphaFold-style PDB: CA atoms on a line (1 Å apart on x), with
// residue 10 bent back next to residue 1 (spatially close, sequence-far)
const pdb = (rows: [number, number, number, number, number][]) =>
  rows
    .map(
      ([res, x, y, z, plddt]) =>
        `ATOM  ${String(res).padStart(5)}  CA  ALA A${String(res).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00${plddt.toFixed(2).padStart(6)}           C`
    )
    .join('\n');

const structure = pdb([
  [1, 0, 0, 0, 95],
  [2, 4, 0, 0, 92],
  [3, 8, 0, 0, 90],
  [4, 12, 0, 0, 88],
  [40, 2, 1, 0, 85], // sequence-distant, spatially adjacent to residue 1
  [41, 6, 1, 0, 60],
  [100, 200, 200, 200, 30], // far away, low confidence
]);

describe('parseAlphaFoldPdb', () => {
  it('extracts CA coordinates and pLDDT from the B-factor column', () => {
    const coords = parseAlphaFoldPdb(structure);
    expect(coords.size).toBe(7);
    expect(coords.get(1)).toEqual({ x: 0, y: 0, z: 0, plddt: 95 });
    expect(coords.get(40)?.plddt).toBe(85);
  });

  it('ignores non-CA and malformed lines', () => {
    const messy =
      'HEADER junk\nATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 90.00           N\n' +
      structure;
    expect(parseAlphaFoldPdb(messy).size).toBe(7);
  });
});

describe('computeSpatialNeighbours', () => {
  const coords = parseAlphaFoldPdb(structure);
  const features = [
    { start: 40, end: 41, type: 'ACT_SITE', category: 'SITES' },
    { start: 100, end: 100, type: 'MOD_RES', category: 'PTM' },
    { start: 1, end: 4, type: 'MOTIF', category: 'DOMAINS' }, // contains position
    { start: 1, end: 400, type: 'CHAIN', category: 'MOLECULE_PROCESSING' }, // too long
  ];

  it('sorts by true 3D distance and flags sequence-distant neighbours', () => {
    const neighbours = computeSpatialNeighbours(coords, 1, features);
    expect(neighbours.map((n) => n.feature.type)).toEqual([
      'ACT_SITE',
      'MOD_RES',
    ]);
    // residue 40 sits at (2,1,0): distance sqrt(5) ≈ 2.2 from residue 1
    expect(neighbours[0].distance).toBeCloseTo(2.2, 1);
    expect(neighbours[0].targetResidue).toBe(40);
    expect(neighbours[0].spatialOnly).toBe(true); // Δseq 39, 2.2 Å
    expect(neighbours[0].confidence).toBe('high'); // min(95, 85) = 85
    expect(neighbours[1].spatialOnly).toBe(false); // far in space too
    expect(neighbours[1].confidence).toBe('very low'); // min(95, 30)
  });

  it('returns empty without coordinates for the position', () => {
    expect(computeSpatialNeighbours(coords, 999, features)).toEqual([]);
  });
});

describe('collectDossierFeatures / buildResidueDossier', () => {
  const data = {
    'DOMAINS-domain': [
      { start: 1, end: 4, type: 'DOMAIN', description: 'Kunitz' },
    ],
    DOMAINS: [{ start: 1, end: 4, type: 'DOMAIN' }], // aggregate: ignored
    'SITES-act_site': [{ start: 40, end: 41, type: 'ACT_SITE' }],
    'VARIATION-variation': [{ start: 1, end: 1, type: 'VARIANT' }], // excluded
    PEPTIDE_COVERAGE: [
      {
        name: 'all peptides',
        values: [
          { position: 0, value: 0 },
          { position: 1, value: 7 },
        ],
      },
      {
        name: 'unique peptides',
        values: [
          { position: 0, value: 0 },
          { position: 1, value: 2 },
        ],
      },
    ],
  };

  it('collects track-level positional features only', () => {
    const features = collectDossierFeatures(data);
    expect(features.map((f) => f.type).sort()).toEqual(['ACT_SITE', 'DOMAIN']);
  });

  it('builds the full dossier', () => {
    const coords = parseAlphaFoldPdb(structure);
    const dossier = buildResidueDossier({
      position: 1,
      sequence: 'MKLV',
      data,
      variants: [
        { start: 1, wildType: 'M', alternativeSequence: 'T' },
        { start: 2, wildType: 'K', alternativeSequence: 'R' },
      ],
      coords,
    });
    expect(dossier.aminoAcid).toBe('M');
    expect(dossier.plddt).toBe(95);
    expect(dossier.containing.map((f) => f.type)).toEqual(['DOMAIN']);
    expect(dossier.neighbours[0].feature.type).toBe('ACT_SITE');
    expect(dossier.variants).toEqual([
      { change: 'M1T', description: undefined },
    ]);
    expect(dossier.coverage).toEqual({ all: 7, unique: 2 });
    expect(dossier.spatialUnavailable).toBe(false);

    const text = dossierToText('P00001', dossier);
    expect(text).toContain('Residue M1 - P00001');
    expect(text).toContain('ACT_SITE');
    expect(text).toContain('MS peptide coverage: 7 peptides (2 unique)');
  });

  it('degrades gracefully without coordinates', () => {
    const dossier = buildResidueDossier({ position: 1, data, variants: [] });
    expect(dossier.spatialUnavailable).toBe(true);
    expect(dossier.neighbours).toEqual([]);
    expect(dossierToText('X', dossier)).toContain(
      'Spatial context unavailable'
    );
  });
});

describe('plddtBucket', () => {
  it('maps AlphaFold confidence bands', () => {
    expect(plddtBucket(95)).toBe('very high');
    expect(plddtBucket(75)).toBe('high');
    expect(plddtBucket(55)).toBe('low');
    expect(plddtBucket(30)).toBe('very low');
  });
});
