/**
 * Parsing and mapping for the "go to" navigation box: jump straight to a
 * residue range (188-198), a single residue with optional amino-acid
 * validation (185S / S185), or a genomic coordinate mapped onto the protein
 * (g:21:25897620) via the Proteins API coordinates payload.
 */

export type GoToTarget =
  | { kind: 'range'; start: number; end: number }
  | { kind: 'residue'; position: number; aa?: string }
  | {
      kind: 'genomic';
      chromosome?: string;
      position: number;
      endPosition?: number;
    };

// ':' is NOT a protein-range separator: '2:178527015' must parse as
// chromosome 2, not as a residue range
const RANGE_RE = /^([\d,]+)\s*[-–]\s*([\d,]+)$/;
const RESIDUE_RE = /^(?:([A-Za-z])\s*)?(\d+)\s*([A-Za-z])?$/;
// Explicit prefix form: g:..., with optional chromosome and optional range
const GENOMIC_PREFIX_RE =
  /^g(?:enome)?\s*:\s*(?:(?:chr)?([\w.]+)\s*:\s*)?([\d,]+)(?:\s*[-–]\s*([\d,]+))?$/i;
// Bare form as shown on UniProt entry pages: 2:178,527,015 - 178,804,642
const GENOMIC_BARE_RE =
  /^(?:chr)?(\d{1,2}|[XY]|MT)\s*:\s*([\d,]+)(?:\s*[-–]\s*([\d,]+))?$/i;

const toPosition = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value.replace(/,/g, ''));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

export const parseGoTo = (raw: string): GoToTarget | null => {
  const query = raw.trim();
  if (!query) return null;

  const genomic =
    query.match(GENOMIC_PREFIX_RE) ?? query.match(GENOMIC_BARE_RE);
  if (genomic) {
    const position = toPosition(genomic[2]);
    if (position === undefined) return null;
    const endPosition = toPosition(genomic[3]);
    return { kind: 'genomic', chromosome: genomic[1], position, endPosition };
  }

  const range = query.match(RANGE_RE);
  if (range) {
    let start = toPosition(range[1]) ?? 0;
    let end = toPosition(range[2]) ?? 0;
    if (start < 1 || end < 1) return null;
    if (end < start) [start, end] = [end, start];
    return { kind: 'range', start, end };
  }

  const residue = query.match(RESIDUE_RE);
  if (residue) {
    // Letter allowed on either side, not both (185S or S185)
    if (residue[1] && residue[3]) return null;
    const position = Number(residue[2]);
    if (position < 1) return null;
    const aa = (residue[1] || residue[3])?.toUpperCase();
    return { kind: 'residue', position, aa };
  }

  return null;
};

/** Subset of the Proteins API coordinates payload that the mapping needs */
export type GenomicExon = {
  proteinLocation?: {
    begin?: { position?: number };
    end?: { position?: number };
  };
  genomeLocation?: {
    begin?: { position?: number };
    end?: { position?: number };
  };
};

export type GnCoordinate = {
  genomicLocation?: {
    chromosome?: string;
    reverseStrand?: boolean;
    exon?: GenomicExon[];
  };
};

/**
 * Map a genomic position to a protein residue using the exon structure of
 * one gene mapping. Codon-level: positions inside a codon collapse to the
 * same residue; codons split across an exon junction resolve to the exon
 * that contains the queried base. Returns undefined when the position falls
 * outside every exon (intron or out of gene).
 */
export const genomeToProtein = (
  coordinate: GnCoordinate,
  genomicPosition: number
): number | undefined => {
  const location = coordinate.genomicLocation;
  if (!location?.exon) return undefined;
  const reverse = Boolean(location.reverseStrand);
  for (const exon of location.exon) {
    const gBegin = exon.genomeLocation?.begin?.position;
    const gEnd = exon.genomeLocation?.end?.position;
    const pBegin = exon.proteinLocation?.begin?.position;
    const pEnd = exon.proteinLocation?.end?.position;
    if (
      gBegin === undefined ||
      gEnd === undefined ||
      pBegin === undefined ||
      pEnd === undefined
    ) {
      continue;
    }
    const lo = Math.min(gBegin, gEnd);
    const hi = Math.max(gBegin, gEnd);
    if (genomicPosition < lo || genomicPosition > hi) continue;
    // On the reverse strand `begin` is the numerically larger coordinate
    // and translation runs downwards
    const offsetNt = reverse
      ? gBegin - genomicPosition
      : genomicPosition - gBegin;
    const residue = pBegin + Math.floor(offsetNt / 3);
    return Math.min(Math.max(residue, pBegin), pEnd);
  }
  return undefined;
};

