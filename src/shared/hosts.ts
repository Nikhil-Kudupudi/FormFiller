/**
 * Host match patterns, shared between the WXT manifest config and the content
 * script entrypoints so the two can never drift apart.
 */

/**
 * ATS hosts we support out of the box.
 *
 * Deliberately narrow: `<all_urls>` on an extension that reads form data
 * containing PII is the single biggest cause of Chrome Web Store review
 * friction in this category. Broader access is requested at runtime, per site,
 * through `optional_host_permissions`.
 */
export const ATS_HOSTS = [
  '*://*.myworkdayjobs.com/*',
  '*://boards.greenhouse.io/*',
  '*://job-boards.greenhouse.io/*',
  '*://jobs.lever.co/*',
  '*://jobs.ashbyhq.com/*',
  '*://*.icims.com/*',
  '*://*.smartrecruiters.com/*',
  '*://apply.workable.com/*',
  '*://*.taleo.net/*',
  '*://*.bamboohr.com/*',
  '*://*.jobvite.com/*',
  '*://*.rippling.com/*',
  '*://*.rippling-ats.com/*',
  '*://*.eightfold.ai/*',
  '*://*.successfactors.com/*',
  '*://*.successfactors.eu/*',
  // Board front-ends that embed one of the above in an iframe. Listed so the
  // outer page is readable too; the form itself is matched by its own host.
  '*://app.careerpuck.com/*',
  '*://*.careerpuck.com/*',
] as const;

/**
 * Hosts needing a MAIN-world helper.
 *
 * React tracks an input's last-seen value on a page-world object
 * (`el._valueTracker`). That object is not reliably reachable from a content
 * script's isolated world, so defeating it — which is what makes a programmatic
 * fill stick — requires a script sharing the page's JS heap.
 */
export const MAIN_WORLD_HOSTS = [
  '*://boards.greenhouse.io/*',
  '*://job-boards.greenhouse.io/*',
  '*://*.bamboohr.com/*',
] as const;

/** LLM endpoints. Static in the manifest: the service worker needs them at startup. */
export const PROVIDER_ORIGINS = [
  'https://generativelanguage.googleapis.com/*',
  'https://api.x.ai/*',
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
] as const;

/**
 * Hosts the extension must never run on, regardless of granted permissions.
 *
 * Defense in depth. Even with no fill attempted, the *ability* to read these
 * pages is the risk, and it is what a store reviewer will ask about.
 */
export const NEVER_RUN_HOSTS = [
  /(^|\.)chase\.com$/i,
  /(^|\.)bankofamerica\.com$/i,
  /(^|\.)wellsfargo\.com$/i,
  /(^|\.)citi(bank)?\.com$/i,
  /(^|\.)capitalone\.com$/i,
  /(^|\.)paypal\.com$/i,
  /(^|\.)stripe\.com$/i,
  /(^|\.)coinbase\.com$/i,
  /(^|\.)irs\.gov$/i,
  /(^|\.)ssa\.gov$/i,
  /(^|\.)healthcare\.gov$/i,
  /(^|\.)mail\.google\.com$/i,
  /(^|\.)outlook\.(com|live\.com|office\.com)$/i,
  /(^|\.)1password\.com$/i,
  /(^|\.)lastpass\.com$/i,
  /(^|\.)bitwarden\.com$/i,
] as const;

/** True when the extension must not operate on this hostname. */
export function isNeverRunHost(hostname: string): boolean {
  return NEVER_RUN_HOSTS.some((re) => re.test(hostname));
}
