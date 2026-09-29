import { isMeasurementTile } from './model.js';
import type {
  ValueRange,
  GaugeScale,
  Widget,
  DisplayDefaults,
  Dashboard,
  DashboardInput,
  MeasurementDefaults,
} from './model.js';

import { displayDefaultsSchema } from './model.js';

// Resolve for display only: retained tile settings are restored on opt-out.
export function withDashboardDefaults(
  widget: Widget,
  defaults?: DisplayDefaults,
): Widget {
  if (
    !defaults ||
    widget.useDashboardDefaults === false ||
    !displayDefaultsSchema.safeParse(defaults).success
  )
    return widget;
  return {
    ...widget,
    normalColor:
      defaults.normalColor ??
      widget.normalColor ??
      widget.range?.color ??
      '#32a852',
    scale: defaults.scale,
    decimals: defaults.decimals ?? widget.decimals,
    range: defaults.limits
      ? {
          ...defaults.limits,
          color:
            defaults.normalColor ??
            widget.normalColor ??
            widget.range?.color ??
            '#32a852',
        }
      : undefined,
  };
}
export function evaluateRange(
  value: number | null | undefined,
  range?: Pick<ValueRange, 'min' | 'max'>,
  scale: GaugeScale | undefined = range,
) {
  if (value == null || !Number.isFinite(value))
    return { state: 'unknown' as const, fraction: 0 };
  const state =
    range && value < range.min
      ? 'low'
      : range && value > range.max
        ? 'high'
        : 'normal';
  const fraction =
    !scale || value <= scale.min
      ? 0
      : value >= scale.max
        ? 1
        : (value - scale.min) / (scale.max - scale.min);
  return { state, fraction };
}

export const measurementKey = (measurement: string, unit: string) =>
  JSON.stringify([measurement, unit]);

export function dashboardMeasurementDefaults(
  dashboard: Pick<
    DashboardInput,
    'measurementDefaults' | 'displayDefaults' | 'widgets'
  >,
): MeasurementDefaults[] {
  if (dashboard.measurementDefaults !== undefined)
    return dashboard.measurementDefaults;
  // Preserve older shared settings for the measurement types already on this dashboard.
  if (!dashboard.displayDefaults) return [];
  return [
    ...new Map(
      dashboard.widgets.filter(isMeasurementTile).map((w) => [
        measurementKey(w.binding.measurement, w.unit),
        {
          measurement: w.binding.measurement,
          unit: w.unit,
          settings: dashboard.displayDefaults!,
        },
      ]),
    ).values(),
  ];
}

export function defaultsForMeasurement(
  defaults: MeasurementDefaults[],
  measurement: string,
  unit: string,
) {
  return defaults.find((d) => d.measurement === measurement && d.unit === unit)
    ?.settings;
}

export function editableDashboard(dashboard: Dashboard): Dashboard {
  const copy = structuredClone(dashboard);
  copy.measurementDefaults = dashboardMeasurementDefaults(copy);
  delete copy.displayDefaults;
  return copy;
}
