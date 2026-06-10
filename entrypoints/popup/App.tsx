import { useEffect, useState } from 'react';
import type {
  GroupingSummary,
  TabGroupVisibilityResult,
} from '@/utils/tabGrouping';
import {
  TAB_GROUPING_ACTION_MESSAGE,
  type TabGroupingActionName,
  type TabGroupingActionResultMap,
} from '@/utils/tabGroupingMessages';
import './App.css';

type SummaryState =
  | {
      kind: 'tidy' | 'undo' | 'ungroup';
      summary: GroupingSummary;
    }
  | {
      kind: 'collapseAll' | 'expandAll';
      summary: TabGroupVisibilityResult;
    };

function App() {
  const [error, setError] = useState<string | null>(null);
  const [isCollapsingGroups, setIsCollapsingGroups] = useState(false);
  const [isExpandingGroups, setIsExpandingGroups] = useState(false);
  const [isUngrouping, setIsUngrouping] = useState(false);
  const [isTidying, setIsTidying] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);

  useEffect(() => {
    void runTabGroupingAction('getLastGroupingOperation')
      .then((operation) => {
        setUndoAvailable(Boolean(operation));
      })
      .catch((caughtError) => {
        setError(getErrorMessage(caughtError));
      });
  }, []);

  const handleTidyTabs = async () => {
    setError(null);
    setIsTidying(true);

    try {
      const result = await runTabGroupingAction('groupCurrentWindowTabs');
      setSummaryState({ kind: 'tidy', summary: result.plan.summary });
      setUndoAvailable(result.appliedGroups.length > 0);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsTidying(false);
    }
  };

  const handleUndo = async () => {
    setError(null);
    setIsUndoing(true);

    try {
      const result = await runTabGroupingAction('undoLastGroupingOperation');
      setSummaryState({
        kind: 'undo',
        summary: {
          eligibleTabCount: result.undoneTabCount,
          groupCount: 0,
          groupedTabCount: 0,
          skippedTabCount: result.skippedTabCount,
        },
      });
      setUndoAvailable(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsUndoing(false);
    }
  };

  const handleCollapseAll = async () => {
    setError(null);
    setIsCollapsingGroups(true);

    try {
      const result = await runTabGroupingAction('collapseAllTabGroups');
      setSummaryState({ kind: 'collapseAll', summary: result });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsCollapsingGroups(false);
    }
  };

  const handleExpandAll = async () => {
    setError(null);
    setIsExpandingGroups(true);

    try {
      const result = await runTabGroupingAction('expandAllTabGroups');
      setSummaryState({ kind: 'expandAll', summary: result });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsExpandingGroups(false);
    }
  };

  const handleUngroupAll = async () => {
    setError(null);
    setIsUngrouping(true);

    try {
      const result = await runTabGroupingAction('ungroupAllTabs');
      setSummaryState({
        kind: 'ungroup',
        summary: {
          eligibleTabCount: result.ungroupedTabCount,
          groupCount: result.groupCount,
          groupedTabCount: 0,
          skippedTabCount: result.skippedTabCount,
        },
      });
      setUndoAvailable(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsUngrouping(false);
    }
  };

  const isBusy =
    isTidying ||
    isUndoing ||
    isUngrouping ||
    isCollapsingGroups ||
    isExpandingGroups;

  return (
    <main className="popup-shell">
      <section className="heading">
        <p className="eyebrow">TabCat</p>
        <h1>Tidy tabs</h1>
      </section>

      <div className="actions">
        <button
          className="primary-action"
          disabled={isBusy}
          onClick={handleTidyTabs}
          type="button"
        >
          {isTidying ? 'Tidying...' : 'Group tabs'}
        </button>
        <button
          className="secondary-action"
          disabled={isBusy}
          onClick={handleCollapseAll}
          type="button"
        >
          {isCollapsingGroups ? 'Collapsing...' : 'Collapse all'}
        </button>
        <button
          className="secondary-action"
          disabled={isBusy}
          onClick={handleExpandAll}
          type="button"
        >
          {isExpandingGroups ? 'Expanding...' : 'Expand all'}
        </button>
        <button
          className="secondary-action"
          disabled={!undoAvailable || isBusy}
          onClick={handleUndo}
          type="button"
        >
          {isUndoing ? 'Undoing...' : 'Undo'}
        </button>
        <button
          className="secondary-action"
          disabled={isBusy}
          onClick={handleUngroupAll}
          type="button"
        >
          {isUngrouping ? 'Ungrouping...' : 'Ungroup all'}
        </button>
      </div>

      {summaryState && <SummaryPanel summaryState={summaryState} />}
      {error && <p className="error-message">{error}</p>}
      <button
        className="options-action"
        onClick={() => {
          void browser.runtime.openOptionsPage();
        }}
        type="button"
      >
        Options
      </button>
    </main>
  );
}

function SummaryPanel({ summaryState }: { summaryState: SummaryState }) {
  const items = getSummaryItems(summaryState);

  return (
    <section className="summary-panel" aria-live="polite">
      {items.map((item) => (
        <div key={item.label}>
          <span className="summary-number">{item.value}</span>
          <span className="summary-label">{item.label}</span>
        </div>
      ))}
    </section>
  );
}

function getSummaryItems(
  summaryState: SummaryState,
): Array<{ label: string; value: number }> {
  if (summaryState.kind === 'collapseAll') {
    return [
      { label: 'groups', value: summaryState.summary.groupCount },
      { label: 'collapsed', value: summaryState.summary.collapsedGroupCount },
      {
        label: 'already closed',
        value: summaryState.summary.unchangedGroupCount,
      },
    ];
  }

  if (summaryState.kind === 'expandAll') {
    return [
      { label: 'groups', value: summaryState.summary.groupCount },
      { label: 'expanded', value: summaryState.summary.expandedGroupCount },
      { label: 'already open', value: summaryState.summary.unchangedGroupCount },
    ];
  }

  if (
    summaryState.kind === 'tidy' ||
    summaryState.kind === 'undo' ||
    summaryState.kind === 'ungroup'
  ) {
    const { kind, summary } = summaryState;
    const middleValue =
      kind === 'tidy' ? summary.groupedTabCount : summary.eligibleTabCount;
    const middleLabel =
      kind === 'tidy'
        ? 'tabs grouped'
        : kind === 'undo'
          ? 'tabs undone'
          : 'tabs ungrouped';

    return [
      { label: 'groups', value: summary.groupCount },
      { label: middleLabel, value: middleValue },
      { label: 'skipped', value: summary.skippedTabCount },
    ];
  }

  return [];
}

async function runTabGroupingAction<TAction extends TabGroupingActionName>(
  action: TAction,
): Promise<TabGroupingActionResultMap[TAction]> {
  return browser.runtime.sendMessage({
    action,
    type: TAB_GROUPING_ACTION_MESSAGE,
  }) as Promise<TabGroupingActionResultMap[TAction]>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default App;
