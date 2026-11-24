import type { ModbusDevice, SourceSettings } from './sourceSettings.js';
import type { Store } from './store.js';
import type { DeviceEvent } from '../shared/deviceEvents.js';
import { fetchDeviceEvents } from './deviceEvents.js';
import { defaultCollectorSettings } from './collectorSettings.js';

export class EventCollector {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private stopped = false;
  private intervalMs = defaultCollectorSettings.eventIntervalMinutes * 60_000;

  constructor(
    private store: Store,
    private source: () => { revision: number; settings: SourceSettings },
    private fetchEvents: (
      device: ModbusDevice,
      timeoutMs: number,
      signal?: AbortSignal,
    ) => Promise<DeviceEvent[]> = fetchDeviceEvents,
    private now: () => number = Date.now,
    private onError: () => void = () => {},
  ) {}

  start() {
    this.schedule(0);
  }

  configure(intervalMinutes: number) {
    this.intervalMs = intervalMinutes * 60_000;
    if (this.timer) this.schedule(this.intervalMs);
  }

  refresh() {
    if (this.pending) {
      void this.pending.finally(() => this.schedule(0)).catch(() => {});
    } else this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.collectOnce()
        .catch(this.onError)
        .finally(() => {
          if (!this.stopped) this.schedule(this.intervalMs);
        });
    }, delay);
  }

  collectOnce(): Promise<void> {
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

  private async collect() {
    const { revision, settings } = this.source();
    if (settings.source !== 'modbus') return;
    const controller = new AbortController();
    this.controller = controller;
    const devices = settings.modbus.devices;
    try {
      for (let index = 0; index < devices.length; index += 4) {
        if (this.stopped || this.source().revision !== revision) return;
        await Promise.all(
          devices.slice(index, index + 4).map(async (device) => {
            let events: DeviceEvent[] = [];
            let error: string | null = null;
            try {
              events = await this.fetchEvents(
                device,
                settings.modbus.timeoutMs,
                controller.signal,
              );
            } catch (failure) {
              error =
                failure instanceof Error
                  ? failure.message
                  : 'Event fetch failed.';
            }
            if (this.stopped || this.source().revision !== revision) return;
            const attemptedAt = this.now();
            if (!error) {
              try {
                this.store.recordDeviceEvents(events);
              } catch (failure) {
                error =
                  failure instanceof Error
                    ? failure.message
                    : 'Failed to store device events.';
              }
            }
            try {
              this.store.recordDeviceEventFetchStatus({
                project: device.project,
                deviceId: device.id,
                deviceName: device.name,
                host: device.host,
                lastAttemptMs: attemptedAt,
                lastSuccessMs: error ? null : attemptedAt,
                error,
              });
            } catch {
              this.onError();
            }
          }),
        );
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.pending?.catch(() => {});
  }
}
