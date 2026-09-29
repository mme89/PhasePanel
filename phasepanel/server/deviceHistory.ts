import { Writable } from 'node:stream';
import { Client, FileType } from 'basic-ftp';
import type {
  DeviceRecordingPoint,
  DeviceRecordingProfile,
  DeviceRecordingRange,
  RecordingSyncFileTiming,
  RecordingSyncTimings,
} from '../shared/deviceHistory.js';
import type { ModbusDevice } from './sourceSettings.js';

const MAX_RECORDING_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FILES = 2000;
const PROFILE_NAME = /^(?:rec[0-9a-f]+|hiddenrec[0-9a-f]+)$/i;
const RECORDING_NAME = /^((?:rec|hiddenrec)[0-9a-f]+)_[0-9a-f]+\.\d+$/i;

function badRecording(message: string): never {
  throw new Error(`Invalid device recording: ${message}`);
}

function parseText(bytes: Buffer) {
  return bytes.toString('utf8').split('\0', 1)[0].trim();
}

export function parseRecordingHeader(id: string, data: Buffer) {
  if (
    !PROFILE_NAME.test(id) ||
    data.length < 56 ||
    data.length > MAX_HEADER_BYTES
  )
    badRecording('header.');
  // Some firmware versions append two bytes after the 48-byte field entries.
  const remainder = (data.length - 8) % 48;
  if (remainder !== 0 && remainder !== 2) badRecording('header length.');
  const intervalSeconds = data.readUInt32LE(0);
  const format = data.readUInt32LE(4);
  if (
    intervalSeconds < 1 ||
    intervalSeconds > 86400 ||
    ![14, 17].includes(format)
  )
    badRecording('header format.');
  const fields = [];
  for (let offset = 8; offset + 48 <= data.length; offset += 48) {
    const name = parseText(data.subarray(offset, offset + 32));
    const unit = parseText(data.subarray(offset + 32, offset + 48));
    if (!name) badRecording('field name.');
    fields.push({ name, unit });
  }
  if (!fields.length || fields.length > 200) badRecording('field count.');
  return {
    id,
    intervalSeconds,
    kind: format === 14 ? ('range' as const) : ('sample' as const),
    fields,
  };
}

export function parseRecordingFile(
  data: Buffer,
  profile: ReturnType<typeof parseRecordingHeader>,
  fieldIndex: number,
  statistic: 'average' | 'minimum' | 'maximum',
): DeviceRecordingPoint[] {
  if (
    !Number.isInteger(fieldIndex) ||
    fieldIndex < 0 ||
    fieldIndex >= profile.fields.length
  )
    badRecording('field.');
  if (profile.kind === 'sample' && statistic !== 'average')
    badRecording('statistic.');
  const valuesPerField = profile.kind === 'range' ? 3 : 1;
  const stride = 24 + profile.fields.length * valuesPerField * 4;
  if (data.length > MAX_RECORDING_BYTES || data.length % stride !== 0)
    badRecording('file length.');
  const statisticIndex =
    statistic === 'minimum' ? 1 : statistic === 'maximum' ? 2 : 0;
  const points: DeviceRecordingPoint[] = [];
  for (let offset = 0; offset < data.length; offset += stride) {
    // Device timestamps are unsigned 500 MHz ticks since the Unix epoch.
    const start = data.readBigUInt64LE(offset);
    const end = data.readBigUInt64LE(offset + 8);
    const startMs = Number(start / 500_000n);
    const time = Number(end / 500_000n);
    if (
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(time) ||
      time <= startMs ||
      time > 8_640_000_000_000_000
    )
      badRecording('timestamp.');
    const value = data.readFloatLE(
      offset + 20 + (fieldIndex * valuesPerField + statisticIndex) * 4,
    );
    if (!Number.isFinite(value)) continue;
    points.push({ startMs, time, value });
  }
  return points.sort((a, b) => a.time - b.time);
}

export function recordingTimeRange(
  data: Buffer,
  profile: ReturnType<typeof parseRecordingHeader>,
): DeviceRecordingRange | null {
  const stride =
    24 + profile.fields.length * (profile.kind === 'range' ? 12 : 4);
  if (data.length > MAX_RECORDING_BYTES || data.length % stride !== 0)
    badRecording('file length.');
  if (data.length === 0) return null;
  const startMs = Number(data.readBigUInt64LE(0) / 500_000n);
  const endMs = Number(
    data.readBigUInt64LE(data.length - stride + 8) / 500_000n,
  );
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    endMs <= startMs ||
    endMs > 8_640_000_000_000_000
  )
    badRecording('timestamp.');
  return { startMs, endMs };
}

