# nightingale-variation-canvas: perpetual requestAnimationFrame loop

`zoomRefreshed()` unconditionally calls `this.onDimensionsChange()`, and
`withZoom.onDimensionsChange()` calls `requestZoomRefreshed()` again — a
self-perpetuating rAF cycle (axis redraw + foreground clear every frame,
forever) once the element has data.

**Evidence:** CPU profiles of this viewer on Q8WZ42 (~54k variation
features) show a constant background rAF task attributable to this cycle,
present whenever the variants track is mounted, independent of user
interaction.

**Proposed upstream fix:** guard the `onDimensionsChange()` call in
`zoomRefreshed()` on an actual height change (or remove it — dimension
changes already flow through `withResizable`).

**Our workaround:** `withStableDimensions` in
[src/protvista-uniprot.ts](../../src/protvista-uniprot.ts) — only
propagates `onDimensionsChange` when `offsetHeight` actually changed.
