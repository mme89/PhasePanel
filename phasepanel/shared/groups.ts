import type {
  Dashboard,
  DashboardGroup,
  DashboardTile as Widget,
  MinimumTileSize,
} from './model.js';

// Existing tile positions stay unchanged; moved/new tiles append within their section.
export function nextPosition(
  widgets: Widget[],
  groupId: string | undefined,
  width: number,
) {
  const members = widgets.filter((w) => w.groupId === groupId);
  if (!members.length) return { x: 0, y: 0 };
  const y = Math.max(...members.map((w) => w.y));
  const x = Math.max(
    ...members.filter((w) => w.y + w.h > y).map((w) => w.x + w.w),
  );
  return x + width <= 12
    ? { x, y }
    : { x: 0, y: Math.max(...members.map((w) => w.y + w.h)) };
}
export function saveWidget(dashboard: Dashboard, widget: Widget): Dashboard {
  const previous = dashboard.widgets.find((w) => w.id === widget.id);
  const placed =
    !previous || previous.groupId !== widget.groupId
      ? {
          ...widget,
          ...nextPosition(
            dashboard.widgets.filter((w) => w.id !== widget.id),
            widget.groupId,
            widget.w,
          ),
        }
      : widget;
  return {
    ...dashboard,
    widgets: previous
      ? dashboard.widgets.map((w) => (w.id === placed.id ? placed : w))
      : [...dashboard.widgets, placed],
  };
}
export function saveGroup(
  dashboard: Dashboard,
  group: DashboardGroup,
  selectedIds: string[],
): Dashboard {
  const selected = new Set(selectedIds);
  const target = (w: Widget) =>
    selected.has(w.id)
      ? group.id
      : w.groupId === group.id
        ? undefined
        : w.groupId;
  const placed = dashboard.widgets.filter((w) => target(w) === w.groupId);
  const moved = new Map<string, Widget>();
  for (const widget of dashboard.widgets) {
    const groupId = target(widget);
    if (groupId === widget.groupId) continue;
    const next = {
      ...widget,
      groupId,
      ...nextPosition(placed, groupId, widget.w),
    };
    placed.push(next);
    moved.set(widget.id, next);
  }
  const groups = dashboard.groups ?? [];
  return {
    ...dashboard,
    groups: groups.some((g) => g.id === group.id)
      ? groups.map((g) => (g.id === group.id ? group : g))
      : [...groups, group],
    widgets: dashboard.widgets.map((w) => moved.get(w.id) ?? w),
  };
}
export function removeGroup(
  dashboard: Dashboard,
  group: DashboardGroup,
): Dashboard {
  const ungrouped = saveGroup(dashboard, group, []);
  return {
    ...ungrouped,
    groups: ungrouped.groups!.filter((g) => g.id !== group.id),
  };
}
export function moveGroup(
  dashboard: Dashboard,
  id: string,
  direction: -1 | 1,
): Dashboard {
  const groups = [...(dashboard.groups ?? [])];
  const index = groups.findIndex((g) => g.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= groups.length)
    return dashboard;
  [groups[index], groups[destination]] = [groups[destination], groups[index]];
  return { ...dashboard, groups };
}

function resizeTiles(
  dashboard: Dashboard,
  sizeFor: (widget: Widget) => MinimumTileSize,
): Dashboard {
  const placed: Widget[] = [];
  for (const widget of [...dashboard.widgets].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  )) {
    const { w, h } = sizeFor(widget);
    const next = {
      ...widget,
      w,
      h,
      x: Math.min(widget.x, 12 - w),
    };
    let collisions: Widget[];
    while (
      (collisions = placed.filter(
        (other) =>
          other.groupId === next.groupId &&
          next.x < other.x + other.w &&
          next.x + next.w > other.x &&
          next.y < other.y + other.h &&
          next.y + next.h > other.y,
      )).length
    ) {
      next.y = Math.max(...collisions.map((other) => other.y + other.h));
    }
    placed.push(next);
  }
  const byId = new Map(placed.map((w) => [w.id, w]));
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((w) => byId.get(w.id)!),
  };
}

export function applyTileSize(
  dashboard: Dashboard,
  size: MinimumTileSize,
  groupId?: string,
): Dashboard {
  if (
    !Number.isFinite(size.w) ||
    !Number.isFinite(size.h) ||
    size.w <= 0 ||
    size.w > 12 ||
    size.h <= 0
  ) {
    throw new RangeError('Tile size must be positive and fit the canvas width');
  }
  if (groupId === undefined) return resizeTiles(dashboard, () => size);
  const resized = resizeTiles(
    {
      ...dashboard,
      widgets: dashboard.widgets.filter((widget) => widget.groupId === groupId),
    },
    () => size,
  );
  const byId = new Map(resized.widgets.map((widget) => [widget.id, widget]));
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) => byId.get(widget.id) ?? widget),
  };
}
