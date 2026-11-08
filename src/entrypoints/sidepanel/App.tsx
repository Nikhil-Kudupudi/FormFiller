/**
 * The primary surface: preview what will be filled, correct anything wrong,
 * then apply. Stays open while the user works in the form, which is the whole
 * reason this is a side panel and not a popup.
 */
export function App() {
  return (
    <main class="fw-panel">
      <h1>fieldwise</h1>
      <p class="fw-muted">Open a job application to get started.</p>
    </main>
  );
}
