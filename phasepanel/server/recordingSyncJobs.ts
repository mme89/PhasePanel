import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { recordingTitle } from '../shared/deviceRecordingLabels.js';
import type {
  DeviceRecordingProfile,
  DeviceRecordingRange,
  RecordingSyncFileTiming,
  RecordingSyncJob,
  RecordingSyncScope,
  RecordingSyncTimings,
} from '../shared/deviceHistory.js';

type Device = { key: string; name: string };
type Batch = {
  downloaded: number;
  downloadedBytes: number;
  skipped: number;
  failed: string[];
  total: number;
  nextOffset: number;
  ranges: Record<string, DeviceRecordingRange | null>;
  timings?: RecordingSyncTimings;
  fileTimings?: RecordingSyncFileTiming[];
};

const RETRY_DELAYS_MS = [500, 1000, 2000];
const CONNECTION_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);

function isConnectionFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? error.code : undefined;
  return (
    code === 421 ||
    code === 425 ||
    code === 426 ||
    (typeof code === 'string' && CONNECTION_CODES.has(code)) ||
    /timeout|timed out|socket (?:closed|hang up)|connection (?:closed|lost|reset)|client is closed/i.test(
      error.message,
    )
  );
}

export class RecordingSyncJobs {
  private job: RecordingSyncJob | null = null;
  private controller: AbortController | null = null;
  private running = new Set<Promise<void>>();

  constructor(
    private readonly devices: () => Device[],
    private readonly catalog: (
      deviceKey: string,
      signal: AbortSignal,
    ) => Promise<DeviceRecordingProfile[]>,
    private readonly batch: (
      deviceKey: string,
      profileId: string,
      offset: number,
      signal: AbortSignal,
      measureAll: boolean,
    ) => Promise<Batch>,
    private readonly retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
  ) {}

