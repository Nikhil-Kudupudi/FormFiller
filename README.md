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
portalled menus, keyboard-only controls and async typeaheads; dates in all four shapes, including
split month/day/year controls; repeating sections, so each employer row gets its own job; the side
panel preview with per-field confidence and undo; the AI fallback with adapters for Gemini, Grok,
OpenAI and Anthropic. 158 unit tests and 43 browser tests, nine of which drive the real packed
extension.

**Next** — per-ATS adapters (Greenhouse and Lever first), per-site learned overrides, and resume
attach.

### Known gaps

- The content script bundle is ~127 KB, heavier than it should be for code injected into every
  matching page. Zod reaches it through the profile schema; the validation belongs in the service
  worker instead.
- Repeating rows are matched by the fields they contain, so a form whose rows differ structurally
  — an extra question in one row only — may not group them. Those fields fall back to the first
  entry, so check a multi-row form before submitting.
- A split date whose group has no date heading of its own cannot be identified. Those controls
  are reported as unrecognised rather than guessed at, which is the right outcome but still a gap.
- Datepicker widgets that refuse typed input are not driven yet.
- Undo does not clear a custom dropdown. There is no standard way to reset one, and driving a
  widget's own UI to do it risks leaving a worse state than the one being undone, so the panel
  reports it instead.
- Firefox builds but is untested locally.

## Installing

fieldwise is not in any extension store, so it installs unpacked.

**From a release** — no build tools needed. Download `fieldwise-chrome.zip` from the
[Releases page](https://github.com/Nikhil-Kudupudi/FormFiller/releases) and unzip it. Open
`chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the unzipped
folder — the folder itself, not the `manifest.json` inside it. Edge and Brave take the same build
at `edge://extensions` and `brave://extensions`.

For Firefox, open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** and choose
`fieldwise-firefox.zip`. Firefox discards temporary add-ons when it restarts.

**From source** — see Developing below, then load `.output/chrome-mv3`.

### First run

Open the extension's options and fill in your profile; the panel has nothing to offer until you
do. Then open a job application, click the fieldwise icon to open the side panel, and press **Scan
page**. Confident matches arrive ticked and ambiguous ones arrive unticked on purpose. Nothing is
written until you press Fill, and nothing is ever submitted.

On a site outside the supported host list, click the toolbar icon on that page first — that is
what grants access to the tab.

## Developing

Every push runs typecheck, unit tests and browser tests and uploads a build. Tagging `v*` publishes
a release with the zips attached, which is the link to hand someone who wants to try it.

```bash
npm install
npm run dev              # Chrome, with HMR
npm run dev:firefox      # Firefox
npm run test             # unit tests
npm run test:e2e         # Playwright, real extension, real browser
npm run compile          # typecheck
npm run build            # production build
npm run zip              # store-ready zip
npm run zip:firefox      # extension zip plus the sources zip AMO requires
```

On Windows PowerShell, use `npm.cmd` — the execution policy blocks npm's `.ps1` wrapper by default.

## Architecture

The content script runs in the page's isolated world and **never holds the API key**. It sends a
sanitized field skeleton to the service worker, which owns the key and makes the provider call.
That is not only hygiene: since Chrome 85 a content script's `fetch` carries the *page's* origin
and is subject to CORS even when the extension holds host permissions, so the call could not work
from there anyway.

A second content script runs in the **MAIN world**. React records an input's last-seen value on
`el._valueTracker`, a page-world object an isolated script cannot reliably reach. Without resetting
it, React compares the DOM value against the tracker, sees no change, swallows the `input` event,
and the next render wipes what was written — leaving a field that looks filled over state that is
empty. That script shares the page's heap, so it can; and because the page can reach it too, it
validates every message's origin and shape before acting.

Frames announce themselves. A job board commonly embeds its ATS in a cross-origin iframe, leaving
the outer page with no fields at all, so the service worker addresses whichever frame reports the
most fillable fields rather than assuming the top one.

Permissions are deliberately narrow. The extension declares only the ATS hosts it supports plus the
four LLM endpoints; broader access lives in `optional_host_permissions` and is granted per site, by
you, at runtime. A hard-coded deny-list keeps it off banking, tax, health and webmail domains
regardless.

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
