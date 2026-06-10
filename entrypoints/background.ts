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
  activateTabSearchItem,
  filterTabSearchItems,
  getTabSearchWindowLabels,
  loadTabSearchItems,
  type TabSearchContext,
  type TabSearchItem,
  type TabSearchResult,
} from '@/utils/tabSearch';

const OPEN_TAB_SWITCHER_COMMAND = 'open-tab-switcher';
const TIDY_TABS_COMMAND = 'tidy-tabs';
const TAB_SWITCHER_PATH = '/tab-switcher.html';
const TAB_SWITCHER_HEIGHT = 560;
const TAB_SWITCHER_RESULT_LIMIT = 80;
const TAB_SWITCHER_WIDTH = 760;
const TAB_SWITCHER_SEARCH_MESSAGE = 'tabcat:switcher:search';
const TAB_SWITCHER_ACTIVATE_MESSAGE = 'tabcat:switcher:activate';

interface BackgroundTab {
  groupId?: number;
  id?: number;
  url?: string;
  windowId?: number;
}

interface TabSwitcherSearchMessage {
  context?: unknown;
  query?: unknown;
  type: typeof TAB_SWITCHER_SEARCH_MESSAGE;
}

interface TabSwitcherActivateMessage {
  item?: unknown;
  type: typeof TAB_SWITCHER_ACTIVATE_MESSAGE;
}

type TabSwitcherMessage =
  | TabSwitcherActivateMessage
  | TabSwitcherSearchMessage;

