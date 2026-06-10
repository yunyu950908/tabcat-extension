import { getDomain } from 'tldts';
import { getSettings, type GroupingMode, type GroupingScope } from './settings';

const DEFAULT_MIN_GROUP_SIZE = 2;
const LAST_GROUPING_OPERATION_KEY = 'tabcat:lastGroupingOperation';
const NO_GROUP_ID = -1;
type TabGroupColor =
  | 'blue'
  | 'cyan'
  | 'grey'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'yellow';
type NonEmptyArray<T> = [T, ...T[]];

const GROUP_COLORS: TabGroupColor[] = [
  'blue',
  'cyan',
  'grey',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
];

export interface TabLike {
  active?: boolean;
  groupId?: number;
  id?: number;
  pinned?: boolean;
  title?: string;
  url?: string;
  windowId?: number;
}

export type SkipReason =
  | 'already-grouped'
  | 'ignored-domain'
  | 'internal-url'
  | 'invalid-url'
  | 'missing-id'
  | 'pinned'
  | 'singleton';

export interface GroupingOptions {
  collapseNewGroups?: boolean;
  groupingMode?: GroupingMode;
  ignoredDomains?: string[];
  includePinnedTabs?: boolean;
  minGroupSize?: number;
  scope?: GroupingScope;
}

export interface PlannedTab {
  id: number;
  title?: string;
  url: string;
  windowId?: number;
}

export interface PlannedGroup {
  color: TabGroupColor;
  key: string;
  tabIds: number[];
  tabs: PlannedTab[];
  title: string;
}

export interface SkippedTab {
  id?: number;
  key?: string;
  reason: SkipReason;
  title?: string;
  url?: string;
}

export interface GroupingPlan {
  groups: PlannedGroup[];
  skipped: SkippedTab[];
  summary: GroupingSummary;
}

export interface GroupingSummary {
  eligibleTabCount: number;
  groupCount: number;
  groupedTabCount: number;
  skippedTabCount: number;
}

export interface AppliedGroup {
  color: TabGroupColor;
  key: string;
  tabGroupId: number;
  tabIds: number[];
  title: string;
}

export interface ApplyGroupingResult {
  appliedGroups: AppliedGroup[];
  plan: GroupingPlan;
}

export interface LastGroupingOperation {
  appliedGroups: AppliedGroup[];
  createdAt: number;
  version: 1;
}

export interface UndoGroupingResult {
  hadOperation: boolean;
  skippedTabCount: number;
  undoneTabCount: number;
}

export function buildHostnameGroupingPlan(
  tabs: TabLike[],
  options: GroupingOptions = {},
): GroupingPlan {
  return buildGroupingPlan(tabs, { ...options, groupingMode: 'hostname' });
}

