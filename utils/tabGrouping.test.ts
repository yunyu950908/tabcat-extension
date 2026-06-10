import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  arrangeTabsAfterGrouping,
  buildArrangeTabsPlan,
  buildAutoGroupPlan,
  buildGroupingPlan,
  buildHostnameGroupingPlan,
  collapseAllTabGroups,
  expandAllTabGroups,
  buildUngroupAllPlan,
  groupCurrentWindowTabs,
  getHostnameGroupingKey,
  getRootDomainGroupingKey,
  normalizeHostname,
  type TabLike,
} from './tabGrouping';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseIgnoredDomainsInput,
} from './settings';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hostname grouping keys', () => {
  it('normalizes case and a leading www subdomain', () => {
    expect(normalizeHostname('WWW.GitHub.com')).toBe('github.com');
    expect(getHostnameGroupingKey('https://www.github.com/a')).toBe(
      'github.com',
    );
  });

  it('keeps non-www subdomains separate in the MVP mode', () => {
    expect(getHostnameGroupingKey('https://docs.google.com/a')).toBe(
      'docs.google.com',
    );
    expect(getHostnameGroupingKey('https://drive.google.com/b')).toBe(
      'drive.google.com',
    );
  });

  it('does not collapse public-suffix domains in hostname mode', () => {
    expect(getHostnameGroupingKey('https://news.bbc.co.uk/a')).toBe(
      'news.bbc.co.uk',
    );
  });

  it('can resolve root-domain grouping keys', () => {
    expect(getRootDomainGroupingKey('https://docs.google.com/a')).toBe(
      'google.com',
    );
    expect(getRootDomainGroupingKey('https://drive.google.com/b')).toBe(
      'google.com',
    );
    expect(getRootDomainGroupingKey('https://news.bbc.co.uk/a')).toBe(
      'bbc.co.uk',
    );
  });

  it('rejects internal and invalid URLs', () => {
    expect(getHostnameGroupingKey('chrome://settings')).toBeNull();
    expect(getHostnameGroupingKey('about:blank')).toBeNull();
    expect(getHostnameGroupingKey('file:///tmp/example.html')).toBeNull();
    expect(getHostnameGroupingKey('not a url')).toBeNull();
  });
});