async function download(client: Client, name: string, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  await client.downloadTo(
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        if (total > maxBytes)
          callback(new Error('Device recording is too large.'));
        else {
          chunks.push(Buffer.from(chunk));
          callback();
        }
      },
    }),
    name,
  );
  return Buffer.concat(chunks);
}

async function withFtp<T>(
  device: ModbusDevice,
  timeoutMs: number,
  action: (client: Client) => Promise<T>,
  signal?: AbortSignal,
  timings?: RecordingSyncTimings,
) {
  if (!device.ftpUsername || !device.ftpPassword)
    throw new Error('Configure FTP username and password for this device.');
  const client = new Client(timeoutMs);
  const closeOnAbort = () => client.close();
  signal?.throwIfAborted();
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  try {
    const connectStarted = performance.now();
    await client.access({
      host: device.host,
      port: device.ftpPort ?? 21,
      user: device.ftpUsername,
      password: device.ftpPassword,
      secure: false,
    });
    if (timings) timings.connectMs += performance.now() - connectStarted;
    return await action(client);
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    client.close();
  }
}

export async function listDeviceRecordings(
  device: ModbusDevice,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DeviceRecordingProfile[]> {
  return withFtp(
    device,
    timeoutMs,
    async (client) => {
      await client.cd('/data/header');
      const headers = (await client.list()).filter(
        (file) =>
          file.type === FileType.File &&
          file.name.endsWith('.head') &&
          PROFILE_NAME.test(file.name.slice(0, -5)) &&
          file.size <= MAX_HEADER_BYTES,
      );
      const profiles: DeviceRecordingProfile[] = [];
      for (const header of headers) {
        signal?.throwIfAborted();
        const id = header.name.slice(0, -5);
        const data = await download(client, header.name, MAX_HEADER_BYTES);
        profiles.push({ ...parseRecordingHeader(id, data), files: [] });
      }
      await client.cd('/data/rec');
      const files = (await client.list()).filter(
        (file) => file.type === FileType.File && RECORDING_NAME.test(file.name),
      );
      if (files.length > MAX_FILES)
        throw new Error('Too many device recording files.');
      for (const file of files) {
        const id = RECORDING_NAME.exec(file.name)![1];
        const profile = profiles.find((item) => item.id === id);
        if (!profile) continue;
        profile.files.push({
          name: file.name,
          size: file.size,
          modifiedAt: file.modifiedAt?.toISOString() ?? null,
        });
      }
      for (const profile of profiles)
        profile.files.sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true }),
        );
      return profiles.sort((a, b) => a.id.localeCompare(b.id));
    },
    signal,
  );
}

export async function readDeviceRecording(
  device: ModbusDevice,
  timeoutMs: number,
  name: string,
  fieldIndex: number,
  statistic: 'average' | 'minimum' | 'maximum',
) {
  const match = RECORDING_NAME.exec(name);
  if (!match)
    throw Object.assign(new Error('Invalid recording file name.'), {
      statusCode: 400,
    });
  return withFtp(device, timeoutMs, async (client) => {
    await client.cd('/data/header');
    const header = parseRecordingHeader(
      match[1],
      await download(client, `${match[1]}.head`, MAX_HEADER_BYTES),
    );
    if (
      fieldIndex >= header.fields.length ||
      (header.kind === 'sample' && statistic !== 'average')
    )
      throw Object.assign(new Error('Invalid recording measurement.'), {
        statusCode: 400,
      });
    await client.cd('/data/rec');
    const file = (await client.list()).find(
      (item) => item.type === FileType.File && item.name === name,
    );
    if (!file) throw new Error('Device recording file no longer exists.');
    if (file.size > MAX_RECORDING_BYTES)
      throw new Error('Device recording is too large.');
    const data = await download(client, name, MAX_RECORDING_BYTES);
    const points = parseRecordingFile(data, header, fieldIndex, statistic);
    return {
      profile: header,
      file: name,
      fieldIndex,
      statistic,
      range: recordingTimeRange(data, header),
      points,
    };
  });
}

