import {
  bindingKey,
  isMeasurementTile,
  isGraphTile,
  isConsumptionTile,
  isTotalTile,
  type DashboardTile,
  type Dashboard,
  type Reading,
  type TotalTile,
  type TotalSource,
} from './model.js';

export function measurementSources(tile: DashboardTile): TotalSource[] {
  return isConsumptionTile(tile)
    ? (tile.sources ?? [tile])
    : isMeasurementTile(tile)
      ? [tile]
      : isTotalTile(tile)
        ? tile.sources
        : isGraphTile(tile)
          ? tile.sources
          : [];
}
export function readingBindings(tiles: DashboardTile[]) {
  return [
    ...new Map(
      tiles
        .flatMap(measurementSources)
        .map((source) => [bindingKey(source.binding), source.binding]),
    ).values(),
  ];
}
export const totalReadingKey = (tile: TotalTile) => `total:${tile.id}`;
export const totalHistoryKey = (dashboardId: string, tile: TotalTile) =>
  `total:${dashboardId}:${tile.id}:${JSON.stringify(tile.sources.map((source) => bindingKey(source.binding)).sort())}`;
export function historyKeys(dashboard: Pick<Dashboard, 'id' | 'widgets'>) {
  return [
    ...readingBindings(dashboard.widgets).map(bindingKey),
    ...dashboard.widgets
      .filter(isTotalTile)
      .map((tile) => totalHistoryKey(dashboard.id, tile)),
  ];
}

export function totalReading(tile: TotalTile, readings: Reading[]): Reading {
  const byKey = new Map(readings.map((reading) => [reading.key, reading]));
  const inputs = tile.sources.map((source) =>
    byKey.get(bindingKey(source.binding)),
  );
  const retrievedTimes = inputs
    .map((input) => Date.parse(input?.retrievedAt ?? ''))
    .filter(Number.isFinite);
  const base: Reading = {
    key: totalReadingKey(tile),
    value: null,
    unit: tile.unit,
    sourceTimestampNs: null,
    sourceTime: null,
    retrievedAt: new Date(
      retrievedTimes.length ? Math.max(...retrievedTimes) : Date.now(),
    ).toISOString(),
    status: 'unavailable',
  };
  const complete: Reading[] = [];
  const missingInputs: string[] = [];
  inputs.forEach((input, index) => {
    if (
      input &&
      (input.status === 'ok' || input.status === 'stale') &&
      input.value !== null &&
      Number.isFinite(input.value) &&
      input.unit === tile.unit
    ) {
      complete.push(input);
    } else {
      const source = tile.sources[index];
      missingInputs.push(`${source.deviceName}: ${source.label}`);
    }
  });
  if (missingInputs.length) {
    base.missingInputs = missingInputs;
    base.message = `${missingInputs.length} of ${tile.sources.length} values missing: ${missingInputs.join('; ')}.`;
  }
  if (!complete.length)
    return {
      ...base,
      status: inputs.some((input) => input?.status === 'error')
        ? 'error'
        : 'unavailable',
      message: `No input values are available. ${base.message ?? ''}`,
    };
  const value = complete.reduce((sum, input) => sum + input.value!, 0);
  if (!Number.isFinite(value))
    return {
      ...base,
      message: 'The total exceeds the supported numeric range.',
    };
  const times = complete.map((input) =>
    Date.parse(input.sourceTime ?? input.retrievedAt),
  );
  const validTimes = times.every(Number.isFinite);
  return {
    ...base,
    value,
    status:
      complete.some((input) => input.status === 'stale') || !validTimes
        ? 'stale'
        : missingInputs.length
          ? 'partial'
          : 'ok',
    // A total is only as fresh as its oldest source.
    sourceTime: validTimes ? new Date(Math.min(...times)).toISOString() : null,
  };
}
export function withTotalReadings(tiles: DashboardTile[], readings: Reading[]) {
  return [
    ...readings,
    ...tiles.filter(isTotalTile).map((tile) => totalReading(tile, readings)),
  ];
}