describe('hostname grouping plan', () => {
  it('groups eligible tabs by hostname', () => {
    const plan = buildHostnameGroupingPlan([
      tab(1, 'https://github.com/a'),
      tab(2, 'https://github.com/b'),
      tab(3, 'https://docs.google.com/a'),
      tab(4, 'https://docs.google.com/b'),
    ]);

    expect(plan.groups).toMatchObject([
      {
        key: 'docs.google.com',
        tabIds: [3, 4],
        title: 'docs.google.com',
      },
      {
        key: 'github.com',
        tabIds: [1, 2],
        title: 'github.com',
      },
    ]);
    expect(plan.summary).toMatchObject({
      eligibleTabCount: 4,
      groupCount: 2,
      groupedTabCount: 4,
      skippedTabCount: 0,
    });
  });

  it('skips singleton hostnames instead of merging sibling subdomains', () => {
    const plan = buildHostnameGroupingPlan([
      tab(1, 'https://docs.google.com/a'),
      tab(2, 'https://drive.google.com/b'),
    ]);

    expect(plan.groups).toEqual([]);
    expect(plan.skipped).toMatchObject([
      { id: 1, key: 'docs.google.com', reason: 'singleton' },
      { id: 2, key: 'drive.google.com', reason: 'singleton' },
    ]);
  });

  it('skips pinned, grouped, internal, and missing-id tabs', () => {
    const plan = buildHostnameGroupingPlan([
      tab(1, 'https://github.com/a'),
      tab(2, 'https://github.com/b', { pinned: true }),
      tab(3, 'https://github.com/c', { groupId: 4 }),
      tab(4, 'chrome://settings'),
      { url: 'https://github.com/d', groupId: -1, pinned: false },
    ]);

    expect(plan.groups).toEqual([]);
    expect(plan.skipped).toMatchObject([
      { id: 2, reason: 'pinned' },
      { id: 3, reason: 'already-grouped' },
      { id: 4, reason: 'internal-url' },
      { reason: 'missing-id' },
      { id: 1, key: 'github.com', reason: 'singleton' },
    ]);
  });

  it('can include pinned tabs when configured', () => {
    const plan = buildHostnameGroupingPlan(
      [
        tab(1, 'https://github.com/a'),
        tab(2, 'https://github.com/b', { pinned: true }),
      ],
      { includePinnedTabs: true },
    );

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].tabIds).toEqual([1, 2]);
  });

  it('can group sibling subdomains by root domain when configured', () => {
    const plan = buildGroupingPlan(
      [
        tab(1, 'https://docs.google.com/a'),
        tab(2, 'https://drive.google.com/b'),
      ],
      { groupingMode: 'rootDomain' },
    );

    expect(plan.groups).toMatchObject([
      {
        key: 'google.com',
        tabIds: [1, 2],
        title: 'google.com',
      },
    ]);
  });

  it('skips ignored domains by hostname or root domain', () => {
    const plan = buildGroupingPlan(
      [
        tab(1, 'https://docs.google.com/a'),
        tab(2, 'https://docs.google.com/b'),
        tab(3, 'https://github.com/a'),
        tab(4, 'https://github.com/b'),
      ],
      { ignoredDomains: ['google.com', 'github.com'] },
    );

    expect(plan.groups).toEqual([]);
    expect(plan.skipped).toMatchObject([
      { id: 1, key: 'google.com', reason: 'ignored-domain' },
      { id: 2, key: 'google.com', reason: 'ignored-domain' },
      { id: 3, key: 'github.com', reason: 'ignored-domain' },
      { id: 4, key: 'github.com', reason: 'ignored-domain' },
    ]);
  });

  it('renames groups with domain rules', () => {
    const plan = buildGroupingPlan(
      [tab(1, 'https://github.com/a'), tab(2, 'https://github.com/b')],
      {
        domainRules: [
          {
            action: 'name',
            enabled: true,
            id: 'rule-1',
            matchMode: 'exact',
            pattern: 'github.com',
            value: 'Code',
          },
        ],
      },
    );

    expect(plan.groups).toMatchObject([
      {
        key: 'github.com',
        tabIds: [1, 2],
        title: 'Code',
      },
    ]);
  });

  it('merges hostnames with domain rules', () => {
    const plan = buildGroupingPlan(
      [
        tab(1, 'https://docs.google.com/a'),
        tab(2, 'https://drive.google.com/b'),
      ],
      {
        domainRules: [
          {
            action: 'merge',
            enabled: true,
            id: 'rule-1',
            matchMode: 'rootDomain',
            pattern: 'google.com',
            value: 'Google Workspace',
          },
        ],
      },
    );

    expect(plan.groups).toMatchObject([
      {
        key: 'Google Workspace',
        tabIds: [1, 2],
        title: 'Google Workspace',
      },
    ]);
  });

  it('ignores suffix matches with domain rules', () => {
    const plan = buildGroupingPlan(
      [
        tab(1, 'https://docs.google.com/a'),
        tab(2, 'https://docs.google.com/b'),
      ],
      {
        domainRules: [
          {
            action: 'ignore',
            enabled: true,
            id: 'rule-1',
            matchMode: 'suffix',
            pattern: 'google.com',
            value: '',
          },
        ],
      },
    );

    expect(plan.groups).toEqual([]);
    expect(plan.skipped).toMatchObject([
      { id: 1, reason: 'ignored-domain' },
      { id: 2, reason: 'ignored-domain' },
    ]);
  });
});

