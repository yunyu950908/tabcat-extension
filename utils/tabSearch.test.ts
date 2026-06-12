import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateTabSearchItem,
  buildBookmarkSearchItems,
  buildHistorySearchItems,
  buildTabSearchItems,
  filterTabSearchItems,
  getTabSearchWindowLabels,
  type TabSearchItem,
} from './tabSearch';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tab search items', () => {
  it('builds searchable tab items with hostnames, root domains, and group metadata', () => {
    vi.stubGlobal('browser', {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://abc${path}`),
      },
    });

    expect(
      buildTabSearchItems(
        [
          tab(1, 'https://docs.google.com/document', {
            active: true,
            favIconUrl: 'https://docs.google.com/favicon.ico',
            groupId: 10,
            lastAccessed: 1_700_000_000_000,
            title: 'Quarterly Plan',
          }),
          tab(2, 'chrome://extensions', {
            title: 'Extensions',
          }),
          tab(3, 'chrome-extension://abc/tab-switcher.html', {
            title: 'TabCat',
          }),
          tab(4, 'https://github.com/yunyu950908/tabcat-extension', {
            windowId: 99,
          }),
        ],
        [
          {
            color: 'blue',
            id: 10,
            title: 'Work Docs',
            windowId: 1,
          },
        ],
        { paletteWindowId: 99 },
      ),
    ).toEqual([
      {
        active: true,
        favIconUrl: 'https://docs.google.com/favicon.ico',
        groupColor: 'blue',
        groupId: 10,
        groupTitle: 'Work Docs',
        hostname: 'docs.google.com',
        id: 1,
        index: 0,
        key: 'tab:1',
        lastAccessed: 1_700_000_000_000,
        pinned: false,
        rootDomain: 'google.com',
        source: 'tab',
        title: 'Quarterly Plan',
        url: 'https://docs.google.com/document',
        windowId: 1,
      },
      {
        active: false,
        favIconUrl: undefined,
        groupColor: undefined,
        groupId: -1,
        groupTitle: undefined,
        hostname: 'extensions',
        id: 2,
        index: 1,
        key: 'tab:2',
        lastAccessed: 0,
        pinned: false,
        rootDomain: undefined,
        source: 'tab',
        title: 'Extensions',
        url: 'chrome://extensions',
        windowId: 1,
      },
    ]);
  });

  it('builds searchable history and bookmark items', () => {
    expect(
      buildHistorySearchItems([
        {
          id: '99',
          lastVisitTime: 1_700_000_000_000,
          title: 'Linear Roadmap',
          typedCount: 2,
          url: 'https://linear.app/acme/roadmap',
          visitCount: 8,
        },
        {
          id: '100',
          title: 'Extensions',
          url: 'chrome://extensions',
        },
      ]),
    ).toMatchObject([
      {
        hostname: 'linear.app',
        key: 'history:99',
        rootDomain: 'linear.app',
        source: 'history',
        title: 'Linear Roadmap',
        typedCount: 2,
        url: 'https://linear.app/acme/roadmap',
        visitCount: 8,
      },
    ]);

    expect(
      buildBookmarkSearchItems([
        {
          children: [
            {
              children: [
                {
                  dateAdded: 1_600_000_000_000,
                  id: 'bookmark-1',
                  title: 'Design System',
                  url: 'https://design.example.com',
                },
              ],
              id: 'folder-1',
              title: 'Work',
            },
          ],
          id: 'root',
          title: '',
        },
      ]),
    ).toMatchObject([
      {
        folderTitle: 'Work',
        hostname: 'design.example.com',
        key: 'bookmark:bookmark-1',
        rootDomain: 'example.com',
        source: 'bookmark',
        title: 'Design System',
        url: 'https://design.example.com',
      },
    ]);
  });
});

