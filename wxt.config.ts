import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    action: {
      default_title: 'TabCat',
    },
    commands: {
      'tidy-tabs': {
        description: 'Group tabs in the current window by hostname',
        suggested_key: {
          default: 'Alt+Shift+G',
        },
      },
    },
    permissions: ['tabs', 'tabGroups', 'storage'],
  },
  modules: ['@wxt-dev/module-react'],
});
