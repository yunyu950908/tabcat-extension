import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activateTabSearchItem,
  filterTabSearchItems,
  getTabSearchWindowLabels,
  loadTabSearchItems,
  type TabSearchContext,
  type TabSearchItem,
  type TabSearchResult,
} from '@/utils/tabSearch';
import './TabSwitcher.css';

function TabSwitcher() {
  const [context] = useState(parseContext);
  const [error, setError] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<TabSearchItem[]>([]);
  const [paletteWindowId, setPaletteWindowId] = useState<number | undefined>();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let isMounted = true;

    void loadItems(context)
      .then(({ items: loadedItems, windowId }) => {
        if (!isMounted) return;
        setItems(loadedItems);
        setPaletteWindowId(windowId);
      })
      .catch(() => {
        if (!isMounted) return;
        setError('Could not load tabs.');
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [context]);

  const results = useMemo(
    () =>
      filterTabSearchItems(items, query, {
        sourceGroupId: context.sourceGroupId,
        sourceTabId: context.sourceTabId,
        sourceWindowId: context.sourceWindowId,
      }),
    [
      context.sourceGroupId,
      context.sourceTabId,
      context.sourceWindowId,
      items,
      query,
    ],
  );
  const windowLabels = useMemo(
    () => getTabSearchWindowLabels(items, context.sourceWindowId),
    [context.sourceWindowId, items],
  );

  useEffect(() => {
    setSelectedIndex((currentIndex) =>
      results.length === 0 ? 0 : Math.min(currentIndex, results.length - 1),
    );
  }, [results.length]);

  const selectedItem = results[selectedIndex];

  const activateSelectedItem = async (item: TabSearchResult | undefined) => {
    if (!item || isActivating) return;

    setIsActivating(true);

    try {
      await activateTabSearchItem(item);
      await closePaletteWindow(paletteWindowId);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setIsActivating(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((currentIndex) =>
        results.length === 0 ? 0 : (currentIndex + 1) % results.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((currentIndex) =>
        results.length === 0
          ? 0
          : (currentIndex - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void activateSelectedItem(selectedItem);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      void closePaletteWindow(paletteWindowId);
    }
  };

  return (
    <main className="switcher-shell">
      <section className="search-surface">
        <div className="search-bar">
          <div className="search-mark" aria-hidden="true">
            T
          </div>
          <input
            ref={inputRef}
            aria-label="Search tabs"
            placeholder="Search tabs"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <section className="results-panel" aria-live="polite">
          {isLoading && <EmptyState label="Loading tabs..." />}
          {!isLoading && error && <EmptyState label={error} tone="error" />}
          {!isLoading && !error && results.length === 0 && (
            <EmptyState label={query ? 'No matching tabs' : 'No tabs found'} />
          )}
          {!isLoading &&
            !error &&
            results.map((item, index) => (
              <ResultItem
                key={item.id}
                item={item}
                isSelected={index === selectedIndex}
                windowLabel={
                  windowLabels.get(item.windowId) ?? `Window ${item.windowId}`
                }
                onActivate={() => {
                  void activateSelectedItem(item);
                }}
                onSelect={() => {
                  setSelectedIndex(index);
                }}
              />
            ))}
        </section>
      </section>
    </main>
  );
}

function ResultItem({
  isSelected,
  item,
  onActivate,
  onSelect,
  windowLabel,
}: {
  isSelected: boolean;
  item: TabSearchResult;
  onActivate: () => void;
  onSelect: () => void;
  windowLabel: string;
}) {
  return (
    <button
      aria-selected={isSelected}
      className="result-item"
      type="button"
      onClick={onActivate}
      onMouseEnter={onSelect}
    >
      <span className="favicon-frame">
        {item.favIconUrl ? (
          <img
            alt=""
            src={item.favIconUrl}
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span>{getFallbackIcon(item)}</span>
        )}
      </span>
      <span className="result-copy">
        <span className="result-title">{item.title}</span>
        <span className="result-meta">
          <span>{item.hostname || item.url}</span>
          {item.groupTitle && (
            <>
              <span aria-hidden="true">/</span>
              <span className="group-chip">
                <span
                  className="group-dot"
                  style={{ background: getGroupColor(item.groupColor) }}
                />
                {item.groupTitle}
              </span>
            </>
          )}
          <span aria-hidden="true">/</span>
          <span>{windowLabel}</span>
          {item.active && (
            <>
              <span aria-hidden="true">/</span>
              <span>Current</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function EmptyState({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'error' | 'neutral';
}) {
  return <div className={`empty-state empty-state-${tone}`}>{label}</div>;
}

async function loadItems(context: TabSearchContext): Promise<{
  items: TabSearchItem[];
  windowId?: number;
}> {
  const currentWindow = await browser.windows.getCurrent();
  const items = await loadTabSearchItems({
    ...context,
    paletteWindowId: currentWindow.id,
  });

  return { items, windowId: currentWindow.id };
}

async function closePaletteWindow(windowId?: number): Promise<void> {
  if (windowId != null) {
    await browser.windows.remove(windowId);
    return;
  }

  window.close();
}

function parseContext(): TabSearchContext {
  const params = new URLSearchParams(window.location.search);

  return {
    sourceGroupId: parseNumberParam(params.get('sourceGroupId')),
    sourceTabId: parseNumberParam(params.get('sourceTabId')),
    sourceWindowId: parseNumberParam(params.get('sourceWindowId')),
  };
}

function parseNumberParam(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function getFallbackIcon(item: TabSearchItem): string {
  return (item.hostname || item.title || '?').slice(0, 1).toUpperCase();
}

function getGroupColor(color?: string): string {
  const colors: Record<string, string> = {
    blue: '#1a73e8',
    cyan: '#0891b2',
    green: '#188038',
    grey: '#5f6368',
    orange: '#fa7b17',
    pink: '#d01884',
    purple: '#9334e6',
    red: '#d93025',
    yellow: '#f9ab00',
  };

  return colors[color ?? ''] ?? '#64748b';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Could not load tabs.';
}

export default TabSwitcher;