describe('manual grouping application', () => {
  it('adds a matching singleton tab to an existing group instead of creating a duplicate group', async () => {
    const browserStub = stubBrowserForManualGrouping({
      initialTabs: [
        tab(1, 'https://github.com/a', { groupId: 10, index: 0 }),
        tab(2, 'https://github.com/new', { index: 1 }),
        tab(3, 'https://example.com/a', { index: 2 }),
      ],
      refreshedTabs: [
        tab(1, 'https://github.com/a', { groupId: 10, index: 0 }),
        tab(2, 'https://github.com/new', { groupId: 10, index: 1 }),
        tab(3, 'https://example.com/a', { index: 2 }),
      ],
    });

    await expect(groupCurrentWindowTabs()).resolves.toMatchObject({
      appliedGroups: [
        {
          key: 'github.com',
          tabGroupId: 10,
          tabIds: [2],
          title: 'github.com',
        },
      ],
      plan: {
        summary: {
          eligibleTabCount: 2,
          groupCount: 1,
          groupedTabCount: 1,
        },
      },
    });
    expect(browserStub.groupTabs).toHaveBeenCalledWith({
      groupId: 10,
      tabIds: [2],
    });
    expect(browserStub.updateGroup).toHaveBeenCalledWith(10, {
      collapsed: false,
      color: 'orange',
      title: 'github.com',
    });
    expect(browserStub.queryTabs).toHaveBeenCalledTimes(2);
    expect(browserStub.saveSession).toHaveBeenCalledOnce();
  });

  it('merges duplicate matching groups into the first group without creating another group', async () => {
    const browserStub = stubBrowserForManualGrouping({
      initialTabs: [
        tab(1, 'https://aliyun.com/a', { groupId: 10, index: 0 }),
        tab(2, 'https://example.com/a', { index: 1 }),
        tab(3, 'https://aliyun.com/b', { groupId: 11, index: 2 }),
      ],
      refreshedTabs: [
        tab(1, 'https://aliyun.com/a', { groupId: 10, index: 0 }),
        tab(3, 'https://aliyun.com/b', { groupId: 10, index: 1 }),
        tab(2, 'https://example.com/a', { index: 2 }),
      ],
    });

    await expect(groupCurrentWindowTabs()).resolves.toMatchObject({
      appliedGroups: [],
      plan: {
        summary: {
          eligibleTabCount: 1,
          groupCount: 1,
          groupedTabCount: 0,
        },
      },
    });
    expect(browserStub.groupTabs).toHaveBeenCalledWith({
      groupId: 10,
      tabIds: [3],
    });
    expect(browserStub.updateGroup).toHaveBeenCalledWith(10, {
      collapsed: false,
      color: 'green',
      title: 'aliyun.com',
    });
    expect(browserStub.clearSession).toHaveBeenCalledOnce();
  });
});

describe('arrange tabs plan', () => {
  it('moves grouped tabs left and keeps group blocks in first-seen order', () => {
    expect(
      buildArrangeTabsPlan([
        tab(1, 'https://pinned.example.com', { index: 0, pinned: true }),
        tab(2, 'https://ungrouped.example.com', { index: 1 }),
        tab(3, 'https://github.com/a', { groupId: 10, index: 2 }),
        tab(4, 'https://docs.google.com/a', { groupId: 11, index: 3 }),
        tab(5, 'https://github.com/b', { groupId: 10, index: 4 }),
        tab(6, 'https://later.example.com', { index: 5 }),
      ]),
    ).toEqual({
      movedTabCount: 3,
      windows: [
        {
          groupIds: [10, 11],
          startIndex: 1,
          tabIdGroups: [[3, 5], [4]],
          tabIds: [3, 5, 4],
          windowId: 1,
        },
      ],
    });
  });

  it('uses newly applied groups when planning manual tidy arrangement', () => {
    expect(
      buildArrangeTabsPlan(
        [
          tab(1, 'https://ungrouped.example.com', { index: 0 }),
          tab(2, 'https://github.com/a', { index: 1 }),
          tab(3, 'https://github.com/b', { index: 2 }),
        ],
        [
          {
            color: 'green',
            key: 'github.com',
            tabGroupId: 10,
            tabIds: [2, 3],
            title: 'github.com',
          },
        ],
      ),
    ).toEqual({
      movedTabCount: 2,
      windows: [
        {
          groupIds: [10],
          startIndex: 0,
          tabIdGroups: [[2, 3]],
          tabIds: [2, 3],
          windowId: 1,
        },
      ],
    });
  });

  it('plans each window independently', () => {
    expect(
      buildArrangeTabsPlan([
        tab(1, 'https://ungrouped.example.com', { index: 0, windowId: 1 }),
        tab(2, 'https://github.com/a', {
          groupId: 10,
          index: 1,
          windowId: 1,
        }),
        tab(3, 'https://docs.google.com/a', {
          groupId: 11,
          index: 0,
          windowId: 2,
        }),
        tab(4, 'https://example.com/a', { index: 1, windowId: 2 }),
      ]),
    ).toEqual({
      movedTabCount: 2,
      windows: [
        {
          groupIds: [10],
          startIndex: 0,
          tabIdGroups: [[2]],
          tabIds: [2],
          windowId: 1,
        },
        {
          groupIds: [11],
          startIndex: 0,
          tabIdGroups: [[3]],
          tabIds: [3],
          windowId: 2,
        },
      ],
    });
  });

  it('returns no moves when no tabs are grouped', () => {
    expect(
      buildArrangeTabsPlan([
        tab(1, 'https://github.com/a', { index: 0 }),
        tab(2, 'https://example.com/a', { index: 1 }),
      ]),
    ).toEqual({
      movedTabCount: 0,
      windows: [],
    });
  });

  it('moves whole tab groups instead of moving grouped tabs directly', async () => {
    const moveGroup = vi.fn(async (groupId: number) => ({
      collapsed: false,
      color: 'blue',
      id: groupId,
      windowId: 1,
    }));
    const moveTabs = vi.fn();

    vi.stubGlobal('browser', {
      tabGroups: {
        move: moveGroup,
      },
      tabs: {
        move: moveTabs,
      },
    });

    await arrangeTabsAfterGrouping(
      [
        tab(1, 'https://ungrouped.example.com', { index: 0 }),
        tab(2, 'https://github.com/a', { index: 1 }),
        tab(3, 'https://github.com/b', { index: 2 }),
        tab(4, 'https://docs.google.com/a', { groupId: 11, index: 3 }),
      ],
      [
        {
          color: 'green',
          key: 'github.com',
          tabGroupId: 10,
          tabIds: [2, 3],
          title: 'github.com',
        },
      ],
    );

    expect(moveGroup).toHaveBeenNthCalledWith(1, 11, {
      index: 0,
      windowId: 1,
    });
    expect(moveGroup).toHaveBeenNthCalledWith(2, 10, {
      index: 0,
      windowId: 1,
    });
    expect(moveTabs).not.toHaveBeenCalled();
  });
});

