# withZoom treats every attribute change as a zoom

`withZoom.attributeChangedCallback` calls `requestZoomRefreshed()` for any
changed attribute — including `highlight`, which nightingale-manager
reflects onto every registered element on every change event. The
SVG-based elements then rebuild everything:

- `nightingale-colored-sequence` rewrites one gradient `<stop>` per
  residue: on TITIN (34,350 aa) with 4 such tracks, one click costs
  ~275k DOM attribute writes for a highlight-overlay-only change.
- `nightingale-linegraph-track` regenerates every series' full path
  string (~34k points per series).

The canvas tracks already avoid this via a draw stamp that excludes
`highlight` (`nightingale-track-canvas` `_drawStamp`); this is about
bringing the SVG elements to parity.

**Evidence:** CPU profiles on Q8WZ42 show identical multi-hundred-ms
stacks under `renderD3`/`refresh` on every click before the workaround;
near-zero after.

**Proposed upstream fix:** the same geometry stamp in `zoomRefreshed()`:
skip the rebuild when data reference, display range, length and width are
unchanged; call `updateHighlight()` only.

**Our workaround:** `withHighlightOnlyRefresh` in
[src/protvista-uniprot.ts](../../src/protvista-uniprot.ts), applied to
colored-sequence and linegraph at registration.