export function buildGroupingPlan(
  tabs: TabLike[],
  options: GroupingOptions = {},
): GroupingPlan {
  const minGroupSize = Math.max(2, options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE);
  const skipped: SkippedTab[] = [];
  const candidates = new Map<string, PlannedTab[]>();

  for (const tab of tabs) {
    const candidate = getEligibleTab(tab, options);

    if (!candidate.ok) {
      skipped.push(candidate.skipped);
      continue;
    }

    const groupTabs = candidates.get(candidate.key) ?? [];
    groupTabs.push(candidate.tab);
    candidates.set(candidate.key, groupTabs);
  }

  const groups: PlannedGroup[] = [];
  let eligibleTabCount = 0;

  for (const [key, groupTabs] of [...candidates.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    eligibleTabCount += groupTabs.length;

    if (groupTabs.length < minGroupSize) {
      for (const tab of groupTabs) {
        skipped.push({
          id: tab.id,
          key,
          reason: 'singleton',
          title: tab.title,
          url: tab.url,
        });
      }
      continue;
    }

    groups.push({
      color: colorForGroupingKey(key),
      key,
      tabIds: groupTabs.map((tab) => tab.id),
      tabs: groupTabs,
      title: key,
    });
  }

  const groupedTabCount = groups.reduce(
    (sum, group) => sum + group.tabIds.length,
    0,
  );

  return {
    groups,
    skipped,
    summary: {
      eligibleTabCount,
      groupCount: groups.length,
      groupedTabCount,
      skippedTabCount: skipped.length,
    },
  };
}

export async function groupCurrentWindowTabsByHostname(
  options: GroupingOptions = {},
): Promise<ApplyGroupingResult> {
  return groupCurrentWindowTabs({ ...options, groupingMode: 'hostname' });
}

export async function groupCurrentWindowTabs(
  options: GroupingOptions = {},
): Promise<ApplyGroupingResult> {
  const settings = await getSettings();
  const resolvedOptions: GroupingOptions = {
    collapseNewGroups: settings.collapseNewGroups,
    groupingMode: settings.groupingMode,
    ignoredDomains: settings.ignoredDomains,
    includePinnedTabs: settings.includePinnedTabs,
    minGroupSize: settings.minGroupSize,
    scope: settings.scope,
    ...options,
  };
  const tabs = await browser.tabs.query(
    resolvedOptions.scope === 'allWindows' ? {} : { currentWindow: true },
  );
  const plan = buildGroupingPlan(tabs, resolvedOptions);
  const appliedGroups: AppliedGroup[] = [];

  for (const group of plan.groups) {
    const tabIds = toNonEmptyArray(group.tabIds);
    const tabGroupId = await (browser.tabs.group({ tabIds }) as Promise<number>);
    await browser.tabGroups.update(tabGroupId, {
      collapsed: resolvedOptions.collapseNewGroups,
      color: group.color,
      title: group.title,
    });

    appliedGroups.push({
      color: group.color,
      key: group.key,
      tabGroupId,
      tabIds: group.tabIds,
      title: group.title,
    });
  }

  await saveLastGroupingOperation(appliedGroups);

  return { appliedGroups, plan };
}

export async function getLastGroupingOperation(): Promise<LastGroupingOperation | null> {
  const stored = await browser.storage.session.get(LAST_GROUPING_OPERATION_KEY);
  const operation = stored[LAST_GROUPING_OPERATION_KEY];

  if (!isLastGroupingOperation(operation)) {
    return null;
  }

  return operation;
}

export async function undoLastGroupingOperation(): Promise<UndoGroupingResult> {
  const operation = await getLastGroupingOperation();

  if (!operation) {
    return {
      hadOperation: false,
      skippedTabCount: 0,
      undoneTabCount: 0,
    };
  }

  const affectedTabIds = new Set(
    operation.appliedGroups.flatMap((group) => group.tabIds),
  );
  const createdGroupIds = new Set(
    operation.appliedGroups.map((group) => group.tabGroupId),
  );
  const tabs = await browser.tabs.query({});
  const undoableTabIds = tabs
    .filter(
      (tab) =>
        tab.id != null &&
        affectedTabIds.has(tab.id) &&
        createdGroupIds.has(tab.groupId),
    )
    .map((tab) => tab.id as number);

  if (undoableTabIds.length > 0) {
    await browser.tabs.ungroup(toNonEmptyArray(undoableTabIds));
  }

  await clearLastGroupingOperation();

  return {
    hadOperation: true,
    skippedTabCount: affectedTabIds.size - undoableTabIds.length,
    undoneTabCount: undoableTabIds.length,
  };
}

export function getHostnameGroupingKey(url: string): string | null {
  return getGroupingKey(url, 'hostname')?.key ?? null;
}

export function getRootDomainGroupingKey(url: string): string | null {
  return getGroupingKey(url, 'rootDomain')?.key ?? null;
}

export function getGroupingKey(
  url: string,
  groupingMode: GroupingMode,
): { hostname: string; key: string; rootDomain: string | null } | null {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    const rootDomain = getDomain(hostname, { allowPrivateDomains: true });

    return {
      hostname,
      key: groupingMode === 'rootDomain' ? rootDomain ?? hostname : hostname,
      rootDomain,
    };
  } catch {
    return null;
  }
}

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function colorForGroupingKey(key: string): TabGroupColor {
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

function toNonEmptyArray<T>(items: T[]): NonEmptyArray<T> {
  if (items.length === 0) {
    throw new Error('Expected at least one item.');
  }

  return items as NonEmptyArray<T>;
}

async function saveLastGroupingOperation(
  appliedGroups: AppliedGroup[],
): Promise<void> {
  if (appliedGroups.length === 0) {
    await clearLastGroupingOperation();
    return;
  }

  const operation: LastGroupingOperation = {
    appliedGroups,
    createdAt: Date.now(),
    version: 1,
  };

  await browser.storage.session.set({
    [LAST_GROUPING_OPERATION_KEY]: operation,
  });
}

async function clearLastGroupingOperation(): Promise<void> {
  await browser.storage.session.remove(LAST_GROUPING_OPERATION_KEY);
}

function isLastGroupingOperation(
  value: unknown,
): value is LastGroupingOperation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const operation = value as Partial<LastGroupingOperation>;

  return (
    operation.version === 1 &&
    typeof operation.createdAt === 'number' &&
    Array.isArray(operation.appliedGroups) &&
    operation.appliedGroups.every(isAppliedGroup)
  );
}

function isAppliedGroup(value: unknown): value is AppliedGroup {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const group = value as Partial<AppliedGroup>;

  return (
    typeof group.key === 'string' &&
    typeof group.tabGroupId === 'number' &&
    Array.isArray(group.tabIds) &&
    group.tabIds.every((tabId) => typeof tabId === 'number') &&
    typeof group.title === 'string' &&
    typeof group.color === 'string' &&
    (GROUP_COLORS as string[]).includes(group.color)
  );
}

function getEligibleTab(
  tab: TabLike,
  options: GroupingOptions,
):
  | { key: string; ok: true; tab: PlannedTab }
  | { ok: false; skipped: SkippedTab } {
  if (tab.id == null) {
    return {
      ok: false,
      skipped: {
        reason: 'missing-id',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  if (!options.includePinnedTabs && tab.pinned) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        reason: 'pinned',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  if (tab.groupId !== undefined && tab.groupId !== NO_GROUP_ID) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        reason: 'already-grouped',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  if (!tab.url) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        reason: 'invalid-url',
        title: tab.title,
      },
    };
  }

  const groupingKey = getGroupingKey(tab.url, options.groupingMode ?? 'hostname');

  if (!groupingKey) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        reason: tab.url.includes(':') ? 'internal-url' : 'invalid-url',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  if (isIgnoredDomain(groupingKey, options.ignoredDomains ?? [])) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        key: groupingKey.key,
        reason: 'ignored-domain',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  return {
    key: groupingKey.key,
    ok: true,
    tab: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
    },
  };
}

function isIgnoredDomain(
  groupingKey: { hostname: string; key: string; rootDomain: string | null },
  ignoredDomains: string[],
): boolean {
  const ignored = new Set(ignoredDomains.map(normalizeHostname));

  return (
    ignored.has(groupingKey.key) ||
    ignored.has(groupingKey.hostname) ||
    (groupingKey.rootDomain != null && ignored.has(groupingKey.rootDomain))
  );
}
