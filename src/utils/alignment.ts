/**
 * Client-side pairwise protein alignment (Needleman-Wunsch, linear gap
 * penalty) for the ortholog comparison feature. Produces a per-residue
 * position mapping between the two sequences plus a conservation status
 * for every reference residue - enough to answer "is this site conserved
 * in the ortholog?" without any server round-trip.
 *
 * Deliberately simple scoring (identity / similarity groups) rather than
 * a full BLOSUM matrix: orthologs are close enough that group-level
 * similarity is what a biologist reads off the track.
 */

const SIMILARITY_GROUPS = [
  'ILMV',
  'FWY',
  'KRH',
  'DE',
  'NQ',
  'ST',
  'AG',
] as const;

const groupOf = (aa: string): number => {
  for (let g = 0; g < SIMILARITY_GROUPS.length; g += 1) {
    if (SIMILARITY_GROUPS[g].includes(aa)) return g;
  }
  return -1;
};

const MATCH = 3;
const SIMILAR = 1;
const MISMATCH = -1;
const GAP = -4;

/** Refuse quadratic blow-ups (e.g. TITIN vs anything) honestly */
export const MAX_ALIGNMENT_CELLS = 25_000_000;

export type ConservationStatus = 'identical' | 'similar' | 'different' | 'gap';

export type PairwiseAlignment = {
  /** 1-based ref position -> 1-based ortholog position (0 = gap) */
  mapping: Int32Array;
  /** per 1-based ref position (index 0 unused) */
  status: ConservationStatus[];
  identity: number; // fraction of aligned reference residues identical
  alignedLength: number;
};

export const alignSequences = (
  reference: string,
  ortholog: string
): PairwiseAlignment => {
  const n = reference.length;
  const m = ortholog.length;
  if (n === 0 || m === 0) throw new Error('Empty sequence');
  if ((n + 1) * (m + 1) > MAX_ALIGNMENT_CELLS) {
    throw new Error(
      `Sequences too long to align in the browser (${n} x ${m} residues)`
    );
  }
  const width = m + 1;
  const score = new Float32Array((n + 1) * width);
  // 0 = diagonal, 1 = up (gap in ortholog), 2 = left (gap in reference)
  const trace = new Uint8Array((n + 1) * width);
  for (let j = 1; j <= m; j += 1) {
    score[j] = j * GAP;
    trace[j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    score[i * width] = i * GAP;
    trace[i * width] = 1;
    const a = reference[i - 1];
    const groupA = groupOf(a);
    for (let j = 1; j <= m; j += 1) {
      const b = ortholog[j - 1];
      const substitution =
        a === b
          ? MATCH
          : groupA !== -1 && groupA === groupOf(b)
            ? SIMILAR
            : MISMATCH;
      const diagonal = score[(i - 1) * width + (j - 1)] + substitution;
      const up = score[(i - 1) * width + j] + GAP;
      const left = score[i * width + (j - 1)] + GAP;
      let best = diagonal;
      let direction = 0;
      if (up > best) {
        best = up;
        direction = 1;
      }
      if (left > best) {
        best = left;
        direction = 2;
      }
      score[i * width + j] = best;
      trace[i * width + j] = direction;
    }
  }

  const mapping = new Int32Array(n + 1);
  const status: ConservationStatus[] = new Array(n + 1).fill('gap');
  let identical = 0;
  let alignedLength = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const direction = trace[i * width + j];
    if (i > 0 && j > 0 && direction === 0) {
      mapping[i] = j;
      const a = reference[i - 1];
      const b = ortholog[j - 1];
      if (a === b) {
        status[i] = 'identical';
        identical += 1;
      } else if (groupOf(a) !== -1 && groupOf(a) === groupOf(b)) {
        status[i] = 'similar';
      } else {
        status[i] = 'different';
      }
      alignedLength += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && (direction === 1 || j === 0)) {
      status[i] = 'gap';
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return {
    mapping,
    status,
    identity: alignedLength ? identical / alignedLength : 0,
    alignedLength,
  };
};

export type ConservationRun = {
  start: number;
  end: number;
  status: ConservationStatus;
};

/** Compress per-residue statuses into contiguous runs for cheap rendering */
export const conservationRuns = (
  status: ConservationStatus[]
): ConservationRun[] => {
  const runs: ConservationRun[] = [];
  for (let position = 1; position < status.length; position += 1) {
    const current = status[position];
    const last = runs[runs.length - 1];
    if (last && last.status === current && last.end === position - 1) {
      last.end = position;
    } else {
      runs.push({ start: position, end: position, status: current });
    }
  }
  return runs;
};

/**
 * Project an ortholog feature onto reference coordinates through the
 * alignment. Returns undefined when neither endpoint maps (deleted
 * region in the reference).
 */
export const projectToReference = (
  mapping: Int32Array,
  orthologStart: number,
  orthologEnd: number
): { start: number; end: number } | undefined => {
  // Invert lazily: find reference positions mapping into the range
  let start: number | undefined;
  let end: number | undefined;
  for (let ref = 1; ref < mapping.length; ref += 1) {
    const ortho = mapping[ref];
    if (ortho >= orthologStart && ortho <= orthologEnd) {
      if (start === undefined) start = ref;
      end = ref;
    }
  }
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
};
