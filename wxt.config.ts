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
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'scripting',
      'activeTab',
      'history',
      'bookmarks',
    ],
    web_accessible_resources: [
      {
        matches: ['<all_urls>'],
        resources: ['tab-switcher.html'],
        use_dynamic_url: true,
      },
    ],
  },
  modules: ['@wxt-dev/module-react'],
});
