import {
  autoGroupTabIntoExistingGroup,
  collapseAllTabGroups,
  expandAllTabGroups,
  getLastGroupingOperation,
  groupCurrentWindowTabs,
  undoLastGroupingOperation,
  ungroupAllTabs,
} from '@/utils/tabGrouping';
import {
  isTabGroupingActionName,
  TAB_GROUPING_ACTION_MESSAGE,
  type TabGroupingActionMessage,
} from '@/utils/tabGroupingMessages';
import {
  type TabSearchContext,
} from '@/utils/tabSearch';

const OPEN_TAB_SWITCHER_COMMAND = 'open-tab-switcher';
const TIDY_TABS_COMMAND = 'tidy-tabs';
const TAB_SWITCHER_PATH = '/tab-switcher.html';
const TAB_SWITCHER_HEIGHT = 560;
const TAB_SWITCHER_WIDTH = 760;
const TAB_SWITCHER_OVERLAY_CLOSE_MESSAGE = 'tabcat:switcher-overlay:close';

interface BackgroundTab {
  groupId?: number;
  id?: number;
  url?: string;
  windowId?: number;
}

interface TabSwitcherOverlayCloseMessage {
  sourceTabId?: unknown;
  token?: unknown;
  type: typeof TAB_SWITCHER_OVERLAY_CLOSE_MESSAGE;
}

let tabGroupingOperationQueue: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command === OPEN_TAB_SWITCHER_COMMAND) {
      void openTabSwitcher().catch((error) => {
        console.error('Failed to open tab switcher.', error);
      });
      return;
    }

    if (command !== TIDY_TABS_COMMAND) return;

    void queueTabGroupingOperation(() => groupCurrentWindowTabs()).catch((error) => {
      console.error('Failed to tidy tabs from command.', error);
    });
  });

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    void queueTabGroupingOperation(() =>
      autoGroupTabIntoExistingGroup(tab),
    ).catch((error) => {
      console.error('Failed to auto group tab.', error);
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    if (isTabSwitcherOverlayCloseMessage(message)) {
      return handleTabSwitcherOverlayClose(message);
    }

    if (isTabGroupingActionMessage(message)) {
      return handleTabGroupingAction(message);
    }

    return undefined;
  });
});

function queueTabGroupingOperation<T>(operation: () => Promise<T>): Promise<T> {
  const queuedOperation = tabGroupingOperationQueue.then(operation, operation);

  tabGroupingOperationQueue = queuedOperation.then(
    () => undefined,
    () => undefined,
  );

  return queuedOperation;
}

function handleTabGroupingAction(message: TabGroupingActionMessage): Promise<unknown> {
  switch (message.action) {
    case 'collapseAllTabGroups':
      return queueTabGroupingOperation(() => collapseAllTabGroups());
    case 'expandAllTabGroups':
      return queueTabGroupingOperation(() => expandAllTabGroups());
    case 'getLastGroupingOperation':
      return getLastGroupingOperation();
    case 'groupCurrentWindowTabs':
      return queueTabGroupingOperation(() => groupCurrentWindowTabs());
    case 'undoLastGroupingOperation':
      return queueTabGroupingOperation(() => undoLastGroupingOperation());
    case 'ungroupAllTabs':
      return queueTabGroupingOperation(() => ungroupAllTabs());
  }
}

async function handleTabSwitcherOverlayClose(
  message: TabSwitcherOverlayCloseMessage,
): Promise<{ ok: true }> {
  const sourceTabId = parseFiniteNumber(message.sourceTabId);
  const token = typeof message.token === 'string' ? message.token : undefined;

  if (sourceTabId == null || !token) {
    throw new Error('Invalid tab switcher overlay close request.');
  }

  await browser.scripting.executeScript({
    args: [token],
    func: closeTabcatSwitcherOverlay,
    target: { tabId: sourceTabId },
  });

  return { ok: true };
}

