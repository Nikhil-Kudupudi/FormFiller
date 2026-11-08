import { defineContentScript } from 'wxt/utils/define-content-script';
import { ATS_HOSTS, isNeverRunHost } from '@/shared/hosts';

/**
 * Page-side agent.
 *
 * Runs in the isolated world. Detects fields, applies fills, and renders the
 * preview overlay. It never holds the API key and never calls a provider.
 */
export default defineContentScript({
  matches: [...ATS_HOSTS],
  runAt: 'document_idle',
  // iCIMS renders its portal inside iframes, and Greenhouse and Workable are
  // commonly embedded as an iframe on the employer's own careers page. Note
  // this matches on the *iframe's* origin, so the inner host must be listed.
  allFrames: true,

  main() {
    if (isNeverRunHost(location.hostname)) return;
  },
});
