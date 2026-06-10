import { getDomain } from 'tldts';
import { normalizeHostname } from './tabGrouping';

const NO_GROUP_ID = -1;

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

export interface TabSearchContext {
  paletteWindowId?: number;
  sourceGroupId?: number;
  sourceTabId?: number;
  sourceWindowId?: number;
}

export interface TabSearchItem {
  active: boolean;
  favIconUrl?: string;
  groupColor?: string;
  groupId: number;
  groupTitle?: string;
  hostname: string;
  id: number;
  index: number;
  lastAccessed: number;
  pinned: boolean;
  rootDomain?: string;
  title: string;
  url: string;
  windowId: number;
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

export async function loadTabSearchItems(
  context: TabSearchContext = {},
): Promise<TabSearchItem[]> {
  const [tabs, groups] = await Promise.all([
    browser.tabs.query({}),
    browser.tabGroups.query({}) as Promise<TabSearchGroupLike[]>,
  ]);

  return buildTabSearchItems(tabs, groups, context);
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
      const parsedUrl = parseHttpUrl(url);
      const hostname = parsedUrl
        ? normalizeHostname(parsedUrl.hostname)
        : getDisplayHost(url);
      const rootDomain = parsedUrl
        ? getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
        : undefined;
      const groupId = tab.groupId ?? NO_GROUP_ID;
      const group = groupId !== NO_GROUP_ID ? groupById.get(groupId) : undefined;

      return {
        active: tab.active === true,
        favIconUrl: tab.favIconUrl,
        groupColor: group?.color,
        groupId,
        groupTitle: group?.title || undefined,
        hostname,
        id: tab.id as number,
        index: tab.index ?? 0,
        lastAccessed: tab.lastAccessed ?? 0,
        pinned: tab.pinned === true,
        rootDomain,
        title: tab.title || hostname || url,
        url,
        windowId: tab.windowId as number,
      };
    });
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

export async function activateTabSearchItem(item: TabSearchItem): Promise<void> {
  await browser.tabs.update(item.id, { active: true });
  await browser.windows.update(item.windowId, { focused: true });
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
  let score = 0;

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
    Number(b.active) - Number(a.active) ||
    b.lastAccessed - a.lastAccessed ||
    a.windowId - b.windowId ||
    a.index - b.index ||
    a.id - b.id
  );
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
