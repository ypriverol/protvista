import { LitElement, html, svg } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { frame } from 'timing-functions';

// Nightingale
import NightingaleManager from '@nightingale-elements/nightingale-manager';
import NightingaleNavigation from '@nightingale-elements/nightingale-navigation';
import NightingaleSequence from '@nightingale-elements/nightingale-sequence';
import NightingaleColoredSequence from '@nightingale-elements/nightingale-colored-sequence';
import NightingaleTrackCanvas from '@nightingale-elements/nightingale-track-canvas';
import NightingaleInterproTrack from '@nightingale-elements/nightingale-interpro-track';
import NightingaleVariationCanvas from '@nightingale-elements/nightingale-variation-canvas';
import NightingaleLinegraphTrack from '@nightingale-elements/nightingale-linegraph-track';
import NightingaleSequenceHeatmap from '@nightingale-elements/nightingale-sequence-heatmap';
import NightingaleFilter, {
  Filter,
} from '@nightingale-elements/nightingale-filter';
import { amColorScale } from '@nightingale-elements/nightingale-structure';

// adapters
import featureAdapter from './adapters/feature-adapter';
import proteomicsAdapter from './adapters/proteomics-adapter';
import proteomicsCoverageAdapter from './adapters/proteomics-coverage-adapter';
import structureAdapter from './adapters/structure-adapter';
import variationAdapter, {
  TransformedVariant,
} from './adapters/variation-adapter';
import interproAdapter from './adapters/interpro-adapter';
import variationGraphAdapter from './adapters/variation-graph-adapter';
import rnaEditingGraphAdapter from './adapters/rna-editing-graph-adapter';
import rnaEditingAdapter from './adapters/rna-editing-adapter';
import rnaEditingLollipopAdapter from './adapters/rna-editing-lollipop-adapter';
import ProtvistaLollipopTrack from './elements/protvista-lollipop-track';
import proteomicsPTMApdapter from './adapters/ptm-exchange-adapter';
import alphaFoldConfidenceAdapter from './adapters/alphafold-confidence-adapter';
import alphaMissensePathogenicityAdapter from './adapters/alphamissense-pathogenicity-adapter';
import alphaMissenseHeatmapAdapter from './adapters/alphamissense-heatmap-adapter';

import ProtvistaUniprotStructure from './protvista-uniprot-structure';

import { fetchOne, loadComponent } from './utils';

import filterConfig, { colorConfig } from './filter-config';
import config, {
  ProtvistaConfig,
  ProtvistaTrackConfig,
  TrackType,
} from './config';
import { validateConfig, formatConfigErrors } from './config-validator';
import {
  parseGoTo,
  genomeToProteinNearest,
  selectCoordinate,
  clampWindow,
  GnCoordinate,
} from './utils/coordinate-navigation';
import { buildHighlight } from './utils/structure-highlight';

import { TransformedInterPro } from './adapters/types/interpro';
import { StructureFeature } from './adapters/structure-adapter';

/** Union of all possible per-track payload shapes stored in this.data */
type TrackPayload =
  | Record<string, unknown>[]
  | { sequence: string; variants: TransformedVariant[] }
  | ({ sequence: string; variants: TransformedVariant[] } & Record<
      string,
      unknown
    >)
  | TransformedInterPro
  | StructureFeature[]
  | { variants?: TransformedVariant[] }
  | string
  | null
  | undefined;

import loaderIcon from './icons/spinner.svg';
import protvistaStyles from './styles/protvista-styles';
import loaderStyles from './styles/loader-styles';

// Performance marks deliberately use stable, namespaced names so they
// survive component re-mount and tooling can pin to them by name.
// Renaming or moving them is a breaking change for perf measurement.
//
// Each mark fires at most once per page (subsequent component instances
// or re-loads no-op), and corresponding measures are emitted so they
// show up as named segments in Chrome DevTools and Lighthouse's
// user-timings audit.
const markOnce = (name: string) => {
  if (performance.getEntriesByName(name, 'mark').length === 0) {
    performance.mark(name);
  }
};
const measureOnce = (name: string, start: string, end: string) => {
  if (performance.getEntriesByName(name, 'measure').length === 0) {
    try {
      performance.measure(name, start, end);
    } catch {
      // Either start/end mark missing — surface marks but skip the measure
      // rather than throwing; comparing the marks directly still works.
    }
  }
};

/**
 * Typed adapter dispatch. Each case calls the real adapter with its real
 * signature so genuine mismatches become compile-time errors.
 *
 * Re-validation of the two bugs flagged in issue #133:
 *   - variation-adapter: returns `{ sequence, variants } | null` — the null
 *     case is handled downstream by the `if (!filteredData) return` guard.
 *   - proteomics-ptm-adapter (ProteomicsPtm): the adapter accepts a single
 *     ProteomicsPtm argument; trackData[0] is cast via Parameters<> which
 *     preserves the real type at the call site. No signature mismatch found.
 *
 * The `raw as Parameters<typeof adapter>` cast on each case is intentional:
 * trackData arrives as TrackPayload[] from the URL fetch and we cannot
 * statically prove its shape matches the adapter's expectation. The cast is
 * narrowed per-case (not a blanket unknown[]) so any future adapter signature
 * change will surface here.
 */
