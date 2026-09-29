import type {
  DeviceRecordingProfile,
  DeviceRecordingRange,
  RecordingSyncTimings,
} from '../shared/deviceHistory';
import { recordingTitle } from '../shared/deviceRecordingLabels';
export { recordingFieldLabel } from '../shared/deviceRecordingLabels';

export function recordingInterval(seconds: number) {
  if (seconds === 1) return 'every second';
  if (seconds < 60) return `every ${seconds} seconds`;
  if (seconds === 60) return 'every minute';
  if (seconds < 3600 && seconds % 60 === 0)
    return `every ${seconds / 60} minutes`;
  if (seconds === 3600) return 'hourly';
  if (seconds % 3600 === 0) return `every ${seconds / 3600} hours`;
  return `every ${seconds} seconds`;
}

function byteSize(bytes: number, smallPrecision = 1) {
  const [divisor, unit] =
    bytes >= 1_000_000_000
      ? [1_000_000_000, 'GB']
      : bytes >= 1_000_000
        ? [1_000_000, 'MB']
        : [1000, 'KB'];
  const value = bytes / divisor;
  return `${value.toFixed(value < 10 ? smallPrecision : 1)} ${unit}`;
}

function duration(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function recordingFileSize(bytes: number) {
  return byteSize(bytes, 2);
}

export function syncTransferLabel(bytes: number, durationMs: number) {
  const transferred = `${byteSize(bytes)} transferred`;
  if (bytes === 0 || durationMs <= 0) return transferred;
  return `${transferred} · ${byteSize((bytes * 1000) / durationMs)}/s average`;
}

export function syncTimingLabel(timings: RecordingSyncTimings) {
  return `Connection ${duration(timings.connectMs)} · preparation ${duration(timings.setupMs)} · downloads ${duration(timings.downloadMs)} · saving ${duration(timings.saveMs)}`;
}

export function syncFileDuration(ms: number) {
  return duration(ms);
}

export function syncFileRate(bytes: number, durationMs: number) {
  return durationMs > 0 ? `${byteSize((bytes * 1000) / durationMs)}/s` : '—';
}

export function recordingLabel(profile: DeviceRecordingProfile) {
  return `${recordingTitle(profile)} · ${recordingInterval(profile.intervalSeconds)} · ${profile.files.length} ${profile.files.length === 1 ? 'file' : 'files'}`;
}

export function recordingFileLabel(
  name: string,
  latest: boolean,
  range?: DeviceRecordingRange | null,
) {
  const sequence = /\.(\d+)$/.exec(name);
  const segment = sequence
    ? `${latest ? 'Latest segment' : 'Segment'} ${Number(sequence[1])}`
    : name;
  if (!range) return segment;
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  const startLabel = start.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const endLabel = end.toLocaleString(undefined, {
    year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric',
    month: start.toDateString() === end.toDateString() ? undefined : 'short',
    day: start.toDateString() === end.toDateString() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${startLabel} – ${endLabel} · ${segment}`;
}
