import { useEffect, useState } from 'react';
import { api } from './api';

export type AlarmStatuses = {
  sampledAt: number | null;
  dashboards: { id: string; active: boolean }[];
};

export function useAlarmStatuses(shouldPoll: boolean) {
  const [statuses, setStatuses] = useState<AlarmStatuses>();
  useEffect(() => {
    if (!shouldPoll) {
      setStatuses(undefined);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<AlarmStatuses>('/dashboards/alarm-status', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(65000),
          ]),
        });
        if (!controller.signal.aborted) setStatuses(result);
      } catch {
        // The next poll retries. Keep the last confirmed state in view.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [shouldPoll]);
  return statuses;
}
