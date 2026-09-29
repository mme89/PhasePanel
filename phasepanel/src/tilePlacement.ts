export type PositionedTile = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type Alignment =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type PlacementBounds = {
  x: number;
  y: number;
  width: number;
  maxY: number;
};

// Keep an existing connected arrangement. For separated tiles, close gaps
// within each row and between rows without flattening a two-dimensional layout.
export function joinTiles<T extends PositionedTile>(
  tiles: T[],
  selected: Set<string>,
  bounds: PlacementBounds,
): { tiles: T[]; order: string[] } | { error: string } {
  const members = tiles.filter((tile) => selected.has(tile.id));
  if (members.length < 2)
    return { error: 'Select at least two tiles to link.' };
  const rowOrder = [...members].sort((a, b) => a.y - b.y || a.x - b.x);
  const close = (a: T, b: T) => {
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (
      (overlapX > 1e-6 && overlapY >= -1e-6) ||
      (overlapY > 1e-6 && overlapX >= -1e-6)
    );
  };
  const connected = new Set<string>([members[0].id]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const tile of members) {
      if (connected.has(tile.id)) continue;
      if (
        members.some((other) => connected.has(other.id) && close(tile, other))
      ) {
        connected.add(tile.id);
        expanded = true;
      }
    }
  }
  if (
    connected.size === members.length &&
    !placementError(tiles, selected, bounds)
  )
    return { tiles, order: rowOrder.map((tile) => tile.id) };

  const rows: T[][] = [];
  for (const tile of rowOrder) {
    const row = rows.find(
      (items) =>
        Math.abs(tile.y - items[0].y) < Math.min(tile.h, items[0].h) / 2,
    );
    if (row) row.push(tile);
    else rows.push([tile]);
  }
  const plans = [rows.map((row) => row.sort((a, b) => a.x - b.x))];
  if (rows.length === 1) plans.push(members.map((tile) => [tile]));
  const unselected = tiles.filter((tile) => !selected.has(tile.id));
  const oldX = Math.min(...members.map((tile) => tile.x));
  const oldY = Math.min(...members.map((tile) => tile.y));
  for (const plan of plans) {
    const order = plan.flat();
    const blockW = Math.max(
      ...plan.map((row) => row.reduce((sum, tile) => sum + tile.w, 0)),
    );
    const blockH = plan.reduce(
      (sum, row) => sum + Math.max(...row.map((tile) => tile.h)),
      0,
    );
    const maxX = bounds.x + bounds.width - blockW;
    const maxY = bounds.maxY - blockH;
    if (maxX < bounds.x - 1e-6 || maxY < bounds.y - 1e-6) continue;
    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));
    const xs = [
      oldX,
      bounds.x,
      ...unselected.flatMap((tile) => [tile.x + tile.w, tile.x - blockW]),
    ].map((value) => clamp(value, bounds.x, maxX));
    const ys = [
      oldY,
      bounds.y,
      ...unselected.flatMap((tile) => [tile.y + tile.h, tile.y - blockH]),
    ].map((value) => clamp(value, bounds.y, maxY));
    const anchors = xs
      .flatMap((x) => ys.map((y) => ({ x, y })))
      .sort(
        (a, b) =>
          (a.x - oldX) ** 2 +
          (a.y - oldY) ** 2 -
          (b.x - oldX) ** 2 -
          (b.y - oldY) ** 2,
      );
    for (const anchor of anchors) {
      const positions = new Map<string, { x: number; y: number }>();
      let rowY = anchor.y;
      for (const row of plan) {
        let columnX = anchor.x;
        for (const tile of row) {
          positions.set(tile.id, { x: columnX, y: rowY });
          columnX += tile.w;
        }
        rowY += Math.max(...row.map((tile) => tile.h));
      }
      const next = tiles.map((tile) => ({
        ...tile,
        ...positions.get(tile.id),
      }));
      if (!placementError(next, selected, bounds))
        return { tiles: next, order: order.map((tile) => tile.id) };
    }
  }
  return {
    error:
      'The linked tiles do not fit together in a clear area of this section.',
  };
}

export function alignTiles<T extends PositionedTile>(
  tiles: T[],
  selected: Set<string>,
  alignment: Alignment,
): T[] {
  const members = tiles.filter((tile) => selected.has(tile.id));
  if (members.length < 2) return tiles;
  const left = Math.min(...members.map((tile) => tile.x));
  const right = Math.max(...members.map((tile) => tile.x + tile.w));
  const top = Math.min(...members.map((tile) => tile.y));
  const bottom = Math.max(...members.map((tile) => tile.y + tile.h));
  return tiles.map((tile) => {
    if (!selected.has(tile.id)) return tile;
    switch (alignment) {
      case 'left':
        return { ...tile, x: left };
      case 'center':
        return { ...tile, x: (left + right - tile.w) / 2 };
      case 'right':
        return { ...tile, x: right - tile.w };
      case 'top':
        return { ...tile, y: top };
      case 'middle':
        return { ...tile, y: (top + bottom - tile.h) / 2 };
      case 'bottom':
        return { ...tile, y: bottom - tile.h };
    }
  });
}

export function placementError(
  tiles: PositionedTile[],
  changed: Set<string>,
  bounds: PlacementBounds,
) {
  for (const tile of tiles.filter((item) => changed.has(item.id))) {
    if (![tile.x, tile.y].every(Number.isFinite))
      return 'Enter valid X and Y coordinates.';
    if (
      tile.x < bounds.x - 1e-6 ||
      tile.x + tile.w > bounds.x + bounds.width + 1e-6 ||
      tile.y < bounds.y - 1e-6 ||
      tile.y > bounds.maxY + 1e-6
    )
      return 'The position is outside this tile section. Keep tiles within its horizontal bounds and below its top edge.';
    if (
      tiles.some(
        (other) =>
          other.id !== tile.id &&
          tile.x < other.x + other.w - 1e-6 &&
          tile.x + tile.w > other.x + 1e-6 &&
          tile.y < other.y + other.h - 1e-6 &&
          tile.y + tile.h > other.y + 1e-6,
      )
    )
      return 'This placement would overlap another tile. No positions were changed.';
  }
  return '';
}
