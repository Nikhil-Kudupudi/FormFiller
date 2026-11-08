import { defineContentScript } from 'wxt/utils/define-content-script';
import { MAIN_WORLD_HOSTS } from '@/shared/hosts';

/**
 * MAIN-world helper.
 *
 * React records an input's last-seen value on `el._valueTracker`, a page-world
 * object that an isolated content script cannot reliably reach. Without
 * resetting it, React compares the DOM value against the tracker, sees no
 * change, swallows the `input` event, and the next render wipes what we wrote.
 *
 * This script shares the page's JS heap, so it can. It is also, by the same
 * token, reachable by the page itself — so every message is validated for
 * origin and shape before it is acted on.
 */
export default defineContentScript({
  matches: [...MAIN_WORLD_HOSTS],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_idle',

  main() {
    // Implemented alongside the fill engine.
  },
});
