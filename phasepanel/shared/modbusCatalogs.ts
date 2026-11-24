import { defaultModbusModel, type ModbusModel } from './modbusModels.js';
import { umg604Catalog, umg604CatalogByKey } from './umg604Catalog.js';
import { umg605ProCatalogRows } from './catalogs/umg605ProRows.js';
import { umg509ProCatalogRows } from './catalogs/umg509ProRows.js';
import { umg512ProCatalogRows } from './catalogs/umg512ProRows.js';
import { umg508CatalogRows } from './catalogs/umg508Rows.js';
import { umg96RmECatalogRows } from './catalogs/umg96RmERows.js';
import { umg96PaCatalogRows } from './catalogs/umg96PaRows.js';
import { umg96PqLCatalogRows } from './catalogs/umg96PqLRows.js';

type Block = Pick<ModbusModel, 'firstRegister' | 'registerCount'>;
export type CatalogValue = ModbusModel['measurements'][number] & {
  block: Block;
};
export type ModbusModelCatalog = {
  values: readonly CatalogValue[];
  byKey: ReadonlyMap<string, CatalogValue>;
};

type RawCatalogRow = readonly [number, string, string];

function buildBlocks(rows: readonly RawCatalogRow[]): Map<number, Block> {
  const blocks = new Map<number, Block>();
  let first = -1;
  let previous = -1;
  for (const [address] of rows) {
    if (address !== previous + 2 || address - first + 2 > 124) first = address;
    previous = address;
    blocks.set(address, {
      firstRegister: first,
      registerCount: address - first + 2,
    });
  }
  const finalBlocks = new Map<number, Block>();
  for (const block of blocks.values())
    finalBlocks.set(block.firstRegister, block);
  const byAddress = new Map<number, Block>();
  for (const [address, block] of blocks)
    byAddress.set(address, finalBlocks.get(block.firstRegister)!);
  return byAddress;
}

function buildDesignationCatalog(
  rows: readonly RawCatalogRow[],
): ModbusModelCatalog {
  const blocksByAddress = buildBlocks(rows);
  const usedKeys = new Set<string>();
  const values: CatalogValue[] = rows.map(([address, designation, unit]) => {
    const match = /^(_[A-Za-z0-9_]+?)(?:\[(\d+)\])?$/.exec(designation)!;
    const base = match[1];
    const index = match[2];
    const measurement = `JZ${base}`;
    let channel = index ?? 'Overall';
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
      block: blocksByAddress.get(address)!,
    };
  });
  return {
    values,
    byKey: new Map(
      values.map((item) => [
        JSON.stringify([item.measurement, item.channel]),
        item,
      ]),
    ),
  };
}

function buildDescribedCatalog(
  rows: readonly RawCatalogRow[],
): ModbusModelCatalog {
  const blocksByAddress = buildBlocks(rows);
  const values: CatalogValue[] = rows.map(([address, description, unit]) => ({
    measurement: `JZ_R${address}`,
    channel: 'Overall',
    label: description,
    channelLabel: `Register ${address}`,
    unit,
    address,
    block: blocksByAddress.get(address)!,
  }));
  return {
    values,
    byKey: new Map(
      values.map((item) => [
        JSON.stringify([item.measurement, item.channel]),
        item,
      ]),
    ),
  };
}

export const modbusCatalogByModelId: Readonly<
  Record<string, ModbusModelCatalog>
> = {
  [defaultModbusModel]: {
    values: umg604Catalog,
    byKey: umg604CatalogByKey,
  },
  'umg-605-pro': buildDesignationCatalog(umg605ProCatalogRows),
  'umg-509-pro': buildDesignationCatalog(umg509ProCatalogRows),
  'umg-512-pro': buildDesignationCatalog(umg512ProCatalogRows),
  'umg-96-pa': buildDescribedCatalog(umg96PaCatalogRows),
  'umg-96-pq-l': buildDescribedCatalog(umg96PqLCatalogRows),
  'umg-96rm-e': buildDescribedCatalog(umg96RmECatalogRows),
  'umg-508': buildDesignationCatalog(umg508CatalogRows),
};
