import { getDomain } from 'tldts';
import { normalizeHostname } from './tabGrouping';

const HISTORY_SEARCH_LIMIT = 1200;
const NO_GROUP_ID = -1;

export type TabSearchItemSource = 'bookmark' | 'history' | 'tab';

export interface TabSearchTabLike {
  active?: boolean;
  favIconUrl?: string;
  groupId?: number;
  id?: number;
  index?: number;
  lastAccessed?: number;
  pinned?: boolean;
  title?: string;
  url?: string;
  windowId?: number;
}

export interface TabSearchGroupLike {
  color?: string;
  id: number;
  title?: string;
  windowId?: number;
}

export interface TabSearchHistoryLike {
  id?: string;
  lastVisitTime?: number;
  title?: string;
  typedCount?: number;
  url?: string;
  visitCount?: number;
}

export interface TabSearchBookmarkLike {
  children?: TabSearchBookmarkLike[];
  dateAdded?: number;
  id: string;
  title?: string;
  url?: string;
}

export interface TabSearchContext {
  paletteWindowId?: number;
  sourceGroupId?: number;
  sourceTabId?: number;
  sourceWindowId?: number;
}

export interface TabSearchItem {
  active: boolean;
  favIconUrl?: string;
  folderTitle?: string;
  groupColor?: string;
  groupId: number;
  groupTitle?: string;
  hostname: string;
  id?: number;
  index: number;
  key: string;
  lastAccessed: number;
  pinned: boolean;
  rootDomain?: string;
  source: TabSearchItemSource;
  title: string;
  typedCount?: number;
  url: string;
  visitCount?: number;
  windowId?: number;
}

export interface TabSearchResult extends TabSearchItem {
  score: number;
}

export interface TabSearchOptions {
  limit?: number;
  sourceGroupId?: number;
  sourceTabId?: number;
  sourceWindowId?: number;
}

export interface TabSearchActivationOptions {
  sourceWindowId?: number;
}

export async function loadTabSearchItems(
  context: TabSearchContext = {},
): Promise<TabSearchItem[]> {
  const [tabs, groups, historyEntries, bookmarkTree] = await Promise.all([
    browser.tabs.query({}),
    browser.tabGroups.query({}) as Promise<TabSearchGroupLike[]>,
    loadHistoryEntries(),
    loadBookmarkTree(),
  ]);

  const tabItems = buildTabSearchItems(tabs, groups, context);
  const historyByUrl = buildHistoryByUrl(historyEntries);
  const bookmarkItems = buildBookmarkSearchItems(bookmarkTree, historyByUrl);
  const historyItems = buildHistorySearchItems(historyEntries);

  return mergeTabSearchItems(tabItems, bookmarkItems, historyItems);
}

export function buildTabSearchItems(
  tabs: TabSearchTabLike[],
  groups: TabSearchGroupLike[] = [],
  context: TabSearchContext = {},
): TabSearchItem[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const extensionBaseUrl = getExtensionBaseUrl();

  return tabs
    .filter(
      (tab) =>
        tab.id != null &&
        tab.windowId != null &&
        tab.url &&
        tab.windowId !== context.paletteWindowId &&
        !isTabCatUrl(tab.url, extensionBaseUrl),
    )
    .map((tab) => {
      const url = tab.url as string;
      const { hostname, rootDomain, title } = getUrlSearchFields(
        url,
        tab.title,
      );
      const groupId = tab.groupId ?? NO_GROUP_ID;
      const group = groupId !== NO_GROUP_ID ? groupById.get(groupId) : undefined;
      const id = tab.id as number;

      return {
        active: tab.active === true,
        favIconUrl: tab.favIconUrl,
        groupColor: group?.color,
        groupId,
        groupTitle: group?.title || undefined,
        hostname,
        id,
        index: tab.index ?? 0,
        key: `tab:${id}`,
        lastAccessed: tab.lastAccessed ?? 0,
        pinned: tab.pinned === true,
        rootDomain,
        source: 'tab',
        title,
        url,
        windowId: tab.windowId as number,
      };
    });
}

