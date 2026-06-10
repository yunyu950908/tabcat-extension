import { getDomain } from 'tldts';
import {
  getSettings,
  normalizeDomainInput,
  type DomainRule,
  type GroupingMode,
  type GroupingScope,
  type TabCatSettings,
} from './settings';

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

interface CandidateGroup {
  key: string;
  tabs: PlannedTab[];
  title: string;
  windowId?: number;
}

interface ExistingGroupBlock {
  firstOrder: number;
  groupId: number;
  tabIds: number[];
}

interface ExistingGroupState {
  color: TabGroupColor;
  groups: Map<number, ExistingGroupBlock>;
  key: string;
  title: string;
  windowId?: number;
}

interface ApplyGroupingOperation extends PlannedGroup {
  existingGroupIds: number[];
  mergeTabIds: number[];
  targetGroupId?: number;
  windowId?: number;
}

interface GroupingApplicationPlan extends GroupingPlan {
  operations: ApplyGroupingOperation[];
}

interface TabGroupLike {
  collapsed: boolean;
  id: number;
  windowId: number;
}

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
  index?: number;
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
  autoGroupNewTabs?: boolean;
  arrangeTabsAfterGrouping?: boolean;
  collapseNewGroups?: boolean;
  domainRules?: DomainRule[];
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
  arrangement: ArrangeTabsResult | null;
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

export interface UngroupAllPlan {
  groupCount: number;
  skippedTabCount: number;
  tabIds: number[];
  ungroupedTabCount: number;
}

export interface UngroupAllResult {
  groupCount: number;
  skippedTabCount: number;
  ungroupedTabCount: number;
}

export type TabGroupVisibilityAction = 'collapseAll' | 'expandAll';

export interface TabGroupVisibilityResult {
  action: TabGroupVisibilityAction;
  collapsedGroupCount: number;
  expandedGroupCount: number;
  groupCount: number;
  unchangedGroupCount: number;
}

export interface ArrangeTabsWindowPlan {
  groupIds: number[];
  startIndex: number;
  tabIdGroups: number[][];
  tabIds: number[];
  windowId?: number;
}

export interface ArrangeTabsPlan {
  movedTabCount: number;
  windows: ArrangeTabsWindowPlan[];
}

export interface ArrangeTabsResult {
  movedTabCount: number;
  windowCount: number;
}

export type AutoGroupSkipReason =
  | Exclude<SkipReason, 'singleton'>
  | 'disabled'
  | 'missing-window'
  | 'multiple-matching-groups'
  | 'no-matching-group';

