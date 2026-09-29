import { isIP } from 'node:net';
import { z } from 'zod';
import {
  defaultModbusModel,
  modbusModelSchema,
} from '../shared/modbusModels.js';
import type { Config } from './config.js';
import { builtInModbusModels } from './modbusModels.js';
import type { Binding } from '../shared/model.js';

export const modbusDeviceSchema = z.object({
  project: z.string().trim().min(1).max(200),
  id: z.string().regex(/^\d+$/).max(20),
  name: z.string().trim().min(1).max(200),
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .default(defaultModbusModel),
  host: z
    .string()
    .trim()
    .min(1)
    .refine(
      (host) =>
        isIP(host) !== 0 ||
        (/^[a-z0-9.-]+$/i.test(host) &&
          !host.startsWith('-') &&
          !host.endsWith('-')),
      'Enter a device IP address or hostname.',
    ),
  port: z.number().int().min(1).max(65535).default(502),
  ftpPort: z.number().int().min(1).max(65535).optional(),
  ftpUsername: z.string().max(200).optional(),
  ftpPassword: z.string().max(500).optional(),
});
export type ModbusDevice = z.infer<typeof modbusDeviceSchema>;

const gridvisSchema = z.object({
  baseUrl: z.string().trim().max(2000),
  username: z.string().max(200),
  password: z.string().max(500),
  timeoutMs: z.number().int().min(100).max(60000),
});
const modbusSchema = z.object({
  devices: z.array(modbusDeviceSchema).max(500),
  models: z
    .array(modbusModelSchema)
    .min(1)
    .max(100)
    .default(builtInModbusModels),
  timeoutMs: z.number().int().min(100).max(60000),
});
export const sourceSettingsSchema = z
  .object({
    source: z.enum(['mock', 'gridvis', 'modbus']),
    gridvis: gridvisSchema,
    modbus: modbusSchema,
    staleMs: z.number().int().min(1000).max(3600000),
  })
  .superRefine((value, context) => {
    if (value.source === 'gridvis') {
      try {
        const url = new URL(value.gridvis.baseUrl);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('Invalid URL');
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['gridvis', 'baseUrl'],
          message: 'Enter an HTTP(S) service URL without credentials or query.',
        });
      }
      if (Boolean(value.gridvis.username) !== Boolean(value.gridvis.password))
        context.addIssue({
          code: 'custom',
          path: ['gridvis', 'password'],
          message: 'Set both username and password, or leave both blank.',
        });
    }
    if (value.source === 'modbus' && value.modbus.devices.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['modbus', 'devices'],
        message: 'Add at least one Modbus device.',
      });
    const keys = value.modbus.devices.map((device) =>
      JSON.stringify([device.project, device.id]),
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: 'custom',
        path: ['modbus', 'devices'],
        message: 'Project and device ID pairs must be unique.',
      });
    const modelIds = value.modbus.models.map((model) => model.id);
    if (new Set(modelIds).size !== modelIds.length)
      context.addIssue({
        code: 'custom',
        path: ['modbus', 'models'],
        message: 'Model IDs must be unique.',
      });
    const modelNames = value.modbus.models.map((model) =>
      model.name.toLocaleLowerCase(),
    );
    if (new Set(modelNames).size !== modelNames.length)
      context.addIssue({
        code: 'custom',
        path: ['modbus', 'models'],
        message: 'Model names must be unique.',
      });
    if (!modelIds.includes(defaultModbusModel))
      context.addIssue({
        code: 'custom',
        path: ['modbus', 'models'],
        message: 'The UMG 604-PRO model must remain available.',
      });
    value.modbus.devices.forEach((device, index) => {
      if (Boolean(device.ftpUsername) !== Boolean(device.ftpPassword))
        context.addIssue({
          code: 'custom',
          path: ['modbus', 'devices', index, 'ftpPassword'],
          message: 'Set both FTP user and password, or leave both blank.',
        });
      if (!modelIds.includes(device.model))
        context.addIssue({
          code: 'custom',
          path: ['modbus', 'devices', index, 'model'],
          message: 'Select a configured Modbus model.',
        });
    });
  });
