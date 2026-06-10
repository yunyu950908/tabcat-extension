import { describe, expect, it } from 'vitest';
import {
  buildGroupingPlan,
  buildHostnameGroupingPlan,
  getHostnameGroupingKey,
  getRootDomainGroupingKey,
  normalizeHostname,
  type TabLike,
} from './tabGrouping';
import { parseIgnoredDomainsInput } from './settings';

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
});

describe('settings helpers', () => {
  it('normalizes ignored domain input', () => {
    expect(
      parseIgnoredDomainsInput(
        'https://www.github.com/a\nDocs.Google.com, localhost:3000',
      ),
    ).toEqual(['docs.google.com', 'github.com', 'localhost']);
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
