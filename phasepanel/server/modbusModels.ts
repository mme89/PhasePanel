import {
  defaultModbusModel,
  type ModbusModel,
} from '../shared/modbusModels.js';

// Standardized Janitza 19000–19077 float32 live-reading and energy block shared
// across UMG 605-PRO, 509-PRO, 512-PRO, 96-PA, 96-PQ-L, 96RM-E, and 508.
function standardJanitzaModel(id: string, name: string): ModbusModel {
  return {
    id,
    name,
    firstRegister: 19000,
    registerCount: 78,
    measurements: [
      ...[1, 2, 3].map((phase) => ({
        measurement: 'U_Effective',
        channel: `L${phase}`,
        label: 'Voltage',
        channelLabel: `L${phase}`,
        unit: 'V',
        address: 19000 + (phase - 1) * 2,
      })),
      ...[
        ['L1-L2', 19006],
        ['L2-L3', 19008],
        ['L3-L1', 19010],
      ].map(([channel, address]) => ({
        measurement: 'U_LL_Effective',
        channel: String(channel),
        label: 'Line-to-line voltage',
        channelLabel: String(channel),
        unit: 'V',
        address: Number(address),
      })),
      ...[1, 2, 3].map((phase) => ({
        measurement: 'I_Effective',
        channel: `L${phase}`,
        label: 'Current',
        channelLabel: `L${phase}`,
        unit: 'A',
        address: 19012 + (phase - 1) * 2,
      })),
      {
        measurement: 'I_Neutral',
        channel: 'SUM13',
        label: 'Neutral current',
        channelLabel: 'L1–L3 vector sum',
        unit: 'A',
        address: 19018,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'PowerActive',
        channel: `L${phase}`,
        label: 'Active power',
        channelLabel: `L${phase}`,
        unit: 'W',
        address: 19020 + (phase - 1) * 2,
      })),
      {
        measurement: 'PowerActive',
        channel: 'SUM13',
        label: 'Active power',
        channelLabel: 'Total L1–L3',
        unit: 'W',
        address: 19026,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'PowerApparent',
        channel: `L${phase}`,
        label: 'Apparent power',
        channelLabel: `L${phase}`,
        unit: 'VA',
        address: 19028 + (phase - 1) * 2,
      })),
      {
        measurement: 'PowerApparent',
        channel: 'SUM13',
        label: 'Apparent power',
        channelLabel: 'Total L1–L3',
        unit: 'VA',
        address: 19034,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'PowerReactive',
        channel: `L${phase}`,
        label: 'Reactive power',
        channelLabel: `L${phase}`,
        unit: 'VAr',
        address: 19036 + (phase - 1) * 2,
      })),
      {
        measurement: 'PowerReactive',
        channel: 'SUM13',
        label: 'Reactive power',
        channelLabel: 'Total L1–L3',
        unit: 'VAr',
        address: 19042,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'PowerFactor',
        channel: `L${phase}`,
        label: 'Power factor',
        channelLabel: `L${phase}`,
        unit: '',
        address: 19044 + (phase - 1) * 2,
      })),
      {
        measurement: 'Frequency',
        channel: 'Overall',
        label: 'Frequency',
        channelLabel: 'Overall',
        unit: 'Hz',
        address: 19050,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'EnergyActiveImport',
        channel: `L${phase}`,
        label: 'Active energy consumption',
        channelLabel: `L${phase}`,
        unit: 'Wh',
        address: 19062 + (phase - 1) * 2,
      })),
      {
        measurement: 'EnergyActiveImport',
        channel: 'SUM13',
        label: 'Active energy consumption',
        channelLabel: 'Total L1–L3',
        unit: 'Wh',
        address: 19068,
      },
      ...[1, 2, 3].map((phase) => ({
        measurement: 'EnergyActiveExport',
        channel: `L${phase}`,
        label: 'Active energy delivery',
        channelLabel: `L${phase}`,
        unit: 'Wh',
        address: 19070 + (phase - 1) * 2,
      })),
      {
        measurement: 'EnergyActiveExport',
        channel: 'SUM13',
        label: 'Active energy delivery',
        channelLabel: 'Total L1–L3',
        unit: 'Wh',
        address: 19076,
      },
    ],
  };
}

