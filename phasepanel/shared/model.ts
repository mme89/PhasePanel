import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^;,\u0000-\u001f]+$/, 'Invalid measurement identifier');
export const projectName = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v !== '.' && v !== '..', 'Invalid project');
export const bindingSchema = z
  .object({
    project: projectName,
    deviceId: z.string().regex(/^\d+$/).max(20),
    measurement: identifier,
    channel: identifier,
  })
  .strict();
export const rangeSchema = z
  .object({
    min: z.number().finite(),
    max: z.number().finite(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a valid color'),
  })
  .strict()
  .refine(
    (v) => v.min < v.max && Number.isFinite(v.max - v.min),
    'Maximum must be greater than minimum',
  );
export const scaleSchema = z
  .object({ min: z.number().finite(), max: z.number().finite() })
  .strict()
  .refine(
    (v) => v.min < v.max && Number.isFinite(v.max - v.min),
    'Scale maximum must be greater than scale minimum',
  );
export type GaugeScale = z.infer<typeof scaleSchema>;
export type ValueRange = z.infer<typeof rangeSchema>;
export const displayDefaultsSchema = z
  .object({
    scale: scaleSchema,
    limits: scaleSchema.optional(),
    decimals: z.number().int().min(0).max(6).optional(),
    normalColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();
export type DisplayDefaults = z.infer<typeof displayDefaultsSchema>;
export const measurementDefaultsSchema = z
  .object({
    measurement: identifier,
    unit: z.string().max(50),
    settings: displayDefaultsSchema,
  })
  .strict();
export type MeasurementDefaults = z.infer<typeof measurementDefaultsSchema>;
const tileBackgroundColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();
export const widgetSchema = z
  .object({
    id: z.string().uuid(),
    binding: bindingSchema,
    groupId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(100),
    deviceName: z.string().max(200),
    measurementLabel: z.string().max(200).optional(),
    unit: z.string().max(50),
    decimals: z.number().int().min(0).max(6),
    display: z
      .enum(['number', 'gauge', 'bar', 'status', 'sparkline', 'graph'])
      .optional(),
    graphMinutes: z
      .union([z.literal(5), z.literal(15), z.literal(60)])
      .optional(),
    range: rangeSchema.optional(),
    scale: scaleSchema.optional(),
    useDashboardDefaults: z.boolean().optional(),
    normalColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    backgroundColor: tileBackgroundColor,
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid')
  .refine(
    (v) =>
      !['gauge', 'bar'].includes(v.display ?? '') ||
      Boolean(v.scale ?? v.range),
    'Gauge and bar tiles require scale minimum and maximum values',
  );
export const totalSourceSchema = z
  .object({
    binding: bindingSchema,
    deviceName: z.string().max(200),
    label: z.string().trim().min(1).max(100),
    unit: z.string().max(50),
  })
  .strict();
export type TotalSource = z.infer<typeof totalSourceSchema>;
const {
  binding: _binding,
  deviceName: _deviceName,
  measurementLabel: _measurementLabel,
  graphMinutes: _graphMinutes,
  ...totalFields
} = widgetSchema.shape;
export const totalTileSchema = z
  .object({
    ...totalFields,
    display: z.enum(['number', 'gauge']).optional(),
    kind: z.literal('total'),
    sources: z.array(totalSourceSchema).min(2).max(50),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid')
  .refine(
    (v) => v.display !== 'gauge' || Boolean(v.scale ?? v.range),
    'Gauge tiles require scale minimum and maximum values',
  )
  .refine(
    (v) => v.sources.every((source) => source.unit === v.unit),
    'All values must have the same unit',
  )
  .refine(
    (v) =>
      new Set(
        v.sources.map((source) =>
          JSON.stringify([
            source.binding.project,
            source.binding.deviceId,
            source.binding.measurement,
            source.binding.channel,
          ]),
        ),
      ).size === v.sources.length,
    'Choose each source only once',
  );
export type TotalTile = z.infer<typeof totalTileSchema>;
export const graphTileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('graph'),
    groupId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(100),
    sources: z.array(totalSourceSchema).min(1).max(12),
    unit: z.string().max(50),
    decimals: z.number().int().min(0).max(6),
    backgroundColor: tileBackgroundColor,
    graphMinutes: z.union([z.literal(5), z.literal(15), z.literal(60)]),
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid')
  .refine(
    (v) => v.sources.every((source) => source.unit === v.unit),
    'All graph values must have the same unit',
  )
  .refine(
    (v) =>
      new Set(v.sources.map((source) => bindingKey(source.binding))).size ===
      v.sources.length,
    'Choose each graph value only once',
  );
export type GraphTile = z.infer<typeof graphTileSchema>;
export const consumptionTileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('consumption'),
    groupId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(100),
    binding: bindingSchema,
    deviceName: z.string().max(200),
    sources: z.array(totalSourceSchema).min(1).max(12).optional(),
    unit: z
      .string()
      .regex(
        /^(?:[kMGT]?Wh)$/i,
        'Choose an energy value in Wh, kWh, MWh, or GWh',
      ),
    decimals: z.number().int().min(0).max(6),
    backgroundColor: tileBackgroundColor,
    period: z.enum(['day', 'week', 'month']),
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid')
  .refine(
    (v) =>
      !v.sources ||
      (bindingKey(v.sources[0].binding) === bindingKey(v.binding) &&
        v.sources.every((source) => /^(?:[kMGT]?Wh)$/i.test(source.unit)) &&
        new Set(v.sources.map((source) => bindingKey(source.binding))).size ===
          v.sources.length),
    'Choose distinct energy readings and keep the first source as the primary meter',
  );
export type ConsumptionTile = z.infer<typeof consumptionTileSchema>;
export const textTileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('text'),
    groupId: z.string().uuid().optional(),
    label: z.string().trim().max(100).default(''),
    text: z.string().trim().min(1).max(5000),
    fontSize: z.number().int().min(10).max(96).default(24),
    backgroundColor: tileBackgroundColor,
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid');
export type TextTile = z.infer<typeof textTileSchema>;
export const dateTimeTileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('datetime'),
    groupId: z.string().uuid().optional(),
    label: z.string().trim().max(100).default(''),
    fontSize: z.number().int().min(10).max(96).default(32),
    backgroundColor: tileBackgroundColor,
    mode: z.enum(['datetime', 'date', 'time']).default('datetime'),
    design: z.enum(['classic', 'flip']).optional(),
    hour12: z.boolean().default(false),
    showSeconds: z.boolean().default(true),
    timeZone: z
      .string()
      .max(100)
      .default('')
      .refine((zone) => {
        if (!zone) return true;
        try {
          new Intl.DateTimeFormat('en-GB', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Enter a valid time zone, for example Europe/Berlin or UTC'),
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid');
export type DateTimeTile = z.infer<typeof dateTimeTileSchema>;
export const logTileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('log'),
    groupId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(100).default('Dashboard log'),
    fontSize: z.number().int().min(10).max(96).optional(),
    backgroundColor: tileBackgroundColor,
    maxEntries: z.number().int().min(10).max(500).default(100),
    x: z.number().finite().min(0).max(11),
    y: z.number().finite().min(0).max(10000),
    w: z.number().finite().positive().max(12),
    h: z.number().finite().positive(),
  })
  .strict()
  .refine((v) => v.x + v.w <= 12, 'Tile extends beyond grid');
export type LogTile = z.infer<typeof logTileSchema>;
export type DashboardTile =
  | Widget
  | TextTile
  | DateTimeTile
  | TotalTile
  | GraphTile
  | LogTile
  | ConsumptionTile;
export function isConsumptionTile(
  tile: DashboardTile,
): tile is ConsumptionTile {
  return 'kind' in tile && tile.kind === 'consumption';
}
export function isTotalTile(tile: DashboardTile): tile is TotalTile {
  return 'kind' in tile && tile.kind === 'total';
}
export function isGraphTile(tile: DashboardTile): tile is GraphTile {
  return 'kind' in tile && tile.kind === 'graph';
}
export function isMeasurementTile(tile: DashboardTile): tile is Widget {
  return 'binding' in tile && !isConsumptionTile(tile);
}
export const groupSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(100),
    fontSize: z.number().int().min(10).max(96).optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    showTitle: z.boolean().optional(),
    placement: z
      .object({
        x: z.number().finite().min(0).max(7680),
        y: z.number().finite().min(0).max(1000000),
        scale: z.number().finite().min(0.02).max(8),
      })
      .strict()
      .optional(),
    layout: z
      .object({
        x: z.number().int().min(0).max(11),
        y: z.number().int().min(0).max(10000),
        w: z.number().int().min(2).max(12),
        h: z.number().int().min(2).max(1000),
      })
      .strict()
      .refine((v) => v.x + v.w <= 12, 'Group extends beyond grid')
      .optional(),
  })
  .strict();
export type DashboardGroup = z.infer<typeof groupSchema>;
export const dashboardResolutionSchema = z
  .object({
    width: z.number().int().min(640).max(7680),
    height: z.number().int().min(360).max(4320),
  })
  .strict();
export type DashboardResolution = z.infer<typeof dashboardResolutionSchema>;
export const minimumTileSizeSchema = z
  .object({
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(8),
  })
  .strict();
export type MinimumTileSize = z.infer<typeof minimumTileSizeSchema>;
export const dashboardInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    refreshSeconds: z.number().int().min(1).max(3600).default(5),
    resolution: dashboardResolutionSchema.optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    backgroundImage: z
      .string()
      .max(2_800_000)
      .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    snapToGrid: z.boolean().optional(),
    ungroupedOnCanvas: z.boolean().optional(),
    groupLayoutWidth: z.number().int().min(640).max(7680).optional(),
    minimumTileSize: minimumTileSizeSchema.optional(),
    tileLinks: z
      .array(z.array(z.string().uuid()).min(2).max(100))
      .max(50)
      .optional(),
    widgets: z
      .array(
        z.union([
          widgetSchema,
          textTileSchema,
          dateTimeTileSchema,
          totalTileSchema,
          graphTileSchema,
          consumptionTileSchema,
          logTileSchema,
        ]),
      )
      .max(100)
      .default([]),
    groups: z.array(groupSchema).max(50).optional(),
    displayDefaults: displayDefaultsSchema.optional(),
    measurementDefaults: z.array(measurementDefaultsSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(
        (v.measurementDefaults ?? []).map((d) =>
          JSON.stringify([d.measurement, d.unit]),
        ),
      ).size === (v.measurementDefaults ?? []).length,
    'Measurement defaults must be unique per measurement and unit',
  )
  .refine(
    (v) => new Set(v.widgets.map((w) => w.id)).size === v.widgets.length,
    'Tile IDs must be unique',
  )
  .refine(
    (v) =>
      new Set((v.groups ?? []).map((g) => g.id)).size ===
      (v.groups ?? []).length,
    'Group IDs must be unique',
  )
  .refine(
    (v) =>
      v.widgets.every(
        (w) => !w.groupId || v.groups?.some((g) => g.id === w.groupId),
      ),
    'Each tile group must exist in this dashboard',
  )
  .refine((v) => {
    const linked = (v.tileLinks ?? []).flat();
    const sections = new Map(v.widgets.map((w) => [w.id, w.groupId]));
    return (
      new Set(linked).size === linked.length &&
      (v.tileLinks ?? []).every(
        (link) =>
          link.every((id) => sections.has(id)) &&
          link.every((id) => sections.get(id) === sections.get(link[0])),
      )
    );
  }, 'Linked tiles must be distinct tiles in the same section of this dashboard');
export type Binding = z.infer<typeof bindingSchema>;
export type Widget = z.infer<typeof widgetSchema>;
export type DashboardInput = z.infer<typeof dashboardInput>;
export type Dashboard = DashboardInput & {
  id: string;
  revision: number;
  updatedAt: string;
};
export type Project = { name: string };
export type Device = { id: string; name: string; model: string };
export type Measurement = {
  measurement: string;
  channel: string;
  label: string;
  channelLabel: string;
  unit: string;
};
export type Reading = {
  key: string;
  value: number | null;
  unit: string;
  sourceTimestampNs: string | null;
  sourceTime: string | null;
  retrievedAt: string;
  status: 'ok' | 'stale' | 'partial' | 'unavailable' | 'error';
  missingInputs?: string[];
  message?: string;
};
export const bindingKey = (b: Binding) =>
  JSON.stringify([b.project, b.deviceId, b.measurement, b.channel]);
