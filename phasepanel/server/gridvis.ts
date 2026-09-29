import { parse } from 'lossless-json';
import {
  bindingKey,
  type Binding,
  type Device,
  type Measurement,
  type Project,
  type Reading,
} from '../shared/model.js';
import type { Config } from './config.js';

type ObjectMap = Record<string, unknown>;
function object(value: unknown): ObjectMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectMap)
    : {};
}
function list(value: unknown, wrapper: string): unknown[] {
  // GridVis/Jersey wraps collections with their XML entity names in JSON.
  const collection = Array.isArray(value) ? value : object(value)[wrapper];
  if (!Array.isArray(collection))
    throw new GridVisError(
      'Unexpected GridVis response format. Check your installed API version.',
      'format',
    );
  return collection;
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function parseGridVisJson(text: string): unknown {
  // JSON.parse would round int64 nanosecond timestamps before we could convert them.
  return parse(text, undefined, (token) =>
    /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))
      ? token
      : Number(token),
  );
}
export function timestamp(
  value: unknown,
): { ns: string; iso: string; ms: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return null;
  const ns = BigInt(raw);
  const ms = Number(ns / 1000000n);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 8640000000000000)
    return null;
  return { ns: raw, ms, iso: new Date(ms).toISOString() };
}
export interface GridVis {
  projects(): Promise<Project[]>;
  devices(project: string): Promise<Device[]>;
  measurements(project: string, device: string): Promise<Measurement[]>;
  readings(bindings: Binding[]): Promise<Reading[]>;
}
export class GridVisError extends Error {
  constructor(
    message: string,
    public code: 'auth' | 'timeout' | 'upstream' | 'format' = 'upstream',
  ) {
    super(message);
  }
}
export class RestGridVis implements GridVis {
  private base: string;
  private inFlight = new Map<string, Promise<unknown>>();
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {
    this.base = config.GRIDVIS_BASE_URL!.replace(/\/+$/, '') + '/rest/1/';
  }
  private async get(path: string): Promise<unknown> {
    const existing = this.inFlight.get(path);
    if (existing) return existing;
    const request = (async () => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.config.GRIDVIS_USERNAME)
        headers.Authorization =
          'Basic ' +
          Buffer.from(
            `${this.config.GRIDVIS_USERNAME}:${this.config.GRIDVIS_PASSWORD}`,
          ).toString('base64');
      try {
        const response = await this.fetcher(this.base + path, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.GRIDVIS_TIMEOUT_MS),
        });
        if (response.status === 401 || response.status === 403)
          throw new GridVisError(
            'GridVis authentication failed. Check server credentials.',
            'auth',
          );
        if (!response.ok)
          throw new GridVisError(`GridVis returned HTTP ${response.status}.`);
        const text = await response.text();
        try {
          return parseGridVisJson(text);
        } catch {
          throw new GridVisError('GridVis returned invalid JSON.', 'format');
        }
      } catch (error) {
        if (error instanceof GridVisError) throw error;
        if (
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
        )
          throw new GridVisError('GridVis request timed out.', 'timeout');
        throw new GridVisError(
          'Cannot reach GridVis. Check the connection and server configuration.',
        );
      }
    })();
    this.inFlight.set(path, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(path);
    }
  }
  async projects(): Promise<Project[]> {
    return list(await this.get('projects'), 'project')
      .map(object)
      .filter((p) => str(p.name))
      .map((p) => ({ name: str(p.name) }));
  }
  async devices(project: string): Promise<Device[]> {
    return list(
      await this.get(`projects/${encodeURIComponent(project)}/devices`),
      'device',
    )
      .map(object)
      .filter((d) => /^\d+$/.test(String(d.id)))
      .map((d) => ({
        id: String(d.id),
        name: str(d.name) || `Device ${d.id}`,
        model: str(d.typeDisplayName) || str(d.type),
      }));
  }
  async measurements(project: string, device: string): Promise<Measurement[]> {
    return list(
      await this.get(
        `projects/${encodeURIComponent(project)}/devices/${encodeURIComponent(device)}/online/values`,
      ),
      'valuetype',
    )
      .map(object)
      .filter((v) => str(v.value) && str(v.type))
      .map((v) => ({
        measurement: str(v.value),
        channel: str(v.type),
        label: str(v.valueName) || str(v.value),
        channelLabel: str(v.typeName) || str(v.type),
        unit: str(v.unit),
      }));
  }
  async readings(bindings: Binding[]): Promise<Reading[]> {
    const unique = [
      ...new Map(bindings.map((b) => [bindingKey(b), b])).values(),
    ];
    const grouped = new Map<string, Binding[]>();
    for (const b of unique)
      grouped.set(b.project, [...(grouped.get(b.project) ?? []), b]);
    return (
      await Promise.all(
        [...grouped].map(async ([project, selected]) => {
          const query = new URLSearchParams({
            appendValueType: 'true',
            timeout: '500',
            timeliness: String(this.config.GRIDVIS_STALE_MS),
            ignoreDeletedDevice: 'true',
          });
          for (const b of [...selected].sort((a, b) =>
            bindingKey(a).localeCompare(bindingKey(b)),
          ))
            query.append(
              'value',
              `${b.deviceId};${b.measurement};${b.channel}`,
            );
          const retrievedAt = () => new Date(this.now()).toISOString();
          try {
            const raw = await this.get(
              `projects/${encodeURIComponent(project)}/onlinevalues?${query}`,
            );
            // Swagger describes an array; some versions return a single OnlineValueMap.
            const maps = Array.isArray(raw) ? raw.map(object) : [object(raw)];
            if (!maps.every((m) => m.value && typeof m.value === 'object'))
              throw new GridVisError(
                'Unexpected GridVis live-value format.',
                'format',
              );
            const values = Object.assign(
              {},
              ...maps.map((m) => object(m.value)),
            ) as ObjectMap;
            const times = Object.assign(
              {},
              ...maps.map((m) => object(m.time)),
            ) as ObjectMap;
            const types = Object.assign(
              {},
              ...maps.map((m) => object(m.valueType)),
            ) as ObjectMap;
            return selected.map((b): Reading => {
              const mapKey = `${b.deviceId}.${b.measurement}.${b.channel}`;
              const value = values[mapKey];
              const time = timestamp(times[mapKey]);
              const valid = typeof value === 'number' && Number.isFinite(value);
              return {
                key: bindingKey(b),
                value: valid ? value : null,
                unit: str(object(types[mapKey]).unit),
                sourceTimestampNs: time?.ns ?? null,
                sourceTime: time?.iso ?? null,
                retrievedAt: retrievedAt(),
                status: !valid
                  ? 'unavailable'
                  : time && this.now() - time.ms > this.config.GRIDVIS_STALE_MS
                    ? 'stale'
                    : 'ok',
              };
            });
          } catch (error) {
            return selected.map((b) => ({
              key: bindingKey(b),
              value: null,
              unit: '',
              sourceTimestampNs: null,
              sourceTime: null,
              retrievedAt: retrievedAt(),
              status: 'error' as const,
              message:
                error instanceof Error
                  ? error.message
                  : 'GridVis request failed.',
            }));
          }
        }),
      )
    ).flat();
  }
}

