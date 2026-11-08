/**
 * happy-dom performs no layout, so every element reports a 0x0 rect and the
 * visibility check correctly concludes "too small to be real".
 *
 * These helpers give elements a plausible box so logic *above* visibility can
 * be tested in isolation. Visibility itself is covered by its own unit tests
 * (which assert on CSS, not geometry) and, properly, by the Playwright suite
 * in a browser that actually lays pages out.
 */

/** Give every element on the page a realistic box. */
export function stubLayout(width = 200, height = 30): void {
  for (const el of Array.from(document.querySelectorAll('*'))) {
    stubElementLayout(el as HTMLElement, width, height);
  }
}

export function stubElementLayout(el: HTMLElement, width = 200, height = 30): void {
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 10,
      left: 10,
      right: 10 + width,
      bottom: 10 + height,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Make `elementFromPoint` agree that the element at a point is itself, so the
 * overlay check does not report everything as covered.
 */
export function stubHitTesting(): void {
  document.elementFromPoint = ((x: number, y: number) => {
    void x;
    void y;
    return null;
  }) as typeof document.elementFromPoint;
}

/** Lay out the page the way a browser would, for tests above the layout layer. */
export function layOutPage(): void {
  stubLayout();
  stubHitTesting();
}