describe('ungroup all plan', () => {
  it('collects grouped tab ids and counts unique groups', () => {
    expect(
      buildUngroupAllPlan([
        tab(1, 'https://github.com/a', { groupId: 10 }),
        tab(2, 'https://github.com/b', { groupId: 10 }),
        tab(3, 'https://example.com/a'),
        tab(4, 'https://docs.google.com/a', { groupId: 11 }),
      ]),
    ).toEqual({
      groupCount: 2,
      skippedTabCount: 0,
      tabIds: [1, 2, 4],
      ungroupedTabCount: 3,
    });
  });

  it('counts grouped tabs without ids as skipped', () => {
    expect(
      buildUngroupAllPlan([
        { groupId: 10, title: 'Missing id' },
        tab(2, 'https://github.com/b', { groupId: 10 }),
      ]),
    ).toEqual({
      groupCount: 1,
      skippedTabCount: 1,
      tabIds: [2],
      ungroupedTabCount: 1,
    });
  });

  it('returns an empty plan when no tabs are grouped', () => {
    expect(
      buildUngroupAllPlan([
        tab(1, 'https://github.com/a'),
        tab(2, 'https://example.com/a'),
      ]),
    ).toEqual({
      groupCount: 0,
      skippedTabCount: 0,
      tabIds: [],
      ungroupedTabCount: 0,
    });
  });
});

