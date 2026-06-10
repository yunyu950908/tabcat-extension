import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  ignoredDomainsToInput,
  parseIgnoredDomainsInput,
  resetSettings,
  saveSettings,
  type GroupingMode,
  type GroupingScope,
  type TabCatSettings,
} from '@/utils/settings';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Options() {
  const [error, setError] = useState<string | null>(null);
  const [ignoredDomainsInput, setIgnoredDomainsInput] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [settings, setSettings] = useState<TabCatSettings>(DEFAULT_SETTINGS);

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default Options;
