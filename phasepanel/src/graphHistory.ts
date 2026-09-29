import type { Reading } from '../shared/model';

export type GraphSample = {
  time: number;
  value: number | null;
  status?: Reading['status'];
  unit?: string;
  sourceTimestampNs?: string | null;
};
export type GraphHistory = Record<string, GraphSample[]>;

const RETAIN_MS = 60 * 60 * 1000;
const MAX_SAMPLES = 3600;

export function appendGraphHistory(
  history: GraphHistory,
  keys: string[],
  readings: Reading[] | null,
  time: number,
): GraphHistory {
  const byKey = new Map(readings?.map((reading) => [reading.key, reading]));
  const next: GraphHistory = {};
  for (const key of keys) {
    if (history[key]?.some((sample) => sample.time === time)) {
      next[key] = history[key];
      continue;
    }
    const reading = byKey.get(key);
    const value =
      reading?.status === 'ok' &&
      reading.value !== null &&
      Number.isFinite(reading.value)
        ? reading.value
        : null;
    next[key] = [
      ...(history[key] ?? []),
      {
        time,
        value,
        status: reading?.status ?? (readings ? 'unavailable' : 'error'),
        unit: reading?.unit ?? '',
        sourceTimestampNs: reading?.sourceTimestampNs ?? null,
      },
    ]
      .filter((sample) => sample.time >= time - RETAIN_MS)
      .slice(-MAX_SAMPLES);
  }
  return next;
}

export function mergeGraphHistory(
  current: GraphHistory,
  saved: GraphHistory,
  keys: string[],
  now: number,
): GraphHistory {
  const next: GraphHistory = {};
  for (const key of keys) {
    const byTime = new Map(
      [
        ...(saved[key] ?? []).map((sample) => ({
          ...sample,
          value: sample.status && sample.status !== 'ok' ? null : sample.value,
        })),
        ...(current[key] ?? []),
      ].map((sample) => [sample.time, sample]),
    );
    next[key] = [...byTime.values()]
      .filter((sample) => sample.time >= now - RETAIN_MS)
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_SAMPLES);
  }
  return next;
}