  private async retryConnection<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
    job: RecordingSyncJob,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        const result = await operation();
        job.retry = null;
        return result;
      } catch (error) {
        if (
          signal.aborted ||
          !isConnectionFailure(error) ||
          attempt >= this.retryDelaysMs.length
        ) {
          job.retry = null;
          throw error;
        }
        job.retry = {
          attempt: attempt + 1,
          total: this.retryDelaysMs.length,
          retryAtMs: Date.now() + this.retryDelaysMs[attempt],
        };
        await delay(this.retryDelaysMs[attempt], undefined, { signal });
        job.retry = { ...job.retry, retryAtMs: null };
      }
    }
  }

  status() {
    return this.job && { ...this.job };
  }

  start(
    scope: RecordingSyncScope,
    deviceKey?: string,
    profileId?: string,
    measureAll = false,
  ) {
    if (this.controller)
      throw Object.assign(new Error('A recording sync is already running.'), {
        statusCode: 409,
      });
    const available = this.devices();
    const selected = available.find((device) => device.key === deviceKey);
    if (scope !== 'all' && !selected)
      throw Object.assign(new Error('Select a device with an FTP login.'), {
        statusCode: 400,
      });
    if (scope === 'recording' && !profileId)
      throw Object.assign(new Error('Select a recording.'), {
        statusCode: 400,
      });
    if (scope === 'all' && !available.length)
      throw Object.assign(
        new Error('No device with an FTP login is available to sync.'),
        {
          statusCode: 400,
        },
      );

    const job: RecordingSyncJob = {
      id: randomUUID(),
      scope,
      measureAll,
      state: 'running',
      phase: 'Finding recordings…',
      current: '',
      retry: null,
      done: 0,
      total: 0,
      downloaded: 0,
      downloadedBytes: 0,
      transferDurationMs: 0,
      timings: { connectMs: 0, setupMs: 0, downloadMs: 0, saveMs: 0 },
      fileTimings: [],
      skipped: 0,
      failedFiles: 0,
      unavailableDevices: 0,
      notice: '',
      error: '',
    };
    const controller = new AbortController();
    this.job = job;
    this.controller = controller;
    const targets = scope === 'all' ? available : [selected!];
    const task = this.run(job, controller, targets, profileId);
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
    return { ...job };
  }

  cancel() {
    if (this.job?.state !== 'running' || !this.controller) return this.status();
    this.controller.abort();
    this.job.state = 'canceled';
    this.job.phase = '';
    this.job.current = '';
    this.job.retry = null;
    this.job.notice = `Sync canceled after ${this.job.done} of ${this.job.total} files. Completed batches remain saved.`;
    return this.status();
  }

  async stop() {
    this.cancel();
    await Promise.all(this.running);
  }

  private async run(
    job: RecordingSyncJob,
    controller: AbortController,
    devices: Device[],
    profileId?: string,
  ) {
    const signal = controller.signal;
    const targets: {
      deviceKey: string;
      deviceName: string;
      profileId: string;
      recordingName: string;
      fileCount: number;
    }[] = [];
    const failedDevices = new Set<string>();
    try {
      for (const device of devices) {
        signal.throwIfAborted();
        job.current = `Checking ${device.name}…`;
        try {
          const profiles = await this.retryConnection(
            () => this.catalog(device.key, signal),
            signal,
            job,
          );
          const chosen =
            job.scope === 'recording'
              ? profiles.filter((profile) => profile.id === profileId)
              : profiles;
          if (job.scope === 'recording' && !chosen.length)
            throw new Error('Selected recording was not found on the device.');
          for (const profile of chosen) {
            targets.push({
              deviceKey: device.key,
              deviceName: device.name,
              profileId: profile.id,
              recordingName: recordingTitle(profile),
              fileCount: profile.files.length,
            });
          }
        } catch (error) {
          if (signal.aborted || job.scope !== 'all') throw error;
          job.unavailableDevices++;
        }
      }
      signal.throwIfAborted();
      if (!targets.length) {
        job.notice = job.unavailableDevices
          ? `No recordings synced; ${job.unavailableDevices} devices could not be reached.`
          : 'No recordings found to sync.';
        job.state = 'complete';
        return;
      }
      job.total = targets.reduce((sum, target) => sum + target.fileCount, 0);
      job.phase = 'Syncing recordings…';
      for (const target of targets) {
        signal.throwIfAborted();
        if (failedDevices.has(target.deviceKey)) {
          job.done += target.fileCount;
          continue;
        }
        job.current = `${target.deviceName} · ${target.recordingName}`;
        let offset = 0;
        let actualTotal = target.fileCount;
        try {
          do {
            signal.throwIfAborted();
            const started = performance.now();
            const batch = await this.retryConnection(
              () =>
                this.batch(
                  target.deviceKey,
                  target.profileId,
                  offset,
                  signal,
                  job.measureAll,
                ),
              signal,
              job,
            );
            signal.throwIfAborted();
            job.transferDurationMs += performance.now() - started;
            if (batch.timings)
              for (const key of Object.keys(
                job.timings,
              ) as (keyof RecordingSyncTimings)[])
                job.timings[key] += batch.timings[key];
            for (const sample of batch.fileTimings ?? []) {
              if (job.fileTimings.length >= 100) break;
              job.fileTimings.push({
                ...sample,
                deviceName: target.deviceName,
              });
            }
            job.downloadedBytes += batch.downloadedBytes;
            if (offset === 0) job.total += batch.total - target.fileCount;
            job.downloaded += batch.downloaded;
            job.skipped += batch.skipped;
            job.failedFiles += batch.failed.length;
            actualTotal = batch.total;
            if (batch.nextOffset <= offset && offset < actualTotal)
              throw new Error('The device did not advance the recording sync.');
            job.done += batch.nextOffset - offset;
            offset = batch.nextOffset;
          } while (offset < actualTotal);
        } catch (error) {
          if (signal.aborted || job.scope === 'recording') throw error;
          failedDevices.add(target.deviceKey);
          job.done += Math.max(0, actualTotal - offset);
        }
      }
      job.unavailableDevices += failedDevices.size;
      job.notice = `${job.unavailableDevices || job.failedFiles ? 'Sync finished' : 'Sync complete'}: ${job.downloaded} downloaded, ${job.skipped} already saved${job.failedFiles ? `, ${job.failedFiles} files failed` : ''}${job.unavailableDevices ? `, ${job.unavailableDevices} devices unavailable` : ''}.`;
      job.state = 'complete';
    } catch (error) {
      if (!signal.aborted) {
        job.state = 'failed';
        job.error =
          error instanceof Error ? error.message : 'Recording sync failed.';
      }
    } finally {
      job.phase = '';
      job.current = '';
      job.retry = null;
      if (this.controller === controller) this.controller = null;
    }
  }
}