describe('auto group plan', () => {
  it('joins exactly one existing matching group', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new'),
        [
          tab(1, 'https://github.com/a', { groupId: 10 }),
          tab(2, 'https://example.com/a', { groupId: 11 }),
          tab(3, 'https://github.com/new'),
        ],
      ),
    ).toMatchObject({
      action: 'group',
      key: 'github.com',
      tabGroupId: 10,
      tabId: 3,
    });
  });

  it('skips when no existing group matches', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new'),
        [
          tab(1, 'https://example.com/a', { groupId: 10 }),
          tab(2, 'https://github.com/a'),
        ],
      ),
    ).toMatchObject({
      action: 'skip',
      key: 'github.com',
      reason: 'no-matching-group',
      tabId: 3,
    });
  });

  it('skips when multiple existing groups match', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new'),
        [
          tab(1, 'https://github.com/a', { groupId: 10 }),
          tab(2, 'https://github.com/b', { groupId: 11 }),
        ],
      ),
    ).toMatchObject({
      action: 'skip',
      key: 'github.com',
      reason: 'multiple-matching-groups',
      tabId: 3,
    });
  });

  it('skips already grouped tabs', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new', { groupId: 10 }),
        [tab(1, 'https://github.com/a', { groupId: 10 })],
      ),
    ).toMatchObject({
      action: 'skip',
      reason: 'already-grouped',
      tabId: 3,
    });
  });

  it('skips ignored domains', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new'),
        [tab(1, 'https://github.com/a', { groupId: 10 })],
        { ignoredDomains: ['github.com'] },
      ),
    ).toMatchObject({
      action: 'skip',
      key: 'github.com',
      reason: 'ignored-domain',
      tabId: 3,
    });
  });

  it('respects pinned tab settings', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new', { pinned: true }),
        [tab(1, 'https://github.com/a', { groupId: 10 })],
      ),
    ).toMatchObject({
      action: 'skip',
      reason: 'pinned',
      tabId: 3,
    });

    expect(
      buildAutoGroupPlan(
        tab(3, 'https://github.com/new', { pinned: true }),
        [tab(1, 'https://github.com/a', { groupId: 10 })],
        { includePinnedTabs: true },
      ),
    ).toMatchObject({
      action: 'group',
      tabGroupId: 10,
      tabId: 3,
    });
  });

  it('matches sibling subdomains in root-domain grouping mode', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://mail.google.com/new'),
        [tab(1, 'https://docs.google.com/a', { groupId: 10 })],
        { groupingMode: 'rootDomain' },
      ),
    ).toMatchObject({
      action: 'group',
      key: 'google.com',
      tabGroupId: 10,
      tabId: 3,
    });
  });

  it('uses merge rules to match existing groups', () => {
    expect(
      buildAutoGroupPlan(
        tab(3, 'https://drive.google.com/new'),
        [tab(1, 'https://docs.google.com/a', { groupId: 10 })],
        {
          domainRules: [
            {
              action: 'merge',
              enabled: true,
              id: 'rule-1',
              matchMode: 'rootDomain',
              pattern: 'google.com',
              value: 'Google Workspace',
            },
          ],
        },
      ),
    ).toMatchObject({
      action: 'group',
      key: 'Google Workspace',
      tabGroupId: 10,
      tabId: 3,
    });
  });
});

