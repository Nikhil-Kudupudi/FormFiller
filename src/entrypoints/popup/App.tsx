import { browser } from 'wxt/browser';

/**
 * Minimal universal fallback. The real interaction lives in the side panel,
 * because a popup closes as soon as focus returns to the page.
 */
export function App() {
  const openPanel = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId && browser.sidePanel) {
      await browser.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  };

  return (
    <main class="fw-popup">
      <h1>fieldwise</h1>
      <button type="button" onClick={openPanel}>Open panel</button>
      <button type="button" onClick={() => browser.runtime.openOptionsPage()}>
        Edit profile
      </button>
    </main>
  );
}
