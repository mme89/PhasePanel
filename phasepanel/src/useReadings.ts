import { deviceEvents, type LogEntry } from '../shared/dashboardLog';
import { readingBindings, withTotalReadings } from '../shared/totals';
import { useEffect, useMemo, useState } from 'react';
import {
  bindingKey,
  isGraphTile,
  isMeasurementTile,
  type Dashboard,
  type Reading,
} from '../shared/model';
import { api, message } from './api';
import {
  appendGraphHistory,
  mergeGraphHistory,
  type GraphHistory,
} from './graphHistory';
export function useReadings(
  dashboard: Dashboard | undefined,
  expectedSourceRevision?: number,
  historyVersion = 0,
  draft?: Dashboard,
) {
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [previewReadings, setPreviewReadings] = useState<Reading[]>([]);
  const [graphHistory, setGraphHistory] = useState<GraphHistory>({});
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>();
  useEffect(() => {
    setReadings([]);
    setGraphHistory({});
    setEvents([]);
    let previous = new Map<string, boolean>();
    let sequence = 0;
    let sourceRevision: number | undefined;
    setError('');
    setChanged(false);
    setLastRefresh(undefined);
    if (!dashboard || !readingBindings(dashboard.widgets).length) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const graphKeys = [
      ...new Set(
        dashboard.widgets.flatMap((widget) =>
          isGraphTile(widget)
            ? widget.sources.map((source) => bindingKey(source.binding))
            : isMeasurementTile(widget) &&
                (widget.display === 'graph' || widget.display === 'sparkline')
              ? [bindingKey(widget.binding)]
              : [],
        ),
      ),
    ];
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    function loadHistory() {
      if (!graphKeys.length) return;
      void api<{
        revision: number;
        sourceRevision: number;
        samples: GraphHistory;
      }>(`/dashboards/${dashboard!.id}/history?minutes=60`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (
            controller.signal.aborted ||
            result.revision !== dashboard!.revision ||
            (sourceRevision !== undefined &&
              sourceRevision !== result.sourceRevision)
          )
            return;
          sourceRevision = result.sourceRevision;
          setGraphHistory((current) =>
            mergeGraphHistory(current, result.samples, graphKeys, Date.now()),
          );
        })
        .catch(() => {
          // Live polling remains available when the history endpoint fails.
        });
    }
    loadHistory();
    async function refresh() {
      try {
        const result = await api<{
          revision: number;
          sourceRevision: number;
          sampledAt?: number | null;
          readings: Reading[];
        }>(`/dashboards/${dashboard!.id}/readings`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (result.revision === dashboard!.revision) {
          const sourceChanged =
            sourceRevision !== undefined &&
            sourceRevision !== result.sourceRevision;
          sourceRevision = result.sourceRevision;
          if (sourceChanged) {
            previous = new Map();
            loadHistory();
          }
          if (graphKeys.length) {
            const sampledAt = result.sampledAt ?? Date.now();
            setGraphHistory((current) =>
              appendGraphHistory(
                sourceChanged ? {} : current,
                graphKeys,
                result.readings,
                sampledAt,
              ),
            );
          }
          const changes = deviceEvents(
            previous,
            result.readings,
            dashboard!.widgets,
          );
          previous = changes.availability;
          if (changes.events.length) {
            const time = new Date().toISOString();
            const added = changes.events.map((entry) => ({
              ...entry,
              id: ++sequence,
              time,
            }));
            setEvents((current) => [...current, ...added].slice(-500));
          }
        }
        setReadings(result.readings);
        setError('');
        setChanged(result.revision !== dashboard!.revision);
        setLastRefresh(new Date(result.sampledAt ?? Date.now()).toISOString());
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(message(e));
          if (graphKeys.length)
            setGraphHistory((current) =>
              appendGraphHistory(current, graphKeys, null, Date.now()),
            );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          // Schedule after completion, so a slow upstream cannot create overlapping polls.
          timer = setTimeout(refresh, dashboard!.refreshSeconds * 1000);
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    dashboard?.id,
    dashboard?.revision,
    dashboard?.refreshSeconds,
    expectedSourceRevision,
    historyVersion,
  ]);
  const extraBindingsKey = useMemo(() => {
    if (!draft) return '';
    const savedKeys = new Set(
      (dashboard ? readingBindings(dashboard.widgets) : []).map(bindingKey),
    );
    const extra = readingBindings(draft.widgets).filter(
      (b) => !savedKeys.has(bindingKey(b)),
    );
    return extra.length ? JSON.stringify(extra) : '';
  }, [dashboard, draft]);
  useEffect(() => {
    if (!extraBindingsKey) {
      setPreviewReadings([]);
      return;
    }
    const controller = new AbortController();
    const bindings = JSON.parse(extraBindingsKey);
    const refreshMs = Math.max(1, (draft?.refreshSeconds ?? 5) * 1000);
    let timer: ReturnType<typeof setTimeout>;
    async function pollPreview() {
      try {
        const result = await api<{ readings: Reading[] }>('/readings/preview', {
          method: 'POST',
          body: JSON.stringify({ bindings }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setPreviewReadings(result.readings);
      } catch {
        // Preview failures never override saved dashboard polling status.
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(pollPreview, refreshMs);
      }
    }
    const debounce = setTimeout(() => void pollPreview(), 150);
    return () => {
      controller.abort();
      clearTimeout(debounce);
      clearTimeout(timer);
    };
  }, [extraBindingsKey, draft?.refreshSeconds, expectedSourceRevision]);
  const combinedReadings = useMemo(() => {
    if (!draft) return readings;
    const byKey = new Map(readings.map((r) => [r.key, r]));
    for (const r of previewReadings) byKey.set(r.key, r);
    return withTotalReadings(draft.widgets, [...byKey.values()]);
  }, [draft, readings, previewReadings]);
  return {
    events,
    readings: combinedReadings,
    graphHistory,
    error,
    changed,
    loading,
    lastRefresh,
  };
}
