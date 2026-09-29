export type LogEntry = {
  id: number;
  time: string;
  level: 'info' | 'warning' | 'error';
  message: string;
};

import { bindingKey, type DashboardTile, type Reading } from './model.js';
import { measurementSources } from './totals.js';

// Infer data availability from existing readings; never run connection tests.
export function deviceEvents(
  previous: Map<string, boolean>,
  readings: Reading[],
  tiles: DashboardTile[],
) {
  const byKey = new Map(readings.map((reading) => [reading.key, reading]));
  const devices = new Map<string, { label: string; available: boolean }>();
  for (const source of tiles.flatMap(measurementSources)) {
    const { project, deviceId } = source.binding;
    const key = JSON.stringify([project, deviceId]);
    const device = devices.get(key) ?? {
      label: source.deviceName || deviceId,
      available: false,
    };
    const reading = byKey.get(bindingKey(source.binding));
    device.available ||=
      !!reading &&
      reading.status === 'ok' &&
      reading.value !== null &&
      Number.isFinite(reading.value);
    devices.set(key, device);
  }
  const availability = new Map<string, boolean>();
  const events: Omit<LogEntry, 'id' | 'time'>[] = [];
  for (const [key, device] of devices) {
    availability.set(key, device.available);
    const before = previous.get(key);
    if (
      before === device.available ||
      (before === undefined && device.available)
    )
      continue;
    events.push({
      level: device.available ? 'info' : 'warning',
      message: `${device.label}: ${device.available ? 'available again' : 'missing'}`,
    });
  }
  return { availability, events };
}
