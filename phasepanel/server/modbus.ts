import { createConnection } from 'node:net';
import {
  bindingKey,
  type Binding,
  type Device,
  type Measurement,
  type Project,
  type Reading,
} from '../shared/model.js';
import type { ModbusModel } from '../shared/modbusModels.js';
import type { Config } from './config.js';
import type { ModbusDevice } from './sourceSettings.js';
import type { GridVis } from './gridvis.js';
import { builtInModbusModels } from './modbusModels.js';
import { defaultModbusModel } from '../shared/modbusModels.js';
import { umg604Catalog, umg604CatalogByKey } from '../shared/umg604Catalog.js';

const measurementKey = (measurement: string, channel: string) =>
  JSON.stringify([measurement, channel]);

export function checkModbusTcp(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

export function readModbusBlock(
  device: ModbusDevice,
  timeoutMs: number,
  model: ModbusModel,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = createConnection({ host: device.host, port: device.port });
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new Error('Modbus request timed out.')),
      timeoutMs,
    );
    socket.on('connect', () => {
      const request = Buffer.alloc(12);
      request.writeUInt16BE(1, 0); // transaction ID
      request.writeUInt16BE(0, 2); // Modbus protocol
      request.writeUInt16BE(6, 4); // remaining request length
      request[6] = 1; // device unit ID
      request[7] = 3; // read holding registers only
      request.writeUInt16BE(model.firstRegister, 8);
      request.writeUInt16BE(model.registerCount, 10);
      socket.write(request);
    });
    socket.on('data', (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      chunks.push(chunk);
      received += chunk.length;
      if (received < 9) return;
      const response = Buffer.concat(chunks, received);
      const frameLength = 6 + response.readUInt16BE(4);
      if (frameLength > 260 || frameLength < 9)
        return finish(new Error('Invalid Modbus response length.'));
      if (received < frameLength) return;
      if (
        response.readUInt16BE(0) !== 1 ||
        response.readUInt16BE(2) !== 0 ||
        response[6] !== 1 ||
        response[7] !== 3 ||
        response[8] !== model.registerCount * 2 ||
        frameLength !== 9 + model.registerCount * 2
      )
        return finish(new Error('Unexpected Modbus response.'));
      finish(undefined, response);
    });
    socket.on('error', () => finish(new Error('Cannot reach Modbus device.')));
    socket.on('end', () =>
      finish(new Error('Modbus connection closed early.')),
    );
  });
}

export class ModbusSource implements GridVis {
  private devicesByKey: Map<string, ModbusDevice>;
  private modelsById: Map<string, ModbusModel>;
  private valuesByModel: Map<
    string,
    Map<string, ModbusModel['measurements'][number]>
  >;
  private inFlight = new Map<string, Promise<Buffer>>();

  constructor(
    private config: Config,
    private now = Date.now,
    private readBlock = readModbusBlock,
    models: ModbusModel[] = builtInModbusModels,
  ) {
    this.devicesByKey = new Map(
      config.modbusDevices.map((device) => [
        JSON.stringify([device.project, device.id]),
        device,
      ]),
    );
    this.modelsById = new Map(models.map((model) => [model.id, model]));
    this.valuesByModel = new Map(
      models.map((model) => [
        model.id,
        new Map(
          [
            ...model.measurements,
            ...(model.id === defaultModbusModel ? umg604Catalog : []),
          ].map((item) => [
            measurementKey(item.measurement, item.channel),
            item,
          ]),
        ),
      ]),
    );
  }

  async projects(): Promise<Project[]> {
    return [...new Set(this.config.modbusDevices.map((d) => d.project))].map(
      (name) => ({ name }),
    );
  }

  async devices(project: string): Promise<Device[]> {
    return this.config.modbusDevices
      .filter((device) => device.project === project)
      .map((device) => ({
        id: device.id,
        name: device.name,
        model: `${this.modelsById.get(device.model)?.name ?? device.model} (Modbus/TCP)`,
      }));
  }

