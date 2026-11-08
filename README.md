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

Early, but the core works and is tested.

**Done** — builds for Chrome and Firefox from one source tree; profile schema with versioned
migrations; field detection (attributes, eight label strategies, weighted scoring with an
ambiguity margin); the deny-list and honeypot guard; the fill engine, including the value-tracker
workaround that makes a write survive a framework re-render; the AI fallback with adapters for
Gemini, Grok, OpenAI and Anthropic; 100 unit tests and 13 browser tests.

**Next** — the side-panel preview UI, per-ATS adapters, work-history and education repeaters, and
per-site learned overrides.

Verified against the kitchen-sink fixture in Chromium: 17 fields filled with none failing
read-back, all ten honeypots left empty, password/search/newsletter/referrer/cover-letter
untouched, both consent boxes unchecked, the salutation select left alone while the real job title
filled, authorization and sponsorship answered with opposite values, and the country select
resolving to "United States of America" rather than the Minor Outlying Islands.

## Developing

```bash
npm install
npm run dev              # Chrome, with HMR
npm run dev:firefox      # Firefox
npm run test             # unit tests (detection engine)
npm run test:e2e         # Playwright, real extension, real browser
npm run build            # production build
npm run zip              # store-ready zip
npm run zip:firefox      # extension zip + the sources zip AMO requires
```

Loading unpacked: build, then point `chrome://extensions` → *Load unpacked* at `.output/chrome-mv3`.
Edge and Brave consume the same Chromium build unchanged.

## Architecture

The content script runs in the page's isolated world and **never holds the API key**. It sends a
sanitized field skeleton to the service worker, which owns the key and makes the provider call. That
isn't only hygiene: since Chrome 85 a content script's `fetch` carries the *page's* origin and is
subject to CORS even when the extension holds host permissions, so the call couldn't work from there
anyway.

A second content script runs in the **MAIN world** on Greenhouse and BambooHR. React records an
input's last-seen value on `el._valueTracker`, a page-world object an isolated script can't reliably
reach. Without resetting it, React compares the DOM value against the tracker, sees no change,
swallows the `input` event, and the next render wipes what was written. That script shares the
page's JS heap, so it can — and because the page can reach it too, it validates every message's
origin and shape before acting.

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