describe('tab search filtering', () => {
  it('matches title, hostname, root domain, url, and group title', () => {
    const items = [
      item(1, {
        groupTitle: 'Work Docs',
        hostname: 'docs.google.com',
        rootDomain: 'google.com',
        title: 'Quarterly Plan',
        url: 'https://docs.google.com/document',
      }),
      item(2, {
        groupTitle: 'Source',
        hostname: 'github.com',
        rootDomain: 'github.com',
        title: 'Pull request',
        url: 'https://github.com/yunyu950908/tabcat-extension/pull/28',
      }),
    ];

    expect(filterTabSearchItems(items, 'quarterly')).toMatchObject([
      { id: 1 },
    ]);
    expect(filterTabSearchItems(items, 'google')).toMatchObject([{ id: 1 }]);
    expect(filterTabSearchItems(items, 'pull 28')).toMatchObject([{ id: 2 }]);
    expect(filterTabSearchItems(items, 'source')).toMatchObject([{ id: 2 }]);
  });

  it('matches bookmark folders and result sources', () => {
    const items = [
      item(1, {
        folderTitle: 'Research',
        hostname: 'archive.example.com',
        key: 'bookmark:1',
        source: 'bookmark',
        title: 'Archive Notes',
        url: 'https://archive.example.com',
      }),
      item(2, {
        hostname: 'calendar.example.com',
        key: 'history:2',
        source: 'history',
        title: 'Calendar',
        url: 'https://calendar.example.com',
      }),
    ];

    expect(filterTabSearchItems(items, 'research')).toMatchObject([
      { key: 'bookmark:1' },
    ]);
    expect(filterTabSearchItems(items, 'history')).toMatchObject([
      { key: 'history:2' },
    ]);
  });

  it('prefers open tabs over matching bookmarks and history when signals tie', () => {
    const items = [
      item(1, {
        key: 'history:1',
        source: 'history',
        title: 'Example dashboard',
      }),
      item(2, {
        key: 'bookmark:2',
        source: 'bookmark',
        title: 'Example dashboard',
      }),
      item(3, {
        key: 'tab:3',
        source: 'tab',
        title: 'Example dashboard',
      }),
    ];

    expect(
      filterTabSearchItems(items, 'example').map((result) => result.key),
    ).toEqual(['tab:3', 'bookmark:2', 'history:1']);
  });

  it('boosts current-window and current-group results', () => {
    const items = [
      item(1, {
        groupId: 10,
        title: 'GitHub issue',
        windowId: 2,
      }),
      item(2, {
        groupId: 20,
        title: 'GitHub pull request',
        windowId: 1,
      }),
      item(3, {
        groupId: 10,
        title: 'GitHub repository',
        windowId: 1,
      }),
    ];

    expect(
      filterTabSearchItems(items, 'github', {
        sourceGroupId: 10,
        sourceWindowId: 1,
      }).map((result) => result.id),
    ).toEqual([3, 2, 1]);
  });

  it('boosts the source tab when all other match signals are equal', () => {
    const items = [
      item(1, {
        title: 'Example dashboard',
      }),
      item(2, {
        title: 'Example dashboard',
      }),
    ];

    expect(
      filterTabSearchItems(items, 'example', {
        sourceTabId: 2,
      }).map((result) => result.id),
    ).toEqual([2, 1]);
  });

  it('supports fuzzy subsequence matching and limits results', () => {
    const items = [
      item(1, { title: 'GitHub Pull Request' }),
      item(2, { title: 'Google Calendar' }),
      item(3, { title: 'Gmail Inbox' }),
    ];

    expect(filterTabSearchItems(items, 'gpr')).toMatchObject([{ id: 1 }]);
    expect(filterTabSearchItems(items, '', { limit: 2 })).toHaveLength(2);
  });

  it('labels the source window first for display', () => {
    const labels = getTabSearchWindowLabels(
      [
        item(1, { windowId: 1 }),
        item(2, { windowId: 3 }),
        item(3, { windowId: 2 }),
      ],
      2,
    );

    expect([...labels.entries()]).toEqual([
      [2, 'Current window'],
      [1, 'Window 2'],
      [3, 'Window 3'],
    ]);
  });
});

describe('tab search activation', () => {
  it('activates the tab and focuses its window', async () => {
    const updateTab = vi.fn(async () => ({}));
    const updateWindow = vi.fn(async () => ({}));

    vi.stubGlobal('browser', {
      tabs: {
        update: updateTab,
      },
      windows: {
        update: updateWindow,
      },
    });

    await activateTabSearchItem(item(42, { windowId: 7 }));

    expect(updateTab).toHaveBeenCalledWith(42, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(7, { focused: true });
  });

  it('opens history and bookmark results in the source window', async () => {
    const createTab = vi.fn(async () => ({ windowId: 7 }));
    const updateWindow = vi.fn(async () => ({}));

    vi.stubGlobal('browser', {
      tabs: {
        create: createTab,
      },
      windows: {
        update: updateWindow,
      },
    });

    await activateTabSearchItem(
      item(42, {
        source: 'bookmark',
        url: 'https://example.com/docs',
        windowId: undefined,
      }),
      { sourceWindowId: 7 },
    );

    expect(createTab).toHaveBeenCalledWith({
      active: true,
      url: 'https://example.com/docs',
      windowId: 7,
    });
    expect(updateWindow).toHaveBeenCalledWith(7, { focused: true });
  });
});

function tab(
  id: number,
  url: string,
  overrides: Partial<Parameters<typeof buildTabSearchItems>[0][number]> = {},
) {
  return {
    active: false,
    groupId: -1,
    id,
    index: id - 1,
    pinned: false,
    title: url,
    url,
    windowId: 1,
    ...overrides,
  };
}

function item(id: number, overrides: Partial<TabSearchItem> = {}): TabSearchItem {
  return {
    active: false,
    groupId: -1,
    hostname: 'example.com',
    id,
    index: id - 1,
    key: `tab:${id}`,
    lastAccessed: 0,
    pinned: false,
    rootDomain: 'example.com',
    source: 'tab',
    title: `Example ${id}`,
    url: `https://example.com/${id}`,
    windowId: 1,
    ...overrides,
  };
}