async function callAdapter(
  name: NonNullable<ProtvistaTrackConfig['data'][number]['adapter']>,
  raw: TrackPayload[]
): Promise<unknown> {
  switch (name) {
    case 'feature-adapter':
      return featureAdapter(...(raw as Parameters<typeof featureAdapter>));
    case 'interpro-adapter':
      return interproAdapter(...(raw as Parameters<typeof interproAdapter>));
    case 'proteomics-adapter':
      return proteomicsAdapter(
        ...(raw as Parameters<typeof proteomicsAdapter>)
      );
    case 'proteomics-coverage-adapter':
      return proteomicsCoverageAdapter(
        ...(raw as Parameters<typeof proteomicsCoverageAdapter>)
      );
    case 'structure-adapter':
      return structureAdapter(...(raw as Parameters<typeof structureAdapter>));
    case 'variation-adapter':
      return variationAdapter(...(raw as Parameters<typeof variationAdapter>));
    case 'variation-graph-adapter':
      return variationGraphAdapter(
        ...(raw as Parameters<typeof variationGraphAdapter>)
      );
    case 'rna-editing-adapter':
      return rnaEditingAdapter(
        ...(raw as Parameters<typeof rnaEditingAdapter>)
      );
    case 'rna-editing-lollipop-adapter':
      return rnaEditingLollipopAdapter(
        ...(raw as Parameters<typeof rnaEditingLollipopAdapter>)
      );
    case 'rna-editing-graph-adapter':
      return rnaEditingGraphAdapter(
        ...(raw as Parameters<typeof rnaEditingGraphAdapter>)
      );
    case 'proteomics-ptm-adapter':
      return proteomicsPTMApdapter(
        ...(raw as Parameters<typeof proteomicsPTMApdapter>)
      );
    case 'alphafold-confidence-adapter':
      return alphaFoldConfidenceAdapter(
        ...(raw as Parameters<typeof alphaFoldConfidenceAdapter>)
      );
    case 'alphamissense-pathogenicity-adapter':
      return alphaMissensePathogenicityAdapter(
        ...(raw as Parameters<typeof alphaMissensePathogenicityAdapter>)
      );
    case 'alphamissense-heatmap-adapter':
      return alphaMissenseHeatmapAdapter(
        ...(raw as Parameters<typeof alphaMissenseHeatmapAdapter>)
      );
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown adapter: ${_exhaustive as string}`);
    }
  }
}

/**
 * Wrapper-side performance patches for upstream Nightingale elements
 * (see the "highlight hot path" audit in PR discussion):
 *
 * withZoom.attributeChangedCallback treats ANY changed attribute - the
 * highlight included - as a zoom and calls zoomRefreshed(), which in the
 * SVG-based elements rebuilds everything: nightingale-colored-sequence
 * rewrites one <stop> per residue (34,350 x 2 attrs x 4 tracks on TITIN
 * per click) and nightingale-linegraph-track regenerates full multi-
 * megabyte path strings. Skip the rebuild when nothing that affects
 * geometry changed and refresh only the highlight overlay.
 */
type RefreshablePatchTarget = HTMLElement & {
  zoomRefreshed?(): void;
  updateHighlight?(): void;
  onDimensionsChange?(): void;
  data?: unknown;
  sequence?: string;
  length?: number;
  'display-start'?: number;
  'display-end'?: number;
  width?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withHighlightOnlyRefresh = <T extends new (...args: any[]) => any>(
  Base: T
): T =>
  class extends Base {
    private __lastGeometryStamp?: string;
    private __lastDataRef?: unknown;

    zoomRefreshed() {
      const self = this as unknown as RefreshablePatchTarget;
      const stamp = [
        self.width,
        self['display-start'],
        self['display-end'],
        self.length,
        self.sequence?.length,
        self.offsetWidth,
      ].join('|');
      if (
        this.__lastGeometryStamp === stamp &&
        this.__lastDataRef === self.data
      ) {
        // Only the highlight (or an equally non-geometric attribute)
        // changed: redraw the overlay, skip the O(sequence-length) rebuild
        self.updateHighlight?.();
        return;
      }
      this.__lastGeometryStamp = stamp;
      this.__lastDataRef = self.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (super.zoomRefreshed as any)?.call(this);
    }
  };

/**
 * nightingale-variation-canvas's zoomRefreshed() unconditionally calls
 * onDimensionsChange(), which schedules another zoomRefreshed() - a
 * self-perpetuating requestAnimationFrame loop that burns CPU forever
 * once variant data is loaded. Break the cycle by only propagating real
 * height changes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withStableDimensions = <T extends new (...args: any[]) => any>(
  Base: T
): T =>
  class extends Base {
    private __lastMeasuredHeight?: number;

    onDimensionsChange() {
      const height = (this as unknown as HTMLElement).offsetHeight;
      if (this.__lastMeasuredHeight === height) return;
      this.__lastMeasuredHeight = height;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (super.onDimensionsChange as any)?.call(this);
    }
  };

type NightingaleEvent = Event & {
  detail?: {
    displaystart?: number;
    displayend?: number;
    eventType?: 'click' | 'mouseover' | 'mouseout' | 'reset';
    feature?: unknown;
    coords?: [number, number];
    highlight?: string;
  };
};

@customElement('protvista-uniprot')
class ProtvistaUniprot extends LitElement {
  private openCategories: string[];
  private nostructure: boolean;
  private hasData: boolean;
  private loading: boolean;
  private data: Record<string, TrackPayload> = {};
  private rawData: Record<string, TrackPayload> = {};
  private displayCoordinates: { start?: number; end?: number } = {};
  private suspend?: boolean;
  private accession?: string;
  private sequence?: string;
  private notooltip?: boolean;
  private transformedVariants?: {
    sequence: string;
    variants: TransformedVariant[];
  };
  private config?: ProtvistaConfig;
  private configSrc?: string;
  private tooltip: {
    visible: boolean;
    title: string;
    content: string;
    x: number;
    y: number;
  } = { visible: false, title: '', content: '', x: 0, y: 0 };
  private gotoError?: string;
  // Download progress across all configured endpoints: per-url fraction
  // (0..1), aggregated into the slim bar above the viewer
  private _fetchFractions = new Map<string, number>();
  private _fetchDone = 0;
  private _fetchTotal = 0;
  private _lastProgressRender = 0;
  // Track keys ("CATEGORY-track") whose features are currently highlighted
  // on the 3D structure (and across all tracks) as a group
  private structureHighlightTracks = new Set<string>();
  private _structureGroupHighlight = '';
  // Range of the last clicked 1D feature, mirrored onto the 3D structure
  private _clickedFeatureHighlight = '';

  get _combinedStructureHighlight(): string {
    return [this._structureGroupHighlight, this._clickedFeatureHighlight]
      .filter(Boolean)
      .join(',');
  }
  private _genomicCoordinates?: Promise<GnCoordinate[] | undefined>;
  // Data waiting to be pushed into a track element once it scrolls into
  // view. Feeding a dense track is expensive (full re-process + draw), so
  // offscreen tracks are deferred - the pattern EBI ships upstream as
  // nightingale-scrollbox (ebi-webcomponents/nightingale#311).
  private _pendingTrackData = new WeakMap<Element, unknown>();
  private _trackVisibilityObserver?: IntersectionObserver;
  // Categories that have been expanded at least once: their track elements
  // stay mounted (hidden) on collapse so re-expanding is instant instead of
  // re-processing all the data.
  private everOpenedCategories = new Set<string>();
  // Category opens deferred to the next frame that haven't fired yet; a
  // close click in between removes the entry to cancel the expansion.
  private _pendingCategoryOpens = new Set<string>();
  // Last RAW data reference pushed into each track element. Comparing
  // against element.data is useless: nightingale's setter stores a
  // processed copy and the getter returns that - never the object we
  // assigned - so an identity guard on element.data is always true and
  // every lit update re-fed every track (2.1s NonOverlappingLayout re-run
  // per click on TITIN, measured by CPU profile).
  private _assignedTrackData = new WeakMap<Element, unknown>();
  // Tracks the exact data reference last pushed into each heatmap so
  // _loadDataInComponents (which runs after every lit update) doesn't
  // rebuild heatmaps that already display the current data.
  private _assignedHeatmapData = new WeakMap<object, unknown>();
  private _onOutsideClick = (e: MouseEvent) => {
    // notooltip is checked here (not at listener registration) so toggling
    // it at runtime behaves correctly without leaking/losing the listener
    if (this.notooltip) return;
    if (!(e.target as Element)?.closest?.('protvista-uniprot')) {
      this._hideTooltip();
    }
  };

  constructor() {
    super();
    this.openCategories = [];
    this.nostructure = false;
    this.hasData = false;
    this.loading = true;
    this.displayCoordinates = {};
    this.transformedVariants = { sequence: '', variants: [] };
    this.addStyles();
  }

  static get properties() {
    return {
      suspend: { type: Boolean, reflect: true },
      accession: { type: String, reflect: true },
      sequence: { type: String },
      data: { type: Object },
      openCategories: { type: Array },
      config: { type: Object },
      configSrc: { type: String, attribute: 'config-src', reflect: true },
      notooltip: { type: Boolean, reflect: true },
      nostructure: { type: Boolean, reflect: true },
    };
  }

  addStyles() {
    // We are not using static get styles() as we are not using the shadowDOM because of Mol*
    const styleTag = document.createElement('style');
    styleTag.textContent = `${protvistaStyles.toString()} ${loaderStyles.toString()}`;
    document.querySelector('head')?.append(styleTag);
  }

  registerWebComponents() {
    loadComponent('nightingale-navigation', NightingaleNavigation);
    loadComponent('nightingale-track-canvas', NightingaleTrackCanvas);
    loadComponent(
      'nightingale-colored-sequence',
      withHighlightOnlyRefresh(NightingaleColoredSequence)
    );
    loadComponent('nightingale-interpro-track', NightingaleInterproTrack);
    loadComponent('nightingale-sequence', NightingaleSequence);
    loadComponent(
      'nightingale-variation-canvas',
      withStableDimensions(NightingaleVariationCanvas)
    );
    loadComponent(
      'nightingale-linegraph-track',
      withHighlightOnlyRefresh(NightingaleLinegraphTrack)
    );
    loadComponent('nightingale-filter', NightingaleFilter);
    loadComponent('nightingale-manager', NightingaleManager);
    loadComponent('protvista-uniprot-structure', ProtvistaUniprotStructure);
    loadComponent('protvista-lollipop-track', ProtvistaLollipopTrack);
    loadComponent('nightingale-sequence-heatmap', NightingaleSequenceHeatmap);
  }

  /**
   * Mark that at least one endpoint returned usable data: dismisses the
   * loader and fires the public protvista-event exactly once. Called as
   * payloads arrive so that one slow endpoint (e.g. 85MB of variants for
   * TITIN) never blanks the whole viewer.
   */
  _onFetchProgress(url: string, loadedBytes: number, totalBytes?: number) {
    // content-length is the compressed size while loadedBytes counts
    // decompressed bytes; cap below 1 so only completion reaches 100%
    const fraction = totalBytes
      ? Math.min(loadedBytes / totalBytes, 0.95)
      : 0.5;
    this._fetchFractions.set(url, fraction);
    this._renderProgress();
  }

  _renderProgress(force = false) {
    const now = Date.now();
    if (!force && now - this._lastProgressRender < 150) return;
    this._lastProgressRender = now;
    this.requestUpdate();
  }

  get _fetchProgressPercent(): number {
    if (this._fetchTotal === 0) return 100;
    let sum = 0;
    this._fetchFractions.forEach((fraction) => {
      sum += fraction;
    });
    return Math.min(100, Math.round((sum / this._fetchTotal) * 100));
  }

  _markDataAvailable() {
    if (this.hasData) return;
    this.hasData = true;
    this.loading = false;
    this.dispatchEvent(
      new CustomEvent('protvista-event', {
        detail: { hasData: true },
        bubbles: true,
      })
    );
    this.requestUpdate();
  }

  _onDataAvailable(payload: unknown) {
    // Some endpoints return empty arrays, while most fail 🙄
    if (payload && typeof payload === 'object' && 'features' in payload) {
      const features = (payload as { features?: unknown[] }).features;
      if (Array.isArray(features) && features.length > 0) {
        this._markDataAvailable();
      }
    }
  }

  /**
   * Availability check on transformed category data: covers payload shapes
   * without a raw `features` array (AlphaFold confidence, InterPro,
   * adapter-less Nightingale-native data, variants).
   */
  _onCategoryDataAssigned(assigned: unknown) {
    if (
      Array.isArray(assigned) &&
      // `flat()` keeps `undefined` entries for tracks that returned nothing
      assigned.some((item) => item != null)
    ) {
      this._markDataAvailable();
    } else if (
      assigned &&
      typeof assigned === 'object' &&
      Array.isArray((assigned as { variants?: unknown[] }).variants) &&
      (assigned as { variants: unknown[] }).variants.length > 0
    ) {
      this._markDataAvailable();
    }
  }

  async _loadData() {
    const accession = this.accession;
    if (accession && this.config) {
      // Get the list of unique urls
      const urls = this.config.categories.flatMap(({ tracks }) =>
        tracks.flatMap(({ data }) => data[0].url)
      );

      // Kick off every fetch immediately, but do NOT await them as a batch:
      // each category below only waits for its own urls, so fast tracks
      // render while slow ones are still downloading.
      const uniqueUrls = [...new Set(urls)];
      this._fetchTotal = uniqueUrls.length;
      this._fetchDone = 0;
      this._fetchFractions.clear();
      const pending = new Map<string, Promise<unknown>>(
        uniqueUrls.map((url) => [
          url,
          fetchOne(url.replace('{accession}', accession), (loaded, total) =>
            this._onFetchProgress(url, loaded, total)
          ).then((payload) => {
            this.rawData[url] = payload as TrackPayload;
            this._fetchFractions.set(url, 1);
            this._fetchDone += 1;
            this._renderProgress(true);
            this._onDataAvailable(payload);
            return payload;
          }),
        ])
      );

      // Now iterate over tracks and categories, transforming the data
      // and assigning it as adequate. Categories are processed
      // independently and rendered as soon as their own data arrives.
      const categoryTasks = this.config.categories.map(async (category) => {
        const { name: categoryName, tracks, trackType } = category;
        // Wait only for the urls this category actually uses
        const categoryUrls = new Set(
          tracks.flatMap(({ data }) => data[0].url).flat()
        );
        await Promise.all([...categoryUrls].map((url) => pending.get(url)));
        const categoryData = await Promise.all(
          tracks.map(async ({ data: dataConfig, name: trackName, filter }) => {
            const { url, adapter } = dataConfig[0]; // TODO handle array
            const trackData = (Array.isArray(url) ? url : [url]).map(
              (url) => this.rawData[url] || []
            );

            if (
              !trackData ||
              (adapter === 'variation-adapter' &&
                Array.isArray(trackData[0]) &&
                trackData[0].length === 0)
            ) {
              return;
            }

            // 1. Convert data
            let transformedData = adapter
              ? await callAdapter(adapter, trackData)
              : trackData;

            if (adapter === 'interpro-adapter') {
              const representativeDomains: TransformedInterPro = [];
              (transformedData as TransformedInterPro | undefined)?.forEach(
                (feature) => {
                  feature.locations?.forEach((location) => {
                    if (location.representative) {
                      location.fragments?.forEach((fragment) => {
                        representativeDomains.push({
                          ...feature,
                          type: 'InterPro Representative Domain',
                          start: fragment.start,
                          end: fragment.end,
                        });
                      });
                    }
                  });
                }
              );
              transformedData = representativeDomains;
            }

            // 2. Filter raw data if filter is specified
            const filteredData =
              Array.isArray(transformedData) && filter
                ? transformedData.filter(
                    ({ type }: { type?: string }) => type === filter
                  )
                : transformedData;
            if (!filteredData) {
              return;
            }

            // 3. Assign track data
            this.data[`${categoryName}-${trackName}`] = filteredData;

            if (trackName === 'variation') {
              this.transformedVariants = filteredData as {
                sequence: string;
                variants: TransformedVariant[];
              };
            }
            return filteredData;
          })
        );

        this.data[categoryName] =
          trackType === 'nightingale-linegraph-track' ||
          trackType === 'nightingale-colored-sequence'
            ? categoryData[0]
            : (categoryData.flat() as Record<string, unknown>[]);

        this._onCategoryDataAssigned(this.data[categoryName]);

        // Re-render now: this category is ready even if others are still
        // fetching. `updated()` pushes the new data into the track elements.
        this.requestUpdate();
      });

      await Promise.all(categoryTasks);

      // Every category has been transformed into this.data; release the raw
      // payloads (e.g. ~85MB of TITIN variation JSON) instead of pinning
      // them in memory for the component's lifetime.
      this.rawData = {};
    }
    this.loading = false;
    markOnce('protvista:data-loaded');
    measureOnce(
      'protvista:fetch-and-parse',
      'protvista:script-start',
      'protvista:data-loaded'
    );
    this.requestUpdate(); // Why?
  }

  async _loadDataInComponents() {
    await frame();
    Object.entries(this.data).forEach(([id, data]) => {
      const element: NightingaleTrackCanvas | null = this.querySelector(
        `#${CSS.escape(`track-${id}`)}`
      );

      // Set data only if this exact object hasn't been pushed before
      if (element && this._assignedTrackData.get(element) !== data) {
        this._assignedTrackData.set(element, data);
        element.data = data as NightingaleTrackCanvas['data'];
      }
      const currentCategory = this.config?.categories.find(
        ({ name }) => name === id
      );
      const dataAsArray = data as {
        length?: number;
        variants?: TransformedVariant[];
      } | null;
      if (
        currentCategory &&
        currentCategory.tracks &&
        dataAsArray &&
        // Check there's data and special case for variants
        // NOTE: should refactor variation-adapter
        // to return a list of variants and set the sequence
        // on protvista-variation separately
        ((dataAsArray.length ?? 0) > 0 ||
          (dataAsArray.variants?.length ?? 0) > 0)
      ) {
        // Make category element visible
        const categoryElt = this.querySelector<HTMLElement>(
          `#${CSS.escape(`category_${currentCategory.name}`)}`
        );
        if (categoryElt) {
          categoryElt.style.display = 'flex';
        }
        for (const track of currentCategory.tracks) {
          const elementTrack: NightingaleTrackCanvas | null =
            this.querySelector(`#${CSS.escape(`track-${id}-${track.name}`)}`);
          const trackData = this.data[`${id}-${track.name}`];
          // Only assign when the data actually changed: setting `.data`
          // makes the track re-process and redraw everything, which is very
          // expensive for dense tracks (e.g. 240k+ variants for TITIN) and
          // this method runs after every lit update.
          if (
            elementTrack &&
            this._assignedTrackData.get(elementTrack) !== trackData
          ) {
            this._assignTrackDataWhenVisible(elementTrack, trackData);
          }
        }
      }

      if (
        currentCategory?.name === 'ALPHAMISSENSE_PATHOGENICITY' &&
        currentCategory.tracks
      ) {
        const heatmapComponent = this.querySelector<NightingaleSequenceHeatmap>(
          'nightingale-sequence-heatmap'
        );
        for (const track of currentCategory.tracks) {
          if (track.trackType === 'nightingale-sequence-heatmap') {
            if (heatmapComponent && this.sequence) {
              const heatmapData = this.data[`${id}-${track.name}`] as {
                xValue: number;
                yValue: string;
                score: number;
              }[];
              // setHeatmapData rebuilds the whole heatmap; skip if this
              // exact data has already been pushed to this component.
              if (
                this._assignedHeatmapData.get(heatmapComponent) === heatmapData
              ) {
                continue;
              }
              this._assignedHeatmapData.set(heatmapComponent, heatmapData);
              const xDomain = Array.from(
                { length: this.sequence.length },
                (_, i) => i + 1
              );
              const yDomain = [
                ...new Set(heatmapData.map((hotMapItem) => hotMapItem.yValue)),
              ] as string[];
              heatmapComponent.setHeatmapData(
                xDomain,
                yDomain,
                heatmapData as Parameters<
                  typeof heatmapComponent.setHeatmapData
                >[2]
              );
              heatmapComponent.updateComplete.then(() => {
                heatmapComponent.heatmapInstance?.setColor((d) =>
                  amColorScale(d.score)
                );
              });
            }
          }
        }
      }
    });
  }

  _toggleStructureHighlight(trackKey: string, enabled: boolean) {
    if (enabled) {
      this.structureHighlightTracks.add(trackKey);
    } else {
      this.structureHighlightTracks.delete(trackKey);
    }
    const { highlight, truncated } = buildHighlight(
      [...this.structureHighlightTracks].map((key) => this.data[key])
    );
    if (truncated) {
      console.warn(
        'Too many feature intervals selected for structure highlighting; showing the first 500'
      );
    }
    // Broadcast through the manager so the ruler and every 1D track sync
    const emitter = this.querySelector('nightingale-navigation');
    emitter?.dispatchEvent(
      new CustomEvent('change', {
        // key must match the manager's observed attribute name
        detail: { highlight },
        bubbles: true,
        cancelable: true,
      })
    );
    // nightingale-structure does NOT register with the manager; the
    // highlight is passed down declaratively through
    // protvista-uniprot-structure (see render), which keeps it applied
    // even when the user switches to a different structure afterwards
    this._structureGroupHighlight = highlight;
    this.requestUpdate();
  }

  _handleStructureToggle(e: Event) {
    const input = e.target as HTMLInputElement;
    const trackKey = input.dataset.trackKey;
    if (trackKey) this._toggleStructureHighlight(trackKey, input.checked);
  }

  /**
   * Zoom controls with the same behaviour as uniprot.org's toolbar:
   * out/in by a fifth of the sequence, or straight to ~29 visible
   * residues (letter-level view).
   */
  _handleZoom(operation: 'zoom-out' | 'zoom-in' | 'zoom-in-seq') {
    const length = this.sequence?.length;
    const navigation = this.querySelector('nightingale-navigation') as
      | (HTMLElement & { 'display-start'?: number; 'display-end'?: number })
      | null;
    if (!length || !navigation) return;
    const displayStart = Number(navigation['display-start'] ?? 1);
    const displayEnd = Number(navigation['display-end'] ?? length);
    const scaleFactor = length / 5;
    let k: number;
    if (operation === 'zoom-in') k = scaleFactor;
    else if (operation === 'zoom-out') k = -scaleFactor;
    else k = displayEnd - displayStart - 29;
    const newEnd = displayEnd - k;
    let newStart = displayStart;
    if (newEnd > length) newStart -= newEnd - length;
    if (displayStart < newEnd) {
      navigation.dispatchEvent(
        new CustomEvent('change', {
          detail: {
            'display-start': Math.max(1, Math.round(newStart)),
            'display-end': Math.min(Math.round(newEnd), length),
          },
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  _handleGoToSubmit(e: Event) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem(
      'goto'
    ) as HTMLInputElement;
    this.goTo(input.value);
  }

  _setGotoError(message?: string) {
    this.gotoError = message;
    this.requestUpdate();
  }

  /**
   * Broadcast a view change through nightingale-manager. The display window
   * is clamped to a minimum span so a single-residue jump never collapses
   * the viewer into a stretched one-column view.
   */
  _navigateTo(rawStart: number, rawEnd: number, highlight?: string) {
    const emitter = this.querySelector('nightingale-navigation');
    const length = this.sequence?.length;
    if (!emitter || !length) return;
    const { start, end } = clampWindow(rawStart, rawEnd, length);
    this.displayCoordinates = { start, end };
    // The manager only honours detail keys matching its observed attribute
    // names (display-start/display-end/highlight) - the concatenated
    // displaystart/displayend forms are ignored by its changeListener
    emitter.dispatchEvent(
      new CustomEvent('change', {
        detail: {
          'display-start': start,
          'display-end': end,
          ...(highlight ? { highlight } : {}),
        },
        bubbles: true,
        cancelable: true,
      })
    );
  }

  /**
   * Jump to a protein range ("188-198"), a residue with optional amino-acid
   * validation ("185S"/"S185"), or a genomic coordinate mapped through the
   * Proteins API coordinates payload ("g:21:25897620").
   */
  async goTo(rawQuery: string) {
    const length = this.sequence?.length;
    if (!length) return;
    const target = parseGoTo(rawQuery);
    if (!target) {
      this._setGotoError(
        `Couldn't understand "${rawQuery}". Try 188-198, 185S or g:21:25897620`
      );
      return;
    }

    if (target.kind === 'range') {
      const start = Math.min(target.start, length);
      const end = Math.min(target.end, length);
      this._setGotoError(undefined);
      // Highlight the exact range; _navigateTo widens the display window
      this._navigateTo(start, end, `${start}:${end}`);
      return;
    }

    let position: number;
    if (target.kind === 'genomic') {
      const coordinates = await this._loadGenomicCoordinates();
      const coordinate = selectCoordinate(coordinates, target.chromosome);
      const mapped =
        coordinate && genomeToProteinNearest(coordinate, target.position);
      if (!mapped) {
        this._setGotoError(
          `Genomic position ${target.position} doesn't map onto ${this.accession} (more than 10kb outside the gene?)`
        );
        return;
      }
      // Gene-level coordinates (e.g. pasted from a UniProt entry page) may
      // span the whole gene: map both ends and show the covered residues
      if (target.endPosition !== undefined) {
        const mappedEnd = coordinate
          ? genomeToProteinNearest(coordinate, target.endPosition)
          : undefined;
        if (mappedEnd) {
          const start = Math.min(mapped.residue, mappedEnd.residue);
          const end = Math.max(mapped.residue, mappedEnd.residue);
          this._setGotoError(undefined);
          this._navigateTo(start, end, `${start}:${end}`);
          return;
        }
      }
      position = mapped.residue;
    } else {
      position = target.position;
      if (position > length) {
        this._setGotoError(
          `Position ${position} is beyond the sequence (length ${length})`
        );
        return;
      }
      const actual = this.sequence?.charAt(position - 1).toUpperCase();
      if (target.aa && actual !== target.aa) {
        this._setGotoError(
          `Residue ${position} is ${actual}, not ${target.aa}`
        );
        return;
      }
    }

    this._setGotoError(undefined);
    // Highlight just the residue; _navigateTo widens the window around it
    this._navigateTo(position - 15, position + 15, `${position}:${position}`);
  }

  _loadGenomicCoordinates(): Promise<GnCoordinate[] | undefined> {
    if (!this._genomicCoordinates) {
      this._genomicCoordinates = (async () => {
        try {
          const response = await fetch(
            `https://www.ebi.ac.uk/proteins/api/coordinates/${this.accession}`,
            // Without the explicit Accept header this endpoint returns XML
            { headers: { Accept: 'application/json' } }
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = (await response.json()) as {
            gnCoordinate?: GnCoordinate[];
          };
          return payload.gnCoordinate;
        } catch (e) {
          console.error(
            `Couldn't load genomic coordinates for ${this.accession}`,
            e
          );
          return undefined;
        }
      })();
    }
    return this._genomicCoordinates;
  }

  /**
   * Clear all per-protein state. Without this, switching the accession at
   * runtime keeps showing the previous protein's tracks (and mixes them
   * with the new protein's data as it arrives).
   */
  _resetViewerState() {
    this.data = {};
    this.rawData = {};
    this.hasData = false;
    this.loading = true;
    this.sequence = undefined;
    this.transformedVariants = { sequence: '', variants: [] };
    this.openCategories = [];
    this.everOpenedCategories.clear();
    this._pendingCategoryOpens.clear();
    this.tooltip = { ...this.tooltip, visible: false };
    this.displayCoordinates = {};
    this.gotoError = undefined;
    this._genomicCoordinates = undefined;
    this._fetchFractions.clear();
    this._fetchDone = 0;
    this._fetchTotal = 0;
    this.structureHighlightTracks.clear();
    this._structureGroupHighlight = '';
    this._clickedFeatureHighlight = '';
    // The open/closed arrow state is toggled imperatively via classList,
    // so lit won't reset it on re-render
    this.querySelectorAll('.category-label.open').forEach((el) =>
      el.classList.remove('open')
    );
  }

  /**
   * Push data into a track element only once it is (nearly) visible.
   * Expanding several categories mounts many tracks at once; without this,
   * every one of them processes its full dataset immediately even though
   * most are below the fold.
   */
  _assignTrackDataWhenVisible(element: NightingaleTrackCanvas, data: unknown) {
    if (this._assignedTrackData.get(element) === data) return;
    if (typeof IntersectionObserver === 'undefined') {
      this._assignedTrackData.set(element, data);
      element.data = data as NightingaleTrackCanvas['data'];
      return;
    }
    this._pendingTrackData.set(element, data);
    if (!this._trackVisibilityObserver) {
      this._trackVisibilityObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const pending = this._pendingTrackData.get(entry.target);
            this._pendingTrackData.delete(entry.target);
            this._trackVisibilityObserver?.unobserve(entry.target);
            if (pending !== undefined) {
              this._assignedTrackData.set(entry.target, pending);
              (entry.target as NightingaleTrackCanvas).data =
                pending as NightingaleTrackCanvas['data'];
            }
          }
        },
        // Start loading slightly before the track scrolls into view
        { rootMargin: '250px 0px' }
      );
    }
    this._trackVisibilityObserver.observe(element);
  }

  updated(changedProperties: Map<string, string>) {
    super.updated(changedProperties);

    // React to runtime accession changes (get() returns the previous value;
    // undefined means this is the initial set handled by connectedCallback)
    if (
      changedProperties.has('accession') &&
      changedProperties.get('accession') !== undefined
    ) {
      this._resetViewerState();
      this._init();
      return;
    }

    // First render with content — manager is in the DOM, not the loader.
    if (this.hasData && !this.loading) {
      markOnce('protvista:first-render');
      measureOnce(
        'protvista:render',
        'protvista:data-loaded',
        'protvista:first-render'
      );
      measureOnce(
        'protvista:total',
        'protvista:script-start',
        'protvista:first-render'
      );
    }

    const filterComponent =
      this.querySelector<NightingaleFilter>('nightingale-filter');
    if (filterComponent && filterComponent.filters !== filterConfig) {
      filterComponent.filters = filterConfig as Filter[];
    }

    const variationComponent = this.querySelector<NightingaleVariationCanvas>(
      'nightingale-variation-canvas'
    );

    if (variationComponent && variationComponent?.colorConfig !== colorConfig) {
      variationComponent.colorConfig = colorConfig as (
        v: import('@nightingale-elements/nightingale-variation').VariationDatum
      ) => string;
    }

    if (changedProperties.has('suspend')) {
      if (this.suspend) return;
      this._init();
    }

    this._loadDataInComponents();
  }

  async _init() {
    if (!this.config && this.configSrc) {
      this.config = await this.loadExternalConfig(this.configSrc);
    }
    if (!this.config) {
      this.config = config;
    }

    if (!this.accession) return;
    this.loadEntry(this.accession).then((entryData) => {
      if (!entryData) return;
      this.sequence = entryData.sequence.sequence;
      this.displayCoordinates = { start: 1, end: this.sequence?.length };
      // We need to get the length of the protein before rendering it
    });
    this._loadData();
  }

  connectedCallback() {
    super.connectedCallback();
    markOnce('protvista:script-start');
    this.registerWebComponents();

    if (!this.suspend) this._init();

    this.addEventListener('change', (e: NightingaleEvent) => {
      if (e.detail?.displaystart) {
        this.displayCoordinates.start = e.detail.displaystart;
      }
      if (e.detail?.displayend) {
        this.displayCoordinates.end = e.detail.displayend;
      }

      // 3D -> 1D: a residue selection made inside the Mol* viewer arrives
      // as a change event from nightingale-structure carrying only a
      // highlight; bring the 1D view to that region so both stay in sync
      if (
        typeof e.detail?.highlight === 'string' &&
        e.detail.highlight &&
        (e.target as Element)?.tagName?.toLowerCase() ===
          'nightingale-structure'
      ) {
        const [rawStart, rawEnd] = e.detail.highlight
          .split(',')[0]
          .split(':')
          .map(Number);
        if (Number.isFinite(rawStart) && rawStart >= 1) {
          this._navigateTo(rawStart, rawEnd || rawStart);
        }
      }

      if (!this.notooltip) {
        if (e.detail?.eventType === 'click') {
          this._updateTooltip(e);
        } else if (!e.detail?.eventType || e.detail.eventType === 'reset') {
          // Zoom/pan/reset: any open tooltip is now out of place
          this._hideTooltip();
        }
      }

      // 1D -> 3D: clicking a feature/variant mirrors its range onto the
      // structure (nightingale-structure never hears manager highlights)
      if (e.detail?.eventType === 'click' && !this.nostructure) {
        const feature = e.detail.feature as
          | {
              start?: number | string;
              begin?: number | string;
              end?: number | string;
            }
          | undefined;
        const start = Number(feature?.start ?? feature?.begin);
        const end = Number(feature?.end ?? start);
        if (Number.isFinite(start) && start >= 1) {
          const next = `${Math.trunc(start)}:${Math.trunc(
            Number.isFinite(end) ? Math.max(start, end) : start
          )}`;
          // Re-clicking the same feature must not trigger a re-render
          if (next !== this._clickedFeatureHighlight) {
            this._clickedFeatureHighlight = next;
            this.requestUpdate();
          }
        }
      }
    });

    document.addEventListener('click', this._onOutsideClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onOutsideClick);
  }

  _updateTooltip(e: NightingaleEvent) {
    const feature = e.detail?.feature as
      | {
          type?: string;
          start?: number | string;
          end?: number | string;
          tooltipContent?: string;
        }
      | undefined;
    if (!feature?.tooltipContent) {
      return;
    }
    const [pageX, pageY] = e.detail?.coords || [0, 0];
    this.tooltip = {
      visible: true,
      title: `${feature.type || ''} ${feature.start || ''}-${feature.end || ''}`,
      // Built by this package's tooltip formatters, which escape all
      // external API data (see src/utils/security.ts)
      content: feature.tooltipContent,
      // coords are page-based; the tooltip is position:fixed, so convert
      // to viewport coordinates
      x: pageX - window.scrollX,
      y: pageY - window.scrollY,
    };
    this.requestUpdate();
  }

  _hideTooltip() {
    if (this.tooltip.visible || this._clickedFeatureHighlight) {
      this.tooltip = { ...this.tooltip, visible: false };
      this._clickedFeatureHighlight = '';
      this.requestUpdate();
    }
  }

  /**
   * Load a viewer configuration from a URL (set via the `config-src`
   * attribute) and validate it against the published configuration contract
   * (see schema/protvista-config.schema.json). On any failure the error is
   * reported on the console and the viewer falls back to the built-in
   * UniProt configuration.
   */
  async loadExternalConfig(url: string): Promise<ProtvistaConfig | undefined> {
    let payload: unknown;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      payload = await response.json();
    } catch (e) {
      console.error(
        `Couldn't load ProtVista configuration from "${url}", falling back to the default configuration`,
        e
      );
      return undefined;
    }
    const result = validateConfig(payload);
    if (!result.valid) {
      console.error(
        `Configuration loaded from "${url}" is invalid, falling back to the default configuration.\n${formatConfigErrors(result.errors)}`
      );
      return undefined;
    }
    return result.config;
  }

  async loadEntry(
    accession: string
  ): Promise<{ sequence: { sequence: string } } | undefined> {
    try {
      return (await (
        await fetch(`https://www.ebi.ac.uk/proteins/api/proteins/${accession}`)
      ).json()) as { sequence: { sequence: string } };
    } catch (e) {
      console.error(`Couldn't load UniProt entry`, e);
      return undefined;
    }
  }

  /**
   * we need to use the light DOM.
   * */
  createRenderRoot() {
    return this;
  }

  get _progressTemplate() {
    if (this._fetchTotal === 0 || this._fetchDone >= this._fetchTotal) {
      return '';
    }
    const percent = this._fetchProgressPercent;
    return html`
      <div
        class="protvista-progress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${percent}"
        aria-label="Loading annotation data"
      >
        <div class="protvista-progress__bar" style="width: ${percent}%"></div>
        <span class="protvista-progress__label"
          >Loading annotation data ${this._fetchDone}/${this._fetchTotal}</span
        >
      </div>
    `;
  }

  render() {
    // Component isn't ready
    if (!this.sequence || !this.config || this.suspend) {
      return html``;
    }
    if (this.loading) {
      return html`${this._progressTemplate}
        <div class="protvista-loader">${svg`${unsafeHTML(loaderIcon)}`}</div>`;
    }
    if (!this.hasData) {
      return html`<div class="protvista-no-results">
        No feature data available for ${this.accession}
      </div>`;
    }
    return html`
      ${this._progressTemplate}
      <form class="protvista-goto" @submit="${this._handleGoToSubmit}">
        <div class="protvista-goto__row">
          <span class="protvista-zoom-tool" role="group" aria-label="Zoom">
            <button
              type="button"
              title="Zoom out"
              @click="${() => this._handleZoom('zoom-out')}"
            >
              −
            </button>
            <button
              type="button"
              title="Zoom in"
              @click="${() => this._handleZoom('zoom-in')}"
            >
              +
            </button>
            <button
              type="button"
              title="Zoom to sequence (29 residues)"
              @click="${() => this._handleZoom('zoom-in-seq')}"
            >
              AA
            </button>
          </span>
          <label for="protvista-goto-input">Go to position</label>
          <input
            id="protvista-goto-input"
            name="goto"
            type="text"
            placeholder="e.g. 188-198"
          />
          <button type="submit">Go</button>
        </div>
        ${this.gotoError
          ? html`<span class="protvista-goto__error" role="alert"
              >${this.gotoError}</span
            >`
          : html`<span class="protvista-goto__hint"
              >range <code>188-198</code> · residue with check
              <code>185S</code> · genomic position
              <code>g:21:25897620</code></span
            >`}
      </form>
      <nightingale-manager
        reflected-attributes="length display-start display-end highlight activefilters filters"
      >
        <div class="nav-container">
          <div class="nav-track-label"></div>
          <div class="track-content">
            <nightingale-navigation
              length="${this.sequence.length}"
              height="40"
            ></nightingale-navigation>
            <nightingale-sequence
              length="${this.sequence.length}"
              height="40"
              sequence="${this.sequence}"
              display-start=${this.displayCoordinates?.start}
              display-end="${this.displayCoordinates?.end}"
              highlight-event="onclick"
              use-ctrl-to-zoom
            ></nightingale-sequence>
          </div>
        </div>
        ${this.config.categories.map(
          (category) =>
            this.data[category.name] &&
            html`
              <div class="category" id="category_${category.name}">
                <div
                  class="category-label"
                  data-category-toggle="${category.name}"
                  @click="${this.handleCategoryClick}"
                >
                  ${category.helpPage
                    ? html`<span data-article-id="${category.helpPage}"
                        >${category.label}</span
                      >`
                    : category.label}
                </div>
                <div
                  data-id="category_${category.name}"
                  class="aggregate-track-content track-content ${category.trackType ===
                  'nightingale-colored-sequence'
                    ? 'track-content__coloured-sequence'
                    : ''}"
                  .style="${this.openCategories.includes(category.name)
                    ? 'opacity:0'
                    : 'opacity:1'}"
                >
                  ${this.data[category.name] &&
                  this.getTrack(
                    category.trackType,
                    'non-overlapping',
                    category.color,
                    category.shape,
                    category.name,
                    category.scale,
                    category['color-range']
                  )}
                </div>
              </div>

              <!-- Expanded Categories -->
              ${category.tracks &&
              category.tracks.map((track) => {
                const isOpen = this.openCategories.includes(category.name);
                // Once a category has been expanded, keep its track elements
                // mounted and merely hide them on collapse: re-mounting means
                // Nightingale re-processes all the data from scratch, which
                // is seconds of work for dense tracks (e.g. TITIN variants).
                if (isOpen || this.everOpenedCategories.has(category.name)) {
                  const trackData = this.data[`${category.name}-${track.name}`];
                  return trackData &&
                    ((Array.isArray(trackData) && trackData.length) ||
                      Object.keys(trackData).length)
                    ? html`
                        <div
                          class="category__track"
                          id="track_${track.name}"
                          .style="${isOpen ? '' : 'display:none'}"
                        >
                          <div class="track-label" title="${track.tooltip}">
                            ${(track.filterComponent &&
                              this.getFilterComponent(
                                `${category.name}-${track.name}`
                              )) ||
                            (track.labelUrl &&
                              this.accession &&
                              html`<a
                                target="_blank"
                                href="${track.labelUrl.replace(
                                  '{accession}',
                                  this.accession
                                )}"
                                >${track.label}</a
                              >`) ||
                            (track.helpPage
                              ? html`<span data-article-id="${track.helpPage}"
                                  >${track.label}</span
                                >`
                              : track.label)}
                            ${!this.nostructure
                              ? html`<label
                                  class="structure-toggle"
                                  title="Highlight all features of this track on the 3D structure (and across all tracks)"
                                  ><input
                                    type="checkbox"
                                    data-track-key="${category.name}-${track.name}"
                                    .checked=${this.structureHighlightTracks.has(
                                      `${category.name}-${track.name}`
                                    )}
                                    @change="${this._handleStructureToggle}"
                                  />3D</label
                                >`
                              : ''}
                          </div>
                          <div
                            class="track-content"
                            class="track-content ${category.trackType ===
                            'nightingale-colored-sequence'
                              ? 'track-content__coloured-sequence'
                              : ''}"
                            data-id="track_${track.name}"
                          >
                            ${this.getTrack(
                              track.trackType,
                              'non-overlapping',
                              track.color || category.color,
                              track.shape || category.shape,
                              `${category.name}-${track.name}`,
                              track.scale || category.scale,
                              track['color-range'] || category['color-range']
                            )}
                          </div>
                        </div>
                      `
                    : '';
                }
              })}
              ${!category.tracks
                ? (this.data[category.name] as { accession?: string }[]).map(
                    (item: { accession?: string }) => {
                      const isOpen = this.openCategories.includes(
                        category.name
                      );
                      if (
                        isOpen ||
                        this.everOpenedCategories.has(category.name)
                      ) {
                        if (!item || !item.accession) return '';
                        return html`
                          <div
                            class="category__track"
                            id="track_${item.accession}"
                            .style="${isOpen ? '' : 'display:none'}"
                          >
                            <div class="track-label" title="${item.accession}">
                              ${item.accession}
                            </div>
                            <div
                              class="track-content"
                              data-id="track_${item.accession}"
                            >
                              ${this.getTrack(
                                category.trackType,
                                'non-overlapping',
                                category.color,
                                category.shape,
                                `${category.name}-${item.accession}`,
                                category.scale,
                                category['color-range']
                              )}
                            </div>
                          </div>
                        `;
                      }
                    }
                  )
                : ''}
            `
        )}
        <div class="nav-container">
          <div class="credits"></div>
          <div class="track-content">
            <nightingale-sequence
              length="${this.sequence.length}"
              height="40"
              sequence="${this.sequence}"
              display-start=${this.displayCoordinates.start}
              display-end="${this.displayCoordinates.end}"
              highlight-event="onclick"
              use-ctrl-to-zoom
            ></nightingale-sequence>
          </div>
        </div>
        ${!this.nostructure
          ? html`
              <protvista-uniprot-structure
                accession="${this.accession || ''}"
                .highlight=${this._combinedStructureHighlight}
              ></protvista-uniprot-structure>
            `
          : ''}
        ${!this.notooltip && this.tooltip.visible
          ? html`
              <div
                class="protvista-uniprot-tooltip"
                role="tooltip"
                style="left: ${this.tooltip.x + 8}px; top: ${this.tooltip.y +
                8}px"
              >
                <div class="protvista-uniprot-tooltip-header">
                  <span>${this.tooltip.title}</span>
                  <button
                    type="button"
                    aria-label="Close tooltip"
                    @click="${this._hideTooltip}"
                  >
                    ×
                  </button>
                </div>
                <div class="protvista-uniprot-tooltip-body">
                  ${unsafeHTML(this.tooltip.content)}
                </div>
              </div>
            `
          : ''}
      </nightingale-manager>
    `;
  }

  handleCategoryClick(e: MouseEvent) {
    let target = e.target as Element;

    if (target instanceof HTMLSpanElement) {
      target = target.parentElement as Element;
    }

    const toggle = target.getAttribute('data-category-toggle');

    if (toggle && !target.classList.contains('open')) {
      // Flip the arrow synchronously, then defer mounting the expanded
      // tracks until after the next paint: mounting Nightingale canvas
      // elements for a dense category blocks the main thread, and without
      // the deferral the click appears dead until the work finishes.
      target.classList.add('open');
      this._pendingCategoryOpens.add(toggle);
      requestAnimationFrame(() => {
        setTimeout(() => {
          // A close click in the meantime cancels the pending expansion;
          // without this check the deferred callback would force the
          // category back open against the user's last action
          if (!this._pendingCategoryOpens.delete(toggle)) return;
          this.everOpenedCategories.add(toggle);
          if (!this.openCategories.includes(toggle)) {
            this.openCategories = [...this.openCategories, toggle];
          }
        }, 0);
      });
    } else {
      target.classList.remove('open');
      if (toggle) this._pendingCategoryOpens.delete(toggle);
      this.openCategories = this.openCategories.filter((d) => d !== toggle);
    }
  }

  groupByCategory(filters: Filter[] | undefined, category: string) {
    return filters?.filter((f) => f.type.name === category);
  }

  getFilter(filters: Filter[] | undefined, filterName: string) {
    return filters?.filter((f) => f.name === filterName)?.[0];
  }

  handleFilterClick(e: CustomEvent) {
    const target = e.target as Element as NightingaleFilter;
    const consequenceFilters = this.groupByCategory(
      target.filters,
      'consequence'
    );
    const provenanceFilters = this.groupByCategory(
      target.filters,
      'provenance'
    );

    const selectedFilters = e.detail?.value;

    if (selectedFilters) {
      const selectedConsequenceFilters = selectedFilters
        .map((f: string) => this.getFilter(consequenceFilters, f))
        .filter(Boolean) as (Filter & {
        filterPredicate: (v: TransformedVariant) => unknown;
      })[];
      const selectedProvenanceFilters = selectedFilters
        .map((f: string) => this.getFilter(provenanceFilters, f))
        .filter(Boolean) as (Filter & {
        filterPredicate: (v: TransformedVariant) => unknown;
      })[];

      const filteredVariants = this.transformedVariants?.variants
        ?.filter((variant) =>
          selectedConsequenceFilters.some((filter) =>
            filter.filterPredicate(variant)
          )
        )
        .filter((variant) =>
          selectedProvenanceFilters.some((filter) =>
            filter.filterPredicate(variant)
          )
        );

      const existing = this.data['VARIATION-variation'];
      this.data['VARIATION-variation'] = {
        ...(existing && typeof existing === 'object' && !Array.isArray(existing)
          ? existing
          : {}),
        variants: filteredVariants,
      } as TrackPayload;

      this._loadDataInComponents();
    }
  }

  getCategoryTypesAsString(tracks: ProtvistaTrackConfig[]) {
    return tracks.map((t) => t.filter).join(',');
  }

  getFilterComponent(forId: string) {
    return html`
      <nightingale-filter
        style="minWidth: 20%"
        for="track-${forId}"
        @change="${this.handleFilterClick}"
      ></nightingale-filter>
    `;
  }

  getTrack(
    trackType: TrackType,
    layout = '',
    color = '',
    shape = '',
    id = '',
    scale = '',
    colorRange = ''
  ) {
    // lit-html doesn't allow to have dynamic tag names, hence the switch/case
    // with repeated code
    switch (trackType) {
      case 'nightingale-track-canvas':
        return html`
          <nightingale-track-canvas
            length="${this.sequence?.length}"
            height="40"
            layout="${layout}"
            color="${color}"
            shape="${shape}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-track-canvas>
        `;
      case 'protvista-lollipop-track':
        return html`
          <protvista-lollipop-track
            length="${this.sequence?.length}"
            height="55"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            margin-color="transparent"
            use-ctrl-to-zoom
          >
          </protvista-lollipop-track>
        `;
      case 'nightingale-interpro-track':
        return html`
          <nightingale-interpro-track
            length="${this.sequence?.length}"
            height="40"
            color="${color}"
            shape="${shape}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-interpro-track>
        `;
      case 'nightingale-variation-canvas':
        return html`
          <nightingale-variation-canvas
            length="${this.sequence?.length}"
            height="500"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-variation-canvas
        `;
      case 'nightingale-linegraph-track':
        return html`
          <nightingale-linegraph-track
            length="${this.sequence?.length}"
            height="50"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            show-label-name
            highlight-on-click
            use-ctrl-to-zoom
          >
          </nightingale-linegraph-track>
        `;
      case 'nightingale-colored-sequence':
        return html`
          <nightingale-colored-sequence
            length="${this.sequence?.length}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            id="track-${id}"
            scale="${scale}"
            color-range="${colorRange}"
            height="13"
            highlight-event="onclick"
            use-ctrl-to-zoom
          >
          </nightingale-colored-sequence>
        `;

      case 'nightingale-sequence-heatmap':
        return html`
          <nightingale-sequence-heatmap
            id="track-${id}"
            heatmap-id="seq-heatmap"
            length="${this.sequence?.length}"
            display-start="${this.displayCoordinates?.start}"
            display-end="${this.displayCoordinates?.end}"
            highlight-event="onclick"
            highlight-color="#EB3BFF66"
            height="300"
            use-ctrl-to-zoom
          >
          </nightingale-sequence-heatmap>
        `;
      default:
        console.warn('No Matching ProtvistaTrack Found.');
        break;
    }
  }
}

export default ProtvistaUniprot;
