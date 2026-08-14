/**
 * The Residue Report ("dossier"): everything the viewer knows about one
 * amino-acid position, aggregated - including real 3D distances to
 * annotated features computed from the AlphaFold model's C-alpha
 * coordinates. Distances answer the question sequence tracks cannot:
 * "what is this residue near IN THE FOLD?"
 *
 * The coordinate file is fetched as plain text from the AlphaFold file
 * host and parsed here - deliberately independent of the Mol* viewer,
 * whose instance upstream keeps private. AlphaFold stores per-residue
 * pLDDT confidence in the B-factor column.
 */

export type ResidueCoord = {
  x: number;
  y: number;
  z: number;
  plddt: number;
};

export type CoordinateMap = Map<number, ResidueCoord>;

/** Parse C-alpha ATOM records from an AlphaFold PDB file */
export const parseAlphaFoldPdb = (text: string): CoordinateMap => {
  const coords: CoordinateMap = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    // PDB fixed columns: atom name 13-16, resSeq 23-26, x/y/z 31-54,
    // B-factor (pLDDT in AlphaFold files) 61-66
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const residue = Number(line.slice(22, 26));
    if (!Number.isFinite(residue) || coords.has(residue)) continue;
    coords.set(residue, {
      x: Number(line.slice(30, 38)),
      y: Number(line.slice(38, 46)),
      z: Number(line.slice(46, 54)),
      plddt: Number(line.slice(60, 66)),
    });
  }
  return coords;
};

const distance = (a: ResidueCoord, b: ResidueCoord): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

export const plddtBucket = (plddt: number): string => {
  if (plddt >= 90) return 'very high';
  if (plddt >= 70) return 'high';
  if (plddt >= 50) return 'low';
  return 'very low';
};

export type DossierFeature = {
  start: number;
  end: number;
  type: string;
  description?: string;
  category: string;
};

export type SpatialNeighbour = {
  feature: DossierFeature;
  /** minimum C-alpha distance from the queried residue, in Angstrom */
  distance: number;
  /** the residue within the feature closest in space */
  targetResidue: number;
  /** sequence separation between queried residue and targetResidue */
  sequenceDelta: number;
  /** true when far in sequence but close in the fold - the insight */
  spatialOnly: boolean;
  confidence: string;
};

/**
 * Annotation types that describe observations rather than function
 * (immune epitopes, sequence conflicts...). They stay in the report but
 * are capped so they cannot drown out sites, PTMs and binding residues.
 */
export const LOW_SIGNAL_TYPES = new Set([
  'EPITOPE',
  'ANTIGEN',
  'CONFLICT',
  'VAR_SEQ',
  'NON_CONS',
  'NON_TER',
  'UNSURE',
]);
export const LOW_SIGNAL_MAX = 2;

const isLowSignal = (type: string) => LOW_SIGNAL_TYPES.has(type.toUpperCase());

/** Compact the boilerplate IEDB epitope descriptions */
export const compactDescription = (
  type: string,
  description?: string
): string | undefined => {
  if (!description) return undefined;
  if (type.toUpperCase() === 'EPITOPE') {
    const match = description.match(
      /^([A-Z]{5,30}) is a linear peptidic epitope \(epitope ID (\d+)\)/
    );
    if (match) return `epitope ${match[1]} (IEDB ${match[2]})`;
  }
  return description;
};

/** Distance-ordered selection with the low-signal cap applied */
const capLowSignal = <T extends { feature: { type: string } } | DossierFeature>(
  items: T[],
  limit: number
): T[] => {
  const kept: T[] = [];
  let lowSignal = 0;
  for (const item of items) {
    const type =
      'feature' in item
        ? (item as { feature: { type: string } }).feature.type
        : (item as DossierFeature).type;
    if (isLowSignal(type)) {
      if (lowSignal >= LOW_SIGNAL_MAX) continue;
      lowSignal += 1;
    }
    kept.push(item);
    if (kept.length >= limit) break;
  }
  return kept;
};

/** Long features (chains, big domains) belong in "located in", not in
 * the spatial-neighbour list */
export const NEIGHBOUR_MAX_SPAN = 50;
export const SPATIAL_ONLY_MIN_SEQ_DELTA = 30;
export const SPATIAL_ONLY_MAX_DISTANCE = 12;

export const computeSpatialNeighbours = (
  coords: CoordinateMap,
  position: number,
  features: DossierFeature[],
  limit = 8
): SpatialNeighbour[] => {
  const origin = coords.get(position);
  if (!origin) return [];
  const neighbours: SpatialNeighbour[] = [];
  for (const feature of features) {
    if (feature.end - feature.start > NEIGHBOUR_MAX_SPAN) continue;
    if (position >= feature.start && position <= feature.end) continue;
    let best: { distance: number; residue: number } | undefined;
    for (let r = feature.start; r <= feature.end; r += 1) {
      const target = coords.get(r);
      if (!target) continue;
      const d = distance(origin, target);
      if (!best || d < best.distance) best = { distance: d, residue: r };
    }
    if (!best) continue;
    const sequenceDelta = Math.abs(best.residue - position);
    neighbours.push({
      feature,
      distance: Math.round(best.distance * 10) / 10,
      targetResidue: best.residue,
      sequenceDelta,
      spatialOnly:
        sequenceDelta >= SPATIAL_ONLY_MIN_SEQ_DELTA &&
        best.distance <= SPATIAL_ONLY_MAX_DISTANCE,
      confidence: plddtBucket(
        Math.min(origin.plddt, coords.get(best.residue)?.plddt ?? 0)
      ),
    });
  }
  return capLowSignal(
    neighbours.sort((a, b) => a.distance - b.distance),
    limit
  ) as SpatialNeighbour[];
};

