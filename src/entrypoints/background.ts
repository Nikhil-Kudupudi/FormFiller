import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

/**
 * Service worker.
 *
 * Owns the user's API key and is the only place a provider request is made.
 * This is not merely hygiene: since Chrome 85 a content script's `fetch`
 * carries the *page's* origin and is subject to normal CORS even when the
 * extension holds host permissions, so the call would fail from there anyway.
 */
export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel rather than a popup.
  // A popup closes the moment focus moves to the page, which would make
  // "preview, correct a field, then apply" impossible.
  if (browser.sidePanel) {
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {
        // Not fatal — the popup entrypoint remains as a fallback.
      });
  }
});
