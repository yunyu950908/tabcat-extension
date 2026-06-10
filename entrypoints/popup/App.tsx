import { useEffect, useState } from 'react';
import {
  getLastGroupingOperation,
  groupCurrentWindowTabs,
  type GroupingSummary,
  ungroupAllTabs,
  undoLastGroupingOperation,
} from '@/utils/tabGrouping';
import './App.css';

type SummaryState = {
  kind: 'tidy' | 'undo' | 'ungroup';
  summary: GroupingSummary;
};

function App() {
  const [error, setError] = useState<string | null>(null);
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

  const isBusy = isTidying || isUndoing || isUngrouping;

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
  const { kind, summary } = summaryState;
  const middleValue =
    kind === 'tidy' ? summary.groupedTabCount : summary.eligibleTabCount;
  const middleLabel =
    kind === 'tidy'
      ? 'tabs grouped'
      : kind === 'undo'
        ? 'tabs undone'
        : 'tabs ungrouped';

  return (
    <section className="summary-panel" aria-live="polite">
      <div>
        <span className="summary-number">{summary.groupCount}</span>
        <span className="summary-label">groups</span>
      </div>
      <div>
        <span className="summary-number">{middleValue}</span>
        <span className="summary-label">{middleLabel}</span>
      </div>
      <div>
        <span className="summary-number">{summary.skippedTabCount}</span>
        <span className="summary-label">skipped</span>
      </div>
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export default App;
