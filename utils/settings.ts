export type GroupingMode = 'hostname' | 'rootDomain';
export type GroupingScope = 'currentWindow' | 'allWindows';

export interface TabCatSettings {
  collapseNewGroups: boolean;
  groupingMode: GroupingMode;
  ignoredDomains: string[];
  includePinnedTabs: boolean;
  minGroupSize: number;
  scope: GroupingScope;
}

export const DEFAULT_SETTINGS: TabCatSettings = {
  collapseNewGroups: false,
  groupingMode: 'hostname',
  ignoredDomains: [],
  includePinnedTabs: false,
  minGroupSize: 2,
  scope: 'currentWindow',
};

const SETTINGS_KEY = 'tabcat:settings';

export async function getSettings(): Promise<TabCatSettings> {
  const stored = await browser.storage.sync.get(SETTINGS_KEY);

  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(
  nextSettings: Partial<TabCatSettings>,
): Promise<TabCatSettings> {
  const currentSettings = await getSettings();
  const settings = normalizeSettings({
    ...currentSettings,
    ...nextSettings,
  });

  await browser.storage.sync.set({
    [SETTINGS_KEY]: settings,
  });

  return settings;
}

export async function resetSettings(): Promise<TabCatSettings> {
  await browser.storage.sync.set({
    [SETTINGS_KEY]: DEFAULT_SETTINGS,
  });

  return DEFAULT_SETTINGS;
}

export function parseIgnoredDomainsInput(value: string): string[] {
  const domains = value
    .split(/[\n,]/)
    .map(normalizeDomainInput)
    .filter((domain): domain is string => Boolean(domain));

  return [...new Set(domains)].sort((a, b) => a.localeCompare(b));
}

export function ignoredDomainsToInput(domains: string[]): string {
  return domains.join('\n');
}

function normalizeSettings(value: unknown): TabCatSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }

  const settings = value as Partial<TabCatSettings>;

  return {
    collapseNewGroups:
      settings.collapseNewGroups ?? DEFAULT_SETTINGS.collapseNewGroups,
    groupingMode:
      settings.groupingMode === 'rootDomain' ? 'rootDomain' : 'hostname',
    ignoredDomains: Array.isArray(settings.ignoredDomains)
      ? parseIgnoredDomainsInput(settings.ignoredDomains.join('\n'))
      : DEFAULT_SETTINGS.ignoredDomains,
    includePinnedTabs:
      settings.includePinnedTabs ?? DEFAULT_SETTINGS.includePinnedTabs,
    minGroupSize: Math.max(
      2,
      Number.isFinite(settings.minGroupSize)
        ? Number(settings.minGroupSize)
        : DEFAULT_SETTINGS.minGroupSize,
    ),
    scope: settings.scope === 'allWindows' ? 'allWindows' : 'currentWindow',
  };
}

function normalizeDomainInput(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostname = withoutProtocol.split('/')[0].split('?')[0].split('#')[0];

  return hostname.replace(/:\d+$/, '').replace(/^www\./, '') || null;
}