/** Categories whose entries are not positional annotations */
const EXCLUDED_CATEGORIES = new Set([
  'VARIATION',
  'PROTEOMICS',
  'PEPTIDE_COVERAGE',
  'ALPHAFOLD_CONFIDENCE',
  'ALPHAMISSENSE_PATHOGENICITY',
  'STRUCTURE_COVERAGE',
]);

/** Collect deduplicated positional features from the viewer's track data */
export const collectDossierFeatures = (
  data: Record<string, unknown>
): DossierFeature[] => {
  const seen = new Set<string>();
  const features: DossierFeature[] = [];
  for (const [key, value] of Object.entries(data)) {
    const separator = key.indexOf('-');
    if (separator === -1) continue; // track-level entries only (no dupes)
    const category = key.slice(0, separator);
    if (EXCLUDED_CATEGORIES.has(category)) continue;
    if (!Array.isArray(value)) continue;
    for (const raw of value as Record<string, unknown>[]) {
      const start = Math.trunc(Number(raw?.start ?? raw?.begin));
      const end = Math.trunc(Number(raw?.end ?? start));
      const type = String(raw?.type ?? '').trim();
      if (!Number.isFinite(start) || start < 1 || !type) continue;
      const dedupe = `${type}|${start}|${end}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      features.push({
        start,
        end: Number.isFinite(end) ? Math.max(end, start) : start,
        type,
        description: compactDescription(
          type,
          typeof raw?.description === 'string' ? raw.description : undefined
        ),
        category,
      });
    }
  }
  return features;
};

export type ResidueDossier = {
  position: number;
  aminoAcid?: string;
  plddt?: number;
  containing: DossierFeature[];
  neighbours: SpatialNeighbour[];
  variants: { change: string; description?: string }[];
  coverage?: { all: number; unique: number };
  spatialUnavailable?: boolean;
};

export const buildResidueDossier = (options: {
  position: number;
  sequence?: string;
  data: Record<string, unknown>;
  variants?: {
    start?: number | string;
    begin?: number | string;
    wildType?: string;
    alternativeSequence?: string;
    description?: string;
  }[];
  coords?: CoordinateMap;
}): ResidueDossier => {
  const { position, sequence, data, variants, coords } = options;
  const features = collectDossierFeatures(data);
  const containing = capLowSignal(
    features
      .filter((f) => position >= f.start && position <= f.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start)),
    6
  ) as DossierFeature[];
  const neighbours = coords
    ? computeSpatialNeighbours(coords, position, features)
    : [];
  const variantList = (variants ?? [])
    .filter((v) => Math.trunc(Number(v.start ?? v.begin)) === position)
    .slice(0, 12)
    .map((v) => ({
      change: `${v.wildType ?? '?'}${position}${v.alternativeSequence ?? '?'}`,
      description: v.description,
    }));
  // Peptide coverage series: [{name:'all peptides',values},{name:'unique...'}]
  let coverage: ResidueDossier['coverage'];
  const coverageSeries = data['PEPTIDE_COVERAGE'] as
    | { name: string; values: { position: number; value: number }[] }[]
    | undefined;
  if (Array.isArray(coverageSeries)) {
    const all = coverageSeries[0]?.values?.[position]?.value;
    const unique = coverageSeries[1]?.values?.[position]?.value;
    if (Number.isFinite(all)) {
      coverage = { all: all as number, unique: (unique as number) ?? 0 };
    }
  }
  return {
    position,
    aminoAcid: sequence?.charAt(position - 1) || undefined,
    plddt: coords?.get(position)?.plddt,
    containing,
    neighbours,
    variants: variantList,
    coverage,
    spatialUnavailable: !coords,
  };
};

/** Plain-text rendering for the copy button */
export const dossierToText = (
  accession: string,
  dossier: ResidueDossier
): string => {
  const lines = [
    `Residue ${dossier.aminoAcid ?? ''}${dossier.position} - ${accession}` +
      (dossier.plddt !== undefined
        ? ` (AlphaFold pLDDT ${dossier.plddt}, ${plddtBucket(dossier.plddt)} confidence)`
        : ''),
  ];
  if (dossier.containing.length) {
    lines.push('Located in:');
    for (const f of dossier.containing) {
      lines.push(
        `  ${f.type}${f.description ? ` (${f.description})` : ''} ${f.start}-${f.end}`
      );
    }
  }
  if (dossier.neighbours.length) {
    lines.push('Spatially close (C-alpha distances, AlphaFold model):');
    for (const n of dossier.neighbours) {
      lines.push(
        `  ${n.distance} A  ${n.feature.type}${
          n.feature.description ? ` (${n.feature.description})` : ''
        } at ${n.targetResidue}${n.spatialOnly ? '  [distal in sequence]' : ''} [confidence: ${n.confidence}]`
      );
    }
  } else if (dossier.spatialUnavailable) {
    lines.push('Spatial context unavailable (no full-length AlphaFold model).');
  }
  if (dossier.variants.length) {
    lines.push(
      `Variants at this position: ${dossier.variants.map((v) => v.change).join(', ')}`
    );
  }
  if (dossier.coverage) {
    lines.push(
      `MS peptide coverage: ${dossier.coverage.all} peptides (${dossier.coverage.unique} unique)`
    );
  }
  return lines.join('\n');
};
