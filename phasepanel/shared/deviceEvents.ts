export const deviceEventTypes = [
  'Overvoltage',
  'Undervoltage',
  'Overcurrent',
  'Voltage outage',
  'Other event',
] as const;

export type DeviceEventType = (typeof deviceEventTypes)[number];

export type DeviceEvent = {
  project: string;
  deviceId: string;
  deviceName: string;
  host: string;
  startedAtMs: number;
  endedAtMs: number;
  reason: number;
  type: string;
  phase: string | null;
  unit: 'V' | 'A' | null;
  threshold: number;
  minimum: number;
  maximum: number;
  average: number;
};

export type DeviceEventFetchStatus = {
  project: string;
  deviceId: string;
  deviceName: string;
  host: string;
  lastAttemptMs: number;
  lastSuccessMs: number | null;
  error: string | null;
};
