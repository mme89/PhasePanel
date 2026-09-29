import { deviceEvents, type LogEntry } from '../shared/dashboardLog';
import { readingBindings } from '../shared/totals';
import { useEffect, useState } from 'react';
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
) {
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
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
    if (graphKeys.length) {
      void api<{
        revision: number;
        sourceRevision: number;
        samples: GraphHistory;
      }>(`/dashboards/${dashboard.id}/history?minutes=60`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (
            controller.signal.aborted ||
            result.revision !== dashboard.revision ||
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
    async function refresh() {
      try {
        const result = await api<{
          revision: number;
          sourceRevision: number;
          sampledAt?: number | null;
          readings: Reading[];
        }>(`/dashboards/${dashboard!.id}/readings`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(65000),
          ]),
        });
        if (controller.signal.aborted) return;
        if (result.revision === dashboard!.revision) {
          const sourceChanged =
            sourceRevision !== undefined &&
            sourceRevision !== result.sourceRevision;
          sourceRevision = result.sourceRevision;
          if (sourceChanged) previous = new Map();
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
  return {
    events,
    readings,
    graphHistory,
    error,
    changed,
    loading,
    lastRefresh,
  };
}