async function openTabSwitcher(): Promise<void> {
  const [sourceTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (sourceTab?.id != null) {
    try {
      await openFloatingTabSwitcher(sourceTab);
      return;
    } catch (error) {
      console.info('Falling back to the tab switcher popup.', error);
    }
  }

  await openTabSwitcherWindow(sourceTab);
}

async function openFloatingTabSwitcher(sourceTab: BackgroundTab): Promise<void> {
  if (sourceTab.id == null) {
    throw new Error('Cannot inject the tab switcher without an active tab.');
  }

  const closeToken = createTabSwitcherOverlayToken();

  await browser.scripting.executeScript({
    args: [
      buildTabSwitcherUrl(sourceTab, {
        closeToken,
        embedded: true,
      }),
      closeToken,
    ],
    func: showTabcatSwitcherOverlay,
    target: { tabId: sourceTab.id },
  });
}

async function openTabSwitcherWindow(sourceTab?: BackgroundTab): Promise<void> {
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

function buildTabSwitcherUrl(
  sourceTab?: BackgroundTab,
  options: {
    closeToken?: string;
    embedded?: boolean;
  } = {},
): string {
  const url = new URL(getRuntimeUrl(TAB_SWITCHER_PATH));
  const context = createTabSearchContext(sourceTab);

  if (options.embedded) {
    url.searchParams.set('embedded', '1');
  }

  if (options.closeToken) {
    url.searchParams.set('closeToken', options.closeToken);
  }

  if (context.sourceTabId != null) {
    url.searchParams.set('sourceTabId', String(context.sourceTabId));
  }

  if (context.sourceWindowId != null) {
    url.searchParams.set('sourceWindowId', String(context.sourceWindowId));
  }

  if (context.sourceGroupId != null) {
    url.searchParams.set('sourceGroupId', String(context.sourceGroupId));
  }

  return url.href;
}

function createTabSwitcherOverlayToken(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const randomValues = new Uint32Array(4);
  crypto.getRandomValues(randomValues);

  return [...randomValues].map((value) => value.toString(16)).join('-');
}

function createTabSearchContext(sourceTab?: BackgroundTab): TabSearchContext {
  const context: TabSearchContext = {};

  if (sourceTab?.id != null) {
    context.sourceTabId = sourceTab.id;
  }

  if (sourceTab?.windowId != null) {
    context.sourceWindowId = sourceTab.windowId;
  }

  if (
    sourceTab?.groupId != null &&
    sourceTab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE
  ) {
    context.sourceGroupId = sourceTab.groupId;
  }

  return context;
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

function isTabGroupingActionMessage(
  message: unknown,
): message is TabGroupingActionMessage {
  return (
    isRecord(message) &&
    message.type === TAB_GROUPING_ACTION_MESSAGE &&
    isTabGroupingActionName(message.action)
  );
}

function isTabSwitcherOverlayCloseMessage(
  message: unknown,
): message is TabSwitcherOverlayCloseMessage {
  return (
    isRecord(message) && message.type === TAB_SWITCHER_OVERLAY_CLOSE_MESSAGE
  );
}

function parseFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function showTabcatSwitcherOverlay(frameUrl: string, closeToken: string): void {
  const rootId = 'tabcat-switcher-overlay-root';
  const existingRoot = document.getElementById(rootId);

  if (existingRoot) {
    existingRoot.dispatchEvent(new CustomEvent('tabcat:close-switcher-overlay'));
    existingRoot.remove();
    return;
  }

  const root = document.createElement('div');
  root.id = rootId;
  root.dataset.tabcatCloseToken = closeToken;
  document.documentElement.append(root);

  const shadowRoot = root.attachShadow({ mode: 'closed' });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        inset: 0;
        position: fixed;
        z-index: 2147483647;
      }

      * {
        box-sizing: border-box;
      }

      .tabcat-overlay {
        align-items: flex-start;
        background: rgba(15, 23, 42, 0.42);
        display: flex;
        inset: 0;
        justify-content: center;
        padding: 36px 16px 16px;
        position: fixed;
      }

      .tabcat-frame-shell {
        background: #ffffff;
        border: 1px solid rgba(148, 163, 184, 0.42);
        border-radius: 8px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.32);
        height: min(640px, calc(100vh - 56px));
        max-height: min(640px, calc(100vh - 56px));
        overflow: hidden;
        width: min(760px, calc(100vw - 32px));
      }

      .tabcat-frame {
        border: 0;
        display: block;
        height: 100%;
        width: 100%;
      }

      @media (max-width: 560px) {
        .tabcat-overlay {
          padding-top: 16px;
        }
      }
    </style>
    <div class="tabcat-overlay">
      <div class="tabcat-frame-shell">
        <iframe class="tabcat-frame" title="TabCat tab switcher"></iframe>
      </div>
    </div>
  `;

  const overlay = shadowRoot.querySelector<HTMLDivElement>('.tabcat-overlay');
  const iframe = shadowRoot.querySelector<HTMLIFrameElement>('.tabcat-frame');

  if (!overlay || !iframe) {
    root.remove();
    throw new Error('Missing TabCat overlay frame.');
  }

  const frame = iframe;
  const frameOrigin = new URL(frameUrl).origin;

  overlay.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  root.addEventListener('tabcat:close-switcher-overlay', closeOverlay);
  window.addEventListener('message', handleMessage);
  frame.addEventListener('load', () => {
    frame.focus();
  });
  frame.src = frameUrl;

  function closeOverlay(): void {
    root.removeEventListener('tabcat:close-switcher-overlay', closeOverlay);
    window.removeEventListener('message', handleMessage);
    root.remove();
  }

  function handleMessage(event: MessageEvent): void {
    if (
      event.origin !== frameOrigin ||
      !isOverlayCloseMessage(event.data)
    ) {
      return;
    }

    closeOverlay();
  }

  function isOverlayCloseMessage(
    value: unknown,
  ): value is { token: string; type: 'tabcat:switcher-overlay:close' } {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { source?: unknown }).source === 'tabcat:switcher' &&
      (value as { token?: unknown }).token === closeToken &&
      (value as { type?: unknown }).type === 'tabcat:switcher-overlay:close'
    );
  }
}

function closeTabcatSwitcherOverlay(closeToken: string): void {
  const root = document.getElementById('tabcat-switcher-overlay-root');

  if (!root || root.dataset.tabcatCloseToken !== closeToken) {
    return;
  }

  root.dispatchEvent(new CustomEvent('tabcat:close-switcher-overlay'));
  root.remove();
}
