import { z } from 'zod';
import { defaultModbusModel } from '../shared/modbusModels.js';
import { modbusDeviceSchema, type ModbusDevice } from './sourceSettings.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('data/dashboards.db'),
  DESKTOP_DATA_DIR: z.string().optional(),
  DESKTOP_PORT_MODE: z.enum(['auto', 'fixed']).optional(),
  DESKTOP_SETTINGS_PREVIEW: z.enum(['true', 'false']).default('false'),
  GRIDVIS_MOCK: z.enum(['true', 'false']).default('false'),
  DATA_SOURCE: z.enum(['gridvis', 'modbus']).default('modbus'),
  MODBUS_DEVICES: z.string().optional(),
  MODBUS_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(4000),
  GRIDVIS_BASE_URL: z.string().optional(),
  GRIDVIS_USERNAME: z.string().optional(),
  GRIDVIS_PASSWORD: z.string().optional(),
  GRIDVIS_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(8000),
  GRIDVIS_STALE_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(60000),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  let modbusDevices: ModbusDevice[] = [];
  if (parsed.MODBUS_DEVICES) {
    let raw: unknown;
    try {
      raw = JSON.parse(parsed.MODBUS_DEVICES ?? '');
    } catch {
      throw new Error(
        'MODBUS_DEVICES must be a JSON array of configured devices.',
      );
    }
    modbusDevices = z.array(modbusDeviceSchema).parse(raw);
    if (modbusDevices.some((device) => device.model !== defaultModbusModel))
      throw new Error(
        'MODBUS_DEVICES can only use the built-in model. Configure custom models in Source settings.',
      );
    const keys = modbusDevices.map((device) =>
      JSON.stringify([device.project, device.id]),
    );
    if (new Set(keys).size !== keys.length)
      throw new Error('MODBUS_DEVICES contains duplicate project/device IDs.');
  }
  if (parsed.GRIDVIS_BASE_URL) {
    const url = new URL(parsed.GRIDVIS_BASE_URL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'GRIDVIS_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.',
      );
    }
  }
  return { ...parsed, modbusDevices };
}
export type Config = ReturnType<typeof readConfig>;
