# fieldwise

Fill job application forms from a profile stored on your own machine.

Every job application asks for the same twenty facts — name, email, phone, address, work history,
education — and every ATS names its fields differently. Most of them render framework-controlled
widgets rather than plain HTML inputs, which is exactly why your browser's built-in autofill does
nothing on them.

fieldwise detects those fields, shows you what it's about to write, and fills them when you say so.

## Principles

These are constraints, not preferences.

- **It never submits.** Not as an option, not behind a flag. A half-filled application can't be
  retracted at most ATSs.
- **It never overwrites what you already typed.** Sites restore drafts and Workday pre-fills from
  your parsed resume; blowing that away is unrecoverable.
- **It shows you first.** Every match is previewed with its value and confidence before anything is
  written, and there's an Undo.
- **It never checks a consent box.** Agreeing to arbitration or a background check is a legal act.
- **Your profile stays on your machine.** No account, no server, no telemetry.
- **The AI fallback is off by default**, opt-in per site, and never sees your profile values — only
  the shape of the form.

## Status

Usable. Scan a page, review what will be written, correct anything wrong, apply, undo.

**Done** — builds for Chrome and Firefox from one source tree; profile editor with versioned
migrations and import/export; field detection (attributes, eight label strategies, weighted
scoring with an ambiguity margin); the deny-list and honeypot guard; the fill engine with the
MAIN-world bridge that makes a write survive a framework re-render; custom dropdowns, including
portalled menus, keyboard-only controls and async typeaheads; the side panel preview with
per-field confidence and undo; the AI fallback with adapters for Gemini, Grok, OpenAI and
Anthropic. 122 unit tests and 28 browser tests, seven of which drive the real packed extension.

**Next** — per-ATS adapters (Greenhouse and Lever first), work-history and education repeaters on
multi-row forms, split date fields, per-site learned overrides, and resume attach.

### Known gaps

- The content script bundle is ~127 KB, heavier than it should be for code injected into every
  matching page. Zod reaches it through the profile schema; the validation belongs in the service
  worker instead.
- Repeating sections fill only the first row. A form with three employer rows gets one.
- Split date fields (three selects for month, day and year) are not handled yet.
- Undo does not clear a custom dropdown. There is no standard way to reset one, and driving a
  widget's own UI to do it risks leaving a worse state than the one being undone, so the panel
  reports it instead.
- Firefox builds but is untested locally.

## What the AI fallback sends

The model is asked what a field *means*, never what should go in it. It receives an opaque id and
the field's shape — tag, type, label, a few attribute names, and the option labels of a select —
and may answer only with that id plus a key from a closed enum. Values come from your local
profile by key lookup in packaged code, so the model has no way to supply one.

The payload is built as an allow-list rather than by stripping the page, which means page prose,
HTML comments, `alt` and `title` text have no route into it. Deny-listed fields are left out
entirely: a payload that never describes a password field cannot be talked into targeting one.

This matters because a job posting is attacker-controlled text — anyone can post a job. A test
fixture carries fifteen prompt injections hidden eight different ways, and asserts none of them
reach the payload. The real protection, though, isn't the filtering: it's that every answer is
re-validated against the closed enum, the deny-list and the live DOM before anything is written.
An instruction that reaches the model still has nothing it can make the model do.

## On the API key

There is no true secret storage in a browser extension, and nothing here will pretend otherwise.

The key lives in `chrome.storage.local`, never `storage.sync` — syncing would replicate a billable
credential to Google's servers and every device you're signed into. An optional passphrase mode
encrypts it (PBKDF2-SHA256 → AES-GCM, derived key held only in `storage.session`). That genuinely
protects against someone reading your profile directory offline or recovering it from a backup. It
does **not** protect against malware running as you while the extension is unlocked.

## Prior art

[`tonybolivar/autograph`](https://github.com/tonybolivar/autograph) is the most complete prior work
in this space and was read for design and for its inventory of per-ATS attributes. It is GPL-3.0;
no code from it is used here. fieldwise is written from scratch and is MIT.

## License

MIT
