import type { Layout, LayoutItem } from 'react-grid-layout';

function overlaps(a: LayoutItem, b: LayoutItem) {
  return (
    a.i !== b.i &&
    a.x < b.x + b.w - 1e-6 &&
    a.x + a.w > b.x + 1e-6 &&
    a.y < b.y + b.h - 1e-6 &&
    a.y + a.h > b.y + 1e-6
  );
}

// Resolve against the start of the gesture, so crossing a neighbor does not
// permanently push it away if the pointer moves back or passes over it.
export function reflowTiles(
  original: Layout,
  active: LayoutItem,
  swap: boolean,
  width = Infinity,
): Layout {
  const previous = original.find((item) => item.i === active.i);
  if (!previous) return original;
  if (swap) {
    const target = original.find(
      (item) =>
        item.i !== active.i &&
        !item.static &&
        active.x + active.w / 2 >= item.x &&
        active.x + active.w / 2 < item.x + item.w &&
        active.y + active.h / 2 >= item.y &&
        active.y + active.h / 2 < item.y + item.h,
    );
    if (target) {
      const exchanged = original.map((item) =>
        item.i === active.i
          ? { ...active, x: target.x, y: target.y }
          : item.i === target.i
            ? { ...item, x: previous.x, y: previous.y }
            : { ...item },
      );
      if (
        exchanged.every(
          (item) =>
            item.x >= 0 &&
            item.x + item.w <= width + 1e-6 &&
            item.y <= 920000 &&
            !exchanged.some((other) => overlaps(item, other)),
        )
      )
        return exchanged;
    }
  }
  const placed: LayoutItem[] = [{ ...active }];
  for (const item of [...original]
    .filter((item) => item.i !== active.i)
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    const next = { ...item };
    let collisions = placed.filter((other) => overlaps(next, other));
    while (collisions.length) {
      if (next.static) return original;
      next.y = Math.max(...collisions.map((other) => other.y + other.h));
      if (next.y > 920000) return original;
      collisions = placed.filter((other) => overlaps(next, other));
    }
    placed.push(next);
  }
  return original.map((item) => placed.find((next) => next.i === item.i)!);
}
