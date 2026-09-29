import {
  bindingKey,
  isMeasurementTile,
  isTotalTile,
  type Dashboard,
} from '../shared/model.js';
import {
  dashboardMeasurementDefaults,
  defaultsForMeasurement,
  withDashboardDefaults,
} from '../shared/range.js';
import { totalHistoryKey } from '../shared/totals.js';

export type DashboardAlertTarget = {
  key: string;
  dashboardId: string;
  signature: string;
  readingKey: string;
  dashboardName: string;
  deviceName: string;
  label: string;
  unit: string;
  decimals: number;
  min: number;
  max: number;
};

export function dashboardAlertTargets(
  dashboards: Dashboard[],
): DashboardAlertTarget[] {
  return dashboards.flatMap((dashboard) => {
    const defaults = dashboardMeasurementDefaults(dashboard);
    return dashboard.widgets.flatMap((tile) => {
      const resolved = isMeasurementTile(tile)
        ? withDashboardDefaults(
            tile,
            defaultsForMeasurement(
              defaults,
              tile.binding.measurement,
              tile.unit,
            ),
          )
        : tile;
      if (
        (!isMeasurementTile(resolved) && !isTotalTile(resolved)) ||
        !resolved.range
      )
        return [];
      const readingKey = isTotalTile(resolved)
        ? totalHistoryKey(dashboard.id, resolved)
        : bindingKey(resolved.binding);
      const key = `${dashboard.id}:${resolved.id}`;
      return [
        {
          key,
          dashboardId: dashboard.id,
          signature: JSON.stringify([
            readingKey,
            resolved.range.min,
            resolved.range.max,
          ]),
          readingKey,
          dashboardName: dashboard.name,
          deviceName: isTotalTile(resolved) ? '' : resolved.deviceName,
          label: resolved.label,
          unit: resolved.unit,
          decimals: resolved.decimals,
          min: resolved.range.min,
          max: resolved.range.max,
        },
      ];
    });
  });
}

const observedTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function dashboardAlertMessage(
  target: Pick<
    DashboardAlertTarget,
    | 'dashboardName'
    | 'deviceName'
    | 'label'
    | 'unit'
    | 'decimals'
    | 'min'
    | 'max'
  >,
  value: number,
  direction: 'low' | 'high',
  sampledAt: number,
): string {
  const limit = direction === 'low' ? target.min : target.max;
  let digits = target.decimals;
  let displayValue = '';
  do {
    displayValue = value.toLocaleString('en-GB', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    if (Number(displayValue.replaceAll(',', '')) !== limit || value === limit)
      break;
    digits++;
  } while (digits <= 12);
  if (Number(displayValue.replaceAll(',', '')) === limit && value !== limit)
    displayValue = String(value);
  const unit = target.unit ? ` ${target.unit}` : '';
  return [
    `${direction === 'low' ? 'Below' : 'Above'} dashboard limit`,
    `Dashboard: ${target.dashboardName}`,
    [target.deviceName, target.label].filter(Boolean).join(' · '),
    `Value: ${displayValue}${unit}`,
    `Limit: ${limit}${unit}`,
    `Observed: ${observedTime.format(new Date(sampledAt))}`,
  ].join('\n');
}

export function testDashboardAlertMessage(sentAt: number): string {
  return [
    'Below dashboard limit',
    'Dashboard: TEST',
    'Sample device · TEST · Overall',
    'Value: 00.00 Hz',
    'Limit: 00 Hz',
    `Observed: ${observedTime.format(new Date(sentAt))}`,
  ].join('\n');
}
