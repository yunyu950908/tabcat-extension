import { groupCurrentWindowTabs } from '@/utils/tabGrouping';

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command !== 'tidy-tabs') return;

    void groupCurrentWindowTabs().catch((error) => {
      console.error('Failed to tidy tabs from command.', error);
    });
  });
});
