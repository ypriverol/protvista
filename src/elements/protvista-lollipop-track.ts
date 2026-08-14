/**
 * Lollipop (needle) track for sparse per-residue events: RNA-editing
 * sites, curated PTMs, or any data where a handful of positions carry
 * counts. The cBioPortal/ProteinPaint convention: a stem at each position
 * whose height encodes the count, with a minimum stem width so events stay
 * visible at ANY zoom level - unlike per-residue letter grids or line
 * graphs, which collapse to invisible dots at full-protein zoom.
 * See docs/design/scalable-dense-tracks.md.
 */
import { select } from 'd3';
import NightingaleElement, {
  withDimensions,
  withPosition,
  withMargin,
  withResizable,
  withHighlight,
  withManager,
  withZoom,
} from '@nightingale-elements/nightingale-new-core';
import { customElement } from 'lit/decorators.js';

export type LollipopDatum = {
  position: number;
  count: number;
  color?: string;
  type?: string;
  tooltipContent?: string;
  /** start/end aliases so wrapper features (tooltip, 3D mirror) interop */
  start?: number;
  end?: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_COLOR = '#00639a';
const HIGHLIGHT_COLOR = '#ffe999';

@customElement('protvista-lollipop-track')
class ProtvistaLollipopTrack extends withManager(
  withZoom(
    withResizable(
      withMargin(
        withPosition(withDimensions(withHighlight(NightingaleElement)))
      )
    )
  )
) {
  #data: LollipopDatum[] = [];
  #maxCount = 1;
  #svg?: SVGSVGElement;

  set data(input: LollipopDatum[] | undefined) {
    this.#data = (input ?? []).filter(
      (d) => Number.isFinite(d.position) && d.position >= 1
    );
    this.#maxCount = Math.max(1, ...this.#data.map((d) => d.count || 1));
    this.refresh();
  }

  get data(): LollipopDatum[] {
    return this.#data;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.#svg) {
      this.#svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      this.#svg.style.display = 'block';
      this.appendChild(this.#svg);
    }
    // Hand the svg selection to withZoom: its setter attaches the zoom
    // behaviour and creates xScale - without this the scale never
    // initialises and nothing can be drawn (the same wiring
    // nightingale-linegraph-track does in createTrack)
    this.svg = select(this).selectAll<SVGSVGElement, unknown>('svg');
    this.refresh();
  }

  zoomRefreshed() {
    this.refresh();
  }

  refresh() {
    const svg = this.#svg;
    // xScale only exists once the manager/zoom initialisation has run
    if (!svg || !this.xScale) return;
    const width = this.width;
    const height = this.height;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Highlight underlay
    for (const segment of this.highlightedRegion?.segments ?? []) {
      const x = this.getXFromSeqPosition(segment.start);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', '0');
      rect.setAttribute(
        'width',
        String(Math.max(0, this.getXFromSeqPosition(segment.end + 1) - x))
      );
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', HIGHLIGHT_COLOR);
      rect.setAttribute('opacity', '0.6');
      svg.appendChild(rect);
    }

    if (this.#data.length === 0) return;
    const baseline = height - 4;
    const usable = baseline - 10;
    const baseWidth = this.getSingleBaseWidth();
    const stemWidth = Math.max(2, Math.min(4, baseWidth * 0.4));
    const headRadius = Math.max(2.5, Math.min(5, baseWidth));

    // Baseline axis
    const axis = document.createElementNS(SVG_NS, 'line');
    axis.setAttribute('x1', '0');
    axis.setAttribute('x2', String(width));
    axis.setAttribute('y1', String(baseline));
    axis.setAttribute('y2', String(baseline));
    axis.setAttribute('stroke', '#d2dce3');
    svg.appendChild(axis);

    for (const datum of this.#data) {
      const x = this.getXFromSeqPosition(datum.position) + baseWidth / 2;
      if (x < -10 || x > width + 10) continue;
      const stemHeight = Math.max(
        5,
        ((datum.count || 1) / this.#maxCount) * usable
      );
      const color = datum.color || DEFAULT_COLOR;
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'feature');
      group.style.cursor = 'pointer';

      const stem = document.createElementNS(SVG_NS, 'line');
      stem.setAttribute('x1', String(x));
      stem.setAttribute('x2', String(x));
      stem.setAttribute('y1', String(baseline));
      stem.setAttribute('y2', String(baseline - stemHeight));
      stem.setAttribute('stroke', color);
      stem.setAttribute('stroke-width', String(stemWidth));
      group.appendChild(stem);

      const head = document.createElementNS(SVG_NS, 'circle');
      head.setAttribute('cx', String(x));
      head.setAttribute('cy', String(baseline - stemHeight));
      head.setAttribute('r', String(headRadius));
      head.setAttribute('fill', color);
      group.appendChild(head);

      group.addEventListener('click', (e) =>
        this.#dispatch('click', datum, e as MouseEvent)
      );
      group.addEventListener('mouseenter', (e) =>
        this.#dispatch('mouseover', datum, e as MouseEvent)
      );
      group.addEventListener('mouseleave', (e) =>
        this.#dispatch('mouseout', datum, e as MouseEvent)
      );
      svg.appendChild(group);
    }
  }

  #dispatch(
    eventType: 'click' | 'mouseover' | 'mouseout',
    datum: LollipopDatum,
    event: MouseEvent
  ) {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: {
          eventType,
          feature: {
            ...datum,
            start: datum.position,
            end: datum.position,
          },
          coords: [event.pageX, event.pageY],
          ...(eventType === 'click'
            ? { highlight: `${datum.position}:${datum.position}` }
            : {}),
        },
        bubbles: true,
        cancelable: true,
      })
    );
  }
}

export default ProtvistaLollipopTrack;
