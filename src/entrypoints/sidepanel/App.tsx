import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  sendToBackground,
  type ApplyResult,
  type Proposal,
  type ScanResult,
  type SectionStatus,
} from '@/shared/messaging';

/**
 * The primary surface.
 *
 * A side panel rather than a popup because a popup closes the moment focus
 * moves to the page -- which would make "show me what you'll fill, let me
 * correct a field, now apply" impossible. The panel stays open while the user
 * works in the form, and across the steps of a multi-page wizard.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'ready'; scan: ScanResult }
  | { kind: 'applied'; scan: ScanResult; result: ApplyResult }
  | { kind: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  const scan = useCallback(async () => {
    setStatus({ kind: 'scanning' });
    setNotice(undefined);

    const reply = await sendToBackground({ type: 'scan-active-tab' });
    if (!reply.ok) {
      setStatus({
        kind: 'error',
        message:
          reply.error.includes('Receiving end') || reply.error.includes('No active tab')
            ? 'Open a job application page, then scan again.'
            : reply.error,
      });
      return;
    }
    if (!('scan' in reply)) return;

    setStatus({ kind: 'ready', scan: reply.scan });
    // Pre-tick only the high-confidence matches. Anything ambiguous is shown
    // unticked, so accepting a guess is always a deliberate act.
    setChosen(new Set(reply.scan.proposals.filter((p) => p.recommended).map((p) => p.fieldId)));
  }, []);

  // Re-scan when the user switches tabs, so the panel never shows another
  // page's fields.
  useEffect(() => {
    const onActivated = () => setStatus({ kind: 'idle' });
    browser.tabs.onActivated.addListener(onActivated);
    return () => browser.tabs.onActivated.removeListener(onActivated);
  }, []);

  const proposals = useMemo(
    () => ('scan' in status ? status.scan.proposals : []),
    [status],
  );

  const toggle = (fieldId: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  };

  const apply = async () => {
    if (!('scan' in status)) return;
    const reply = await sendToBackground({ type: 'apply', fieldIds: [...chosen] });
    if (!reply.ok) {
      setStatus({ kind: 'error', message: reply.error });
      return;
    }
    if ('apply' in reply) {
      setStatus({ kind: 'applied', scan: status.scan, result: reply.apply });
    }
  };

  const undo = async () => {
    const reply = await sendToBackground({ type: 'undo' });
    if (reply.ok && 'undo' in reply) {
      setNotice(`Put ${reply.undo.restored} field${reply.undo.restored === 1 ? '' : 's'} back.`);
      await scan();
    }
  };

  const expand = async (section: 'work' | 'education') => {
    setNotice(undefined);
    const reply = await sendToBackground({ type: 'expand-rows', section });
    if (!reply.ok) {
      setNotice(reply.error);
      return;
    }
    // The page changed, so every field id from the last scan is stale.
    await scan();
  };

  const runAi = async () => {
    setAiBusy(true);
    setNotice(undefined);
    const reply = await sendToBackground({ type: 'run-ai', fieldIds: [] });
    setAiBusy(false);
    if (!reply.ok) {
      setNotice(reply.error);
      return;
    }
    await scan();
  };

  return (
    <main class="fw-panel">
      <header class="fw-head">
        <h1>fieldwise</h1>
        <button type="button" onClick={() => void scan()} disabled={status.kind === 'scanning'}>
          {status.kind === 'scanning' ? 'Scanning…' : 'Scan page'}
        </button>
      </header>

      {status.kind === 'idle' && (
        <p class="fw-muted">Open a job application and scan the page.</p>
      )}

      {status.kind === 'error' && <p class="fw-error">{status.message}</p>}

      {notice && <p class="fw-notice">{notice}</p>}

      {'scan' in status && (
        <>
          {status.scan.hasClosedShadowRoot && (
            <p class="fw-warn">
              Part of this form is built in a way the extension can&rsquo;t read. Those fields
              will need filling by hand.
            </p>
          )}

          {status.kind === 'applied' && (
            <section class="fw-result">
              <p>
                <strong>{status.result.filled.length}</strong> filled
                {status.result.failed.length > 0 && (
                  <>
                    , <strong>{status.result.failed.length}</strong> didn&rsquo;t take
                  </>
                )}
                .
              </p>
              {status.result.failed.length > 0 && (
                <ul class="fw-fails">
                  {status.result.failed.map((f) => (
                    <li key={f.fieldId}>
                      <span class="fw-f-label">{f.label}</span>
                      <span class="fw-muted"> — {f.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              {status.result.canUndo && (
                <button type="button" class="fw-undo" onClick={() => void undo()}>
                  Undo
                </button>
              )}
              <p class="fw-muted fw-small">
                Nothing was submitted. Check the form before you send it.
              </p>
            </section>
          )}

          {status.kind === 'ready' && status.scan.sections.length > 0 && (
            <Sections sections={status.scan.sections} onExpand={(s) => void expand(s)} />
          )}

          {status.kind === 'ready' && (
            <>
              <ProposalList
                proposals={proposals}
                chosen={chosen}
                onToggle={toggle}
                onFocus={(fieldId) => void sendToBackground({ type: 'highlight', fieldId })}
              />

              {proposals.length > 0 && (
                <div class="fw-actions">
                  <button type="button" class="fw-primary" onClick={() => void apply()} disabled={chosen.size === 0}>
                    Fill {chosen.size} field{chosen.size === 1 ? '' : 's'}
                  </button>
                </div>
              )}

              {proposals.length === 0 && (
                <p class="fw-muted">Nothing here matched your profile.</p>
              )}
            </>
          )}

          <Omissions scan={status.scan} onRunAi={() => void runAi()} aiBusy={aiBusy} />
        </>
      )}

      <footer class="fw-foot">
        <button type="button" class="fw-link" onClick={() => void browser.runtime.openOptionsPage()}>
          Edit profile
        </button>
      </footer>
    </main>
  );
}

/**
 * Repeating sections with fewer rows than the profile has entries.
 *
 * Offered rather than done automatically: clicking Add changes the page, and
 * nothing should change before the user has asked for it.
 */