export function buildHistorySearchItems(
  historyEntries: TabSearchHistoryLike[],
): TabSearchItem[] {
  return historyEntries
    .filter((entry) => entry.url && parseHttpUrl(entry.url))
    .map((entry, index) => {
      const url = entry.url as string;
      const { hostname, rootDomain, title } = getUrlSearchFields(
        url,
        entry.title,
      );

      return {
        active: false,
        groupId: NO_GROUP_ID,
        hostname,
        index,
        key: `history:${entry.id || getUrlKey(url)}`,
        lastAccessed: entry.lastVisitTime ?? 0,
        pinned: false,
        rootDomain,
        source: 'history',
        title,
        typedCount: entry.typedCount,
        url,
        visitCount: entry.visitCount,
      };
    });
}

export function buildBookmarkSearchItems(
  bookmarkTree: TabSearchBookmarkLike[],
  historyByUrl: Map<string, TabSearchHistoryLike> = new Map(),
): TabSearchItem[] {
  const items: TabSearchItem[] = [];

  collectBookmarkSearchItems(bookmarkTree, [], historyByUrl, items);

  return items;
}

export function filterTabSearchItems(
  items: TabSearchItem[],
  query: string,
  options: TabSearchOptions = {},
): TabSearchResult[] {
  const tokens = normalizeQuery(query);
  const limit = options.limit ?? 80;
  const results: TabSearchResult[] = [];

  for (const item of items) {
    const score = scoreTabSearchItem(item, tokens, options);

    if (score == null) {
      continue;
    }

    results.push({ ...item, score });
  }

  return results.sort(compareTabSearchResults).slice(0, limit);
}

export async function activateTabSearchItem(
  item: Pick<TabSearchItem, 'id' | 'source' | 'url' | 'windowId'>,
  options: TabSearchActivationOptions = {},
): Promise<void> {
  if (item.source === 'tab') {
    if (item.id == null || item.windowId == null) {
      throw new Error('Cannot activate a tab result without a tab id.');
    }

    await browser.tabs.update(item.id, { active: true });
    await browser.windows.update(item.windowId, { focused: true });
    return;
  }

  const createProperties: {
    active: true;
    url: string;
    windowId?: number;
  } = {
    active: true,
    url: item.url,
  };

  if (options.sourceWindowId != null) {
    createProperties.windowId = options.sourceWindowId;
  }

  const createdTab = await browser.tabs.create(createProperties);
  const windowId = options.sourceWindowId ?? createdTab.windowId;

  if (windowId != null) {
    await browser.windows.update(windowId, { focused: true });
  }
}

export function getTabSearchWindowLabels(
  items: TabSearchItem[],
  sourceWindowId?: number,
): Map<number, string> {
  const windowIds = [
    ...new Set(
      items
        .map((item) => item.windowId)
        .filter((windowId): windowId is number => windowId != null),
    ),
  ].sort((a, b) => {
    if (a === sourceWindowId) return -1;
    if (b === sourceWindowId) return 1;
    return a - b;
  });

  return new Map(
    windowIds.map((windowId, index) => [
      windowId,
      windowId === sourceWindowId ? 'Current window' : `Window ${index + 1}`,
    ]),
  );
}

function collectBookmarkSearchItems(
  nodes: TabSearchBookmarkLike[],
  folderPath: string[],
  historyByUrl: Map<string, TabSearchHistoryLike>,
  items: TabSearchItem[],
): void {
  for (const node of nodes) {
    if (node.url) {
      if (!parseHttpUrl(node.url)) {
        continue;
      }

      const { hostname, rootDomain, title } = getUrlSearchFields(
        node.url,
        node.title,
      );
      const historyEntry = historyByUrl.get(getUrlKey(node.url));

      items.push({
        active: false,
        folderTitle: folderPath.join(' / ') || undefined,
        groupId: NO_GROUP_ID,
        hostname,
        index: items.length,
        key: `bookmark:${node.id}`,
        lastAccessed: historyEntry?.lastVisitTime ?? node.dateAdded ?? 0,
        pinned: false,
        rootDomain,
        source: 'bookmark',
        title,
        typedCount: historyEntry?.typedCount,
        url: node.url,
        visitCount: historyEntry?.visitCount,
      });

      continue;
    }

    const nextFolderPath = node.title
      ? [...folderPath, node.title]
      : folderPath;

    if (node.children) {
      collectBookmarkSearchItems(
        node.children,
        nextFolderPath,
        historyByUrl,
        items,
      );
    }
  }
}