export type SourceSettings = z.infer<typeof sourceSettingsSchema>;

export function mappedModbusValues(settings: SourceSettings): {
  binding: Binding;
  deviceName: string;
  label: string;
  channelLabel: string;
  unit: string;
}[] {
  if (settings.source !== 'modbus') return [];
  const models = new Map(
    settings.modbus.models.map((model) => [model.id, model]),
  );
  return settings.modbus.devices.flatMap((device) =>
    (models.get(device.model)?.measurements ?? []).map((measurement) => ({
      binding: {
        project: device.project,
        deviceId: device.id,
        measurement: measurement.measurement,
        channel: measurement.channel,
      },
      deviceName: device.name,
      label: measurement.label,
      channelLabel: measurement.channelLabel,
      unit: measurement.unit,
    })),
  );
}

export const sourceSettingsUpdateSchema = z.object({
  revision: z.number().int().positive(),
  source: z.enum(['mock', 'gridvis', 'modbus']),
  gridvis: gridvisSchema.omit({ password: true }).extend({
    password: z.string().max(500).optional(),
    clearPassword: z.boolean().optional(),
  }),
  modbus: modbusSchema.omit({ devices: true }).extend({
    devices: z
      .array(
        modbusDeviceSchema.omit({ ftpPassword: true }).extend({
          ftpPassword: z.string().max(500).optional(),
          clearFtpPassword: z.boolean().optional(),
        }),
      )
      .max(500),
  }),
  staleMs: z.number().int().min(1000).max(3600000),
});

export function initialSourceSettings(config: Config): SourceSettings {
  return {
    source: config.GRIDVIS_MOCK === 'true' ? 'mock' : config.DATA_SOURCE,
    gridvis: {
      baseUrl: config.GRIDVIS_BASE_URL ?? '',
      username: config.GRIDVIS_USERNAME ?? '',
      password: config.GRIDVIS_PASSWORD ?? '',
      timeoutMs: config.GRIDVIS_TIMEOUT_MS,
    },
    modbus: {
      devices: config.modbusDevices,
      models: builtInModbusModels,
      timeoutMs: config.MODBUS_TIMEOUT_MS,
    },
    staleMs: config.GRIDVIS_STALE_MS,
  };
}

export function publicSourceSettings(
  settings: SourceSettings,
  revision: number,
) {
  const { password: _, ...gridvis } = settings.gridvis;
  return {
    ...settings,
    revision,
    modbus: {
      ...settings.modbus,
      devices: settings.modbus.devices.map(({ ftpPassword, ...device }) => ({
        ...device,
        ftpPort: device.ftpPort ?? 21,
        hasFtpPassword: Boolean(ftpPassword),
      })),
    },
    gridvis: {
      ...gridvis,
      hasPassword: Boolean(settings.gridvis.password),
    },
  };
}

export function updatedSourceSettings(
  current: SourceSettings,
  raw: unknown,
): { revision: number; settings: SourceSettings } {
  const input = sourceSettingsUpdateSchema.parse(raw);
  const password = input.gridvis.clearPassword
    ? ''
    : input.gridvis.password === undefined || input.gridvis.password === ''
      ? current.gridvis.password
      : input.gridvis.password;
  const settings = sourceSettingsSchema.parse({
    source: input.source,
    gridvis: {
      baseUrl: input.gridvis.baseUrl,
      username: input.gridvis.username,
      password: input.gridvis.username ? password : '',
      timeoutMs: input.gridvis.timeoutMs,
    },
    modbus: {
      ...input.modbus,
      devices: input.modbus.devices.map((device) => {
        const previous = current.modbus.devices.find(
          (item) =>
            item.project === device.project &&
            item.id === device.id &&
            item.host === device.host &&
            item.ftpUsername === device.ftpUsername,
        );
        const ftpPassword =
          device.clearFtpPassword || !device.ftpUsername
            ? ''
            : device.ftpPassword || previous?.ftpPassword || '';
        const { clearFtpPassword: _, ...rest } = device;
        return { ...rest, ftpPort: device.ftpPort ?? 21, ftpPassword };
      }),
    },
    staleMs: input.staleMs,
  });
  return { revision: input.revision, settings };
}
