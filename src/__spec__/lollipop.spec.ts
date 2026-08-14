import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    ResizeObserver: ObserverStub,
    IntersectionObserver: ObserverStub,
    MutationObserver: globalThis.MutationObserver ?? ObserverStub,
  });
});

import rnaEditingLollipopAdapter from '../adapters/rna-editing-lollipop-adapter';
import ProtvistaLollipopTrack from '../elements/protvista-lollipop-track';
import type { RnaEditing } from '../adapters/types/rna-editing';

const rnaEditingPayload = (positions: [number, string][]): RnaEditing =>
  ({
    sequence: 'M'.repeat(500),
    features: positions.map(([position, consequence]) => ({
      type: 'rna_editing',
      locationType: { position: { position: String(position) } },
      variantType: { consequenceType: consequence },
    })),
  }) as unknown as RnaEditing;

describe('rna-editing-lollipop-adapter', () => {
  it('aggregates events per position with counts', () => {
    const result = rnaEditingLollipopAdapter(
      rnaEditingPayload([
        [35, 'missense'],
        [35, 'missense'],
        [60, 'synonymous'],
      ])
    )!;
    expect(result.map((d) => [d.position, d.count])).toEqual([
      [35, 2],
      [60, 1],
    ]);
  });

  it('colours by dominant consequence and escapes tooltips', () => {
    const result = rnaEditingLollipopAdapter(
      rnaEditingPayload([
        [10, 'missense'],
        [10, '<script>alert(1)</script>'],
        [10, 'missense'],
      ])
    )!;
    expect(result[0].color).toBe('#014371'); // missense dominates
    expect(result[0].tooltipContent).not.toContain('<script>');
    expect(result[0].tooltipContent).toContain('&lt;script&gt;');
  });

  it('returns undefined for empty payloads', () => {
    expect(
      rnaEditingLollipopAdapter({ features: [] } as unknown as RnaEditing)
    ).toBe(undefined);
    expect(rnaEditingLollipopAdapter(undefined as unknown as RnaEditing)).toBe(
      undefined
    );
  });
});

describe('protvista-lollipop-track', () => {
  const createInstance = () => {
    const instance = new ProtvistaLollipopTrack() as ProtvistaLollipopTrack & {
      xScale?: unknown;
      width: number;
      height: number;
      getXFromSeqPosition(p: number): number;
      getSingleBaseWidth(): number;
    };
    // Simulate the state the manager/zoom machinery provides in a page
    instance.getXFromSeqPosition = (p: number) => p * 2;
    instance.getSingleBaseWidth = () => 2;
    Object.defineProperty(instance, 'width', { value: 800 });
    Object.defineProperty(instance, 'height', { value: 55 });
    Object.defineProperty(instance, 'xScale', { value: () => 0 });
    document.body.appendChild(instance);
    return instance;
  };

  it('renders one stem+head group per datum', () => {
    const instance = createInstance();
    instance.data = [
      { position: 35, count: 2, color: '#014371' },
      { position: 60, count: 1 },
    ];
    const groups = instance.querySelectorAll('svg g.feature');
    expect(groups.length).toBe(2);
    expect(groups[0].querySelector('line')).toBeTruthy();
    expect(groups[0].querySelector('circle')).toBeTruthy();
    instance.remove();
  });

  it('dispatches a nightingale change event on click', () => {
    const instance = createInstance();
    instance.data = [
      { position: 35, count: 2, tooltipContent: '<b>hello</b>' },
    ];
    const events: CustomEvent[] = [];
    instance.addEventListener('change', (e) => events.push(e as CustomEvent));
    instance
      .querySelector('svg g.feature')!
      .dispatchEvent(new MouseEvent('click', { bubbles: false }));
    expect(events.length).toBe(1);
    const detail = events[0].detail;
    expect(detail.eventType).toBe('click');
    expect(detail.feature.start).toBe(35);
    expect(detail.feature.tooltipContent).toBe('<b>hello</b>');
    expect(detail.highlight).toBe('35:35');
    instance.remove();
  });

  it('tolerates data assignment before being connected', () => {
    const instance = new ProtvistaLollipopTrack();
    // not appended: no svg yet, refresh must be a safe no-op
    expect(() => {
      instance.data = [{ position: 1, count: 1 }];
    }).not.toThrow();
    expect(instance.querySelectorAll('g.feature').length).toBe(0);
  });
});
