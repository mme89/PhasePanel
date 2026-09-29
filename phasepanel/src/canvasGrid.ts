export const CANVAS_GRID_STEP = 20;

// Move to the next grid line in the requested direction, even from an
// off-grid starting point. Without snapping, distances are canvas pixels.
export function nudgeCoordinate(
  value: number,
  direction: -1 | 1,
  snap: boolean,
  fast: boolean,
  min = 0,
  max = Infinity,
) {
  const steps = fast ? 10 : 1;
  const next = snap
    ? (direction > 0
        ? Math.floor(value / CANVAS_GRID_STEP + 1e-9) + steps
        : Math.ceil(value / CANVAS_GRID_STEP - 1e-9) - steps) * CANVAS_GRID_STEP
    : value + direction * steps;
  const bounded = snap
    ? snapCoordinate(next, min, max)
    : Math.max(min, Math.min(max, next));
  return (bounded - value) * direction < 0 ? value : bounded;
}

// Choose the closest grid line that still fits inside the available bounds.
export function snapCoordinate(value: number, min = 0, max = Infinity) {
  const first = Math.ceil(min / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  const last = Math.floor(max / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  if (first > last) return Math.max(min, Math.min(max, value));
  return Math.max(
    first,
    Math.min(last, Math.round(value / CANVAS_GRID_STEP) * CANVAS_GRID_STEP),
  );
}
