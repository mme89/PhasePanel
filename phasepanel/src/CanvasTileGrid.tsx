import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  useMemo,
  type HTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react';
import GridLayout from 'react-grid-layout';
import {
  noCompactor,
  type LayoutConstraint,
  type Layout,
  type Compactor,
} from 'react-grid-layout/core';
import { nudgeCoordinate, snapCoordinate } from './canvasGrid';
import { reflowTiles } from './reflowTiles';
import {
  moveLinkedTiles,
  preservesLinkedOffsets,
  tileCollides,
} from './tileLinks';

const placedLayout = { ...noCompactor, preventCollision: true };

export function CanvasTileGrid({
  snapToGrid,
  canvasPlacement,
  canvasScale,
  canvasHeight,
  canvasBottomInset = 0,
  groupScale,
  rearrange = false,
  linkedTiles = [],
  ...props
}: ComponentProps<typeof GridLayout> & {
  snapToGrid: boolean;
  canvasPlacement: boolean;
  canvasScale: number;
  canvasHeight?: number;
  canvasBottomInset?: number;
  groupScale: number;
  rearrange?: boolean;
  linkedTiles?: string[][];
}) {
  const container = useRef<HTMLDivElement>(null);
  const layout = props.layout ?? [];
  const keyboardLayout = useRef<typeof layout | null>(null);
  const gesture = useRef<{ layout: Layout; id: string; swap: boolean } | null>(
    null,
  );
  const compactor = useMemo<Compactor>(
    () =>
      rearrange
        ? {
            ...noCompactor,
            allowOverlap: true,
            compact(next, cols) {
              const session = gesture.current;
              const active =
                session && next.find((item) => item.i === session.id);
              const link = linkedTiles.find((ids) =>
                ids.includes(session?.id ?? ''),
              );
              if (active && session && link && session.swap) {
                const offset = origin();
                const maxY =
                  canvasHeight === undefined
                    ? 10000 * 92
                    : Math.max(
                        0,
                        (canvasHeight - canvasBottomInset - offset.y) /
                          groupScale,
                      );
                return moveLinkedTiles(
                  session.layout,
                  active,
                  link,
                  cols,
                  maxY,
                );
              }
              if (!active || !session) return next;
              const flowed = reflowTiles(
                session.layout,
                active,
                session.swap,
                cols,
              );
              return preservesLinkedOffsets(session.layout, flowed, linkedTiles)
                ? flowed
                : session.layout;
            },
          }
        : linkedTiles.length
          ? {
              ...noCompactor,
              allowOverlap: true,
              compact(next) {
                const session = gesture.current;
                const active =
                  session && next.find((item) => item.i === session.id);
                const link = linkedTiles.find((ids) =>
                  ids.includes(session?.id ?? ''),
                );
                if (!session || !active) return next;
                if (!session.swap)
                  return tileCollides(next, session.id) ? session.layout : next;
                const offset = origin();
                const maxY =
                  canvasHeight === undefined
                    ? 10000 * 92
                    : Math.max(
                        0,
                        (canvasHeight - canvasBottomInset - offset.y) /
                          groupScale,
                      );
                return moveLinkedTiles(
                  session.layout,
                  active,
                  link ?? [session.id],
                  props.width,
                  maxY,
                );
              },
            }
          : placedLayout,
    [
      rearrange,
      linkedTiles,
      canvasHeight,
      canvasBottomInset,
      groupScale,
      props.width,
    ],
  );
  // Editing uses pixel precision so existing dashboards can resize below one
  // column or row. Fractional sizes retain that precision after saving.
  const precise =
    props.resizeConfig?.enabled ||
    canvasPlacement ||
    linkedTiles.length > 0 ||
    snapToGrid ||
    layout.some((item) =>
      [item.x, item.y, item.w, item.h].some((n) => !Number.isInteger(n)),
    );
  if (!precise) return <GridLayout {...props} />;
  // GridLayout matches child keys to layout IDs. Children.map/toArray rewrite
  // those keys, so retain them when adding keyboard controls.
  const children: ReactNode[] = [];
  Children.forEach(props.children, (child) => children.push(child));
  const pitchX = (props.width + 20) / 12;
  const pitchY = 92;
  function origin() {
    const node = container.current;
    const canvas =
      node?.closest('.fixed-canvas') ?? node?.closest('.dashboard-grid');
    if (!node || !canvas) return { x: 0, y: 0 };
    const a = node.getBoundingClientRect(),
      b = canvas.getBoundingClientRect();
    return {
      x: (a.left - b.left) / canvasScale + canvas.scrollLeft,
      y: (a.top - b.top) / canvasScale + canvas.scrollTop,
    };
  }
  function align(value: number, offset: number, min: number, max: number) {
    if (!snapToGrid) return Math.max(min, Math.min(max, value));
    return (
      (snapCoordinate(
        offset + value * groupScale,
        offset + min * groupScale,
        offset + max * groupScale,
      ) -
        offset) /
      groupScale
    );
  }
  const constraint: LayoutConstraint = {
    name: 'canvasGrid',
    constrainPosition(item, x, y) {
      const offset = origin();
      return {
        x: align(x, offset.x, 0, props.width - item.w),
        y: align(
          y,
          offset.y,
          0,
          canvasHeight === undefined
            ? 10000 * pitchY
            : Math.max(
                0,
                (canvasHeight - canvasBottomInset - offset.y) / groupScale -
                  item.h,
              ),
        ),
      };
    },
    constrainSize(item, w, h) {
      const offset = origin();
      return {
        w: align(w, offset.x + item.x * groupScale, 1, props.width - item.x),
        h: align(
          h,
          offset.y + item.y * groupScale,
          1,
          canvasHeight === undefined
            ? 10000 * pitchY - item.y
            : Math.max(
                1,
                (canvasHeight - canvasBottomInset - offset.y) / groupScale -
                  item.y,
              ),
        ),
      };
    },
  };
  return (
    <GridLayout
      {...props}
      innerRef={container}
      compactor={compactor}
      onDragStart={(next, old, item, ...rest) => {
        if (item)
          gesture.current = {
            layout: next.map((entry) => ({ ...entry })),
            id: item.i,
            swap: true,
          };
        props.onDragStart?.(next, old, item, ...rest);
      }}
      onDragStop={(...args) => {
        gesture.current = null;
        props.onDragStop?.(...args);
      }}
      onResizeStart={(next, old, item, ...rest) => {
        if (item)
          gesture.current = {
            layout: next.map((entry) => ({ ...entry })),
            id: item.i,
            swap: false,
          };
        props.onResizeStart?.(next, old, item, ...rest);
      }}
      onResizeStop={(...args) => {
        gesture.current = null;
        props.onResizeStop?.(...args);
      }}
      constraints={[constraint]}
      gridConfig={{
        cols: props.width,
        rowHeight: 1,
        margin: [0, 0],
        containerPadding: [0, 0],
      }}
      layout={layout.map((item) => ({
        ...item,
        x: item.x * pitchX,
        y: item.y * pitchY,
        w: Math.max(1, item.w * pitchX - 20),
        h: Math.max(1, item.h * pitchY - 20),
        minW: 1,
        minH: 1,
      }))}
      onLayoutChange={(next) => {
        const converted = next.map((item) => {
          const previous = layout.find((p) => p.i === item.i)!;
          // Preserve exact stored values when the pixel conversion did not move them.
          const stable = (value: number, old: number) =>
            Math.abs(value - old) < 1e-9 ? old : value;
          return {
            ...previous,
            x: stable(item.x / pitchX, previous.x),
            y: stable(item.y / pitchY, previous.y),
            w: stable((item.w + 20) / pitchX, previous.w),
            h: stable((item.h + 20) / pitchY, previous.h),
          };
        });
        // A controlled keyboard update can race the grid’s internal effects.
        // Ignore stale echoes until it acknowledges the requested layout.
        const pending = keyboardLayout.current;
        if (pending) {
          if (
            converted.every((item) => {
              const expected = pending.find((entry) => entry.i === item.i);
              return (
                expected &&
                (['x', 'y', 'w', 'h'] as const).every(
                  (axis) => Math.abs(item[axis] - expected[axis]) < 1e-9,
                )
              );
            })
          )
            keyboardLayout.current = null;
          return;
        }
        props.onLayoutChange?.(converted);
      }}
    >
      {children.map((child) => {
        if (
          !props.dragConfig?.enabled ||
          !isValidElement<HTMLAttributes<HTMLDivElement>>(child)
        )
          return child;
        const item = layout.find((entry) => entry.i === child.key);
        if (!item || item.static || item.isDraggable === false) return child;
        return cloneElement(child, {
          tabIndex: 0,
          'aria-keyshortcuts': 'ArrowUp ArrowDown ArrowLeft ArrowRight',
          'aria-description':
            'Use arrow keys to move this tile. Hold Shift to move ten steps. Snapping uses the canvas grid; otherwise each step is one canvas pixel.',
          onKeyDown(event) {
            child.props.onKeyDown?.(event);
            if (
              event.defaultPrevented ||
              event.target !== event.currentTarget ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const horizontal =
              event.key === 'ArrowLeft' || event.key === 'ArrowRight';
            const direction =
              event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
            const axis = horizontal ? 'x' : 'y';
            const pitch = horizontal ? pitchX : pitchY;
            const offset = origin()[axis];
            const max = horizontal
              ? 12 - item.w
              : canvasHeight === undefined
                ? 10000
                : Math.max(
                    0,
                    (canvasHeight - canvasBottomInset - origin().y) /
                      groupScale /
                      pitchY -
                      item.h,
                  );
            const position =
              (nudgeCoordinate(
                offset + item[axis] * pitch * groupScale,
                direction,
                snapToGrid,
                event.shiftKey,
                offset,
                offset + max * pitch * groupScale,
              ) -
                offset) /
              (pitch * groupScale);
            const moved = { ...item, [axis]: position };
            const link = linkedTiles.find((ids) => ids.includes(item.i));
            // Pixel tiles exclude the legacy 20 px gutters from their size.
            const overlaps = layout.some(
              (other) =>
                other.i !== item.i &&
                !link?.includes(other.i) &&
                moved.x * pitchX < (other.x + other.w) * pitchX - 20 - 1e-7 &&
                (moved.x + moved.w) * pitchX - 20 > other.x * pitchX + 1e-7 &&
                moved.y * pitchY < (other.y + other.h) * pitchY - 20 - 1e-7 &&
                (moved.y + moved.h) * pitchY - 20 > other.y * pitchY + 1e-7,
            );
            if (!overlaps && Math.abs(position - item[axis]) > 1e-9) {
              const next = link
                ? moveLinkedTiles(
                    layout,
                    moved,
                    link,
                    12,
                    canvasHeight === undefined
                      ? 10000
                      : Math.max(
                          0,
                          (canvasHeight - canvasBottomInset - origin().y) /
                            groupScale /
                            pitchY,
                        ),
                    20 / pitchX,
                    20 / pitchY,
                  )
                : layout.map((entry) => (entry.i === item.i ? moved : entry));
              if (
                next === layout ||
                next.every(
                  (entry, index) =>
                    entry.x === layout[index].x && entry.y === layout[index].y,
                )
              )
                return;
              keyboardLayout.current = next;
              props.onLayoutChange?.(next);
            }
          },
        });
      })}
    </GridLayout>
  );
}
