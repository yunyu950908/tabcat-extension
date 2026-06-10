import { groupCurrentWindowTabsByHostname } from '@/utils/tabGrouping';

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command !== 'tidy-tabs') return;

    void groupCurrentWindowTabsByHostname().catch((error) => {
      console.error('Failed to tidy tabs from command.', error);
    });
  });
});
