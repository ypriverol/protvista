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

  .category-label {
    background-color: #b2f5ff;
    cursor: pointer;
  }

  .category-label::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid #333;
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
    border-top: 5px solid #333;
    margin-right: 5px;
  }

  .track-label {
    background-color: #d9faff;
  }

  nightingale-track-canvas {
    border-top: 1px solid #d9faff;
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