type TabSearchOverlayResult = TabSearchResult & {
  windowLabel: string;
};

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
    if (!isTabSwitcherMessage(message)) {
      if (isTabGroupingActionMessage(message)) {
        return handleTabGroupingAction(message);
      }

      return undefined;
    }

    if (message.type === TAB_SWITCHER_SEARCH_MESSAGE) {
      return handleTabSwitcherSearch(message);
    }

    return handleTabSwitcherActivation(message);
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

  await browser.scripting.executeScript({
    args: [createTabSearchContext(sourceTab)],
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

async function handleTabSwitcherSearch(
  message: TabSwitcherSearchMessage,
): Promise<{ results: TabSearchOverlayResult[] }> {
  const context = normalizeTabSearchContext(message.context);
  const query = typeof message.query === 'string' ? message.query : '';
  const items = await loadTabSearchItems(context);
  const windowLabels = getTabSearchWindowLabels(items, context.sourceWindowId);
  const results = filterTabSearchItems(items, query, {
    limit: TAB_SWITCHER_RESULT_LIMIT,
    sourceGroupId: context.sourceGroupId,
    sourceTabId: context.sourceTabId,
    sourceWindowId: context.sourceWindowId,
  }).map((item) => ({
    ...item,
    windowLabel: windowLabels.get(item.windowId) ?? `Window ${item.windowId}`,
  }));

  return { results };
}

async function handleTabSwitcherActivation(
  message: TabSwitcherActivateMessage,
): Promise<{ ok: true }> {
  const item = parseActivatableTabSearchItem(message.item);

  if (!item) {
    throw new Error('Invalid tab search item.');
  }

  await activateTabSearchItem(item);

  return { ok: true };
}

function buildTabSwitcherUrl(sourceTab?: BackgroundTab): string {
  const url = new URL(getRuntimeUrl(TAB_SWITCHER_PATH));
  const context = createTabSearchContext(sourceTab);

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

function isTabSwitcherMessage(message: unknown): message is TabSwitcherMessage {
  return (
    isRecord(message) &&
    (message.type === TAB_SWITCHER_SEARCH_MESSAGE ||
      message.type === TAB_SWITCHER_ACTIVATE_MESSAGE)
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

function normalizeTabSearchContext(value: unknown): TabSearchContext {
  if (!isRecord(value)) {
    return {};
  }

  return {
    sourceGroupId: parseFiniteNumber(value.sourceGroupId),
    sourceTabId: parseFiniteNumber(value.sourceTabId),
    sourceWindowId: parseFiniteNumber(value.sourceWindowId),
  };
}

function parseActivatableTabSearchItem(
  value: unknown,
): Pick<TabSearchItem, 'id' | 'windowId'> | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parseFiniteNumber(value.id);
  const windowId = parseFiniteNumber(value.windowId);

  if (id == null || windowId == null) {
    return null;
  }

  return { id, windowId };
}

function parseFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function showTabcatSwitcherOverlay(context: TabSearchContext): void {
  type OverlayResult = {
    active?: boolean;
    favIconUrl?: string;
    groupColor?: string;
    groupTitle?: string;
    hostname?: string;
    id: number;
    title?: string;
    url?: string;
    windowId: number;
    windowLabel?: string;
  };
  type InputMode = 'keyboard' | 'pointer';

  const rootId = 'tabcat-switcher-overlay-root';
  const existingRoot = document.getElementById(rootId);

  if (existingRoot?.shadowRoot) {
    const existingInput =
      existingRoot.shadowRoot.querySelector<HTMLInputElement>(
        '.tabcat-search-input',
      );
    existingInput?.focus();
    existingInput?.select();
    return;
  }

  existingRoot?.remove();

  const root = document.createElement('div');
  root.id = rootId;
  document.documentElement.append(root);

  const shadowRoot = root.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
        display: block;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

      .tabcat-panel {
        background: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.42);
        border-radius: 8px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.32);
        max-height: min(640px, calc(100vh - 56px));
        overflow: hidden;
        width: min(760px, calc(100vw - 32px));
      }

      .tabcat-search-bar {
        align-items: center;
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
        display: grid;
        gap: 12px;
        grid-template-columns: 36px minmax(0, 1fr);
        padding: 14px;
      }

      .tabcat-mark {
        align-items: center;
        background: #0f172a;
        border-radius: 8px;
        color: #ffffff;
        display: inline-flex;
        font-size: 16px;
        font-weight: 800;
        height: 36px;
        justify-content: center;
        line-height: 1;
        width: 36px;
      }

      .tabcat-search-input {
        appearance: none;
        background: transparent;
        border: 0;
        color: #0f172a;
        font: inherit;
        font-size: 20px;
        line-height: 28px;
        min-width: 0;
        outline: none;
        width: 100%;
      }

      .tabcat-search-input::placeholder {
        color: #94a3b8;
      }

      .tabcat-status {
        color: #64748b;
        font-size: 14px;
        line-height: 20px;
        padding: 20px;
      }

      .tabcat-status[hidden] {
        display: none;
      }

      .tabcat-status-error {
        color: #b42318;
      }

      .tabcat-results {
        display: grid;
        gap: 4px;
        max-height: calc(min(640px, calc(100vh - 56px)) - 65px);
        overflow-y: auto;
        padding: 8px;
      }

      .tabcat-result {
        align-items: center;
        appearance: none;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: #0f172a;
        cursor: pointer;
        display: grid;
        gap: 12px;
        grid-template-columns: 32px minmax(0, 1fr);
        min-height: 60px;
        padding: 10px;
        text-align: left;
        width: 100%;
      }

      .tabcat-result[aria-selected="true"] {
        background: #e0f2fe;
        border-color: #7dd3fc;
      }

      .tabcat-panel[data-input-mode="pointer"] .tabcat-result:hover:not([aria-selected="true"]) {
        background: #f8fafc;
        border-color: #dbeafe;
      }

      .tabcat-favicon {
        align-items: center;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        color: #475569;
        display: inline-flex;
        font-size: 14px;
        font-weight: 800;
        height: 32px;
        justify-content: center;
        overflow: hidden;
        width: 32px;
      }

      .tabcat-favicon img {
        display: block;
        height: 20px;
        object-fit: contain;
        width: 20px;
      }

      .tabcat-copy {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .tabcat-title {
        color: #0f172a;
        font-size: 15px;
        font-weight: 650;
        line-height: 20px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tabcat-meta {
        align-items: center;
        color: #64748b;
        display: flex;
        flex-wrap: nowrap;
        font-size: 12px;
        gap: 7px;
        line-height: 16px;
        min-width: 0;
        overflow: hidden;
      }

      .tabcat-meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tabcat-group {
        align-items: center;
        display: inline-flex;
        gap: 5px;
      }

      .tabcat-group-dot {
        border-radius: 999px;
        display: inline-block;
        flex: 0 0 auto;
        height: 8px;
        width: 8px;
      }

      @media (max-width: 560px) {
        .tabcat-overlay {
          padding-top: 16px;
        }

        .tabcat-search-bar {
          grid-template-columns: 32px minmax(0, 1fr);
          padding: 12px;
        }

        .tabcat-mark,
        .tabcat-favicon {
          border-radius: 8px;
          height: 32px;
          width: 32px;
        }

        .tabcat-search-input {
          font-size: 17px;
          line-height: 24px;
        }

        .tabcat-title {
          font-size: 14px;
        }
      }
    </style>
    <div class="tabcat-overlay">
      <section aria-label="Search tabs" aria-modal="true" class="tabcat-panel" data-input-mode="keyboard" role="dialog">
        <div class="tabcat-search-bar">
          <span aria-hidden="true" class="tabcat-mark">T</span>
          <input aria-label="Search tabs" autocomplete="off" class="tabcat-search-input" placeholder="Search tabs" spellcheck="false" type="search" />
        </div>
        <div class="tabcat-status" hidden></div>
        <div aria-label="Open tabs" class="tabcat-results" role="listbox"></div>
      </section>
    </div>
  `;

  const overlay = getRequiredElement<HTMLDivElement>(
    shadowRoot,
    '.tabcat-overlay',
  );
  const panel = getRequiredElement<HTMLElement>(
    shadowRoot,
    '.tabcat-panel',
  );
  const input = getRequiredElement<HTMLInputElement>(
    shadowRoot,
    '.tabcat-search-input',
  );
  const resultsNode = getRequiredElement<HTMLDivElement>(
    shadowRoot,
    '.tabcat-results',
  );
  const statusNode = getRequiredElement<HTMLDivElement>(
    shadowRoot,
    '.tabcat-status',
  );

  let isActivating = false;
  let query = '';
  let requestSequence = 0;
  let results: OverlayResult[] = [];
  let selectedIndex = 0;

  overlay.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  input.addEventListener('input', () => {
    query = input.value;
    selectedIndex = 0;
    setInputMode('keyboard');
    void search(query);
  });

  shadowRoot.addEventListener('keydown', (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;

    if (keyboardEvent.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
      return;
    }

    if (keyboardEvent.key === 'ArrowDown') {
      event.preventDefault();
      setInputMode('keyboard');
      moveSelection(1);
      return;
    }

    if (keyboardEvent.key === 'ArrowUp') {
      event.preventDefault();
      setInputMode('keyboard');
      moveSelection(-1);
      return;
    }

    if (keyboardEvent.key === 'Enter') {
      event.preventDefault();
      void activate(results[selectedIndex]);
    }
  });

  showStatus('Loading tabs...');
  void search(query);
  window.setTimeout(() => {
    input.focus();
  }, 0);

  async function search(nextQuery: string): Promise<void> {
    const sequence = ++requestSequence;

    try {
      const response = (await sendMessage({
        context,
        query: nextQuery,
        type: 'tabcat:switcher:search',
      })) as { results?: OverlayResult[] };

      if (sequence !== requestSequence) {
        return;
      }

      results = Array.isArray(response?.results) ? response.results : [];
      selectedIndex =
        results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);
      renderResults();
    } catch {
      if (sequence !== requestSequence) {
        return;
      }

      results = [];
      renderResults('Could not load tabs.', 'error');
    }
  }

  function renderResults(
    status?: string,
    tone: 'error' | 'neutral' = 'neutral',
  ): void {
    resultsNode.textContent = '';

    if (status) {
      showStatus(status, tone);
      return;
    }

    if (results.length === 0) {
      showStatus(query ? 'No matching tabs' : 'No tabs found');
      return;
    }

    hideStatus();

    for (const [index, item] of results.entries()) {
      resultsNode.append(createResultButton(item, index));
    }

    updateSelection();
  }

  function createResultButton(
    item: OverlayResult,
    index: number,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'tabcat-result';
    button.setAttribute('aria-selected', String(index === selectedIndex));
    button.setAttribute('role', 'option');
    button.type = 'button';

    const favicon = document.createElement('span');
    favicon.className = 'tabcat-favicon';
    const fallback = document.createElement('span');
    fallback.textContent = getFallbackIcon(item);

    if (item.favIconUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = item.favIconUrl;
      fallback.hidden = true;
      image.addEventListener('error', () => {
        image.remove();
        fallback.hidden = false;
      });
      favicon.append(image);
    }

    favicon.append(fallback);

    const copy = document.createElement('span');
    copy.className = 'tabcat-copy';

    const title = document.createElement('span');
    title.className = 'tabcat-title';
    title.textContent = item.title || item.hostname || item.url || 'Untitled';

    const meta = document.createElement('span');
    meta.className = 'tabcat-meta';
    appendMetaText(meta, item.hostname || item.url || '');

    if (item.groupTitle) {
      appendMetaSeparator(meta);
      const group = document.createElement('span');
      group.className = 'tabcat-group';

      const dot = document.createElement('span');
      dot.className = 'tabcat-group-dot';
      dot.style.background = getGroupColor(item.groupColor);

      const label = document.createElement('span');
      label.textContent = item.groupTitle;

      group.append(dot, label);
      meta.append(group);
    }

    appendMetaSeparator(meta);
    appendMetaText(meta, item.windowLabel || `Window ${item.windowId}`);

    if (item.active) {
      appendMetaSeparator(meta);
      appendMetaText(meta, 'Current');
    }

    copy.append(title, meta);
    button.append(favicon, copy);

    button.addEventListener('pointermove', () => {
      setInputMode('pointer');
      selectedIndex = index;
      updateSelection();
    });
    button.addEventListener('click', () => {
      void activate(item);
    });

    return button;
  }

  function appendMetaText(node: HTMLElement, value: string): void {
    const span = document.createElement('span');
    span.textContent = value;
    node.append(span);
  }

  function appendMetaSeparator(node: HTMLElement): void {
    const separator = document.createElement('span');
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '/';
    node.append(separator);
  }

  function moveSelection(delta: number): void {
    if (results.length === 0) {
      selectedIndex = 0;
      return;
    }

    selectedIndex = (selectedIndex + delta + results.length) % results.length;
    updateSelection();
  }

  function setInputMode(mode: InputMode): void {
    panel.dataset.inputMode = mode;
  }

  function updateSelection(): void {
    const buttons =
      resultsNode.querySelectorAll<HTMLButtonElement>('.tabcat-result');

    buttons.forEach((button, index) => {
      const isSelected = index === selectedIndex;
      button.setAttribute('aria-selected', String(isSelected));

      if (isSelected) {
        button.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  async function activate(item: OverlayResult | undefined): Promise<void> {
    if (!item || isActivating) {
      return;
    }

    isActivating = true;

    try {
      await sendMessage({
        item,
        type: 'tabcat:switcher:activate',
      });
      closeOverlay();
    } catch {
      isActivating = false;
      renderResults('Could not switch to this tab.', 'error');
    }
  }

  function showStatus(
    message: string,
    tone: 'error' | 'neutral' = 'neutral',
  ): void {
    statusNode.className =
      tone === 'error'
        ? 'tabcat-status tabcat-status-error'
        : 'tabcat-status';
    statusNode.hidden = false;
    statusNode.textContent = message;
  }

  function hideStatus(): void {
    statusNode.hidden = true;
    statusNode.textContent = '';
  }

  function closeOverlay(): void {
    root.remove();
  }

  function sendMessage(message: Record<string, unknown>): Promise<unknown> {
    const runtime = getChromeRuntime();

    return new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response: unknown) => {
        const error = runtime.lastError;

        if (error) {
          reject(new Error(error.message ?? 'Extension runtime error.'));
          return;
        }

        resolve(response);
      });
    });
  }

  function getChromeRuntime(): {
    lastError?: { message?: string };
    sendMessage: (
      message: Record<string, unknown>,
      callback: (response: unknown) => void,
    ) => void;
  } {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: {
            lastError?: { message?: string };
            sendMessage?: (
              message: Record<string, unknown>,
              callback: (response: unknown) => void,
            ) => void;
          };
        };
      }
    ).chrome?.runtime;

    if (!runtime?.sendMessage) {
      throw new Error('Extension runtime is not available.');
    }

    return {
      get lastError() {
        return runtime.lastError;
      },
      sendMessage: runtime.sendMessage.bind(runtime),
    };
  }

  function getFallbackIcon(item: OverlayResult): string {
    return (item.hostname || item.title || '?').slice(0, 1).toUpperCase();
  }

  function getGroupColor(color?: string): string {
    const colors: Record<string, string> = {
      blue: '#1a73e8',
      cyan: '#0891b2',
      green: '#188038',
      grey: '#5f6368',
      orange: '#fa7b17',
      pink: '#d01884',
      purple: '#9334e6',
      red: '#d93025',
      yellow: '#f9ab00',
    };

    return colors[color ?? ''] ?? '#64748b';
  }

  function getRequiredElement<T extends HTMLElement>(
    rootNode: ShadowRoot,
    selector: string,
  ): T {
    const element = rootNode.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Missing TabCat overlay element: ${selector}`);
    }

    return element;
  }
}