export async function readDeviceRecordingRanges(
  device: ModbusDevice,
  timeoutMs: number,
  profileId: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
) {
  if (!PROFILE_NAME.test(profileId))
    throw Object.assign(new Error('Invalid recording.'), { statusCode: 400 });
  return withFtp(
    device,
    timeoutMs,
    async (client) => {
      await client.cd('/data/header');
      const profile = parseRecordingHeader(
        profileId,
        await download(client, `${profileId}.head`, MAX_HEADER_BYTES),
      );
      await client.cd('/data/rec');
      const files = (await client.list())
        .filter(
          (file) =>
            file.type === FileType.File &&
            RECORDING_NAME.exec(file.name)?.[1] === profileId,
        )
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true }),
        );
      if (files.length > MAX_FILES)
        throw new Error('Too many device recording files.');
      const ranges: Record<string, DeviceRecordingRange> = {};
      const failed: string[] = [];
      for (const file of files.slice(offset, offset + limit)) {
        signal?.throwIfAborted();
        try {
          if (file.size > MAX_RECORDING_BYTES)
            throw new Error('Device recording is too large.');
          const range = recordingTimeRange(
            await download(client, file.name, MAX_RECORDING_BYTES),
            profile,
          );
          if (range) ranges[file.name] = range;
          else failed.push(file.name);
        } catch (error) {
          if (client.closed) throw error;
          failed.push(file.name);
        }
      }
      return {
        ranges,
        failed,
        total: files.length,
        nextOffset: Math.min(files.length, offset + limit),
      };
    },
    signal,
  );
}

export async function downloadDeviceRecordingBatch(
  device: ModbusDevice,
  timeoutMs: number,
  profileId: string,
  offset: number,
  limit: number,
  known: Record<string, { size: number; modifiedAt: string | null }>,
  signal?: AbortSignal,
) {
  if (!PROFILE_NAME.test(profileId))
    throw Object.assign(new Error('Invalid recording.'), { statusCode: 400 });
  const timings: RecordingSyncTimings = {
    connectMs: 0,
    setupMs: 0,
    downloadMs: 0,
    saveMs: 0,
  };
  return withFtp(
    device,
    timeoutMs,
    async (client) => {
      const setupStarted = performance.now();
      await client.cd('/data/header');
      const profile = parseRecordingHeader(
        profileId,
        await download(client, `${profileId}.head`, MAX_HEADER_BYTES),
      );
      await client.cd('/data/rec');
      const files = (await client.list())
        .filter(
          (file) =>
            file.type === FileType.File &&
            RECORDING_NAME.exec(file.name)?.[1] === profileId,
        )
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true }),
        );
      timings.setupMs += performance.now() - setupStarted;
      if (files.length > MAX_FILES)
        throw new Error('Too many device recording files.');
      const downloaded: {
        file: { name: string; size: number; modifiedAt: string | null };
        bytes: Buffer;
        range: DeviceRecordingRange | null;
      }[] = [];
      const failed: string[] = [];
      const fileTimings: RecordingSyncFileTiming[] = [];
      let skipped = 0;
      for (const file of files.slice(offset, offset + limit)) {
        signal?.throwIfAborted();
        const modifiedAt = file.modifiedAt?.toISOString() ?? null;
        const saved = known[file.name];
        if (
          file !== files[0] &&
          saved?.size === file.size &&
          saved.modifiedAt === modifiedAt
        ) {
          skipped++;
          continue;
        }
        try {
          if (file.size > MAX_RECORDING_BYTES)
            throw new Error('Device recording is too large.');
          const downloadStarted = performance.now();
          const bytes = await download(
            client,
            file.name,
            MAX_RECORDING_BYTES,
          ).finally(() => {
            timings.downloadMs += performance.now() - downloadStarted;
          });
          const durationMs = performance.now() - downloadStarted;
          // Decode each record before persisting it, including its timestamps.
          parseRecordingFile(bytes, profile, 0, 'average');
          fileTimings.push({
            name: file.name,
            bytes: bytes.length,
            durationMs,
          });
          downloaded.push({
            file: { name: file.name, size: bytes.length, modifiedAt },
            bytes,
            range: recordingTimeRange(bytes, profile),
          });
        } catch (error) {
          if (client.closed) throw error;
          failed.push(file.name);
        }
      }
      return {
        profile,
        downloaded,
        failed,
        skipped,
        total: files.length,
        nextOffset: Math.min(files.length, offset + limit),
        timings,
        fileTimings,
      };
    },
    signal,
    timings,
  );
}
