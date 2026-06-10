import { useEffect, useState } from 'react';
import {
  collapseOtherTabGroups,
  expandAllTabGroups,
  getLastGroupingOperation,
  groupCurrentWindowTabs,
  type GroupingSummary,
  type TabGroupVisibilityResult,
  ungroupAllTabs,
  undoLastGroupingOperation,
} from '@/utils/tabGrouping';
import './App.css';

type SummaryState =
  | {
      kind: 'tidy' | 'undo' | 'ungroup';
      summary: GroupingSummary;
    }
  | {
      kind: 'collapseOthers' | 'expandAll';
      summary: TabGroupVisibilityResult;
    };

function App() {
  const [error, setError] = useState<string | null>(null);
  const [isCollapsingOthers, setIsCollapsingOthers] = useState(false);
  const [isExpandingGroups, setIsExpandingGroups] = useState(false);
  const [isUngrouping, setIsUngrouping] = useState(false);
  const [isTidying, setIsTidying] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);

  useEffect(() => {
    void getLastGroupingOperation()
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
      const result = await groupCurrentWindowTabs();
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
      const result = await undoLastGroupingOperation();
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

  const handleCollapseOthers = async () => {
    setError(null);
    setIsCollapsingOthers(true);

    try {
      const result = await collapseOtherTabGroups();

      if (result.activeGroupId == null) {
        setError('Open a tab inside a group first.');
        return;
      }

      setSummaryState({ kind: 'collapseOthers', summary: result });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsCollapsingOthers(false);
    }
  };

  const handleExpandAll = async () => {
    setError(null);
    setIsExpandingGroups(true);

    try {
      const result = await expandAllTabGroups();
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
      const result = await ungroupAllTabs();
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
    isCollapsingOthers ||
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
          onClick={handleCollapseOthers}
          type="button"
        >
          {isCollapsingOthers ? 'Collapsing...' : 'Collapse others'}
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
  if (summaryState.kind === 'collapseOthers') {
    return [
      { label: 'groups', value: summaryState.summary.groupCount },
      { label: 'collapsed', value: summaryState.summary.collapsedGroupCount },
      {
        label: 'kept open',
        value: summaryState.summary.activeGroupId == null ? 0 : 1,
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default App;
