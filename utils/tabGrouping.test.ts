import { describe, expect, it } from 'vitest';
import {
  buildAutoGroupPlan,
  buildGroupingPlan,
  buildHostnameGroupingPlan,
  getHostnameGroupingKey,
  getRootDomainGroupingKey,
  normalizeHostname,
  type TabLike,
} from './tabGrouping';
import { normalizeSettings, parseIgnoredDomainsInput } from './settings';

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
      { id: 1, key: 'docs.google.com', reason: 'ignored-domain' },
      { id: 2, key: 'docs.google.com', reason: 'ignored-domain' },
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

describe('settings helpers', () => {
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
      autoGroupNewTabs: false,
      collapseNewGroups: false,
      ignoredDomains: ['valid.com'],
      includePinnedTabs: false,
      minGroupSize: 4,
    });
  });

  it('normalizes auto group settings safely', () => {
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
      autoGroupNewTabs: false,
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
