import { css } from 'lit';

export default css`
  .track-content {
    width: 80vw;
  }

  .protvista-uniprot-tooltip {
    position: fixed;
    z-index: 50000;
    max-width: 22rem;
    max-height: 20rem;
    overflow-y: auto;
    background: #616161;
    color: #fff;
    font-size: 0.85rem;
    line-height: 1.35;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    padding: 0;
  }

  .protvista-uniprot-tooltip a,
  .protvista-uniprot-tooltip a:link,
  .protvista-uniprot-tooltip a:visited {
    color: #9fd7ff;
  }

  .protvista-uniprot-tooltip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    padding: 0.4rem 0.6rem;
    background: #4a4a4a;
    border-radius: 4px 4px 0 0;
  }

  .protvista-uniprot-tooltip-header button {
    background: none;
    border: none;
    color: #fff;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.2rem;
  }

  .protvista-uniprot-tooltip-body {
    padding: 0.5rem 0.6rem;
  }

  .protvista-uniprot-tooltip-body table td {
    padding: 0.15rem 0.3rem;
    vertical-align: top;
  }

  .track-content__coloured-sequence {
    display: flex;
    align-items: center;
  }

  .nav-container,
  .category__track {
    display: flex;
    margin-bottom: 0.1rem;
  }

  .category {
    display: none;
    margin-bottom: 0.1rem;
  }

  .category-label,
  .track-label,
  .nav-track-label,
  .credits {
    min-width: 20vw;
    max-width: 20vw;
    padding: 0.5em;
    line-height: normal;
  }

  /*
   * Colours follow the UniProt Franklin palette (measured from the
   * uniprot.org production stylesheet):
   *   sapphire-blue #014371 (site navbar), sea-blue #00639a (links),
   *   platinum #e4e8eb (light rows), hover #f5f9fc.
   * Each is overridable by integrators via custom properties.
   */
  protvista-uniprot {
    --protvista-category-background: #014371;
    --protvista-category-color: #fff;
    --protvista-track-background: #e4e8eb;
    --protvista-track-color: #1a1a1a;
    --protvista-hover-background: #f5f9fc;
    --protvista-link-color: #00639a;
  }

  .protvista-progress {
    position: relative;
    height: 4px;
    background: var(--protvista-track-background);
    border-radius: 2px;
    margin: 0 0 1.1rem;
  }

  .protvista-progress__bar {
    height: 100%;
    background: var(--protvista-link-color);
    border-radius: 2px;
    transition: width 0.25s ease;
  }

  .protvista-progress__label {
    position: absolute;
    right: 0;
    top: 6px;
    font-size: 0.7rem;
    color: #667;
    line-height: 1;
  }

  .protvista-goto {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    margin: 0 auto 0.6rem;
    font-size: 0.85rem;
    text-align: center;
  }

  .protvista-goto__row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .protvista-goto__hint {
    color: #667;
    font-size: 0.75rem;
  }

  .protvista-goto__hint code {
    background: var(--protvista-hover-background);
    border: 1px solid var(--protvista-track-background);
    border-radius: 3px;
    padding: 0 0.25em;
  }

  .protvista-goto input {
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--protvista-track-background);
    border-radius: 3px;
    min-width: 15rem;
  }

  .protvista-goto button {
    padding: 0.25rem 0.7rem;
    border: none;
    border-radius: 3px;
    background: var(--protvista-category-background);
    color: var(--protvista-category-color);
    cursor: pointer;
  }

  .protvista-goto__error {
    color: #b00020;
  }

  .structure-toggle {
    float: right;
    font-size: 0.7rem;
    color: var(--protvista-link-color);
    cursor: pointer;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
  }

  .structure-toggle input {
    margin: 0;
    cursor: pointer;
  }

  .category-label {
    background-color: var(--protvista-category-background);
    color: var(--protvista-category-color);
    cursor: pointer;
  }

  .category-label::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid var(--protvista-category-color);
    margin-right: 5px;
    -webkit-transition: all 0.1s;
    /* Safari */
    -o-transition: all 0.1s;
    transition: all 0.1s;
  }

  .category-label.open::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid var(--protvista-category-color);
    margin-right: 5px;
  }

  .track-label {
    background-color: var(--protvista-track-background);
    color: var(--protvista-track-color);
  }

  .track-label:hover {
    background-color: var(--protvista-hover-background);
  }

  .track-label a,
  .track-label a:link,
  .track-label a:visited {
    color: var(--protvista-link-color);
  }

  nightingale-track-canvas {
    border-top: 1px solid var(--protvista-track-background);
  }

  /* The navigation's bold window-bound labels (.start-label/.end-label)
     render at the bottom edge of its svg, flush against the sequence
     track's tick numbers below - at certain zooms they overlap. Keep the
     two text rows apart. */
  .nav-container nightingale-navigation {
    display: block;
    margin-bottom: 9px;
  }

  nightingale-navigation {
    .handle {
      fill: darkgrey;
      stroke: black;
      stroke-width: 0.5px;
      height: 19px;
    }
  }

  nightingale-filter {
    font-size: 0.8rem;
  }

  .feature {
    cursor: pointer;
  }

  .proforma {
    padding-left: 4em;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .mod-link {
    white-space: nowrap;
  }
`;
