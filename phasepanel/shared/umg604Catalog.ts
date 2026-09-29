import type { ModbusModel } from './modbusModels.js';
import { umg604CatalogRows } from './umg604CatalogRows.js';

type Block = Pick<ModbusModel, 'firstRegister' | 'registerCount'>;
type CatalogValue = ModbusModel['measurements'][number] & { block: Block };

const blocks = new Map<number, Block>();
let first = -1;
let previous = -1;
for (const [address] of umg604CatalogRows) {
  if (address !== previous + 2 || address - first + 2 > 124) first = address;
  previous = address;
  blocks.set(address, {
    firstRegister: first,
    registerCount: address - first + 2,
  });
}
// Each block's final size is shared by every value inside it.
const finalBlocks = new Map<number, Block>();
for (const block of blocks.values())
  finalBlocks.set(block.firstRegister, block);

const usedKeys = new Set<string>();
export const umg604Catalog: CatalogValue[] = umg604CatalogRows.map(
  ([address, designation, unit]) => {
    const match = /^(_[A-Za-z0-9_]+?)(?:\[(\d+)\])?$/.exec(designation)!;
    const base = match[1];
    const index = match[2];
    const firstRegister = blocks.get(address)!.firstRegister;
    const measurement = `JZ${base}`;
    let channel = index ?? 'Overall';
    // The published list repeats one designation at two distinct addresses.
    if (usedKeys.has(JSON.stringify([measurement, channel])))
      channel = `${channel}@${address}`;
    usedKeys.add(JSON.stringify([measurement, channel]));
    return {
      measurement,
      channel,
      label: base.slice(1).replaceAll('_', ' '),
      channelLabel:
        index === undefined
          ? `Register ${address}`
          : `${base.startsWith('_FFT_') ? `Harmonic ${Number(index) + 1}` : `Index ${index}`} · register ${address}`,
      unit,
      address,
      block: finalBlocks.get(firstRegister)!,
    };
  },
);

export const umg604CatalogByKey = new Map(
  umg604Catalog.map((item) => [
    JSON.stringify([item.measurement, item.channel]),
    item,
  ]),
);
