import type { Dashboard, DashboardTile } from '../shared/model';
import { saveWidget } from '../shared/groups';

// Editing always uses a fixed canvas. Keep legacy fields readable so opening
// an existing dashboard remains reversible until the user saves the draft.
export function fixedCanvasDashboard(
  dashboard: Dashboard,
  root: HTMLElement | null,
): Dashboard {
  const resolution = dashboard.resolution ?? {
    width: dashboard.groupLayoutWidth ?? 1920,
    height: 1080,
  };
  return placeUngroupedOnCanvas(
    {
      ...dashboard,
      resolution,
    },
    root,
  );
}

// Convert the old below-groups grid to canvas coordinates once, at edit time.
export function placeUngroupedOnCanvas(
  dashboard: Dashboard,
  root: HTMLElement | null,
): Dashboard {
  if (!dashboard.groupLayoutWidth || dashboard.ungroupedOnCanvas)
    return dashboard;
  const grid = root?.querySelector<HTMLElement>(
    '[data-ungrouped] .react-grid-layout',
  );
  const origin =
    root?.querySelector<HTMLElement>('.group-arrangement-grid') ??
    root?.querySelector<HTMLElement>('.fixed-canvas') ??
    root;
  const scale =
    origin && origin.offsetWidth
      ? origin.getBoundingClientRect().width / origin.offsetWidth
      : 1;
  const offset =
    grid && origin
      ? Math.max(
          0,
          (grid.getBoundingClientRect().top -
            origin.getBoundingClientRect().top) /
            scale /
            92,
        )
      : 0;
  return {
    ...dashboard,
    ungroupedOnCanvas: true,
    widgets: dashboard.widgets.map((tile) => {
      if (tile.groupId) return tile;
      // Legacy grid compaction can render a different Y than the stored value.
      const element = root?.querySelector<HTMLElement>(
        `[data-testid="tile-${tile.id}"]`,
      );
      const y =
        element && origin
          ? (element.getBoundingClientRect().top -
              origin.getBoundingClientRect().top) /
            scale /
            92
          : tile.y + offset;
      return { ...tile, y: Math.max(0, Math.min(10000, y)) };
    }),
  };
}

export function saveCanvasWidget(
  dashboard: Dashboard,
  widget: DashboardTile,
  root: HTMLElement | null,
): Dashboard {
  const saved = saveWidget(dashboard, widget);
  const previous = dashboard.widgets.find((tile) => tile.id === widget.id);
  if (
    !dashboard.groupLayoutWidth ||
    !dashboard.ungroupedOnCanvas ||
    widget.groupId ||
    (previous && !previous.groupId) ||
    dashboard.widgets.some((tile) => !tile.groupId && tile.id !== widget.id)
  )
    return saved;
  const origin = root?.querySelector<HTMLElement>('.group-arrangement-grid');
  if (!origin) return saved;
  const box = origin.getBoundingClientRect();
  const scale = box.width / origin.offsetWidth;
  const bottom = Math.max(
    0,
    ...Array.from(
      origin.querySelectorAll('.group-frame'),
      (frame) => (frame.getBoundingClientRect().bottom - box.top) / scale,
    ),
  );
  // Start the first standalone tile below existing groups; it can then be dragged anywhere.
  return {
    ...saved,
    widgets: saved.widgets.map((tile) =>
      tile.id === widget.id
        ? { ...tile, y: Math.min(10000, Math.ceil((bottom + 20) / 92)) }
        : tile,
    ),
  };
}
