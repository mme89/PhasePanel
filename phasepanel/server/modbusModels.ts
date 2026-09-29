import {
  defaultModbusModel,
  type ModbusModel,
} from '../shared/modbusModels.js';

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
];

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
