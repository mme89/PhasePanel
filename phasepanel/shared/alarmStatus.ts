import {
  bindingKey,
  isMeasurementTile,
  isTotalTile,
  type Dashboard,
  type Reading,
} from './model.js';
import {
  dashboardMeasurementDefaults,
  defaultsForMeasurement,
  evaluateRange,
  withDashboardDefaults,
} from './range.js';
import { totalReading } from './totals.js';

type AlarmState = {
  direction: 'normal' | 'low' | 'high';
  candidate: 'normal' | 'low' | 'high';
  count: number;
  signature: string;
};

export function advanceAlarmStates(
  dashboard: Dashboard,
  readings: Reading[],
  previous: Map<string, AlarmState>,
  sampledAt: number,
  staleMs: number,
): { states: Map<string, AlarmState>; alarm: boolean; active: boolean } {
  const defaults = dashboardMeasurementDefaults(dashboard);
  const byKey = new Map(readings.map((reading) => [reading.key, reading]));
  const states = new Map<string, AlarmState>();
  let alarm = false;
  let active = false;
  for (const tile of dashboard.widgets) {
    if (!isMeasurementTile(tile) && !isTotalTile(tile)) continue;
    const resolved = isMeasurementTile(tile)
      ? withDashboardDefaults(
          tile,
          defaultsForMeasurement(defaults, tile.binding.measurement, tile.unit),
        )
      : tile;
    if (!resolved.range) continue;
    const signature = JSON.stringify([resolved.range.min, resolved.range.max]);
    const old = previous.get(tile.id);
    const state: AlarmState =
      old?.signature === signature
        ? { ...old }
        : { direction: 'normal', candidate: 'normal', count: 0, signature };
    const reading = isTotalTile(resolved)
      ? totalReading(resolved, readings)
      : byKey.get(bindingKey(resolved.binding));
    const timestamp = Date.parse(
      reading?.sourceTime ?? reading?.retrievedAt ?? '',
    );
    const valid =
      reading?.status === 'ok' &&
      reading.value !== null &&
      Number.isFinite(reading.value) &&
      Number.isFinite(timestamp) &&
      sampledAt - timestamp <= staleMs;
    if (!valid) {
      state.candidate = 'normal';
      state.count = 0;
    } else {
      const rangeState = evaluateRange(reading.value, resolved.range).state;
      const observed: AlarmState['direction'] =
        rangeState === 'low'
          ? 'low'
          : rangeState === 'high'
            ? 'high'
            : 'normal';
      if (observed === state.direction) {
        state.candidate = 'normal';
        state.count = 0;
      } else {
        state.count = state.candidate === observed ? state.count + 1 : 1;
        state.candidate = observed;
        if (state.count >= 2) {
          state.direction = observed;
          state.candidate = 'normal';
          state.count = 0;
          if (observed === 'low' || observed === 'high') alarm = true;
        }
      }
    }
    if (valid && (state.direction === 'low' || state.direction === 'high'))
      active = true;
    states.set(tile.id, state);
  }
  return { states, alarm, active };
}
