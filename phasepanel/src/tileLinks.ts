import type { Layout } from 'react-grid-layout';
import type { DashboardTile } from '../shared/model';
import { joinTiles } from './tilePlacement';

export function tileCollides(layout: Layout, id: string): boolean {
  const item = layout.find((entry) => entry.i === id);
  return Boolean(
    item &&
    layout.some(
      (other) =>
        other.i !== id &&
        item.x < other.x + other.w - 1e-7 &&
        item.x + item.w > other.x + 1e-7 &&
        item.y < other.y + other.h - 1e-7 &&
        item.y + item.h > other.y + 1e-7,
    ),
  );
}

export function preservesLinkedOffsets(
  initial: Layout,
  next: Layout,
  links: string[][],
): boolean {
  return links.every((link) => {
    const base = initial.find((item) => item.i === link[0]);
    const movedBase = next.find((item) => item.i === link[0]);
    if (!base || !movedBase) return false;
    return link.every((id) => {
      const before = initial.find((item) => item.i === id);
      const after = next.find((item) => item.i === id);
      return Boolean(
        before &&
        after &&
        Math.abs(after.x - movedBase.x - (before.x - base.x)) < 1e-7 &&
        Math.abs(after.y - movedBase.y - (before.y - base.y)) < 1e-7,
      );
    });
  });
}

export function validTileLinks(
  links: string[][] | undefined,
  widgets: DashboardTile[],
): string[][] {
  const sections = new Map(widgets.map((tile) => [tile.id, tile.groupId]));
  return (links ?? [])
    .flatMap((link) => {
      const bySection = new Map<string | undefined, string[]>();
      for (const id of link) {
        if (!sections.has(id)) continue;
        const section = sections.get(id);
        bySection.set(section, [...(bySection.get(section) ?? []), id]);
      }
      return [...bySection.values()];
    })
    .filter((link) => link.length > 1);
}

export function snapLinkedWidgets(
  widgets: DashboardTile[],
  links: string[][] | undefined,
  ungroupedWidth: number,
  groupWidth: number,
): DashboardTile[] {
  let current = widgets;
  for (const link of validTileLinks(links, widgets)) {
    const section = current.find((tile) => tile.id === link[0])?.groupId;
    const pitchX = ((section ? groupWidth : ungroupedWidth) + 20) / 12;
    const pitchY = 92;
    const members = current.filter((tile) => tile.groupId === section);
    const rects = members.map((tile) => ({
      id: tile.id,
      x: tile.x * pitchX,
      y: tile.y * pitchY,
      w: Math.max(1, tile.w * pitchX - 20),
      h: Math.max(1, tile.h * pitchY - 20),
    }));
    const joined = joinTiles(rects, new Set(link), {
      x: 0,
      y: 0,
      width: section ? groupWidth : ungroupedWidth,
      maxY: 10000 * pitchY,
    });
    if ('error' in joined) continue;
    const positions = new Map(joined.tiles.map((tile) => [tile.id, tile]));
    current = current.map((tile) => {
      const position = link.includes(tile.id)
        ? positions.get(tile.id)
        : undefined;
      return position
        ? { ...tile, x: position.x / pitchX, y: position.y / pitchY }
        : tile;
    });
  }
  return current;
}

export function linkTiles(links: string[][], selected: string[]): string[][] {
  const ids = new Set(selected);
  return [
    ...links
      .map((link) => link.filter((id) => !ids.has(id)))
      .filter((link) => link.length > 1),
    selected,
  ];
}

export function unlinkTiles(links: string[][], selected: string[]): string[][] {
  const ids = new Set(selected);
  return links
    .map((link) => link.filter((id) => !ids.has(id)))
    .filter((link) => link.length > 1);
}

// Move from the gesture's starting layout so every member keeps its offset.
// Reject a move that would cross a boundary or overlap an unlinked tile.
export function moveLinkedTiles(
  initial: Layout,
  active: Layout[number],
  members: string[],
  maxX: number,
  maxY: number,
  gutterX = 0,
  gutterY = 0,
): Layout {
  const original = initial.find((item) => item.i === active.i);
  if (!original) return initial;
  const ids = new Set(members);
  const dx = active.x - original.x;
  const dy = active.y - original.y;
  const moved = initial.map((item) =>
    ids.has(item.i) ? { ...item, x: item.x + dx, y: item.y + dy } : item,
  );
  if (
    moved.some(
      (item) =>
        ids.has(item.i) &&
        (item.x < -1e-7 ||
          item.y < -1e-7 ||
          item.x + item.w > maxX + 1e-7 ||
          item.y + item.h > maxY + 1e-7),
    )
  )
    return initial;
  const overlap = (a: Layout[number], b: Layout[number]) =>
    a.x < b.x + b.w - gutterX - 1e-7 &&
    a.x + a.w - gutterX > b.x + 1e-7 &&
    a.y < b.y + b.h - gutterY - 1e-7 &&
    a.y + a.h - gutterY > b.y + 1e-7;
  if (
    moved.some(
      (item) =>
        ids.has(item.i) &&
        moved.some((other) => !ids.has(other.i) && overlap(item, other)),
    )
  )
    return initial;
  return moved;
}