function mergeTabSearchItems(
  tabItems: TabSearchItem[],
  bookmarkItems: TabSearchItem[],
  historyItems: TabSearchItem[],
): TabSearchItem[] {
  const openUrlKeys = new Set(tabItems.map((item) => getUrlKey(item.url)));
  const bookmarkUrlKeys = new Set<string>();
  const mergedItems = [...tabItems];

  for (const item of bookmarkItems) {
    const urlKey = getUrlKey(item.url);

    if (openUrlKeys.has(urlKey) || bookmarkUrlKeys.has(urlKey)) {
      continue;
    }

    bookmarkUrlKeys.add(urlKey);
    mergedItems.push(item);
  }

  const historyUrlKeys = new Set<string>();

  for (const item of historyItems) {
    const urlKey = getUrlKey(item.url);

    if (
      openUrlKeys.has(urlKey) ||
      bookmarkUrlKeys.has(urlKey) ||
      historyUrlKeys.has(urlKey)
    ) {
      continue;
    }

    historyUrlKeys.add(urlKey);
    mergedItems.push(item);
  }

  return mergedItems;
}

function scoreTabSearchItem(
  item: TabSearchItem,
  tokens: string[],
  options: TabSearchOptions,
): number | null {
  let score = getContextScore(item, options);

  if (tokens.length === 0) {
    return score + getRecencyScore(item);
  }

  for (const token of tokens) {
    const tokenScore = scoreToken(item, token);

    if (tokenScore == null) {
      return null;
    }

    score += tokenScore;
  }

  return score + getRecencyScore(item);
}

function scoreToken(item: TabSearchItem, token: string): number | null {
  const fields = [
    { value: item.title, starts: 120, includes: 80, fuzzy: 20 },
    { value: item.hostname, starts: 100, includes: 70, fuzzy: 15 },
    { value: item.rootDomain ?? '', starts: 95, includes: 65, fuzzy: 15 },
    { value: item.groupTitle ?? '', starts: 90, includes: 60, fuzzy: 15 },
    { value: item.folderTitle ?? '', starts: 76, includes: 52, fuzzy: 12 },
    { value: getSourceLabel(item.source), starts: 70, includes: 45, fuzzy: 10 },
    { value: item.url, starts: 55, includes: 35, fuzzy: 8 },
  ];

  let bestScore: number | null = null;

  for (const field of fields) {
    const value = normalizeText(field.value);

    if (!value) {
      continue;
    }

    let fieldScore: number | null = null;

    if (value.startsWith(token)) {
      fieldScore = field.starts;
    } else if (value.includes(token)) {
      fieldScore = field.includes;
    } else if (isSubsequence(token, value)) {
      fieldScore = field.fuzzy;
    }

    if (fieldScore != null) {
      bestScore = Math.max(bestScore ?? 0, fieldScore);
    }
  }

  return bestScore;
}

function getContextScore(
  item: TabSearchItem,
  options: TabSearchOptions,
): number {
  let score = getSourceScore(item.source);

  if (item.windowId === options.sourceWindowId) {
    score += 35;
  }

  if (item.id === options.sourceTabId) {
    score += 30;
  }

  if (
    item.groupId !== NO_GROUP_ID &&
    options.sourceGroupId != null &&
    item.groupId === options.sourceGroupId
  ) {
    score += 25;
  }

  if (item.active) {
    score += 12;
  }

  if (item.pinned) {
    score += 6;
  }

  return score;
}

function getSourceScore(source: TabSearchItemSource): number {
  switch (source) {
    case 'tab':
      return 45;
    case 'bookmark':
      return 12;
    case 'history':
      return 0;
  }
}

function getRecencyScore(item: TabSearchItem): number {
  if (!item.lastAccessed) {
    return 0;
  }

  return Math.min(10, Math.max(0, item.lastAccessed / 1_000_000_000_000));
}

