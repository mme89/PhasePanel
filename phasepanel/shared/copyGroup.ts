import { newId } from './id.js';
import { measurementSources } from './totals.js';
import {
  consumptionTileSchema,
  graphTileSchema,
  isConsumptionTile,
  isGraphTile,
  isTotalTile,
  totalTileSchema,
  type Dashboard,
  type DashboardGroup,
  type Widget,
} from './model.js';

export type DeviceAssignment = {
  project: string;
  deviceId: string;
  deviceName: string;
};
export const sourceDeviceKey = (binding: Widget['binding']) =>
  JSON.stringify([binding.project, binding.deviceId]);

export function copyGroup(
  dashboard: Dashboard,
  source: DashboardGroup,
  title: string,
  assignments: Record<string, DeviceAssignment>,
): Dashboard {
  const members = dashboard.widgets.filter(
    (tile) => tile.groupId === source.id,
  );
  if (
    (dashboard.groups?.length ?? 0) >= 50 ||
    dashboard.widgets.length + members.length > 100
  ) {
    throw new Error(
      'The copy would exceed the dashboard limit of 50 groups or 100 tiles.',
    );
  }
  if (!title.trim() || title.trim().length > 100)
    throw new Error('Choose a group headline of 1–100 characters.');
  const group = structuredClone(source);
  group.id = newId();
  group.title = title.trim();
  // Offset explicitly positioned copies so their handles remain accessible.
  if (group.placement)
    group.placement.y = Math.min(1000000, group.placement.y + 40);
  if (group.layout)
    group.layout.y = Math.min(10000, group.layout.y + group.layout.h);
  const widgets = members.map((original) => {
    const tile = structuredClone(original);
    tile.id = newId();
    tile.groupId = group.id;
    for (const source of measurementSources(tile)) {
      const target = assignments[sourceDeviceKey(source.binding)];
      if (target) {
        source.binding.project = target.project;
        source.binding.deviceId = target.deviceId;
        source.deviceName = target.deviceName;
      }
    }
    if (isConsumptionTile(tile) && tile.sources) {
      tile.binding = structuredClone(tile.sources[0].binding);
      tile.deviceName = tile.sources[0].deviceName;
      consumptionTileSchema.parse(tile);
    }
    if (isTotalTile(tile)) totalTileSchema.parse(tile);
    if (isGraphTile(tile)) graphTileSchema.parse(tile);
    return tile;
  });
  return {
    ...dashboard,
    groups: [...(dashboard.groups ?? []), group],
    widgets: [...dashboard.widgets, ...widgets],
  };
}
