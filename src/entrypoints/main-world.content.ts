import { defineContentScript } from 'wxt/utils/define-content-script';
import { ATS_HOSTS } from '@/shared/hosts';
import { BRIDGE_PROTOCOL } from '@/core/fill/bridge';

/**
 * MAIN-world helper.
 *
 * Runs in the page's own JavaScript world, which is the only place
 * `el._valueTracker` can be reached. React keeps that object to remember the
 * last value it saw; a write that does not reset it is swallowed, so the input
 * shows the new text while component state stays empty and the next render
 * wipes it. Everything here exists to avoid that.
 *
 * Because it shares the page's world, the page can post to it too. It
 * therefore validates the sender and the shape of every message, and its only
 * capability is "write this string into the element the content script just
 * tagged" -- it cannot be asked to read anything or reach another element.
 */
export default defineContentScript({
  matches: [...ATS_HOSTS],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_idle',

  main() {
    const { REQUEST, RESPONSE, TARGET_ATTRIBUTE } = BRIDGE_PROTOCOL;

    window.addEventListener('message', (event: MessageEvent) => {
      // Same window only. A message from an iframe or another origin is not
      // ours, whatever it claims.
      if (event.source !== window) return;

      const data = event.data as { kind?: string; nonce?: string; value?: unknown };
      if (data?.kind !== REQUEST) return;
      if (typeof data.nonce !== 'string' || typeof data.value !== 'string') return;

      // The element is found by the attribute the content script just set,
      // not by anything the message carries. A forged message can therefore
      // only target a field we were already about to write.
      const el = document.querySelector(`[${TARGET_ATTRIBUTE}="${CSS.escape(data.nonce)}"]`);

      const reply = (ok: boolean, value?: string) => {
        window.postMessage({ kind: RESPONSE, nonce: data.nonce, ok, value }, location.origin);
      };

      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement) &&
        !(el instanceof HTMLSelectElement)
      ) {
        reply(false);
        return;
      }

      reply(write(el, data.value), el.value);
    });

    function write(
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      value: string,
    ): boolean {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;

      // Reset React's tracker so the event we fire is not discarded as a
      // no-op. This is the whole reason this script exists.
      const tracked = el as unknown as { _valueTracker?: { setValue(v: string): void } };
      tracked._valueTracker?.setValue('');

      // The prototype setter, bypassing the per-instance accessor React
      // installs. Using HTMLInputElement.prototype on a textarea silently
      // does nothing, which is why the branch above is explicit.
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return el.value === value;
    }
  },
});
