import { z } from 'zod';

export const defaultModbusModel = 'umg-604-pro';

export const modbusModelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(200),
    firstRegister: z.number().int().min(0).max(65535),
    registerCount: z.number().int().min(2).max(125),
    extraBlocks: z
      .array(
        z.object({
          firstRegister: z.number().int().min(0).max(65535),
          registerCount: z.number().int().min(2).max(125),
        }),
      )
      .max(8)
      .optional(),
    measurements: z
      .array(
        z.object({
          measurement: z.string().trim().min(1).max(200),
          channel: z.string().trim().min(1).max(200),
          label: z.string().trim().min(1).max(200),
          channelLabel: z.string().trim().min(1).max(200),
          unit: z.string().trim().max(30),
          address: z.number().int().min(0).max(65535),
        }),
      )
      .min(1)
      .max(250),
  })
  .superRefine((model, context) => {
    const blocks = [
      {
        firstRegister: model.firstRegister,
        registerCount: model.registerCount,
      },
      ...(model.extraBlocks ?? []),
    ];
    blocks.forEach((block, index) => {
      if (block.firstRegister + block.registerCount > 65536)
        context.addIssue({
          code: 'custom',
          path: index === 0 ? ['registerCount'] : ['extraBlocks', index - 1],
          message: 'The register block exceeds the Modbus address range.',
        });
      if (
        blocks
          .slice(0, index)
          .some(
            (other) =>
              block.firstRegister < other.firstRegister + other.registerCount &&
              other.firstRegister < block.firstRegister + block.registerCount,
          )
      )
        context.addIssue({
          code: 'custom',
          path: index === 0 ? ['firstRegister'] : ['extraBlocks', index - 1],
          message: 'Register blocks must not overlap.',
        });
    });
    const seen = new Set<string>();
    model.measurements.forEach((item, index) => {
      const key = JSON.stringify([item.measurement, item.channel]);
      if (seen.has(key))
        context.addIssue({
          code: 'custom',
          path: ['measurements', index],
          message: 'Measurement and channel pairs must be unique.',
        });
      seen.add(key);
      if (
        !blocks.some(
          (block) =>
            item.address >= block.firstRegister &&
            item.address + 1 < block.firstRegister + block.registerCount,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['measurements', index, 'address'],
          message: 'A 32-bit float must fit inside a register block.',
        });
    });
  });

export type ModbusModel = z.infer<typeof modbusModelSchema>;