describe('tab group visibility actions', () => {
  it('collapses all expanded groups in the current window', async () => {
    const queryTabs = vi.fn(async () => [
      tab(1, 'https://github.com/a', { groupId: 10, windowId: 7 }),
    ]);
    const queryGroups = vi.fn(async () => [
      tabGroup(10, { collapsed: false, windowId: 7 }),
      tabGroup(11, { collapsed: false, windowId: 7 }),
      tabGroup(12, { collapsed: true, windowId: 7 }),
    ]);
    const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));

    stubBrowserForVisibilityActions({
      queryGroups,
      queryTabs,
      updateGroup,
    });

    await expect(collapseAllTabGroups()).resolves.toEqual({
      action: 'collapseAll',
      collapsedGroupCount: 2,
      expandedGroupCount: 0,
      groupCount: 3,
      unchangedGroupCount: 1,
    });
    expect(queryGroups).toHaveBeenCalledWith({ windowId: 7 });
    expect(updateGroup).toHaveBeenNthCalledWith(1, 10, { collapsed: true });
    expect(updateGroup).toHaveBeenNthCalledWith(2, 11, { collapsed: true });
  });

  it('collapses groups even when the active tab is ungrouped', async () => {
    const queryTabs = vi.fn(async () => [
      tab(1, 'https://github.com/a', { groupId: -1, windowId: 7 }),
    ]);
    const queryGroups = vi.fn(async () => [
      tabGroup(10, { collapsed: false, windowId: 7 }),
      tabGroup(11, { collapsed: true, windowId: 7 }),
    ]);
    const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));

    stubBrowserForVisibilityActions({
      queryGroups,
      queryTabs,
      updateGroup,
    });

    await expect(collapseAllTabGroups()).resolves.toEqual({
      action: 'collapseAll',
      collapsedGroupCount: 1,
      expandedGroupCount: 0,
      groupCount: 2,
      unchangedGroupCount: 1,
    });
    expect(queryGroups).toHaveBeenCalledWith({ windowId: 7 });
    expect(updateGroup).toHaveBeenCalledOnce();
    expect(updateGroup).toHaveBeenCalledWith(10, { collapsed: true });
  });

  it('can collapse groups across all windows when configured', async () => {
    const queryTabs = vi.fn(async () => [
      tab(1, 'https://github.com/a', { groupId: 10, windowId: 7 }),
    ]);
    const queryGroups = vi.fn(async () => [
      tabGroup(10, { collapsed: false, windowId: 7 }),
      tabGroup(11, { collapsed: false, windowId: 8 }),
    ]);
    const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));

    stubBrowserForVisibilityActions({
      queryGroups,
      queryTabs,
      updateGroup,
    });

    await expect(collapseAllTabGroups({ scope: 'allWindows' })).resolves.toEqual({
      action: 'collapseAll',
      collapsedGroupCount: 2,
      expandedGroupCount: 0,
      groupCount: 2,
      unchangedGroupCount: 0,
    });
    expect(queryGroups).toHaveBeenCalledWith({});
    expect(updateGroup).toHaveBeenNthCalledWith(1, 10, { collapsed: true });
    expect(updateGroup).toHaveBeenNthCalledWith(2, 11, { collapsed: true });
  });

  it('expands all collapsed groups in the current window', async () => {
    const queryTabs = vi.fn(async () => [
      tab(1, 'https://github.com/a', { groupId: 10, windowId: 7 }),
    ]);
    const queryGroups = vi.fn(async () => [
      tabGroup(10, { collapsed: true, windowId: 7 }),
      tabGroup(11, { collapsed: false, windowId: 7 }),
      tabGroup(12, { collapsed: true, windowId: 7 }),
    ]);
    const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));

    stubBrowserForVisibilityActions({
      queryGroups,
      queryTabs,
      updateGroup,
    });

    await expect(expandAllTabGroups()).resolves.toEqual({
      action: 'expandAll',
      collapsedGroupCount: 0,
      expandedGroupCount: 2,
      groupCount: 3,
      unchangedGroupCount: 1,
    });
    expect(queryGroups).toHaveBeenCalledWith({ windowId: 7 });
    expect(updateGroup).toHaveBeenNthCalledWith(1, 10, { collapsed: false });
    expect(updateGroup).toHaveBeenNthCalledWith(2, 12, { collapsed: false });
  });

  it('can expand groups across all windows when configured', async () => {
    const queryTabs = vi.fn(async () => [
      tab(1, 'https://github.com/a', { groupId: 10, windowId: 7 }),
    ]);
    const queryGroups = vi.fn(async () => [
      tabGroup(10, { collapsed: true, windowId: 7 }),
      tabGroup(11, { collapsed: true, windowId: 8 }),
    ]);
    const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));

    stubBrowserForVisibilityActions({
      queryGroups,
      queryTabs,
      updateGroup,
    });

    await expect(expandAllTabGroups({ scope: 'allWindows' })).resolves.toEqual({
      action: 'expandAll',
      collapsedGroupCount: 0,
      expandedGroupCount: 2,
      groupCount: 2,
      unchangedGroupCount: 0,
    });
    expect(queryGroups).toHaveBeenCalledWith({});
  });
});

