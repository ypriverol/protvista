# Upstream findings (not yet filed)

Verified issues in `@nightingale-elements` packages discovered while
optimising this viewer, each with profiling evidence and a proposed fix.
Kept here for the maintainer of this fork to file on
`ebi-webcomponents/nightingale` (or raise internally) if and when they
choose — nothing in this folder is filed automatically.

| Finding                                                                     | Impact                                                                   | Our workaround                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| [variation-canvas rAF loop](./variation-canvas-raf-loop.md)                 | constant background CPU once variants load                               | `withStableDimensions` subclass      |
| [highlight triggers full SVG rebuilds](./highlight-triggers-svg-rebuild.md) | ~275k DOM writes per click on TITIN                                      | `withHighlightOnlyRefresh` subclass  |
| [track data getter/setter asymmetry](./track-data-identity-contract.md)     | consumers cannot do reference-based change detection; cost us 2.1s/click | raw-reference WeakMap in the wrapper |
| [structure labels API proposal](./structure-labels-api.md)                  | blocks 3D callouts/leader-lines for PTMs                                 | none possible wrapper-side           |
