/**
 * The isolated-world side of the MAIN-world bridge.
 *
 * A content script shares the DOM with the page but not its JavaScript heap.
 * React records an input's last-seen value on `el._valueTracker`, a page-world
 * object, and without resetting it React compares the DOM value to the
 * tracker, sees no change, swallows the `input` event, and the next render
 * overwrites what was written. The field looks filled while component state
 * stays empty -- and the form submits empty.
 *
 * So a write that must survive a re-render is delegated to a script running in
 * the page's own world. DOM nodes cannot cross `postMessage`, so the element is
 * identified by a one-shot attribute, which is the one thing both worlds see.
 */

const REQUEST = 'fieldwise:fill-request';
const RESPONSE = 'fieldwise:fill-response';
const TARGET_ATTRIBUTE = 'data-fieldwise-target';

/** How long to wait before concluding no helper is listening. */
const TIMEOUT_MS = 300;

let counter = 0;

export interface BridgeResult {
  ok: boolean;
  /** Absent when no MAIN-world helper answered. */
  value?: string;
}

/**
 * Ask the page-world helper to write a value.
 *
 * Resolves `{ ok: false }` when nothing answers, so the caller can fall back
 * to an isolated-world write rather than failing outright: on a page with no
 * framework, the plain path works fine.
 */
export function writeViaMainWorld(
  el: HTMLElement,
  value: string,
): Promise<BridgeResult> {
  const nonce = `fw_${Date.now().toString(36)}_${counter++}`;
  el.setAttribute(TARGET_ATTRIBUTE, nonce);

  return new Promise<BridgeResult>((resolve) => {
    let settled = false;

    const finish = (result: BridgeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      el.removeAttribute(TARGET_ATTRIBUTE);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      // Only this window, and only our own envelope.
      if (event.source !== window) return;
      const data = event.data as { kind?: string; nonce?: string; ok?: boolean; value?: string };
      if (data?.kind !== RESPONSE || data.nonce !== nonce) return;
      finish({ ok: data.ok === true, value: data.value });
    };

    const timer = setTimeout(() => finish({ ok: false }), TIMEOUT_MS);
    addEventListener('message', onMessage);

    window.postMessage({ kind: REQUEST, nonce, value }, location.origin);
  });
}

export const BRIDGE_PROTOCOL = { REQUEST, RESPONSE, TARGET_ATTRIBUTE } as const;
