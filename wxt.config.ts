import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    action: {
      default_title: 'TabCat',
    },
    commands: {
      'open-tab-switcher': {
        description: 'Open TabCat tab switcher',
        suggested_key: {
          default: 'Ctrl+Shift+K',
        },
      },
      'tidy-tabs': {
        description: 'Group tabs using TabCat settings',
        suggested_key: {
          default: 'Alt+Shift+G',
        },
      },
    },
    permissions: ['tabs', 'tabGroups', 'storage'],
  },
  modules: ['@wxt-dev/module-react'],
});
