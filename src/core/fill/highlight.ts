/**
 * On-page markers for filled fields.
 *
 * Drawn in a shadow root attached to a fixed-position host, rather than as
 * inline styles on the inputs themselves. Two reasons: a site with
 * `* { outline: none !important }` cannot fight an overlay it does not style,
 * and we never mutate the page's own elements, so nothing we draw can be
 * mistaken by the site's JavaScript for user input.
 */

const HOST_ID = 'fieldwise-overlay-host';

const STYLES = `
  :host { all: initial; }
  .layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
  }
  .marker {
    position: absolute;
    border: 2px solid var(--c);
    border-radius: 4px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent);
    transition: opacity .25s ease;
  }
  .marker[data-fading="true"] { opacity: 0; }
  .tag {
    position: absolute;
    top: -1.35rem;
    left: -2px;
    font: 600 11px/1.4 system-ui, sans-serif;
    color: #fff;
    background: var(--c);
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
  }
`;

type Tone = 'filled' | 'attention' | 'focus';

const TONES: Record<Tone, string> = {
  filled: '#16a34a',
  attention: '#d97706',
  focus: '#2563eb',
};

function layer(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    // Inert and out of the layout, so the page is unaffected by our presence.
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;';
    document.documentElement.append(host);

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const div = document.createElement('div');
    div.className = 'layer';
    root.append(style, div);
  }
  return host.shadowRoot!;
}

function container(): HTMLElement {
  return layer().querySelector('.layer') as HTMLElement;
}

export function clearMarkers(): void {
  container().replaceChildren();
}

/** Draw a marker over an element. `note` labels it, e.g. the value written. */
export function markElement(el: HTMLElement, note: string, tone: Tone = 'filled'): void {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.style.setProperty('--c', TONES[tone]);
  marker.style.left = `${rect.left - 2}px`;
  marker.style.top = `${rect.top - 2}px`;
  marker.style.width = `${rect.width + 4}px`;
  marker.style.height = `${rect.height + 4}px`;

  if (note) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    // textContent, never innerHTML: this string can originate from page text.
    tag.textContent = note;
    marker.append(tag);
  }

  container().append(marker);
}

/** Scroll a field into view and flash it, when the user picks it in the panel. */
export function focusElement(el: HTMLElement, note: string): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  clearMarkers();
  markElement(el, note, 'focus');
  window.setTimeout(clearMarkers, 2000);
}

/**
 * Redraw markers on scroll and resize.
 *
 * Positions are viewport-relative, so they have to follow the page. The
 * listeners are passive and the work is one rect read per marker, which keeps
 * this off the critical path on a long careers page.
 */
export function trackMarkers(redraw: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  };

  addEventListener('scroll', schedule, { passive: true, capture: true });
  addEventListener('resize', schedule, { passive: true });

  return () => {
    removeEventListener('scroll', schedule, { capture: true });
    removeEventListener('resize', schedule);
    if (frame) cancelAnimationFrame(frame);
  };
}
