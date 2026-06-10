import {
  autoGroupTabIntoExistingGroup,
  groupCurrentWindowTabs,
} from '@/utils/tabGrouping';

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command !== 'tidy-tabs') return;

    void groupCurrentWindowTabs().catch((error) => {
      console.error('Failed to tidy tabs from command.', error);
    });
  });

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    void autoGroupTabIntoExistingGroup(tab).catch((error) => {
      console.error('Failed to auto group tab.', error);
    });
  });
});