const demoMeasurements: Measurement[] = [
  ...['L1', 'L2', 'L3'].flatMap((channel) => [
    {
      measurement: 'U_Effective',
      channel,
      label: 'Voltage',
      channelLabel: channel,
      unit: 'V',
    },
    {
      measurement: 'I_Effective',
      channel,
      label: 'Current',
      channelLabel: channel,
      unit: 'A',
    },
  ]),
  {
    measurement: 'PowerActive',
    channel: 'SUM13',
    label: 'Active power',
    channelLabel: 'Total',
    unit: 'W',
  },
  {
    measurement: 'Frequency',
    channel: 'Overall',
    label: 'Frequency',
    channelLabel: 'Overall',
    unit: 'Hz',
  },
  {
    measurement: 'EnergyActive',
    channel: 'SUM13',
    label: 'Imported active energy',
    channelLabel: 'Total',
    unit: 'kWh',
  },
];
export class MockGridVis implements GridVis {
  async projects() {
    return [{ name: 'Demo facility' }];
  }
  async devices(project: string) {
    return project === 'Demo facility'
      ? [
          { id: '1', name: 'Main incomer', model: 'UMG 604' },
          { id: '2', name: 'Production floor', model: 'UMG 96RM' },
        ]
      : [];
  }
  async measurements(project: string, device: string) {
    return (await this.devices(project)).some((d) => d.id === device)
      ? demoMeasurements
      : [];
  }
  async readings(bindings: Binding[]): Promise<Reading[]> {
    return Promise.all(
      [...new Map(bindings.map((b) => [bindingKey(b), b])).values()].map(
        async (b) => {
          const measurement = (
            await this.measurements(b.project, b.deviceId)
          ).find(
            (m) => m.measurement === b.measurement && m.channel === b.channel,
          );
          const value = (
            {
              U_Effective: 230.4,
              I_Effective: 18.7,
              PowerActive: 12940,
              Frequency: 50.01,
              EnergyActive:
                45000 +
                ((Date.now() - Date.UTC(2026, 0, 1)) / 3_600_000) * 12.94,
            } as Record<string, number>
          )[b.measurement];
          const now = new Date();
          return {
            key: bindingKey(b),
            value: measurement
              ? value +
                (b.measurement === 'Frequency' ? 0 : Number(b.deviceId) - 1)
              : null,
            unit: measurement?.unit ?? '',
            sourceTimestampNs: String(BigInt(now.getTime()) * 1000000n),
            sourceTime: now.toISOString(),
            retrievedAt: now.toISOString(),
            status: measurement ? 'ok' : 'unavailable',
          };
        },
      ),
    );
  }
}
