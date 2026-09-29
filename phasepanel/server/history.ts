import {
  bindingKey,
  type Binding,
  type Dashboard,
  type Reading,
} from '../shared/model.js';
import { advanceAlarmStates } from '../shared/alarmStatus.js';
import {
  readingBindings,
  totalHistoryKey,
  totalReading,
} from '../shared/totals.js';
import { isTotalTile } from '../shared/model.js';
import { dashboardAlertTargets } from './dashboardAlerts.js';
import type { Store } from './store.js';
import {
  defaultCollectorSettings,
  type CollectorSettings,
} from './collectorSettings.js';

export const HISTORY_INTERVAL_MS =
  defaultCollectorSettings.intervalSeconds * 1000;
export const HISTORY_RETENTION_MS =
  defaultCollectorSettings.retentionDays * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 80;
const CONCURRENT_BATCHES = 4;
type DashboardAlarmSnapshot = {
  dashboardRevision: number;
  sourceRevision: number;
  states: ReturnType<typeof advanceAlarmStates>['states'];
  active: boolean;
};

export class HistorySampler {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopped = false;
  private latestRevision?: number;
  private latestReadings = new Map<string, Reading>();
  private lastSampledAt?: number;
  private alarmStates = new Map<string, DashboardAlarmSnapshot>();
  private retentionMs = HISTORY_RETENTION_MS;

  constructor(
    private store: Store,
    private acquire: (bindings: Binding[]) => Promise<Reading[]>,
    private sourceRevision: () => number,
    private now: () => number = Date.now,
    private intervalMs = HISTORY_INTERVAL_MS,
    private onError: () => void = () => {},
    private configuredBindings: () => Binding[] = () => [],
    private staleMs: () => number = () => 60_000,
  ) {}

  start() {
    if (!this.stopped && !this.timer) this.schedule();
  }

