import { LitElement, html, svg, nothing } from 'lit';
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
import {
  parseAlphaFoldPdb,
  buildResidueDossier,
  dossierToText,
  plddtBucket,
  collectDossierFeatures,
  CoordinateMap,
  ResidueDossier,
} from './utils/residue-dossier';
import {
  alignSequences,
  conservationRuns,
  ConservationStatus,
} from './utils/alignment';
import {
  diffFeatures,
  normaliseType,
  ComparableFeature,
  DiffEntry,
} from './utils/feature-diff';
import { escapeHtml } from './utils/security';
import { buildHighlight } from './utils/structure-highlight';
import {
  buildRegionChunks,
  withLocationParam,
  mergeChunkPayloads,
} from './utils/region-chunks';

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
  private _dossier?: ResidueDossier;
  private _dossierLoading = false;
  private _lastClickedPosition?: number;
  private _afCoordsPromise?: Promise<CoordinateMap | undefined>;
  private _comparison?: {
    accession: string;
    organism: string;
    identity: number;
    mapping: Int32Array;
    status: ConservationStatus[];
    orthologSequence: string;
    diffCounts: { shared: number; referenceOnly: number; orthologOnly: number };
  };
  private _comparisonLoading = false;
  private _comparisonError?: string;
  // UniProt-precomputed ortholog candidates (UniRef50 cluster members)
  private _orthologOptions?: {
    accession: string;
    organism: string;
    length: number;
  }[];
  private _orthologOptionsLoading = false;
  // Bumped on every reset (accession change): async work captured under an
  // older generation must not write into the fresh state
  private _loadGeneration = 0;
  // Deduplicated in-flight/completed fetches for the current accession
  private _urlPromises = new Map<string, Promise<unknown>>();
  // Categories whose data is not fetched until the user expands them
  // (config lazyThreshold vs sequence length); and those currently loading
  private _deferredCategories = new Set<string>();
  private _deferredLoading = new Set<string>();
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

  _ensureUrlFetched(url: string, accession: string): Promise<unknown> {
    let promise = this._urlPromises.get(url);
    if (!promise) {
      const generation = this._loadGeneration;
      this._fetchTotal += 1;
      promise = fetchOne(
        url.replace('{accession}', accession),
        (loaded, total) => {
          if (generation !== this._loadGeneration) return;
          this._onFetchProgress(url, loaded, total);
        }
      ).then((payload) => {
        // A reset (accession switch) happened while downloading: the
        // payload belongs to the previous protein
        if (generation !== this._loadGeneration) return payload;
        this.rawData[url] = payload as TrackPayload;
        this._fetchFractions.set(url, 1);
        this._fetchDone += 1;
        this._renderProgress(true);
        this._onDataAvailable(payload);
        return payload;
      });
      this._urlPromises.set(url, promise);
    }
    return promise;
  }

  async _processCategory(
    category: ProtvistaConfig['categories'][number],
    accession: string
  ) {
    const generation = this._loadGeneration;
    // Wait only for the urls this category actually uses
    const categoryUrls = [
      ...new Set(category.tracks.flatMap(({ data }) => data[0].url).flat()),
    ];
    await Promise.all(
      categoryUrls.map((url) => this._ensureUrlFetched(url, accession))
    );
    if (generation !== this._loadGeneration) return;
    await this._transformCategoryTracks(category);
  }

  /** Transform this.rawData into track/category data for one category */
  async _transformCategoryTracks(
    category: ProtvistaConfig['categories'][number]
  ) {
    const { name: categoryName, tracks, trackType } = category;
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
  }

  /**
   * Fetch a heavy category in residue-window chunks (config
   * regionChunkSize), automatically and in parallel. Summaries refresh at
   * checkpoints as chunks land, so e.g. the variant counts graph appears
   * after the first window instead of after an ~85MB monolith.
   */
  async _processCategoryChunked(
    category: ProtvistaConfig['categories'][number],
    accession: string
  ) {
    const generation = this._loadGeneration;
    const chunkSize = category.regionChunkSize as number;
    const length = this.sequence?.length ?? 0;
    const chunks = buildRegionChunks(length, chunkSize);
    const urls = [
      ...new Set(category.tracks.flatMap(({ data }) => data[0].url).flat()),
    ] as string[];

    const slotsByUrl = new Map<string, (unknown | null)[]>(
      urls.map((url) => [url, new Array(chunks.length).fill(null)])
    );
    let arrivedCount = 0;
    let lastCheckpoint = 0;
    let transforming = Promise.resolve();

    const refresh = () => {
      // Serialise transforms; each one reads the current merged rawData
      transforming = transforming.then(() => {
        if (generation !== this._loadGeneration) return;
        for (const url of urls) {
          const merged = mergeChunkPayloads(
            slotsByUrl.get(url) as (Record<string, unknown> | null)[]
          );
          if (merged) this.rawData[url] = merged as TrackPayload;
        }
        return this._transformCategoryTracks(category);
      });
      return transforming;
    };

    const totalFetches = urls.length * chunks.length;
    await Promise.all(
      urls.flatMap((url) =>
        chunks.map((chunk, index) =>
          this._ensureUrlFetched(withLocationParam(url, chunk), accession).then(
            (payload) => {
              const slots = slotsByUrl.get(url);
              if (slots) slots[index] = payload;
              arrivedCount += 1;
              // Checkpoints: first arrival, then every 3rd, then completion
              if (
                arrivedCount === 1 ||
                arrivedCount - lastCheckpoint >= 3 ||
                arrivedCount === totalFetches
              ) {
                lastCheckpoint = arrivedCount;
                refresh();
              }
            }
          )
        )
      )
    );
    await refresh();
    if (generation !== this._loadGeneration) return;
    // Release the chunk payloads; the transformed data is what the tracks
    // hold on to
    for (const url of urls) {
      delete this.rawData[url];
      for (const chunk of chunks) {
        const chunkUrl = withLocationParam(url, chunk);
        delete this.rawData[chunkUrl];
        this._urlPromises.delete(chunkUrl);
      }
      slotsByUrl.set(url, []);
    }
  }

  /** Fetch and mount a category whose loading was deferred (lazyThreshold) */
  async _loadDeferredCategory(name: string) {
    const accession = this.accession;
    const category = this.config?.categories.find((c) => c.name === name);
    if (!accession || !category) return;
    if (!this._deferredCategories.delete(name)) return; // already loading
    const generation = this._loadGeneration;
    this._deferredLoading.add(name);
    this.requestUpdate();
    await this._processCategory(category, accession);
    if (generation !== this._loadGeneration) return;
    this._deferredLoading.delete(name);
    // Release this category's raw payloads (e.g. 85MB of TITIN variants)
    for (const url of new Set(
      category.tracks.flatMap(({ data }) => data[0].url).flat()
    )) {
      delete this.rawData[url];
    }
    this.requestUpdate();
  }

  async _loadData() {
    const generation = this._loadGeneration;
    const accession = this.accession;
    if (accession && this.config) {
      // Partition: categories marked lazyThreshold defer their (heavy)
      // fetches until first expansion when the protein is long enough -
      // e.g. TITIN's ~85MB variation payload is not downloaded unless the
      // user opens the variants category.
      const sequenceLength = this.sequence?.length ?? 0;
      const eager: ProtvistaConfig['categories'] = [];
      const chunked: ProtvistaConfig['categories'] = [];
      for (const category of this.config.categories) {
        if (
          category.regionChunkSize &&
          sequenceLength > category.regionChunkSize
        ) {
          chunked.push(category);
        } else if (
          category.lazyThreshold &&
          sequenceLength > category.lazyThreshold
        ) {
          this._deferredCategories.add(category.name);
        } else {
          eager.push(category);
        }
      }
      if (this._deferredCategories.size > 0) this.requestUpdate();

      // Kick off every eager fetch immediately (deduplicated), but do NOT
      // await them as a batch: each category only waits for its own urls,
      // so fast tracks render while slow ones are still downloading.
      for (const url of new Set(
        eager.flatMap(({ tracks }) =>
          tracks.flatMap(({ data }) => data[0].url).flat()
        )
      )) {
        this._ensureUrlFetched(url, accession);
      }

      await Promise.all([
        ...eager.map((category) => this._processCategory(category, accession)),
        ...chunked.map((category) =>
          this._processCategoryChunked(category, accession)
        ),
      ]);

      // Every eager category has been transformed into this.data; release
      // the raw payloads instead of pinning them in memory. Deferred
      // fetches have not started yet, so nothing of theirs is lost.
      if (generation !== this._loadGeneration) return;
      this.rawData = {};
    }
    if (generation !== this._loadGeneration) return;
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
    const span = displayEnd - displayStart;
    let k: number;
    // Cap the zoom-in step so '+' keeps working below length/5 instead of
    // silently dying (uniprot.org's toolbar has this dead zone; capped
    // here so the button stays useful down to the 29-residue letter view)
    if (operation === 'zoom-in') k = Math.min(scaleFactor, span - 29);
    else if (operation === 'zoom-out') k = -scaleFactor;
    else k = span - 29;
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
    this._dossier = undefined;
    this._dossierLoading = false;
    this._lastClickedPosition = undefined;
    this._afCoordsPromise = undefined;
    this._clearComparison(false);
    this._fetchFractions.clear();
    this._fetchDone = 0;
    this._fetchTotal = 0;
    this._loadGeneration += 1;
    this._urlPromises.clear();
    this._deferredCategories.clear();
    this._deferredLoading.clear();
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

    if (this.tooltip.visible) this._clampTooltipIntoViewport();

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
    // Await the entry: the sequence length decides which categories defer
    // (lazyThreshold) before any track fetch starts
    const entryData = await this.loadEntry(this.accession);
    if (entryData) {
      this.sequence = entryData.sequence.sequence;
      this.displayCoordinates = { start: 1, end: this.sequence?.length };
    }
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
    const clickedStart = Math.trunc(Number(feature.start));
    if (Number.isFinite(clickedStart) && clickedStart >= 1) {
      this._lastClickedPosition = clickedStart;
    }
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

  /**
   * The tooltip opens at the click coordinates; near the right/bottom
   * viewport edges that puts part of it off-screen. Re-position after
   * render so it always stays fully visible.
   */
  _clampTooltipIntoViewport() {
    const el = this.querySelector<HTMLElement>('.protvista-uniprot-tooltip');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overRight = rect.right - (window.innerWidth - 8);
    const overBottom = rect.bottom - (window.innerHeight - 8);
    if (overRight > 0) {
      el.style.left = `${Math.max(8, rect.left - overRight)}px`;
    }
    if (overBottom > 0) {
      el.style.top = `${Math.max(8, rect.top - overBottom)}px`;
    }
  }

  /**
   * Runtime-only category injected when an ortholog comparison is active:
   * a conservation band plus the ortholog's features projected onto
   * reference coordinates through the alignment. Never fetched by
   * _loadData (guarded by name) and not part of the public config
   * contract.
   */
  static COMPARISON_CATEGORY = 'ORTHOLOG_COMPARISON';

  /** Feature types excluded from the annotation diff: species-specific
   * by nature (variants, conflicts, epitopes), whole-molecule spans, or
   * secondary structure that only the experimentally solved protein has -
   * their absence in the ortholog says nothing biological */
  static UNDIFFABLE_TYPES = new Set([
    'CHAIN',
    'INIT_MET',
    'SIGNAL',
    'TRANSIT',
    'PROPEP',
    'VARIANT',
    'MUTAGEN',
    'MUTAGENESIS',
    'CONFLICT',
    'VAR_SEQ',
    'NON_CONS',
    'NON_TER',
    'NON_STD',
    'UNSURE',
    'EPITOPE',
    'ANTIGEN',
    'HELIX',
    'STRAND',
    'TURN',
    'CONSERVATION',
  ]);

  async _startComparison(rawAccession: string) {
    const accession = rawAccession.trim().toUpperCase();
    if (!accession || !this.sequence) return;
    // Drop any previous comparison so its synthetic tracks are not
    // diffed as if they were annotations of the reference protein
    this._clearComparison(false);
    this._comparisonLoading = true;
    this._comparisonError = undefined;
    this.requestUpdate();
    try {
      const [entryResponse, featuresResponse, ptmResponse] = await Promise.all(
        [
          `https://www.ebi.ac.uk/proteins/api/proteins/${accession}`,
          `https://www.ebi.ac.uk/proteins/api/features/${accession}`,
          // Large-scale PTMs (PTMeXchange): most phosphosites live here,
          // not in the curated features endpoint - without this, every
          // large-scale site of the reference would look "only here"
          `https://www.ebi.ac.uk/proteins/api/proteomics/ptm/${accession}`,
        ].map((url) =>
          fetch(url, { headers: { Accept: 'application/json' } }).catch(
            () => undefined
          )
        )
      );
      if (!entryResponse) throw new Error(`Couldn't load ${accession}`);
      if (!entryResponse.ok) {
        throw new Error(
          `Couldn't load ${accession} (HTTP ${entryResponse.status})`
        );
      }
      const entry = (await entryResponse.json()) as {
        sequence?: { sequence?: string };
        organism?: { names?: { type?: string; value?: string }[] };
      };
      const orthologSequence = entry.sequence?.sequence;
      if (!orthologSequence) throw new Error(`No sequence for ${accession}`);
      const organism =
        entry.organism?.names?.find((n) => n.type === 'scientific')?.value ??
        accession;

      const alignment = alignSequences(this.sequence, orthologSequence);

      // Conservation band: contiguous runs of alignment status
      const STATUS_COLORS: Record<ConservationStatus, string> = {
        identical: '#014371',
        similar: '#b8ce48',
        different: '#a65708',
        gap: '#d2dce3',
      };
      const conservation = conservationRuns(alignment.status).map((run) => ({
        start: run.start,
        end: run.end,
        type: 'CONSERVATION',
        color: STATUS_COLORS[run.status],
        tooltipContent: `<h5>${escapeHtml(run.status)}</h5><p>${run.start}–${run.end} vs ${escapeHtml(accession)}</p>`,
      }));

      // Annotation diff: which compact features (PTMs, sites, motifs,
      // disulfides...) are shared, only on this protein, or only on the
      // ortholog - the question a conservation band alone cannot answer
      const orthologFeatures: ComparableFeature[] = [];
      if (featuresResponse?.ok) {
        const featurePayload = (await featuresResponse.json()) as {
          features?: {
            type?: string;
            begin?: string;
            end?: string;
            description?: string;
          }[];
        };
        for (const feature of featurePayload.features ?? []) {
          const begin = Math.trunc(Number(feature.begin));
          const end = Math.trunc(Number(feature.end ?? begin));
          if (!Number.isFinite(begin) || begin < 1 || !feature.type) continue;
          if (ProtvistaUniprot.UNDIFFABLE_TYPES.has(feature.type.toUpperCase()))
            continue;
          orthologFeatures.push({
            start: begin,
            end: Math.max(begin, end),
            type: feature.type,
            description: feature.description,
          });
        }
      }
      if (ptmResponse?.ok) {
        // proteomics/ptm returns peptide-level features carrying a `ptms`
        // array; each ptm position is relative to the peptide start
        const ptmPayload = (await ptmResponse.json()) as {
          features?: {
            begin?: string;
            ptms?: { name?: string; position?: number }[];
          }[];
        };
        for (const peptide of ptmPayload.features ?? []) {
          const begin = Math.trunc(Number(peptide.begin));
          if (!Number.isFinite(begin) || begin < 1) continue;
          for (const ptm of peptide.ptms ?? []) {
            if (typeof ptm.position !== 'number') continue;
            const site = begin + ptm.position - 1;
            orthologFeatures.push({
              start: site,
              end: site,
              type: 'MOD_RES',
              description: ptm.name
                ? `${ptm.name} (large-scale)`
                : 'PTM (large-scale)',
            });
          }
        }
      }
      // The same site can arrive from both endpoints (curated + large
      // scale); duplicates would surface as phantom "only in ortholog"
      // leftovers after one copy is matched
      const seenOrtholog = new Set<string>();
      const dedupedOrtholog = orthologFeatures.filter((f) => {
        const key = `${normaliseType(f.type)}|${f.start}|${f.end}`;
        if (seenOrtholog.has(key)) return false;
        seenOrtholog.add(key);
        return true;
      });
      const referenceFeatures: ComparableFeature[] = collectDossierFeatures(
        this.data as Record<string, unknown>
      )
        .filter(
          (f) => !ProtvistaUniprot.UNDIFFABLE_TYPES.has(f.type.toUpperCase())
        )
        .map((f) => ({
          start: f.start,
          end: f.end,
          type: f.type,
          description: f.description,
        }));
      // Same duplicate risk on the reference side (curated + large-scale)
      const seenReference = new Set<string>();
      const dedupedReference = referenceFeatures.filter((f) => {
        const key = `${normaliseType(f.type)}|${f.start}|${f.end}`;
        if (seenReference.has(key)) return false;
        seenReference.add(key);
        return true;
      });
      const diff = diffFeatures(
        dedupedReference,
        dedupedOrtholog,
        alignment.mapping
      );

      this._comparison = {
        accession,
        organism,
        identity: alignment.identity,
        mapping: alignment.mapping,
        status: alignment.status,
        orthologSequence,
        diffCounts: {
          shared: diff.shared.length,
          referenceOnly: diff.referenceOnly.length,
          orthologOnly: diff.orthologOnly.length,
        },
      };

      const positionText = (f: { start: number; end: number }) =>
        `${f.start}${f.end !== f.start ? `–${f.end}` : ''}`;
      const diffTooltip = (
        entry: DiffEntry,
        verdict: string,
        counterpart: string
      ) =>
        `<h4>${escapeHtml(entry.type)}</h4><hr />${
          entry.description
            ? `<h5>Description</h5><p>${escapeHtml(entry.description)}</p>`
            : ''
        }<h5>Comparison</h5><p>${verdict}</p><p>${counterpart}</p>`;

      const sharedData = diff.shared.map((entry) => ({
        start: entry.start,
        end: entry.end,
        type: entry.type,
        color: '#014371',
        tooltipContent: diffTooltip(
          entry,
          `Present in <b>both</b> proteins.`,
          `Here ${positionText(entry)} · ${escapeHtml(accession)} ${entry.counterpartStart}${
            entry.counterpartEnd !== entry.counterpartStart
              ? `–${entry.counterpartEnd}`
              : ''
          }`
        ),
      }));
      const referenceOnlyData = diff.referenceOnly.map((entry) => ({
        start: entry.start,
        end: entry.end,
        type: entry.type,
        color: '#a65708',
        tooltipContent: diffTooltip(
          entry,
          `Only annotated on <b>this protein</b> — no matching ${escapeHtml(entry.type)} in ${escapeHtml(accession)} near the aligned position.`,
          `Here ${positionText(entry)}`
        ),
      }));
      const orthologOnlyData = diff.orthologOnly.map((entry) => ({
        start: entry.start,
        end: entry.end,
        type: entry.type,
        color: '#578e21',
        tooltipContent: diffTooltip(
          entry,
          `Only annotated on <b>${escapeHtml(organism)}</b> — not on this protein.`,
          `${escapeHtml(accession)} ${entry.counterpartStart}${
            entry.counterpartEnd !== entry.counterpartStart
              ? `–${entry.counterpartEnd}`
              : ''
          } → here ${positionText(entry)}`
        ),
      }));

      const categoryName = ProtvistaUniprot.COMPARISON_CATEGORY;
      if (
        this.config &&
        !this.config.categories.some((c) => c.name === categoryName)
      ) {
        // Appended, not unshifted: inserting at the front makes lit reuse
        // every existing category element positionally, leaving stale data
        // in recycled tracks. Visibility is handled by auto-expanding and
        // scrolling the section into view instead.
        this.config.categories.push({
          name: categoryName,
          label: `Ortholog: ${accession}`,
          trackType: 'nightingale-track-canvas',
          tracks: [
            {
              name: 'conservation',
              label: 'Conservation',
              trackType: 'nightingale-track-canvas',
              tooltip: `Per-residue alignment status vs ${accession} (${organism}): identical, similar, different, or unaligned.`,
              data: [{ url: '' }],
            },
            {
              name: 'shared',
              label: `Shared (${sharedData.length})`,
              trackType: 'nightingale-track-canvas',
              tooltip: `Annotations present on BOTH proteins at aligned positions (PTMs, sites, motifs...).`,
              data: [{ url: '' }],
            },
            {
              name: 'reference_only',
              label: `Only ${this.accession} (${referenceOnlyData.length})`,
              trackType: 'nightingale-track-canvas',
              tooltip: `Annotations of this protein with no counterpart in ${accession} at the aligned position.`,
              data: [{ url: '' }],
            },
            {
              name: 'ortholog_only',
              label: `Only ${organism} (${orthologOnlyData.length})`,
              trackType: 'nightingale-track-canvas',
              tooltip: `Annotations of ${accession} with no counterpart on this protein, shown at their aligned positions here.`,
              data: [{ url: '' }],
            },
          ],
        });
      }
      this.data[categoryName] = conservation as never;
      this.data[`${categoryName}-conservation`] = conservation as never;
      this.data[`${categoryName}-shared`] = sharedData as never;
      this.data[`${categoryName}-reference_only`] = referenceOnlyData as never;
      this.data[`${categoryName}-ortholog_only`] = orthologOnlyData as never;
      // Auto-expand: the whole point is seeing the per-annotation verdicts
      this.everOpenedCategories.add(categoryName);
      if (!this.openCategories.includes(categoryName)) {
        this.openCategories = [...this.openCategories, categoryName];
      }
      if (this.isConnected) {
        this.requestUpdate();
        await this.updateComplete;
        // Push the data into the freshly mounted tracks directly: the lazy
        // visibility-based assignment would leave them blank until the user
        // happens to scroll past, which reads as "nothing happened"
        this._syncComparisonTrackData();
        this.querySelector(
          `.category-label[data-category-toggle="${categoryName}"]`
        )?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (error) {
      this._comparison = undefined;
      this._comparisonError =
        error instanceof Error ? error.message : 'Comparison failed';
    }
    this._comparisonLoading = false;
    this.requestUpdate();
  }

  _syncComparisonTrackData() {
    const categoryName = ProtvistaUniprot.COMPARISON_CATEGORY;
    for (const key of [
      categoryName,
      `${categoryName}-conservation`,
      `${categoryName}-shared`,
      `${categoryName}-reference_only`,
      `${categoryName}-ortholog_only`,
    ]) {
      const data = this.data[key];
      const element: NightingaleTrackCanvas | null = this.querySelector(
        `#${CSS.escape(`track-${key}`)}`
      );
      if (!element || data === undefined) continue;
      this._assignedTrackData.set(element, data);
      this._pendingTrackData.delete(element);
      element.data = data as NightingaleTrackCanvas['data'];
    }
  }

  _clearComparison(rerender = true) {
    const categoryName = ProtvistaUniprot.COMPARISON_CATEGORY;
    if (this.config) {
      this.config.categories = this.config.categories.filter(
        (c) => c.name !== categoryName
      );
    }
    delete this.data[categoryName];
    delete this.data[`${categoryName}-conservation`];
    delete this.data[`${categoryName}-shared`];
    delete this.data[`${categoryName}-reference_only`];
    delete this.data[`${categoryName}-ortholog_only`];
    this.openCategories = this.openCategories.filter(
      (name) => name !== categoryName
    );
    this.everOpenedCategories.delete(categoryName);
    this._comparison = undefined;
    this._comparisonError = undefined;
    this._comparisonLoading = false;
    if (rerender) this.requestUpdate();
  }

  /**
   * Ortholog candidates come from UniProt's precomputed UniRef50 cluster
   * for this protein - the user picks from what UniProt already grouped,
   * no free-text accessions.
   */
  async _loadOrthologOptions() {
    if (this._orthologOptions || this._orthologOptionsLoading) return;
    this._orthologOptionsLoading = true;
    this.requestUpdate();
    try {
      const clusterResponse = await fetch(
        `https://rest.uniprot.org/uniref/search?query=uniprot_id:${this.accession}+AND+identity:0.5&fields=id`,
        { headers: { Accept: 'application/json' } }
      );
      const cluster = (await clusterResponse.json()) as {
        results?: { id?: string }[];
      };
      const clusterId = cluster.results?.[0]?.id;
      if (!clusterId) throw new Error('No UniRef cluster found');
      const membersResponse = await fetch(
        `https://rest.uniprot.org/uniref/${clusterId}/members?size=30&facetFilter=member_id_type:uniprotkb_id`,
        { headers: { Accept: 'application/json' } }
      );
      const members = (await membersResponse.json()) as {
        results?: {
          accessions?: string[];
          organismName?: string;
          sequenceLength?: number;
        }[];
      };
      this._orthologOptions = (members.results ?? [])
        .map((m) => ({
          accession: m.accessions?.[0] ?? '',
          organism: m.organismName ?? '',
          length: m.sequenceLength ?? 0,
        }))
        .filter((m) => m.accession && m.accession !== this.accession);
    } catch (error) {
      this._comparisonError =
        error instanceof Error ? error.message : 'Ortholog lookup failed';
    }
    this._orthologOptionsLoading = false;
    this.requestUpdate();
  }

  _handleOrthologPick(e: Event) {
    const accession = (e.target as HTMLSelectElement).value;
    if (accession) this._startComparison(accession);
  }

  _loadAlphaFoldCoords(): Promise<CoordinateMap | undefined> {
    if (!this._afCoordsPromise) {
      this._afCoordsPromise = (async () => {
        const candidates: string[] = [];
        try {
          // The prediction API knows the current model file version -
          // never hardcode it (v4 vs v6 already differ across releases)
          const prediction = await fetch(
            `https://alphafold.ebi.ac.uk/api/prediction/${this.accession}`,
            { headers: { Accept: 'application/json' } }
          );
          if (prediction.ok) {
            const entries = (await prediction.json()) as { pdbUrl?: string }[];
            if (entries?.[0]?.pdbUrl) candidates.push(entries[0].pdbUrl);
          }
        } catch {
          // fall through to version probing
        }
        // Fallback: the file host is more permissive than the API; probe
        // recent model versions directly
        for (const version of [6, 7, 5, 4]) {
          candidates.push(
            `https://alphafold.ebi.ac.uk/files/AF-${this.accession}-F1-model_v${version}.pdb`
          );
        }
        for (const url of candidates) {
          try {
            const response = await fetch(url);
            if (!response.ok) continue;
            return parseAlphaFoldPdb(await response.text());
          } catch {
            // try the next candidate
          }
        }
        // No model at all (e.g. TITIN-length proteins) - the spatial
        // section is reported as unavailable
        return undefined;
      })();
    }
    return this._afCoordsPromise;
  }

  async showResidueDossier(position: number) {
    this._dossierLoading = true;
    this._dossier = undefined;
    this._hideTooltip();
    this.requestUpdate();
    const coords = await this._loadAlphaFoldCoords();
    this._dossier = buildResidueDossier({
      position,
      sequence: this.sequence,
      data: this.data as Record<string, unknown>,
      variants: this.transformedVariants?.variants,
      coords,
    });
    if (this._comparison) {
      const mapped = this._comparison.mapping[position] ?? 0;
      const status = this._comparison.status[position];
      const orthologResidue =
        mapped > 0
          ? this._comparison.orthologSequence.charAt(mapped - 1)
          : undefined;
      this._dossier.orthologNote =
        mapped > 0
          ? `${this._comparison.organism} (${this._comparison.accession}): ${status} — ${orthologResidue}${mapped}`
          : `${this._comparison.organism} (${this._comparison.accession}): not aligned at this position`;
    }
    this._dossierLoading = false;
    this.requestUpdate();
  }

  _closeDossier() {
    this._dossier = undefined;
    this._dossierLoading = false;
    this.requestUpdate();
  }

  _copyDossier() {
    if (!this._dossier) return;
    navigator.clipboard
      ?.writeText(dossierToText(this.accession ?? '', this._dossier))
      .catch(() => {});
  }

  /** Highlight the queried residue and a spatial neighbour together */
  _highlightDossierPair(target: number) {
    const position = this._dossier?.position;
    if (!position) return;
    this._clickedFeatureHighlight = `${position}:${position},${target}:${target}`;
    const emitter = this.querySelector('nightingale-navigation');
    emitter?.dispatchEvent(
      new CustomEvent('change', {
        detail: { highlight: this._clickedFeatureHighlight },
        bubbles: true,
        cancelable: true,
      })
    );
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
        <div class="protvista-compare">
          ${this._comparison
            ? html`<span>
                  Comparing with
                  <b>${this._comparison.organism}</b>
                  (${this._comparison.accession}) ·
                  ${Math.round(this._comparison.identity * 100)}% identical ·
                  ${this._comparison.diffCounts.shared} shared annotations,
                  ${this._comparison.diffCounts.referenceOnly} only here,
                  ${this._comparison.diffCounts.orthologOnly} only in
                  ${this._comparison.organism}
                </span>
                <button type="button" @click="${() => this._clearComparison()}">
                  Clear
                </button>`
            : this._orthologOptions
              ? html`<label for="protvista-ortholog-select"
                    >Compare with ortholog</label
                  >
                  <select
                    id="protvista-ortholog-select"
                    @change="${this._handleOrthologPick}"
                  >
                    <option value="">
                      choose (${this._orthologOptions.length} in UniRef50)
                    </option>
                    ${this._orthologOptions.map(
                      (o) =>
                        html`<option value="${o.accession}">
                          ${o.organism} — ${o.accession} (${o.length} aa)
                        </option>`
                    )}
                  </select>
                  ${this._comparisonLoading
                    ? html`<span class="protvista-goto__hint">aligning…</span>`
                    : ''}`
              : html`<button
                  type="button"
                  @click="${() => this._loadOrthologOptions()}"
                >
                  ${this._orthologOptionsLoading
                    ? 'Loading orthologs…'
                    : 'Compare with ortholog'}
                </button>`}
          ${this._comparisonError
            ? html`<span class="protvista-goto__error" role="alert"
                >${this._comparisonError}</span
              >`
            : ''}
        </div>
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
        ${this.config.categories.map((category) =>
          this.data[category.name] ||
          this._deferredCategories.has(category.name) ||
          this._deferredLoading.has(category.name)
            ? html`
                <div
                  class="category"
                  id="category_${category.name}"
                  .style="${this._deferredCategories.has(category.name) ||
                  this._deferredLoading.has(category.name)
                    ? 'display:flex'
                    : ''}"
                >
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
                    ${this._deferredCategories.has(category.name)
                      ? html`<span class="category-deferred-note"
                          >Large dataset — click the label to load</span
                        >`
                      : this._deferredLoading.has(category.name)
                        ? html`<span class="category-deferred-note"
                            >Loading…</span
                          >`
                        : ''}
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
                    const trackData =
                      this.data[`${category.name}-${track.name}`];
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
                              <div
                                class="track-label"
                                title="${item.accession}"
                              >
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
            : nothing
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
                ${this._lastClickedPosition
                  ? html`<div class="protvista-uniprot-tooltip-actions">
                      <button
                        type="button"
                        @click="${() =>
                          this.showResidueDossier(
                            this._lastClickedPosition as number
                          )}"
                      >
                        Position report (${this._lastClickedPosition})
                      </button>
                    </div>`
                  : ''}
              </div>
            `
          : ''}
        ${this._dossierLoading || this._dossier
          ? html`
              <div
                class="protvista-dossier"
                role="dialog"
                aria-label="Residue report"
              >
                <div class="protvista-dossier__header">
                  <strong>
                    ${this._dossier
                      ? html`Residue
                        ${this._dossier.aminoAcid}${this._dossier.position}`
                      : 'Residue report'}
                  </strong>
                  ${this._dossier?.plddt !== undefined
                    ? html`<span
                        class="protvista-dossier__plddt"
                        title="AlphaFold per-residue confidence (pLDDT)"
                        >pLDDT ${this._dossier.plddt} ·
                        ${plddtBucket(this._dossier.plddt)}</span
                      >`
                    : ''}
                  <button
                    type="button"
                    aria-label="Close report"
                    @click="${this._closeDossier}"
                  >
                    ×
                  </button>
                </div>
                ${this._dossierLoading
                  ? html`<p class="protvista-dossier__muted">
                      Computing spatial context…
                    </p>`
                  : html`
                      ${this._dossier?.containing.length
                        ? html`<h5>Located in</h5>
                            <ul>
                              ${this._dossier.containing.map(
                                (f) =>
                                  html`<li>
                                    ${f.type}${f.description
                                      ? html` ·
                                          <span title="${f.description}"
                                            >${f.description.length > 60
                                              ? `${f.description.slice(0, 57)}…`
                                              : f.description}</span
                                          >`
                                      : ''}
                                    <span class="protvista-dossier__muted"
                                      >${f.start}–${f.end}</span
                                    >
                                  </li>`
                              )}
                            </ul>`
                        : ''}
                      ${this._dossier?.neighbours.length
                        ? html`<h5>
                              Spatially close
                              <span class="protvista-dossier__muted"
                                >(Cα distances, AlphaFold model)</span
                              >
                            </h5>
                            <ul>
                              ${this._dossier.neighbours.map(
                                (n) =>
                                  html`<li
                                    class="protvista-dossier__row"
                                    title="Click to highlight both residues; confidence: ${n.confidence}"
                                    @click="${() =>
                                      this._highlightDossierPair(
                                        n.targetResidue
                                      )}"
                                  >
                                    <b>${n.distance} Å</b> ${n.feature.type}
                                    ${n.feature.description
                                      ? html`· ${n.feature.description}`
                                      : ''}
                                    <span class="protvista-dossier__muted"
                                      >at ${n.targetResidue}</span
                                    >
                                    ${n.spatialOnly
                                      ? html`<em
                                          class="protvista-dossier__badge"
                                          >distal in sequence</em
                                        >`
                                      : ''}
                                  </li>`
                              )}
                            </ul>`
                        : this._dossier?.spatialUnavailable
                          ? html`<p class="protvista-dossier__muted">
                              Spatial context unavailable — no full-length
                              AlphaFold model for this protein.
                            </p>`
                          : ''}
                      ${this._dossier?.variants.length
                        ? html`<h5>Variants at this position</h5>
                            <p>
                              ${this._dossier.variants
                                .map((v) => v.change)
                                .join(', ')}
                            </p>`
                        : ''}
                      ${this._dossier?.orthologNote
                        ? html`<h5>Conservation</h5>
                            <p>${this._dossier.orthologNote}</p>`
                        : ''}
                      ${this._dossier?.coverage
                        ? html`<h5>MS detectability</h5>
                            <p>
                              Covered by ${this._dossier.coverage.all}
                              peptide${this._dossier.coverage.all === 1
                                ? ''
                                : 's'}
                              (${this._dossier.coverage.unique} unique)
                            </p>`
                        : ''}
                      <div class="protvista-dossier__actions">
                        <button type="button" @click="${this._copyDossier}">
                          Copy as text
                        </button>
                      </div>
                    `}
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
      if (this._deferredCategories.has(toggle)) {
        this._loadDeferredCategory(toggle);
      }
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
