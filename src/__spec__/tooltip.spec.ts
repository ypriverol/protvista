import { describe, expect, it, vi } from 'vitest';

// jsdom lacks browser observers that the Nightingale elements imported by
// protvista-uniprot register at module load time.
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

import ProtvistaUniprot from '../protvista-uniprot';

type TestableInstance = {
  tooltip: {
    visible: boolean;
    title: string;
    content: string;
    x: number;
    y: number;
  };
  _updateTooltip(e: Event): void;
  _hideTooltip(): void;
};

const clickEvent = (feature: unknown, coords?: [number, number]) =>
  ({ detail: { eventType: 'click', feature, coords } }) as unknown as Event;

describe('feature tooltip', () => {
  it('opens on click events carrying tooltipContent', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance._updateTooltip(
      clickEvent(
        {
          type: 'DOMAIN',
          start: 10,
          end: 50,
          tooltipContent: '<b>My domain</b>',
        },
        [100, 200]
      )
    );
    expect(instance.tooltip.visible).toBe(true);
    expect(instance.tooltip.title).toBe('DOMAIN 10-50');
    expect(instance.tooltip.content).toBe('<b>My domain</b>');
    expect(instance.tooltip.x).toBe(100 - window.scrollX);
    expect(instance.tooltip.y).toBe(200 - window.scrollY);
  });

  it('ignores clicks on features without tooltipContent', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance._updateTooltip(clickEvent({ type: 'DOMAIN' }));
    expect(instance.tooltip.visible).toBe(false);
  });

  it('hides on demand', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance._updateTooltip(
      clickEvent({ type: 'SITE', start: 1, end: 1, tooltipContent: 'x' })
    );
    expect(instance.tooltip.visible).toBe(true);
    instance._hideTooltip();
    expect(instance.tooltip.visible).toBe(false);
  });
});
