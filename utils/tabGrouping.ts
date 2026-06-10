const DEFAULT_MIN_GROUP_SIZE = 2;
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
  | 'internal-url'
  | 'invalid-url'
  | 'missing-id'
  | 'pinned'
  | 'singleton';

export interface GroupingOptions {
  includePinnedTabs?: boolean;
  minGroupSize?: number;
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

export function buildHostnameGroupingPlan(
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
  const tabs = await browser.tabs.query({ currentWindow: true });
  const plan = buildHostnameGroupingPlan(tabs, options);
  const appliedGroups: AppliedGroup[] = [];

  for (const group of plan.groups) {
    const tabIds = toNonEmptyArray(group.tabIds);
    const tabGroupId = await (browser.tabs.group({ tabIds }) as Promise<number>);
    await browser.tabGroups.update(tabGroupId, {
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

  return { appliedGroups, plan };
}

export function getHostnameGroupingKey(url: string): string | null {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return normalizeHostname(parsedUrl.hostname);
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

  const key = getHostnameGroupingKey(tab.url);

  if (!key) {
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

  return {
    key,
    ok: true,
    tab: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
    },
  };
}