function Sections(props: {
  sections: SectionStatus[];
  onExpand: (section: 'work' | 'education') => void;
}) {
  return (
    <div class="fw-sections">
      {props.sections.map((s) => (
        <div key={s.section} class="fw-section-note">
          <p>
            {s.label}: this form shows {s.rows} {s.rows === 1 ? 'row' : 'rows'} and you have{' '}
            {s.entries} {s.entries === 1 ? 'entry' : 'entries'}.
          </p>
          {s.canAdd ? (
            <button type="button" onClick={() => props.onExpand(s.section)}>
              Add {s.entries - s.rows} more {s.entries - s.rows === 1 ? 'row' : 'rows'}
            </button>
          ) : (
            <p class="fw-muted fw-small">
              No Add button found, so only the first {s.rows} will be filled.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ProposalList(props: {
  proposals: Proposal[];
  chosen: Set<string>;
  onToggle: (fieldId: string) => void;
  onFocus: (fieldId: string) => void;
}) {
  if (props.proposals.length === 0) return null;

  return (
    <ul class="fw-list">
      {props.proposals.map((p) => (
        <li key={p.fieldId} class={`fw-row fw-c-${p.confidence}`}>
          <label class="fw-row-main">
            <input
              type="checkbox"
              checked={props.chosen.has(p.fieldId)}
              onChange={() => props.onToggle(p.fieldId)}
            />
            <span class="fw-row-text">
              <span class="fw-label">{p.label}</span>
              <span class="fw-value">{p.value}</span>
            </span>
          </label>
          <span class="fw-meta">
            <span class={`fw-badge fw-b-${p.confidence}`} title={`matched by ${p.via}`}>
              {p.confidence === 'high' ? 'sure' : p.confidence === 'medium' ? 'likely' : 'unsure'}
            </span>
            <button type="button" class="fw-link" onClick={() => props.onFocus(p.fieldId)}>
              show
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What we did not offer, and why.
 *
 * Shown rather than hidden: "autofill not supported on this page" with no
 * explanation is the most common complaint about tools in this category, and
 * a user who can see *why* a field was skipped can act on it.
 */
function Omissions(props: { scan: ScanResult; onRunAi: () => void; aiBusy: boolean }) {
  const { denied, missingValue, unmatched } = props.scan;
  const total = denied.length + missingValue.length + unmatched.length;
  if (total === 0) return null;

  return (
    <details class="fw-omissions">
      <summary>{total} field{total === 1 ? '' : 's'} not filled</summary>

      {unmatched.length > 0 && (
        <section>
          <h2>Not recognised ({unmatched.length})</h2>
          <ul>
            {unmatched.map((o, i) => (
              <li key={i}>{o.label}</li>
            ))}
          </ul>
          <button type="button" onClick={props.onRunAi} disabled={props.aiBusy}>
            {props.aiBusy ? 'Asking…' : 'Try AI on these'}
          </button>
          <p class="fw-muted fw-small">
            Sends the shape of these fields — labels and attribute names — to your chosen
            provider. Never your profile, never the page text.
          </p>
        </section>
      )}

      {missingValue.length > 0 && (
        <section>
          <h2>Nothing saved for these ({missingValue.length})</h2>
          <ul>
            {missingValue.map((o, i) => (
              <li key={i}>
                {o.label} <span class="fw-muted">— {o.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {denied.length > 0 && (
        <section>
          <h2>Deliberately skipped ({denied.length})</h2>
          <ul>
            {denied.map((o, i) => (
              <li key={i}>
                {o.label} <span class="fw-muted">— {o.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </details>
  );
}