/** Pick the gene mapping matching the requested chromosome, if any */
export const selectCoordinate = (
  coordinates: GnCoordinate[] | undefined,
  chromosome?: string
): GnCoordinate | undefined => {
  if (!coordinates?.length) return undefined;
  if (!chromosome) return coordinates[0];
  const wanted = chromosome.replace(/^chr/i, '').toLowerCase();
  return (
    coordinates.find(
      (c) =>
        c.genomicLocation?.chromosome?.replace(/^chr/i, '').toLowerCase() ===
        wanted
    ) ?? coordinates[0]
  );
};

/**
 * Clamp a requested display window to the sequence and enforce a minimum
 * span. Zooming to a single residue (or a tiny range) renders a stretched,
 * near-empty view where the highlight fills the whole viewport; keeping at
 * least ~20 visible residues preserves context around the target.
 */
export const clampWindow = (
  start: number,
  end: number,
  length: number,
  minSpan = 21
): { start: number; end: number } => {
  let s = Math.max(1, Math.min(Math.min(start, end), length));
  let e = Math.min(length, Math.max(s, Math.max(start, end)));
  const span = e - s + 1;
  if (span < minSpan) {
    const pad = Math.ceil((minSpan - span) / 2);
    s -= pad;
    e += pad;
    if (s < 1) {
      e += 1 - s;
      s = 1;
    }
    if (e > length) {
      s = Math.max(1, s - (e - length));
      e = length;
    }
  }
  return { start: s, end: e };
};

/**
 * Like genomeToProtein but snaps positions that fall outside every coding
 * exon (UTRs, introns, gene-level boundaries as shown on UniProt entry
 * pages) to the nearest exon edge, as long as they are within ~10kb of the
 * gene. Returns the residue and whether the mapping was exact.
 */
export const genomeToProteinNearest = (
  coordinate: GnCoordinate,
  genomicPosition: number
): { residue: number; exact: boolean } | undefined => {
  const exact = genomeToProtein(coordinate, genomicPosition);
  if (exact !== undefined) return { residue: exact, exact: true };
  const location = coordinate.genomicLocation;
  if (!location?.exon) return undefined;
  const reverse = Boolean(location.reverseStrand);
  let best: { residue: number; distance: number } | undefined;
  for (const exon of location.exon) {
    const gBegin = exon.genomeLocation?.begin?.position;
    const gEnd = exon.genomeLocation?.end?.position;
    const pBegin = exon.proteinLocation?.begin?.position;
    const pEnd = exon.proteinLocation?.end?.position;
    if (
      gBegin === undefined ||
      gEnd === undefined ||
      pBegin === undefined ||
      pEnd === undefined
    ) {
      continue;
    }
    const lo = Math.min(gBegin, gEnd);
    const hi = Math.max(gBegin, gEnd);
    // Which protein position sits at each genomic edge depends on strand
    const loResidue = reverse ? pEnd : pBegin;
    const hiResidue = reverse ? pBegin : pEnd;
    const candidates: [number, number][] =
      genomicPosition < lo
        ? [[lo - genomicPosition, loResidue]]
        : [[genomicPosition - hi, hiResidue]];
    for (const [distance, residue] of candidates) {
      if (!best || distance < best.distance) best = { residue, distance };
    }
  }
  const MAX_SNAP_DISTANCE = 10_000;
  if (!best || best.distance > MAX_SNAP_DISTANCE) return undefined;
  return { residue: best.residue, exact: false };
};
