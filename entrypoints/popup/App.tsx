import { useEffect, useState } from 'react';
import {
  getLastGroupingOperation,
  groupCurrentWindowTabsByHostname,
  type GroupingSummary,
  undoLastGroupingOperation,
} from '@/utils/tabGrouping';
import './App.css';

type SummaryState = {
  kind: 'tidy' | 'undo';
  summary: GroupingSummary;
};

function App() {
  const [error, setError] = useState<string | null>(null);
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
      const result = await groupCurrentWindowTabsByHostname();
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

  return (
    <main className="popup-shell">
      <section className="heading">
        <p className="eyebrow">TabCat</p>
        <h1>Tidy tabs</h1>
      </section>

      <div className="actions">
        <button
          className="primary-action"
          disabled={isTidying || isUndoing}
          onClick={handleTidyTabs}
          type="button"
        >
          {isTidying ? 'Tidying...' : 'Group tabs'}
        </button>
        <button
          className="secondary-action"
          disabled={!undoAvailable || isTidying || isUndoing}
          onClick={handleUndo}
          type="button"
        >
          {isUndoing ? 'Undoing...' : 'Undo'}
        </button>
      </div>

      {summaryState && <SummaryPanel summaryState={summaryState} />}
      {error && <p className="error-message">{error}</p>}
    </main>
  );
}

function SummaryPanel({ summaryState }: { summaryState: SummaryState }) {
  const { kind, summary } = summaryState;
  const middleValue =
    kind === 'tidy' ? summary.groupedTabCount : summary.eligibleTabCount;
  const middleLabel = kind === 'tidy' ? 'tabs grouped' : 'tabs undone';

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