export type AutoGroupPlan =
  | {
      action: 'group';
      key: string;
      tabGroupId: number;
      tabId: number;
      title: string;
    }
  | {
      action: 'skip';
      key?: string;
      reason: AutoGroupSkipReason;
      tabId?: number;
    };

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
  const candidates = new Map<string, CandidateGroup>();

  for (const tab of tabs) {
    const candidate = getEligibleTab(tab, options);

    if (!candidate.ok) {
      skipped.push(candidate.skipped);
      continue;
    }

    const candidateGroup = candidates.get(candidate.key) ?? {
      key: candidate.key,
      tabs: [],
      title: candidate.title,
    };
    candidateGroup.tabs.push(candidate.tab);
    candidates.set(candidate.key, candidateGroup);
  }

  const groups: PlannedGroup[] = [];
  let eligibleTabCount = 0;

  for (const [key, candidateGroup] of [...candidates.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const groupTabs = candidateGroup.tabs;
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
      title: candidateGroup.title,
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

function buildGroupingApplicationPlan(
  tabs: TabLike[],
  options: GroupingOptions = {},
): GroupingApplicationPlan {
  const minGroupSize = Math.max(2, options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE);
  const skipped: SkippedTab[] = [];
  const candidates = new Map<string, CandidateGroup>();
  const existingGroups = new Map<string, ExistingGroupState>();
  let eligibleTabCount = 0;

  tabs.forEach((tab, originalIndex) => {
    if (isGroupedTab(tab)) {
      skipped.push({
        id: tab.id,
        reason: 'already-grouped',
        title: tab.title,
        url: tab.url,
      });

      const candidate = getEligibleTab(tab, options, { allowGrouped: true });

      if (candidate.ok && tab.groupId != null && tab.groupId !== NO_GROUP_ID) {
        const operationKey = getOperationKey(candidate.key, tab.windowId);
        const state = existingGroups.get(operationKey) ?? {
          color: colorForGroupingKey(candidate.key),
          groups: new Map<number, ExistingGroupBlock>(),
          key: candidate.key,
          title: candidate.title,
          ...(tab.windowId != null && { windowId: tab.windowId }),
        };
        const block = state.groups.get(tab.groupId) ?? {
          firstOrder: getTabRuntimeOrder(tab, originalIndex),
          groupId: tab.groupId,
          tabIds: [],
        };

        block.firstOrder = Math.min(
          block.firstOrder,
          getTabRuntimeOrder(tab, originalIndex),
        );

        if (tab.id != null) {
          block.tabIds.push(tab.id);
        }

        state.groups.set(tab.groupId, block);
        existingGroups.set(operationKey, state);
      }

      return;
    }

    const candidate = getEligibleTab(tab, options);

    if (!candidate.ok) {
      skipped.push(candidate.skipped);
      return;
    }

    eligibleTabCount += 1;

    const operationKey = getOperationKey(candidate.key, tab.windowId);
    const candidateGroup = candidates.get(operationKey) ?? {
      key: candidate.key,
      tabs: [],
      title: candidate.title,
      ...(tab.windowId != null && { windowId: tab.windowId }),
    };
    candidateGroup.tabs.push(candidate.tab);
    candidates.set(operationKey, candidateGroup);
  });

  const operations: ApplyGroupingOperation[] = [];
  const operationKeys = [...new Set([...candidates.keys(), ...existingGroups.keys()])]
    .sort((a, b) => a.localeCompare(b));

  for (const operationKey of operationKeys) {
    const candidateGroup = candidates.get(operationKey);
    const existingState = existingGroups.get(operationKey);
    const candidateTabs = candidateGroup?.tabs ?? [];
    const existingBlocks = existingState
      ? [...existingState.groups.values()].sort(
          (a, b) => a.firstOrder - b.firstOrder || a.groupId - b.groupId,
        )
      : [];
    const targetGroup = existingBlocks[0];
    const mergeTabIds = existingBlocks
      .slice(1)
      .flatMap((block) => block.tabIds);

    if (existingState && targetGroup) {
      if (candidateTabs.length === 0 && mergeTabIds.length === 0) {
        continue;
      }

      operations.push({
        color: existingState.color,
        existingGroupIds: existingBlocks.map((block) => block.groupId),
        key: existingState.key,
        mergeTabIds,
        tabIds: candidateTabs.map((tab) => tab.id),
        tabs: candidateTabs,
        targetGroupId: targetGroup.groupId,
        title: existingState.title,
        ...(existingState.windowId != null && { windowId: existingState.windowId }),
      });
      continue;
    }

    if (candidateTabs.length < minGroupSize) {
      for (const tab of candidateTabs) {
        skipped.push({
          id: tab.id,
          key: candidateGroup?.key ?? getOperationDomainKey(operationKey),
          reason: 'singleton',
          title: tab.title,
          url: tab.url,
        });
      }
      continue;
    }

    const key = candidateGroup?.key ?? getOperationDomainKey(operationKey);

    operations.push({
      color: colorForGroupingKey(key),
      existingGroupIds: [],
      key,
      mergeTabIds: [],
      tabIds: candidateTabs.map((tab) => tab.id),
      tabs: candidateTabs,
      title: candidateGroup?.title ?? key,
      ...(candidateGroup?.windowId != null && { windowId: candidateGroup.windowId }),
    });
  }

  const groupedTabCount = operations.reduce(
    (sum, operation) => sum + operation.tabIds.length,
    0,
  );

  return {
    groups: operations,
    operations,
    skipped,
    summary: {
      eligibleTabCount,
      groupCount: operations.length,
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
    ...getGroupingOptionsFromSettings(settings),
    ...options,
  };
  const tabs = await browser.tabs.query(
    resolvedOptions.scope === 'allWindows' ? {} : { currentWindow: true },
  );
  const plan = buildGroupingApplicationPlan(tabs, resolvedOptions);
  const appliedGroups: AppliedGroup[] = [];
  let appliedOperationCount = 0;

  for (const operation of plan.operations) {
    const tabIdsToMove = [...operation.mergeTabIds, ...operation.tabIds];
    let tabGroupId = operation.targetGroupId;

    if (tabGroupId != null) {
      if (tabIdsToMove.length > 0) {
        await (browser.tabs.group({
          groupId: tabGroupId,
          tabIds: toNonEmptyArray(tabIdsToMove),
        }) as Promise<number>);
      }
    } else {
      tabGroupId = await (browser.tabs.group({
        tabIds: toNonEmptyArray(operation.tabIds),
      }) as Promise<number>);
    }

    await browser.tabGroups.update(tabGroupId, {
      collapsed: resolvedOptions.collapseNewGroups,
      color: operation.color,
      title: operation.title,
    });
    appliedOperationCount += 1;

    if (operation.tabIds.length > 0) {
      appliedGroups.push({
        color: operation.color,
        key: operation.key,
        tabGroupId,
        tabIds: operation.tabIds,
        title: operation.title,
      });
    }
  }

  const arrangement =
    resolvedOptions.arrangeTabsAfterGrouping && appliedOperationCount > 0
    ? await arrangeTabsAfterGrouping(
        await browser.tabs.query(
          resolvedOptions.scope === 'allWindows'
            ? {}
            : { currentWindow: true },
        ),
        appliedGroups,
      )
    : null;

  await saveLastGroupingOperation(appliedGroups);

  return { appliedGroups, arrangement, plan };
}

export function buildArrangeTabsPlan(
  tabs: TabLike[],
  appliedGroups: AppliedGroup[] = [],
): ArrangeTabsPlan {
  const appliedGroupIdsByTabId = new Map<number, number>();

  for (const group of appliedGroups) {
    for (const tabId of group.tabIds) {
      appliedGroupIdsByTabId.set(tabId, group.tabGroupId);
    }
  }

  const tabsByWindow = new Map<string, Array<TabLike & { originalIndex: number }>>();

  tabs.forEach((tab, originalIndex) => {
    const key = String(tab.windowId ?? 'unknown');
    const windowTabs = tabsByWindow.get(key) ?? [];
    windowTabs.push({ ...tab, originalIndex });
    tabsByWindow.set(key, windowTabs);
  });

  const windows: ArrangeTabsWindowPlan[] = [];

  for (const windowTabs of tabsByWindow.values()) {
    const sortedTabs = [...windowTabs].sort(
      (a, b) => getTabOrder(a) - getTabOrder(b),
    );
    const pinnedCount = sortedTabs.filter((tab) => tab.pinned).length;
    const groupBlocks = new Map<
      number,
      { firstOrder: number; tabIds: number[] }
    >();

    for (const tab of sortedTabs) {
      if (tab.pinned || tab.id == null) {
        continue;
      }

      const groupId = getArrangedGroupId(tab, appliedGroupIdsByTabId);

      if (groupId == null) {
        continue;
      }

      const block = groupBlocks.get(groupId) ?? {
        firstOrder: getTabOrder(tab),
        tabIds: [],
      };
      block.tabIds.push(tab.id);
      groupBlocks.set(groupId, block);
    }

    const orderedGroups = [...groupBlocks.entries()]
      .map(([groupId, block]) => ({ groupId, ...block }))
      .sort((a, b) => a.firstOrder - b.firstOrder);
    const tabIds = orderedGroups.flatMap((group) => group.tabIds);

    if (tabIds.length === 0) {
      continue;
    }

    const windowId = sortedTabs.find((tab) => tab.windowId != null)?.windowId;
    windows.push({
      ...(windowId != null && { windowId }),
      groupIds: orderedGroups.map((group) => group.groupId),
      startIndex: pinnedCount,
      tabIdGroups: orderedGroups.map((group) => group.tabIds),
      tabIds,
    });
  }

  return {
    movedTabCount: windows.reduce(
      (sum, windowPlan) => sum + windowPlan.tabIds.length,
      0,
    ),
    windows,
  };
}

export async function arrangeTabsAfterGrouping(
  tabs: TabLike[],
  appliedGroups: AppliedGroup[] = [],
): Promise<ArrangeTabsResult> {
  const plan = buildArrangeTabsPlan(tabs, appliedGroups);

  for (const windowPlan of plan.windows) {
    for (const groupId of [...windowPlan.groupIds].reverse()) {
      await browser.tabGroups.move(groupId, {
        index: windowPlan.startIndex,
        ...(windowPlan.windowId != null && { windowId: windowPlan.windowId }),
      });
    }
  }

  return {
    movedTabCount: plan.movedTabCount,
    windowCount: plan.windows.length,
  };
}

export function buildUngroupAllPlan(tabs: TabLike[]): UngroupAllPlan {
  const groupIds = new Set<number>();
  const tabIds: number[] = [];
  let skippedTabCount = 0;

  for (const tab of tabs) {
    if (tab.groupId == null || tab.groupId === NO_GROUP_ID) {
      continue;
    }

    groupIds.add(tab.groupId);

    if (tab.id == null) {
      skippedTabCount += 1;
      continue;
    }

    tabIds.push(tab.id);
  }

  return {
    groupCount: groupIds.size,
    skippedTabCount,
    tabIds,
    ungroupedTabCount: tabIds.length,
  };
}

export async function ungroupAllTabs(
  options: GroupingOptions = {},
): Promise<UngroupAllResult> {
  const settings = await getSettings();
  const resolvedOptions: GroupingOptions = {
    ...getGroupingOptionsFromSettings(settings),
    ...options,
  };
  const tabs = await browser.tabs.query(
    resolvedOptions.scope === 'allWindows' ? {} : { currentWindow: true },
  );
  const plan = buildUngroupAllPlan(tabs);

  if (plan.tabIds.length > 0) {
    await browser.tabs.ungroup(toNonEmptyArray(plan.tabIds));
  }

  await clearLastGroupingOperation();

  return {
    groupCount: plan.groupCount,
    skippedTabCount: plan.skippedTabCount,
    ungroupedTabCount: plan.ungroupedTabCount,
  };
}

export async function collapseAllTabGroups(
  options: GroupingOptions = {},
): Promise<TabGroupVisibilityResult> {
  const settings = await getSettings();
  const scope = options.scope ?? settings.scope;
  const activeTab = await getActiveTab();
  const groups = await queryTabGroupsForScope(scope, activeTab?.windowId);
  let collapsedGroupCount = 0;

  for (const group of groups) {
    if (group.collapsed) {
      continue;
    }

    await browser.tabGroups.update(group.id, { collapsed: true });
    collapsedGroupCount += 1;
  }

  return {
    action: 'collapseAll',
    collapsedGroupCount,
    expandedGroupCount: 0,
    groupCount: groups.length,
    unchangedGroupCount: groups.length - collapsedGroupCount,
  };
}

export async function expandAllTabGroups(
  options: GroupingOptions = {},
): Promise<TabGroupVisibilityResult> {
  const settings = await getSettings();
  const scope = options.scope ?? settings.scope;
  const activeTab = await getActiveTab();
  const groups = await queryTabGroupsForScope(scope, activeTab?.windowId);
  let expandedGroupCount = 0;

  for (const group of groups) {
    if (!group.collapsed) {
      continue;
    }

    await browser.tabGroups.update(group.id, { collapsed: false });
    expandedGroupCount += 1;
  }

  return {
    action: 'expandAll',
    collapsedGroupCount: 0,
    expandedGroupCount,
    groupCount: groups.length,
    unchangedGroupCount: groups.length - expandedGroupCount,
  };
}

export function buildAutoGroupPlan(
  tab: TabLike,
  tabsInWindow: TabLike[],
  options: GroupingOptions = {},
): AutoGroupPlan {
  const candidate = getEligibleTab(tab, options);

  if (!candidate.ok) {
    return {
      action: 'skip',
      key: candidate.skipped.key,
      reason: toAutoGroupSkipReason(candidate.skipped.reason),
      tabId: candidate.skipped.id,
    };
  }

  if (tab.windowId == null) {
    return {
      action: 'skip',
      key: candidate.key,
      reason: 'missing-window',
      tabId: candidate.tab.id,
    };
  }

  const matchingGroupIds = new Set<number>();

  for (const existingTab of tabsInWindow) {
    if (
      existingTab.id === candidate.tab.id ||
      existingTab.groupId == null ||
      existingTab.groupId === NO_GROUP_ID ||
      (existingTab.windowId != null && existingTab.windowId !== tab.windowId)
    ) {
      continue;
    }

    const existingCandidate = getEligibleTab(existingTab, options, {
      allowGrouped: true,
    });

    if (!existingCandidate.ok || existingCandidate.key !== candidate.key) {
      continue;
    }

    matchingGroupIds.add(existingTab.groupId);
  }

  if (matchingGroupIds.size === 0) {
    return {
      action: 'skip',
      key: candidate.key,
      reason: 'no-matching-group',
      tabId: candidate.tab.id,
    };
  }

  if (matchingGroupIds.size > 1) {
    return {
      action: 'skip',
      key: candidate.key,
      reason: 'multiple-matching-groups',
      tabId: candidate.tab.id,
    };
  }

  const [tabGroupId] = matchingGroupIds;

  return {
    action: 'group',
    key: candidate.key,
    tabGroupId,
    tabId: candidate.tab.id,
    title: candidate.title,
  };
}

export async function autoGroupTabIntoExistingGroup(
  tab: TabLike,
): Promise<AutoGroupPlan> {
  const settings = await getSettings();

  if (!settings.autoGroupNewTabs) {
    return {
      action: 'skip',
      reason: 'disabled',
      tabId: tab.id,
    };
  }

  if (tab.windowId == null) {
    return {
      action: 'skip',
      reason: 'missing-window',
      tabId: tab.id,
    };
  }

  const options = getGroupingOptionsFromSettings(settings);
  const tabsInWindow = await browser.tabs.query({ windowId: tab.windowId });
  const plan = buildAutoGroupPlan(tab, tabsInWindow, options);

  if (plan.action === 'group') {
    await (browser.tabs.group({
      groupId: plan.tabGroupId,
      tabIds: [plan.tabId],
    }) as Promise<number>);
  }

  return plan;
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

async function getActiveTab(): Promise<TabLike | null> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  return activeTab ?? null;
}

async function queryTabGroupsForScope(
  scope: GroupingScope,
  currentWindowId?: number,
): Promise<TabGroupLike[]> {
  if (scope === 'allWindows') {
    return browser.tabGroups.query({}) as Promise<TabGroupLike[]>;
  }

  if (currentWindowId == null) {
    return [];
  }

  return browser.tabGroups.query({
    windowId: currentWindowId,
  }) as Promise<TabGroupLike[]>;
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

function getGroupingOptionsFromSettings(
  settings: TabCatSettings,
): GroupingOptions {
  return {
    autoGroupNewTabs: settings.autoGroupNewTabs,
    arrangeTabsAfterGrouping: settings.arrangeTabsAfterGrouping,
    collapseNewGroups: settings.collapseNewGroups,
    domainRules: settings.domainRules,
    groupingMode: settings.groupingMode,
    ignoredDomains: settings.ignoredDomains,
    includePinnedTabs: settings.includePinnedTabs,
    minGroupSize: settings.minGroupSize,
    scope: settings.scope,
  };
}

function getOperationKey(key: string, windowId?: number): string {
  return `${windowId ?? 'unknown'}\u0000${key}`;
}

function getOperationDomainKey(operationKey: string): string {
  return operationKey.split('\u0000')[1] ?? operationKey;
}

function isGroupedTab(tab: TabLike): boolean {
  return tab.groupId != null && tab.groupId !== NO_GROUP_ID;
}

function getTabOrder(tab: TabLike & { originalIndex: number }): number {
  return tab.index ?? tab.originalIndex;
}

function getTabRuntimeOrder(tab: TabLike, originalIndex: number): number {
  return tab.index ?? originalIndex;
}

function getArrangedGroupId(
  tab: TabLike,
  appliedGroupIdsByTabId: Map<number, number>,
): number | null {
  if (tab.id != null) {
    const appliedGroupId = appliedGroupIdsByTabId.get(tab.id);

    if (appliedGroupId != null) {
      return appliedGroupId;
    }
  }

  return tab.groupId != null && tab.groupId !== NO_GROUP_ID ? tab.groupId : null;
}

function toAutoGroupSkipReason(reason: SkipReason): AutoGroupSkipReason {
  if (reason === 'singleton') {
    return 'no-matching-group';
  }

  return reason;
}

function getEligibleTab(
  tab: TabLike,
  options: GroupingOptions,
  eligibilityOptions: { allowGrouped?: boolean } = {},
):
  | { key: string; ok: true; tab: PlannedTab; title: string }
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

  if (
    !eligibilityOptions.allowGrouped &&
    tab.groupId !== undefined &&
    tab.groupId !== NO_GROUP_ID
  ) {
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

  const groupingKey = getGroupingKey(
    tab.url,
    options.groupingMode ?? 'rootDomain',
  );

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

  const ruleResult = applyDomainRules(
    groupingKey,
    options.domainRules ?? [],
  );

  if (
    isIgnoredDomain(groupingKey, options.ignoredDomains ?? []) ||
    ruleResult.action === 'ignore'
  ) {
    return {
      ok: false,
      skipped: {
        id: tab.id,
        key: ruleResult.key,
        reason: 'ignored-domain',
        title: tab.title,
        url: tab.url,
      },
    };
  }

  return {
    key: ruleResult.key,
    ok: true,
    tab: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
    },
    title: ruleResult.title,
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

function applyDomainRules(
  groupingKey: { hostname: string; key: string; rootDomain: string | null },
  domainRules: DomainRule[],
): { action: 'group' | 'ignore'; key: string; title: string } {
  let key = groupingKey.key;
  let title = groupingKey.key;

  for (const rule of domainRules) {
    if (!rule.enabled || !doesRuleMatch(rule, groupingKey)) {
      continue;
    }

    if (rule.action === 'ignore') {
      return { action: 'ignore', key, title };
    }

    if (rule.action === 'merge') {
      key = rule.value;
      title = rule.value;
      continue;
    }

    title = rule.value;
  }

  return { action: 'group', key, title };
}

function doesRuleMatch(
  rule: DomainRule,
  groupingKey: { hostname: string; key: string; rootDomain: string | null },
): boolean {
  const pattern = normalizeDomainInput(rule.pattern);

  if (!pattern) {
    return false;
  }

  if (rule.matchMode === 'exact') {
    return groupingKey.hostname === pattern;
  }

  if (rule.matchMode === 'rootDomain') {
    return groupingKey.rootDomain === pattern;
  }

  return (
    groupingKey.hostname === pattern || groupingKey.hostname.endsWith(`.${pattern}`)
  );
}
