import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { PROVIDER_ORIGINS } from './src/shared/hosts';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,

  vite: () => ({
    plugins: [preact()],
  }),

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'fieldwise',
      description:
        'Fill job application forms from a profile stored on your own machine. Preview every field before anything is written. Never submits.',

      permissions: [
        'storage',
        'activeTab',
        'scripting',
        // chrome.sidePanel does not exist on Firefox; the sidepanel entrypoint
        // is emitted there as sidebar_action, which needs no permission.
        ...(isFirefox ? [] : ['sidePanel']),
      ],

      // Static: the service worker needs these at startup to reach whichever
      // provider the user configured. Narrow origins raise no scary warning.
      host_permissions: [...PROVIDER_ORIGINS],

      // Broad access is opt-in, per site, at runtime. Never <all_urls> upfront.
      optional_host_permissions: ['*://*/*'],

      ...(isFirefox && {
        browser_specific_settings: {
          gecko: {
            id: 'fieldwise@localhost',
            // data_collection_permissions errors on Firefox <= 127; built-in
            // consent support landed in 140.
            strict_min_version: '140.0',
            data_collection_permissions: { required: ['none'] },
          },
        },
      }),
    };
  },
});