  async measurements(project: string, device: string): Promise<Measurement[]> {
    const configured = this.devicesByKey.get(JSON.stringify([project, device]));
    const values = this.valuesByModel.get(configured?.model ?? '');
    return values
      ? [...values.values()].map(
          ({ measurement, channel, label, channelLabel, unit }) => ({
            measurement,
            channel,
            label,
            channelLabel,
            unit,
          }),
        )
      : [];
  }

  private async block(
    key: string,
    device: ModbusDevice,
    model: ModbusModel,
  ): Promise<Buffer> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.readBlock(
      device,
      this.config.MODBUS_TIMEOUT_MS,
      model,
    );
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async readings(bindings: Binding[]): Promise<Reading[]> {
    const unique = [
      ...new Map(
        bindings.map((binding) => [bindingKey(binding), binding]),
      ).values(),
    ];
    const grouped = new Map<string, Binding[]>();
    for (const binding of unique) {
      const key = JSON.stringify([binding.project, binding.deviceId]);
      grouped.set(key, [...(grouped.get(key) ?? []), binding]);
    }
    const groups = await Promise.all(
      [...grouped].map(async ([key, selected]): Promise<Reading[]> => {
        const device = this.devicesByKey.get(key);
        const model = this.modelsById.get(device?.model ?? '');
        const values = model && this.valuesByModel.get(model.id);
        const supported = selected.filter((binding) =>
          values?.has(measurementKey(binding.measurement, binding.channel)),
        );
        const blocks = model
          ? [
              {
                firstRegister: model.firstRegister,
                registerCount: model.registerCount,
              },
              ...(model.extraBlocks ?? []),
            ]
          : [];
        const blockFor = (binding: Binding, address: number) =>
          blocks.find(
            (block) =>
              address >= block.firstRegister &&
              address + 1 < block.firstRegister + block.registerCount,
          ) ??
          (model?.id === defaultModbusModel
            ? umg604CatalogByKey.get(
                measurementKey(binding.measurement, binding.channel),
              )?.block
            : undefined);
        const frames = new Map<number, Buffer>();
        const failures = new Map<number, string>();
        if (device && model) {
          const needed = new Map(
            supported.flatMap((binding) => {
              const register = values?.get(
                measurementKey(binding.measurement, binding.channel),
              );
              const block = register && blockFor(binding, register.address);
              return block ? [[block.firstRegister, block] as const] : [];
            }),
          );
          for (const block of needed.values()) {
            try {
              frames.set(
                block.firstRegister,
                await this.block(
                  `${key}:${block.firstRegister}:${block.registerCount}`,
                  device,
                  block.firstRegister === model.firstRegister &&
                    block.registerCount === model.registerCount
                    ? model
                    : { ...model, ...block },
                ),
              );
            } catch (error) {
              failures.set(
                block.firstRegister,
                error instanceof Error
                  ? error.message
                  : 'Modbus request failed.',
              );
            }
          }
        }
        const retrievedAt = new Date(this.now()).toISOString();
        return selected.map((binding): Reading => {
          const register = values?.get(
            measurementKey(binding.measurement, binding.channel),
          );
          const block = register && blockFor(binding, register.address);
          const frame = block && frames.get(block.firstRegister);
          const failure = !device
            ? 'Modbus device is not configured.'
            : block && failures.get(block.firstRegister);
          const value =
            frame && register && block
              ? frame.readFloatBE(
                  9 + (register.address - block.firstRegister) * 2,
                )
              : null;
          return {
            key: bindingKey(binding),
            value: value !== null && Number.isFinite(value) ? value : null,
            unit: register?.unit ?? '',
            sourceTimestampNs: null,
            sourceTime: null,
            retrievedAt,
            status: failure
              ? 'error'
              : value !== null && Number.isFinite(value)
                ? 'ok'
                : 'unavailable',
            ...(failure ? { message: failure } : {}),
          };
        });
      }),
    );
    return groups.flat();
  }
}