describe('settings helpers', () => {
  it('uses root-domain grouping and auto group by default', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      arrangeTabsAfterGrouping: true,
      autoGroupNewTabs: true,
      groupingMode: 'rootDomain',
    });

    expect(normalizeSettings(null)).toMatchObject({
      arrangeTabsAfterGrouping: true,
      autoGroupNewTabs: true,
      groupingMode: 'rootDomain',
    });

    expect(normalizeSettings({})).toMatchObject({
      arrangeTabsAfterGrouping: true,
      autoGroupNewTabs: true,
      groupingMode: 'rootDomain',
    });
  });

  it('normalizes ignored domain input', () => {
    expect(
      parseIgnoredDomainsInput(
        'https://www.github.com/a\nDocs.Google.com, localhost:3000',
      ),
    ).toEqual(['docs.google.com', 'github.com', 'localhost']);
  });

  it('drops invalid imported rules', () => {
    expect(
      normalizeSettings({
        domainRules: [
          {
            action: 'merge',
            enabled: true,
            id: 'valid',
            matchMode: 'exact',
            pattern: 'github.com',
            value: 'Code',
          },
          {
            action: 'merge',
            enabled: true,
            id: 'missing-value',
            matchMode: 'exact',
            pattern: 'example.com',
            value: '',
          },
        ],
      }).domainRules,
    ).toMatchObject([
      {
        action: 'merge',
        id: 'valid',
        matchMode: 'exact',
        pattern: 'github.com',
        value: 'Code',
      },
    ]);
  });

  it('normalizes imported scalar settings safely', () => {
    expect(
      normalizeSettings({
        collapseNewGroups: 'true',
        includePinnedTabs: 'true',
        minGroupSize: '4',
        ignoredDomains: ['valid.com', 'not valid.com'],
      }),
    ).toMatchObject({
      arrangeTabsAfterGrouping: true,
      autoGroupNewTabs: true,
      collapseNewGroups: false,
      groupingMode: 'rootDomain',
      ignoredDomains: ['valid.com'],
      includePinnedTabs: false,
      minGroupSize: 4,
    });
  });

  it('normalizes arrange tab settings safely', () => {
    expect(
      normalizeSettings({
        arrangeTabsAfterGrouping: false,
      }),
    ).toMatchObject({
      arrangeTabsAfterGrouping: false,
    });

    expect(
      normalizeSettings({
        arrangeTabsAfterGrouping: 'false',
      }),
    ).toMatchObject({
      arrangeTabsAfterGrouping: true,
    });
  });

  it('keeps hostname grouping available as an explicit fallback mode', () => {
    expect(
      normalizeSettings({
        groupingMode: 'hostname',
      }),
    ).toMatchObject({
      groupingMode: 'hostname',
    });

    expect(
      normalizeSettings({
        groupingMode: 'rootDomain',
      }),
    ).toMatchObject({
      groupingMode: 'rootDomain',
    });

    expect(
      normalizeSettings({
        groupingMode: 'invalid',
      }),
    ).toMatchObject({
      groupingMode: 'rootDomain',
    });
  });

  it('normalizes auto group settings safely', () => {
    expect(
      normalizeSettings({
        autoGroupNewTabs: false,
      }),
    ).toMatchObject({
      autoGroupNewTabs: false,
    });

    expect(
      normalizeSettings({
        autoGroupNewTabs: true,
      }),
    ).toMatchObject({
      autoGroupNewTabs: true,
    });

    expect(
      normalizeSettings({
        autoGroupNewTabs: 'true',
      }),
    ).toMatchObject({
      autoGroupNewTabs: true,
    });
  });
});

function tab(
  id: number,
  url: string,
  overrides: Partial<TabLike> = {},
): TabLike {
  return {
    active: false,
    groupId: -1,
    id,
    pinned: false,
    title: url,
    url,
    windowId: 1,
    ...overrides,
  };
}

function tabGroup(
  id: number,
  overrides: Partial<{
    collapsed: boolean;
    color: string;
    title: string;
    windowId: number;
  }> = {},
) {
  return {
    collapsed: false,
    color: 'blue',
    id,
    title: `Group ${id}`,
    windowId: 1,
    ...overrides,
  };
}

function stubBrowserForManualGrouping({
  initialTabs,
  refreshedTabs = initialTabs,
}: {
  initialTabs: TabLike[];
  refreshedTabs?: TabLike[];
}) {
  let queryCount = 0;
  const queryTabs = vi.fn(async () => {
    queryCount += 1;
    return queryCount === 1 ? initialTabs : refreshedTabs;
  });
  const groupTabs = vi.fn(
    async (options: { groupId?: number; tabIds: number[] }) =>
      options.groupId ?? 99,
  );
  const moveGroup = vi.fn(async (groupId: number) => tabGroup(groupId));
  const updateGroup = vi.fn(async (groupId: number) => tabGroup(groupId));
  const saveSession = vi.fn(async () => undefined);
  const clearSession = vi.fn(async () => undefined);

  vi.stubGlobal('browser', {
    storage: {
      session: {
        remove: clearSession,
        set: saveSession,
      },
      sync: {
        get: vi.fn(async () => ({})),
      },
    },
    tabGroups: {
      move: moveGroup,
      update: updateGroup,
    },
    tabs: {
      group: groupTabs,
      query: queryTabs,
    },
  });

  return {
    clearSession,
    groupTabs,
    moveGroup,
    queryTabs,
    saveSession,
    updateGroup,
  };
}

function stubBrowserForVisibilityActions({
  queryGroups,
  queryTabs,
  updateGroup,
}: {
  queryGroups: ReturnType<typeof vi.fn>;
  queryTabs: ReturnType<typeof vi.fn>;
  updateGroup: ReturnType<typeof vi.fn>;
}) {
  vi.stubGlobal('browser', {
    storage: {
      sync: {
        get: vi.fn(async () => ({})),
      },
    },
    tabGroups: {
      query: queryGroups,
      update: updateGroup,
    },
    tabs: {
      query: queryTabs,
    },
  });
}
