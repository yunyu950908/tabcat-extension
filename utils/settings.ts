export type GroupingMode = 'hostname' | 'rootDomain';
export type GroupingScope = 'currentWindow' | 'allWindows';
export type RuleAction = 'ignore' | 'merge' | 'name';
export type RuleMatchMode = 'exact' | 'rootDomain' | 'suffix';

export interface DomainRule {
  action: RuleAction;
  enabled: boolean;
  id: string;
  matchMode: RuleMatchMode;
  pattern: string;
  value: string;
}

export interface TabCatSettings {
  autoGroupNewTabs: boolean;
  arrangeTabsAfterGrouping: boolean;
  collapseNewGroups: boolean;
  domainRules: DomainRule[];
  groupingMode: GroupingMode;
  ignoredDomains: string[];
  includePinnedTabs: boolean;
  minGroupSize: number;
  scope: GroupingScope;
}

export const DEFAULT_SETTINGS: TabCatSettings = {
  autoGroupNewTabs: false,
  arrangeTabsAfterGrouping: true,
  collapseNewGroups: false,
  domainRules: [],
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

export function normalizeSettings(value: unknown): TabCatSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }

  const settings = value as Partial<TabCatSettings>;
  const minGroupSize = Number(settings.minGroupSize);

  return {
    autoGroupNewTabs: settings.autoGroupNewTabs === true,
    arrangeTabsAfterGrouping: settings.arrangeTabsAfterGrouping !== false,
    collapseNewGroups: settings.collapseNewGroups === true,
    domainRules: Array.isArray(settings.domainRules)
      ? settings.domainRules
          .map(normalizeDomainRule)
          .filter((rule): rule is DomainRule => Boolean(rule))
      : DEFAULT_SETTINGS.domainRules,
    groupingMode:
      settings.groupingMode === 'rootDomain' ? 'rootDomain' : 'hostname',
    ignoredDomains: Array.isArray(settings.ignoredDomains)
      ? parseIgnoredDomainsInput(settings.ignoredDomains.join('\n'))
      : DEFAULT_SETTINGS.ignoredDomains,
    includePinnedTabs: settings.includePinnedTabs === true,
    minGroupSize: Math.max(
      2,
      Number.isFinite(minGroupSize) ? minGroupSize : DEFAULT_SETTINGS.minGroupSize,
    ),
    scope: settings.scope === 'allWindows' ? 'allWindows' : 'currentWindow',
  };
}

export function normalizeDomainInput(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (/\s/.test(trimmed)) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostname = withoutProtocol.split('/')[0].split('?')[0].split('#')[0];

  return hostname.replace(/:\d+$/, '').replace(/^www\./, '') || null;
}

function normalizeDomainRule(value: unknown): DomainRule | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rule = value as Partial<DomainRule>;
  const action = normalizeRuleAction(rule.action);
  const matchMode = normalizeRuleMatchMode(rule.matchMode);
  const pattern =
    typeof rule.pattern === 'string'
      ? normalizeDomainInput(rule.pattern)
      : null;
  const ruleValue = typeof rule.value === 'string' ? rule.value.trim() : '';

  if (!pattern || !action || !matchMode) {
    return null;
  }

  if ((action === 'merge' || action === 'name') && !ruleValue) {
    return null;
  }

  return {
    action,
    enabled: rule.enabled !== false,
    id: typeof rule.id === 'string' && rule.id ? rule.id : createRuleId(),
    matchMode,
    pattern,
    value: action === 'ignore' ? '' : ruleValue,
  };
}

function normalizeRuleAction(action: unknown): RuleAction | null {
  if (action === 'ignore' || action === 'merge' || action === 'name') {
    return action;
  }

  return null;
}

function normalizeRuleMatchMode(matchMode: unknown): RuleMatchMode | null {
  if (
    matchMode === 'exact' ||
    matchMode === 'rootDomain' ||
    matchMode === 'suffix'
  ) {
    return matchMode;
  }

  return null;
}

function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