  configure(settings: CollectorSettings) {
    this.intervalMs = settings.intervalSeconds * 1000;
    this.retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
    this.store.pruneReadings(this.now() - this.retentionMs);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sampleOnce()
        .catch(this.onError)
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, this.intervalMs);
  }

  sampleOnce(): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.collect();
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      })
      .catch(() => {});
    return pending;
  }

  async readingsFor(bindings: Binding[], staleMs: number) {
    const missing = () =>
      this.latestRevision !== this.sourceRevision() ||
      bindings.some((binding) => !this.latestReadings.has(bindingKey(binding)));
    if (bindings.length && missing()) await this.sampleOnce();
    // A dashboard can add a binding while an older sampling pass is in flight.
    if (bindings.length && missing()) await this.sampleOnce();
    const revision = this.sourceRevision();
    const now = this.now();
    return {
      sourceRevision: revision,
      sampledAt:
        bindings.length && this.latestRevision === revision
          ? (this.lastSampledAt ?? null)
          : null,
      readings: bindings.map((binding): Reading => {
        const key = bindingKey(binding);
        const reading =
          this.latestRevision === revision
            ? this.latestReadings.get(key)
            : undefined;
        if (!reading)
          return {
            key,
            value: null,
            unit: '',
            sourceTimestampNs: null,
            sourceTime: null,
            retrievedAt: new Date(now).toISOString(),
            status: 'error',
            message: 'Measurement has not been sampled yet.',
          };
        const timestamp = Date.parse(reading.sourceTime ?? reading.retrievedAt);
        return reading.status === 'ok' &&
          Number.isFinite(timestamp) &&
          now - timestamp > staleMs
          ? { ...reading, status: 'stale' }
          : reading;
      }),
    };
  }

  async currentAlarmStatus() {
    const dashboards = this.store.list();
    if (
      this.lastSampledAt === undefined ||
      this.latestRevision !== this.sourceRevision() ||
      dashboards.some(
        (dashboard) =>
          this.alarmStates.get(dashboard.id)?.dashboardRevision !==
          dashboard.revision,
      )
    )
      await this.sampleOnce();
    const fresh =
      this.lastSampledAt !== undefined &&
      this.now() - this.lastSampledAt <= this.staleMs();
    return {
      sampledAt: this.lastSampledAt ?? null,
      dashboards: dashboards.map((dashboard) => ({
        id: dashboard.id,
        active: fresh && (this.alarmStates.get(dashboard.id)?.active ?? false),
      })),
    };
  }

  private updateAlarmStates(
    dashboards: Dashboard[],
    readings: Reading[],
    sampledAt: number,
    sourceRevision: number,
  ) {
    const next = new Map<string, DashboardAlarmSnapshot>();
    for (const dashboard of dashboards) {
      const old = this.alarmStates.get(dashboard.id);
      const previous =
        old?.dashboardRevision === dashboard.revision &&
        old.sourceRevision === sourceRevision
          ? old.states
          : new Map();
      const result = advanceAlarmStates(
        dashboard,
        readings,
        previous,
        sampledAt,
        this.staleMs(),
      );
      next.set(dashboard.id, {
        dashboardRevision: dashboard.revision,
        sourceRevision,
        states: result.states,
        active: result.active,
      });
    }
    this.alarmStates = next;
  }

  private async collect() {
    const dashboards = this.store.list();
    const alertTargets = dashboardAlertTargets(dashboards);
    const tiles = dashboards.flatMap((dashboard) => dashboard.widgets);
    const bindings = [
      ...new Map(
        [...readingBindings(tiles), ...this.configuredBindings()].map(
          (binding) => [bindingKey(binding), binding],
        ),
      ).values(),
    ].sort((a, b) => bindingKey(a).localeCompare(bindingKey(b)));
    if (!bindings.length) {
      const sampledAt = this.now();
      const revision = this.sourceRevision();
      this.updateAlarmStates(dashboards, [], sampledAt, revision);
      this.store.recordDashboardAlerts(
        alertTargets,
        revision,
        [],
        sampledAt,
        this.staleMs(),
      );
      this.store.pruneReadings(sampledAt - this.retentionMs);
      this.latestRevision = revision;
      this.lastSampledAt = sampledAt;
      return;
    }
    const revision = this.sourceRevision();
    const batches: Binding[][] = [];
    for (let index = 0; index < bindings.length; index += BATCH_SIZE)
      batches.push(bindings.slice(index, index + BATCH_SIZE));
    const readings: Reading[] = [];
    for (let index = 0; index < batches.length; index += CONCURRENT_BATCHES) {
      if (this.stopped || this.sourceRevision() !== revision) return;
      const group = batches.slice(index, index + CONCURRENT_BATCHES);
      const results = await Promise.all(
        group.map(async (batch) => {
          try {
            return await this.acquire(batch);
          } catch {
            return batch.map((binding): Reading => ({
              key: bindingKey(binding),
              value: null,
              unit: '',
              sourceTimestampNs: null,
              sourceTime: null,
              retrievedAt: new Date(this.now()).toISOString(),
              status: 'error',
            }));
          }
        }),
      );
      readings.push(...results.flat());
    }
    if (this.stopped || this.sourceRevision() !== revision) return;
    const sampledAt = this.now();
    const totals = dashboards.flatMap((dashboard) =>
      dashboard.widgets.filter(isTotalTile).map((tile) => ({
        ...totalReading(tile, readings),
        key: totalHistoryKey(dashboard.id, tile),
      })),
    );
    this.store.recordReadings(
      revision,
      [...bindings.map(bindingKey), ...totals.map((reading) => reading.key)],
      [...readings, ...totals],
      sampledAt,
    );
    this.store.recordDashboardAlerts(
      alertTargets,
      revision,
      [...readings, ...totals],
      sampledAt,
      this.staleMs(),
    );
    this.updateAlarmStates(dashboards, readings, sampledAt, revision);
    this.store.pruneReadings(sampledAt - this.retentionMs);
    const byKey = new Map(readings.map((reading) => [reading.key, reading]));
    this.latestRevision = revision;
    this.latestReadings = new Map(
      bindings.map((binding) => {
        const key = bindingKey(binding);
        return [
          key,
          byKey.get(key) ?? {
            key,
            value: null,
            unit: '',
            sourceTimestampNs: null,
            sourceTime: null,
            retrievedAt: new Date(sampledAt).toISOString(),
            status: 'unavailable' as const,
          },
        ];
      }),
    );
    this.lastSampledAt = sampledAt;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending?.catch(() => {});
  }
}