function compareTabSearchResults(
  a: TabSearchResult,
  b: TabSearchResult,
): number {
  return (
    b.score - a.score ||
    getSourceRank(b.source) - getSourceRank(a.source) ||
    Number(b.active) - Number(a.active) ||
    b.lastAccessed - a.lastAccessed ||
    getComparableWindowId(a) - getComparableWindowId(b) ||
    a.index - b.index ||
    a.key.localeCompare(b.key)
  );
}

function getSourceRank(source: TabSearchItemSource): number {
  switch (source) {
    case 'tab':
      return 3;
    case 'bookmark':
      return 2;
    case 'history':
      return 1;
  }
}

function getComparableWindowId(item: TabSearchItem): number {
  return item.windowId ?? Number.MAX_SAFE_INTEGER;
}

function normalizeQuery(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let haystackIndex = 0;

  for (const character of needle) {
    haystackIndex = haystack.indexOf(character, haystackIndex);

    if (haystackIndex === -1) {
      return false;
    }

    haystackIndex += 1;
  }

  return true;
}

function getUrlSearchFields(
  url: string,
  fallbackTitle?: string,
): {
  hostname: string;
  rootDomain?: string;
  title: string;
} {
  const parsedUrl = parseHttpUrl(url);
  const hostname = parsedUrl
    ? normalizeHostname(parsedUrl.hostname)
    : getDisplayHost(url);
  const rootDomain = parsedUrl
    ? getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
    : undefined;

  return {
    hostname,
    rootDomain,
    title: fallbackTitle || hostname || url,
  };
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl;
  } catch {
    return null;
  }
}

function getDisplayHost(url: string): string {
  try {
    const parsedUrl = new URL(url);

    return normalizeHostname(parsedUrl.hostname || parsedUrl.protocol);
  } catch {
    return '';
  }
}

function getUrlKey(url: string): string {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.hash = '';

    return parsedUrl.href;
  } catch {
    return url.trim().toLowerCase();
  }
}

function buildHistoryByUrl(
  historyEntries: TabSearchHistoryLike[],
): Map<string, TabSearchHistoryLike> {
  const historyByUrl = new Map<string, TabSearchHistoryLike>();

  for (const entry of historyEntries) {
    if (!entry.url || !parseHttpUrl(entry.url)) {
      continue;
    }

    const urlKey = getUrlKey(entry.url);
    const existingEntry = historyByUrl.get(urlKey);

    if (
      !existingEntry ||
      (entry.lastVisitTime ?? 0) > (existingEntry.lastVisitTime ?? 0)
    ) {
      historyByUrl.set(urlKey, entry);
    }
  }

  return historyByUrl;
}

function getSourceLabel(source: TabSearchItemSource): string {
  switch (source) {
    case 'tab':
      return 'Tab';
    case 'bookmark':
      return 'Bookmark';
    case 'history':
      return 'History';
  }
}

async function loadHistoryEntries(): Promise<TabSearchHistoryLike[]> {
  const historyApi = browser.history as
    | {
        search(query: {
          maxResults?: number;
          startTime?: number;
          text: string;
        }): Promise<TabSearchHistoryLike[]>;
      }
    | undefined;

  if (!historyApi?.search) {
    return [];
  }

  try {
    return await historyApi.search({
      maxResults: HISTORY_SEARCH_LIMIT,
      startTime: 0,
      text: '',
    });
  } catch {
    return [];
  }
}

async function loadBookmarkTree(): Promise<TabSearchBookmarkLike[]> {
  const bookmarksApi = browser.bookmarks as
    | {
        getTree(): Promise<TabSearchBookmarkLike[]>;
      }
    | undefined;

  if (!bookmarksApi?.getTree) {
    return [];
  }

  try {
    return await bookmarksApi.getTree();
  } catch {
    return [];
  }
}

function getExtensionBaseUrl(): string | null {
  if (typeof browser === 'undefined') {
    return null;
  }

  try {
    return browser.runtime.getURL('/');
  } catch {
    return null;
  }
}

function isTabCatUrl(url: string, extensionBaseUrl: string | null): boolean {
  return Boolean(extensionBaseUrl && url.startsWith(extensionBaseUrl));
}
