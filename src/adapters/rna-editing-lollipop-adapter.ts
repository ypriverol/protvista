/**
 * Aggregates RNA-editing events into per-position lollipop data. Sparse
 * per-residue events were previously shown as a position x amino-acid
 * matrix (nightingale-variation-canvas) - unreadable overkill for a
 * handful of sites - and a count line graph that collapses to a single
 * dot. See docs/design/scalable-dense-tracks.md.
 */
import { RnaEditing } from './types/rna-editing';
import { LollipopDatum } from '../elements/protvista-lollipop-track';
import { escapeHtml } from '../utils/security';

// Franklin-adjacent palette per consequence
const CONSEQUENCE_COLORS: Record<string, string> = {
  missense: '#014371', // sapphire-blue
  synonymous: '#8194a1', // weldon-blue
  stopgain: '#a65708', // bronze
};

const transformData = (data: RnaEditing): LollipopDatum[] | undefined => {
  if (!data?.features?.length) return undefined;

  const byPosition = new Map<
    number,
    { count: number; consequences: Map<string, number> }
  >();
  for (const feature of data.features) {
    const position = Math.trunc(
      Number(feature.locationType?.position?.position)
    );
    if (!Number.isFinite(position) || position < 1) continue;
    const consequence = (
      feature.variantType?.consequenceType || 'unknown'
    ).toLowerCase();
    const entry = byPosition.get(position) ?? {
      count: 0,
      consequences: new Map<string, number>(),
    };
    entry.count += 1;
    entry.consequences.set(
      consequence,
      (entry.consequences.get(consequence) ?? 0) + 1
    );
    byPosition.set(position, entry);
  }

  if (byPosition.size === 0) return undefined;

  return [...byPosition.entries()]
    .sort(([a], [b]) => a - b)
    .map(([position, { count, consequences }]) => {
      // Dominant consequence decides the colour
      const dominant = [...consequences.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0][0];
      const breakdown = [...consequences.entries()]
        .map(
          ([name, n]) =>
            `<li>${escapeHtml(name)}:&nbsp;${n} event${n === 1 ? '' : 's'}</li>`
        )
        .join('');
      return {
        position,
        count,
        type: 'RNA editing',
        color: CONSEQUENCE_COLORS[dominant] ?? '#00639a',
        tooltipContent: `<h5>RNA editing events</h5><ul class="no-bullet">${breakdown}</ul>`,
      };
    });
};

export default transformData;
