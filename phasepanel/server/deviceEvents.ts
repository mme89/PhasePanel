import { Writable } from 'node:stream';
import { Client, FileType } from 'basic-ftp';
import type { DeviceEvent } from '../shared/deviceEvents.js';
import type { ModbusDevice } from './sourceSettings.js';

const EVENT_RECORD_BYTES = 40;
const MAX_FTP_BYTES = 8 * 1024 * 1024;

function eventKind(reason: number) {
  const kinds = [
    ['Overvoltage', reason & 0xff, 'V'],
    ['Undervoltage', (reason >>> 8) & 0xff, 'V'],
    ['Overcurrent', (reason >>> 16) & 0xff, 'A'],
    ['Voltage outage', (reason >>> 24) & 0xff, 'V'],
  ] as const;
  const active = kinds.filter(([, bits]) => bits !== 0);
  if (active.length !== 1)
    return { type: 'Other event', phase: null, unit: null };
  const [type, bits, unit] = active[0];
  const phase = (
    { 1: 'L1', 2: 'L2', 4: 'L3', 8: 'L4' } as Record<number, string>
  )[bits & 0x0f];
  return { type, phase: phase ?? null, unit };
}

export async function fetchDeviceEvents(
  device: ModbusDevice,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DeviceEvent[]> {
  if (!device.ftpUsername || !device.ftpPassword)
    throw new Error('Configure FTP username and password for this device.');
  signal?.throwIfAborted();
  const client = new Client(timeoutMs);
  const abort = () => client.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await client.access({
      host: device.host,
      port: device.ftpPort ?? 21,
      user: device.ftpUsername,
      password: device.ftpPassword,
      secure: false,
    });
    signal?.throwIfAborted();
    await client.cd('/data/evt');
    const files = (await client.list())
      .filter(
        (item) =>
          item.type === FileType.File &&
          /^evt_[0-9a-f]+\.\d+$/i.test(item.name),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.reduce((total, file) => total + file.size, 0) > MAX_FTP_BYTES)
      throw new Error('Device event files are too large.');
    const events: DeviceEvent[] = [];
    let totalReceived = 0;
    let parsedFiles = 0;
    let lastError: unknown;
    for (const file of files) {
      signal?.throwIfAborted();
      const chunks: Buffer[] = [];
      try {
        await client.downloadTo(
          new Writable({
            write(chunk: Buffer, _encoding, callback) {
              totalReceived += chunk.length;
              if (totalReceived > MAX_FTP_BYTES)
                callback(new Error('Device event files are too large.'));
              else {
                chunks.push(Buffer.from(chunk));
                callback();
              }
            },
          }),
          file.name,
        );
        for (const event of parseFtpEventFile(Buffer.concat(chunks), device))
          events.push(event);
        parsedFiles++;
      } catch (error) {
        if (
          signal?.aborted ||
          client.closed ||
          (error instanceof Error &&
            error.message === 'Device event files are too large.')
        )
          throw error;
        lastError = error;
      }
    }
    if (files.length > 0 && parsedFiles === 0 && lastError) throw lastError;
    return events;
  } finally {
    signal?.removeEventListener('abort', abort);
    client.close();
  }
}

export function parseFtpEventFile(
  data: Buffer,
  device: ModbusDevice,
): DeviceEvent[] {
  if (data.length % EVENT_RECORD_BYTES !== 0)
    throw new Error('Invalid device FTP event file.');
  const events: DeviceEvent[] = [];
  for (let offset = 0; offset < data.length; offset += EVENT_RECORD_BYTES) {
    const reason = data.readUInt32LE(offset);
    const startedAtMs = Math.round(data.readDoubleLE(offset + 4) / 1000);
    const endedAtMs = Math.round(data.readDoubleLE(offset + 12) / 1000);
    const threshold = data.readFloatLE(offset + 20);
    const maximum = data.readFloatLE(offset + 24);
    const minimum = data.readFloatLE(offset + 28);
    const average = data.readFloatLE(offset + 32);
    if (
      !Number.isSafeInteger(startedAtMs) ||
      !Number.isSafeInteger(endedAtMs) ||
      startedAtMs <= 0 ||
      startedAtMs > 8_640_000_000_000_000 ||
      endedAtMs > 8_640_000_000_000_000 ||
      endedAtMs < startedAtMs ||
      ![threshold, maximum, minimum, average].every(Number.isFinite)
    )
      throw new Error('Invalid device FTP event record.');
    events.push({
      project: device.project,
      deviceId: device.id,
      deviceName: device.name,
      host: device.host,
      startedAtMs,
      endedAtMs,
      reason,
      ...eventKind(reason),
      threshold,
      maximum,
      minimum,
      average,
    });
  }
  return events;
}
