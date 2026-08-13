/**
 * Parsing and mapping for the "go to" navigation box: jump straight to a
 * residue range (188-198), a single residue with optional amino-acid
 * validation (185S / S185), or a genomic coordinate mapped onto the protein
 * (g:21:25897620) via the Proteins API coordinates payload.
 */

export type GoToTarget =
  | { kind: 'range'; start: number; end: number }
  | { kind: 'residue'; position: number; aa?: string }
  | { kind: 'genomic'; chromosome?: string; position: number };

const RANGE_RE = /^(\d+)\s*[-–:]\s*(\d+)$/;
const RESIDUE_RE = /^(?:([A-Za-z])\s*)?(\d+)\s*([A-Za-z])?$/;
const GENOMIC_RE = /^g(?:enome)?\s*:\s*(?:(?:chr)?([\w.]+)\s*:\s*)?([\d,]+)$/i;

export const parseGoTo = (raw: string): GoToTarget | null => {
  const query = raw.trim();
  if (!query) return null;

  const genomic = query.match(GENOMIC_RE);
  if (genomic) {
    const position = Number(genomic[2].replace(/,/g, ''));
    if (!Number.isInteger(position) || position < 1) return null;
    return { kind: 'genomic', chromosome: genomic[1], position };
  }

  const range = query.match(RANGE_RE);
  if (range) {
    let start = Number(range[1]);
    let end = Number(range[2]);
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