// UMG 604-PRO Modbus address list, firmware 5.028 and newer. Each value is a
// 32-bit big-endian float occupying two holding registers.
export const builtInModbusModels: ModbusModel[] = [
  {
    id: defaultModbusModel,
    name: 'UMG 604-PRO',
    firstRegister: 1317,
    registerCount: 124,
    // The documented L1–L3 active-energy consumption counter is outside
    // the live electrical-values block.
    extraBlocks: [{ firstRegister: 9851, registerCount: 2 }],
    measurements: [
      ...[1, 2, 3, 4].flatMap((phase) => [
        {
          measurement: 'U_Effective',
          channel: `L${phase}`,
          label: 'Voltage',
          channelLabel: `L${phase}`,
          unit: 'V',
          address: 1317 + (phase - 1) * 2,
        },
        {
          measurement: 'I_Effective',
          channel: `L${phase}`,
          label: 'Current',
          channelLabel: `L${phase}`,
          unit: 'A',
          address: 1325 + (phase - 1) * 2,
        },
      ]),
      ...[1, 2, 3, 4].flatMap((phase) => [
        {
          measurement: 'PowerActive',
          channel: `L${phase}`,
          label: 'Active power',
          channelLabel: `L${phase}`,
          unit: 'W',
          address: 1333 + (phase - 1) * 2,
        },
        {
          measurement: 'PowerReactive',
          channel: `L${phase}`,
          label: 'Reactive power',
          channelLabel: `L${phase}`,
          unit: 'VAr',
          address: 1341 + (phase - 1) * 2,
        },
        {
          measurement: 'PowerApparent',
          channel: `L${phase}`,
          label: 'Apparent power',
          channelLabel: `L${phase}`,
          unit: 'VA',
          address: 1349 + (phase - 1) * 2,
        },
        {
          measurement: 'PhaseAngle',
          channel: `L${phase}`,
          label: 'Voltage/current phase angle',
          channelLabel: `L${phase}`,
          unit: '°',
          address: 1415 + (phase - 1) * 2,
        },
        {
          measurement: 'PowerFactor',
          channel: `L${phase}`,
          label: 'Power factor',
          channelLabel: `L${phase}`,
          unit: '',
          address: 1423 + (phase - 1) * 2,
        },
      ]),
      ...[
        ['L1-L2', 1357],
        ['L2-L3', 1359],
        ['L3-L1', 1361],
      ].map(([channel, address]) => ({
        measurement: 'U_LL_Effective',
        channel: String(channel),
        label: 'Line-to-line voltage',
        channelLabel: String(channel),
        unit: 'V',
        address: Number(address),
      })),
      {
        measurement: 'I_Neutral',
        channel: 'SUM13',
        label: 'Neutral current',
        channelLabel: 'L1–L3 vector sum',
        unit: 'A',
        address: 1363,
      },
      {
        measurement: 'I_Neutral',
        channel: 'SUM14',
        label: 'Neutral current',
        channelLabel: 'L1–L4 vector sum',
        unit: 'A',
        address: 1365,
      },
      ...[
        ['PowerApparent', 'Apparent power', 'VA', 1367],
        ['PowerReactive', 'Reactive power', 'VAr', 1371],
        ['PowerFactor', 'Power factor', '', 1373],
      ].map(([measurement, label, unit, address]) => ({
        measurement: String(measurement),
        channel: 'SUM13',
        label: String(label),
        channelLabel: 'Total L1–L3',
        unit: String(unit),
        address: Number(address),
      })),
      {
        measurement: 'PowerActive',
        channel: 'SUM13',
        label: 'Active power',
        channelLabel: 'Total L1–L3',
        unit: 'W',
        address: 1369,
      },
      ...[
        ['PowerApparent', 'Apparent power', 'VA', 1375],
        ['PowerActive', 'Active power', 'W', 1377],
        ['PowerReactive', 'Reactive power', 'VAr', 1379],
        ['PowerFactor', 'Power factor', '', 1381],
      ].map(([measurement, label, unit, address]) => ({
        measurement: String(measurement),
        channel: 'SUM14',
        label: String(label),
        channelLabel: 'Total L1–L4',
        unit: String(unit),
        address: Number(address),
      })),
      {
        measurement: 'Frequency',
        channel: 'Overall',
        label: 'Frequency',
        channelLabel: 'Overall',
        unit: 'Hz',
        address: 1439,
      },
      {
        measurement: 'EnergyActiveImport',
        channel: 'SUM13',
        label: 'Active energy consumption',
        channelLabel: 'Total L1–L3',
        unit: 'Wh',
        address: 9851,
      },
    ],
  },
  standardJanitzaModel('umg-605-pro', 'UMG 605-PRO'),
  standardJanitzaModel('umg-509-pro', 'UMG 509-PRO'),
  standardJanitzaModel('umg-512-pro', 'UMG 512-PRO'),
  standardJanitzaModel('umg-96-pa', 'UMG 96-PA'),
  standardJanitzaModel('umg-96-pq-l', 'UMG 96-PQ-L'),
  standardJanitzaModel('umg-96rm-e', 'UMG 96RM-E'),
  standardJanitzaModel('umg-508', 'UMG 508'),
];

// Upgrade untouched legacy built-in models and append any newly added built-in
// models that are not yet present in an existing database.
export function mergeBuiltInModbusModels(models: ModbusModel[]): ModbusModel[] {
  const upgraded = models.map(upgradeBuiltInModbusModel);
  const existingIds = new Set(upgraded.map((model) => model.id));
  return [
    ...upgraded,
    ...builtInModbusModels.filter((model) => !existingIds.has(model.id)),
  ];
}

// Expand an untouched copy of the original ten-value model on existing installs.
// Keep user-edited built-in models exactly as saved.
export function upgradeBuiltInModbusModel(model: ModbusModel): ModbusModel {
  const current = builtInModbusModels[0];
  const original = current.measurements.filter(
    ({ measurement, channel }) =>
      measurement === 'U_Effective' ||
      measurement === 'I_Effective' ||
      (measurement === 'PowerActive' && channel === 'SUM13') ||
      measurement === 'Frequency',
  );
  const previous = {
    id: current.id,
    name: current.name,
    firstRegister: current.firstRegister,
    registerCount: current.registerCount,
    measurements: current.measurements.filter(
      (item) => item.measurement !== 'EnergyActiveImport',
    ),
  };
  if (JSON.stringify(model) === JSON.stringify(previous)) return current;
  if (
    model.id === current.id &&
    model.name === current.name &&
    model.firstRegister === current.firstRegister &&
    model.registerCount === current.registerCount &&
    !model.extraBlocks?.length &&
    JSON.stringify(model.measurements) === JSON.stringify(original)
  )
    return current;
  return model;
}
