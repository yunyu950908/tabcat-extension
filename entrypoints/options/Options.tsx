import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type DomainRule,
  getSettings,
  ignoredDomainsToInput,
  normalizeDomainInput,
  normalizeSettings,
  parseIgnoredDomainsInput,
  resetSettings,
  saveSettings,
  type GroupingMode,
  type GroupingScope,
  type RuleAction,
  type RuleMatchMode,
  type TabCatSettings,
} from '@/utils/settings';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RuleDraft = Omit<DomainRule, 'enabled' | 'id'>;

const DEFAULT_RULE_DRAFT: RuleDraft = {
  action: 'name',
  matchMode: 'exact',
  pattern: '',
  value: '',
};

function Options() {
  const [error, setError] = useState<string | null>(null);
  const [ignoredDomainsInput, setIgnoredDomainsInput] = useState('');
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(DEFAULT_RULE_DRAFT);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [settings, setSettings] = useState<TabCatSettings>(DEFAULT_SETTINGS);
  const [settingsJson, setSettingsJson] = useState('');

  useEffect(() => {
    void getSettings()
      .then((storedSettings) => {
        setSettings(storedSettings);
        setIgnoredDomainsInput(
          ignoredDomainsToInput(storedSettings.ignoredDomains),
        );
      })
      .catch((caughtError) => {
        setError(getErrorMessage(caughtError));
      });
  }, []);

  const updateSetting = <TKey extends keyof TabCatSettings>(
    key: TKey,
    value: TabCatSettings[TKey],
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value,
    }));
    setSaveState('idle');
  };

  const updateRule = (id: string, changes: Partial<DomainRule>) => {
    updateSetting(
      'domainRules',
      settings.domainRules.map((rule) =>
        rule.id === id ? { ...rule, ...changes } : rule,
      ),
    );
  };

  const removeRule = (id: string) => {
    updateSetting(
      'domainRules',
      settings.domainRules.filter((rule) => rule.id !== id),
    );
  };

  const handleAddRule = () => {
    const pattern = normalizeDomainInput(ruleDraft.pattern);

    if (!pattern) {
      setError('Rule domain is required.');
      return;
    }

    if (ruleDraft.action !== 'ignore' && !ruleDraft.value.trim()) {
      setError('Rule group name is required.');
      return;
    }

    updateSetting('domainRules', [
      ...settings.domainRules,
      {
        action: ruleDraft.action,
        enabled: true,
        id: createRuleId(),
        matchMode: ruleDraft.matchMode,
        pattern,
        value: ruleDraft.action === 'ignore' ? '' : ruleDraft.value.trim(),
      },
    ]);
    setRuleDraft(DEFAULT_RULE_DRAFT);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    setSaveState('saving');

    try {
      const savedSettings = await saveSettings({
        ...settings,
        ignoredDomains: parseIgnoredDomainsInput(ignoredDomainsInput),
      });

      setSettings(savedSettings);
      setIgnoredDomainsInput(
        ignoredDomainsToInput(savedSettings.ignoredDomains),
      );
      setSaveState('saved');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setSaveState('error');
    }
  };

  const handleReset = async () => {
    setError(null);
    setSaveState('saving');

    try {
      const defaultSettings = await resetSettings();
      setSettings(defaultSettings);
      setIgnoredDomainsInput(
        ignoredDomainsToInput(defaultSettings.ignoredDomains),
      );
      setSaveState('saved');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setSaveState('error');
    }
  };

  const handleExportSettings = () => {
    const exportSettings = normalizeSettings({
      ...settings,
      ignoredDomains: parseIgnoredDomainsInput(ignoredDomainsInput),
    });

    setSettingsJson(JSON.stringify(exportSettings, null, 2));
    setSaveState('idle');
  };

  const handleImportSettings = async () => {
    setError(null);
    setSaveState('saving');

    try {
      const parsedSettings = JSON.parse(settingsJson) as unknown;
      const savedSettings = await saveSettings(normalizeSettings(parsedSettings));
      setSettings(savedSettings);
      setIgnoredDomainsInput(
        ignoredDomainsToInput(savedSettings.ignoredDomains),
      );
      setSettingsJson(JSON.stringify(savedSettings, null, 2));
      setSaveState('saved');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setSaveState('error');
    }
  };

  return (
    <main className="options-shell">
      <header className="options-header">
        <p className="eyebrow">TabCat</p>
        <h1>Options</h1>
      </header>

      <section className="settings-section">
        <label className="field">
          <span>Grouping mode</span>
          <select
            value={settings.groupingMode}
            onChange={(event) => {
              updateSetting('groupingMode', event.target.value as GroupingMode);
            }}
          >
            <option value="hostname">Hostname</option>
            <option value="rootDomain">Root domain</option>
          </select>
        </label>

        <label className="field">
          <span>Scope</span>
          <select
            value={settings.scope}
            onChange={(event) => {
              updateSetting('scope', event.target.value as GroupingScope);
            }}
          >
            <option value="currentWindow">Current window</option>
            <option value="allWindows">All windows</option>
          </select>
        </label>

        <label className="field">
          <span>Minimum group size</span>
          <input
            min={2}
            type="number"
            value={settings.minGroupSize}
            onChange={(event) => {
              updateSetting(
                'minGroupSize',
                Math.max(2, Number(event.target.value)),
              );
            }}
          />
        </label>

        <label className="toggle-field">
          <input
            checked={settings.includePinnedTabs}
            type="checkbox"
            onChange={(event) => {
              updateSetting('includePinnedTabs', event.target.checked);
            }}
          />
          <span>Include pinned tabs</span>
        </label>

        <label className="toggle-field">
          <input
            checked={settings.collapseNewGroups}
            type="checkbox"
            onChange={(event) => {
              updateSetting('collapseNewGroups', event.target.checked);
            }}
          />
          <span>Collapse new groups</span>
        </label>

        <label className="field field-wide">
          <span>Ignored domains</span>
          <textarea
            value={ignoredDomainsInput}
            onChange={(event) => {
              setIgnoredDomainsInput(event.target.value);
              setSaveState('idle');
            }}
          />
        </label>
      </section>

      <section className="rules-section">
        <div className="section-heading">
          <h2>Rules</h2>
        </div>

        <div className="rules-list">
          <div className="rule-row rule-header">
            <span>On</span>
            <span>Domain</span>
            <span>Match</span>
            <span>Action</span>
            <span>Group name</span>
            <span />
          </div>

          {settings.domainRules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <input
                aria-label="Enable rule"
                checked={rule.enabled}
                type="checkbox"
                onChange={(event) => {
                  updateRule(rule.id, { enabled: event.target.checked });
                }}
              />
              <input
                aria-label="Rule domain"
                value={rule.pattern}
                onChange={(event) => {
                  updateRule(rule.id, { pattern: event.target.value });
                }}
              />
              <select
                aria-label="Rule match mode"
                value={rule.matchMode}
                onChange={(event) => {
                  updateRule(rule.id, {
                    matchMode: event.target.value as RuleMatchMode,
                  });
                }}
              >
                <option value="exact">Exact</option>
                <option value="rootDomain">Root domain</option>
                <option value="suffix">Suffix</option>
              </select>
              <select
                aria-label="Rule action"
                value={rule.action}
                onChange={(event) => {
                  const action = event.target.value as RuleAction;
                  updateRule(rule.id, {
                    action,
                    value: action === 'ignore' ? '' : rule.value,
                  });
                }}
              >
                <option value="name">Name</option>
                <option value="merge">Merge</option>
                <option value="ignore">Ignore</option>
              </select>
              <input
                aria-label="Rule group name"
                disabled={rule.action === 'ignore'}
                value={rule.value}
                onChange={(event) => {
                  updateRule(rule.id, { value: event.target.value });
                }}
              />
              <button
                className="icon-action"
                onClick={() => removeRule(rule.id)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="rule-row rule-draft">
            <span />
            <input
              aria-label="New rule domain"
              value={ruleDraft.pattern}
              onChange={(event) => {
                setRuleDraft((currentDraft) => ({
                  ...currentDraft,
                  pattern: event.target.value,
                }));
              }}
            />
            <select
              aria-label="New rule match mode"
              value={ruleDraft.matchMode}
              onChange={(event) => {
                setRuleDraft((currentDraft) => ({
                  ...currentDraft,
                  matchMode: event.target.value as RuleMatchMode,
                }));
              }}
            >
              <option value="exact">Exact</option>
              <option value="rootDomain">Root domain</option>
              <option value="suffix">Suffix</option>
            </select>
            <select
              aria-label="New rule action"
              value={ruleDraft.action}
              onChange={(event) => {
                const action = event.target.value as RuleAction;
                setRuleDraft((currentDraft) => ({
                  ...currentDraft,
                  action,
                  value: action === 'ignore' ? '' : currentDraft.value,
                }));
              }}
            >
              <option value="name">Name</option>
              <option value="merge">Merge</option>
              <option value="ignore">Ignore</option>
            </select>
            <input
              aria-label="New rule group name"
              disabled={ruleDraft.action === 'ignore'}
              value={ruleDraft.value}
              onChange={(event) => {
                setRuleDraft((currentDraft) => ({
                  ...currentDraft,
                  value: event.target.value,
                }));
              }}
            />
            <button className="icon-action" onClick={handleAddRule} type="button">
              Add
            </button>
          </div>
        </div>
      </section>

      <section className="json-section">
        <div className="section-heading">
          <h2>Import / export</h2>
        </div>
        <textarea
          className="json-field"
          value={settingsJson}
          onChange={(event) => {
            setSettingsJson(event.target.value);
            setSaveState('idle');
          }}
        />
        <div className="json-actions">
          <button
            className="secondary-action"
            onClick={handleExportSettings}
            type="button"
          >
            Export JSON
          </button>
          <button
            className="secondary-action"
            disabled={!settingsJson.trim() || saveState === 'saving'}
            onClick={handleImportSettings}
            type="button"
          >
            Import JSON
          </button>
        </div>
      </section>

      <footer className="options-footer">
        <button
          className="primary-action"
          disabled={saveState === 'saving'}
          onClick={handleSave}
          type="button"
        >
          {saveState === 'saving' ? 'Saving...' : 'Save'}
        </button>
        <button
          className="secondary-action"
          disabled={saveState === 'saving'}
          onClick={handleReset}
          type="button"
        >
          Reset
        </button>
        {saveState === 'saved' && <span className="save-state">Saved</span>}
        {error && <span className="error-message">{error}</span>}
      </footer>
    </main>
  );
}

function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default Options;
