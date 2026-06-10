import {
  autoGroupTabIntoExistingGroup,
  groupCurrentWindowTabs,
} from '@/utils/tabGrouping';

const OPEN_TAB_SWITCHER_COMMAND = 'open-tab-switcher';
const TIDY_TABS_COMMAND = 'tidy-tabs';
const TAB_SWITCHER_PATH = '/tab-switcher.html';
const TAB_SWITCHER_HEIGHT = 560;
const TAB_SWITCHER_WIDTH = 760;

interface BackgroundTab {
  groupId?: number;
  id?: number;
  url?: string;
  windowId?: number;
}

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command === OPEN_TAB_SWITCHER_COMMAND) {
      void openTabSwitcher().catch((error) => {
        console.error('Failed to open tab switcher.', error);
      });
      return;
    }

    if (command !== TIDY_TABS_COMMAND) return;

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

async function openTabSwitcher(): Promise<void> {
  const [sourceTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const url = buildTabSwitcherUrl(sourceTab);
  const existingTab = await findExistingTabSwitcherTab();

  if (existingTab?.id != null) {
    await browser.tabs.update(existingTab.id, {
      active: true,
      url,
    });

    if (existingTab.windowId != null) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }

    return;
  }

  await browser.windows.create({
    focused: true,
    height: TAB_SWITCHER_HEIGHT,
    type: 'popup',
    url,
    width: TAB_SWITCHER_WIDTH,
  });
}

function buildTabSwitcherUrl(sourceTab?: BackgroundTab): string {
  const url = new URL(getRuntimeUrl(TAB_SWITCHER_PATH));

  if (sourceTab?.id != null) {
    url.searchParams.set('sourceTabId', String(sourceTab.id));
  }

  if (sourceTab?.windowId != null) {
    url.searchParams.set('sourceWindowId', String(sourceTab.windowId));
  }

  if (
    sourceTab?.groupId != null &&
    sourceTab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE
  ) {
    url.searchParams.set('sourceGroupId', String(sourceTab.groupId));
  }

  return url.href;
}

async function findExistingTabSwitcherTab(): Promise<BackgroundTab | null> {
  const tabSwitcherUrl = getRuntimeUrl(TAB_SWITCHER_PATH);
  const tabs = await browser.tabs.query({});

  return (
    tabs.find((tab) => tab.url?.startsWith(tabSwitcherUrl)) ?? null
  );
}

function getRuntimeUrl(path: string): string {
  return browser.runtime.getURL(
    path as Parameters<typeof browser.runtime.getURL>[0],
  );
}
