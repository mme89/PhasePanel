export type DeviceRecordingField = { name: string; unit: string };

export type DeviceRecordingProfile = {
  id: string;
  intervalSeconds: number;
  kind: 'range' | 'sample';
  fields: DeviceRecordingField[];
  files: {
    name: string;
    size: number;
    storedSize?: number;
    modifiedAt: string | null;
    storedAt?: string;
    range?: DeviceRecordingRange | null;
  }[];
};

export type DeviceRecordingPoint = {
  startMs: number;
  time: number;
  value: number;
};

export type DeviceRecordingRange = {
  startMs: number;
  endMs: number;
};

export type RecordingSyncScope = 'recording' | 'device' | 'all';

export type RecordingSyncTimings = {
  connectMs: number;
  setupMs: number;
  downloadMs: number;
  saveMs: number;
};

export type RecordingSyncFileTiming = {
  name: string;
  deviceName?: string;
  bytes: number;
  durationMs: number;
};

export type RecordingSyncJob = {
  id: string;
  scope: RecordingSyncScope;
  measureAll: boolean;
  state: 'running' | 'complete' | 'failed' | 'canceled';
  phase: string;
  current: string;
  retry: { attempt: number; total: number; retryAtMs: number | null } | null;
  done: number;
  total: number;
  downloaded: number;
  downloadedBytes: number;
  transferDurationMs: number;
  timings: RecordingSyncTimings;
  fileTimings: RecordingSyncFileTiming[];
  skipped: number;
  failedFiles: number;
  unavailableDevices: number;
  notice: string;
  error: string;
};
