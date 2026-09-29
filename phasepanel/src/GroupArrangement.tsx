import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { DashboardGroup, DashboardTile } from '../shared/model';
import { snapCoordinate } from './canvasGrid';
export type GroupSection = {
  group: DashboardGroup | undefined;
  widgets: DashboardTile[];
};
type Placement = { x: number; y: number; scale: number };
type Change = Placement & { i: string };

function GroupFrame({
  section,
  index,
  designWidth,
  canvasHeight,
  unit,
  canvasScale,
  arranging,
  snapToGrid,
  fallbackY,
  onChange,
  onExtent,
  children,
}: {
  section: GroupSection;
  index: number;
  designWidth: number;
  canvasHeight?: number;
  unit: number;
  canvasScale: number;
  arranging: boolean;
  snapToGrid: boolean;
  fallbackY: number;
  onChange: (layout: Change[]) => void;
  onExtent: (id: string, bottom: number) => void;
  children: (section: GroupSection, index: number, scale: number) => ReactNode;
}) {
  const group = section.group!;
  const content = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(1);
  const drag = useRef<
    | {
        clientX: number;
        clientY: number;
        initial: Placement;
        resize: boolean;
      }
    | undefined
  >(undefined);
  const [interacting, setInteracting] = useState(false);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() =>
      setNaturalHeight(content.current!.offsetHeight),
    );
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, []);
  const contentWidth = section.widgets.length
    ? (Math.max(...section.widgets.map((w) => w.x + w.w)) *
        (designWidth - 40 + 20)) /
        12 -
      20 +
      40
    : designWidth;
  // Read old grid allocations without changing the way existing dashboards look.
  const legacy = group.layout;
  const legacyWidth = legacy
    ? (legacy.w * (designWidth + 20)) / 12 - 20
    : designWidth;
  const legacyHeight = legacy ? legacy.h * 92 - 48 : naturalHeight;
  const raw = group.placement ?? {
    x: legacy ? (legacy.x * (designWidth + 20)) / 12 : 0,
    y: legacy ? legacy.y * 92 : fallbackY,
    scale: Math.max(
      0.02,
      Math.min(
        legacyWidth / designWidth,
        legacyHeight / Math.max(1, naturalHeight),
      ),
    ),
  };
  const scale = Math.min(raw.scale, designWidth / contentWidth);
  const placement = {
    ...raw,
    scale,
    x: Math.max(0, Math.min(raw.x, designWidth - contentWidth * scale)),
  };
  const frameWidth = contentWidth * scale * unit;
  const frameHeight = (naturalHeight * scale + 28) * unit;
  useLayoutEffect(() => {
    onExtent(group.id, placement.y + naturalHeight * scale + 28);
  }, [group.id, placement.y, naturalHeight, scale, onExtent]);
  function start(
    e: PointerEvent<HTMLDivElement | HTMLButtonElement>,
    resize: boolean,
  ) {
    if (!arranging || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initial: placement,
      resize,
    };
    setInteracting(true);
  }
  function move(e: PointerEvent) {
    if (!drag.current) return;
    const { initial, clientX, clientY, resize } = drag.current;
    const dx = (e.clientX - clientX) / (canvasScale * unit);
    const dy = (e.clientY - clientY) / (canvasScale * unit);
    if (resize) {
      const w = contentWidth * initial.scale,
        h = naturalHeight * initial.scale;
      const maxScale = Math.min(
        8,
        (designWidth - initial.x) / contentWidth,
        canvasHeight === undefined
          ? 8
          : (canvasHeight - initial.y - 28) / naturalHeight,
      );
      const nextScale = Math.max(
        0.02,
        Math.min(
          maxScale,
          initial.scale * (1 + (dx * w + dy * h) / (w * w + h * h)),
        ),
      );
      // Groups keep their aspect ratio; snap the right edge when scaling.
      const snappedWidth =
        snapCoordinate(
          (initial.x + contentWidth * nextScale) * unit,
          (initial.x + contentWidth * 0.02) * unit,
          (initial.x + contentWidth * maxScale) * unit,
        ) /
          unit -
        initial.x;
      onChange([
        {
          i: group.id,
          ...initial,
          scale: snapToGrid ? snappedWidth / contentWidth : nextScale,
        },
      ]);
    } else {
      onChange([
        {
          i: group.id,
          ...initial,
          x: snapToGrid
            ? snapCoordinate(
                (initial.x + dx) * unit,
                0,
                (designWidth - contentWidth * initial.scale) * unit,
              ) / unit
            : Math.max(
                0,
                Math.min(
                  designWidth - contentWidth * initial.scale,
                  initial.x + dx,
                ),
              ),
          y: snapToGrid
            ? snapCoordinate(
                (initial.y + dy) * unit,
                0,
                Math.max(
                  0,
                  (canvasHeight ?? 1000000) -
                    naturalHeight * initial.scale -
                    28,
                ) * unit,
              ) / unit
            : Math.max(
                0,
                Math.min(
                  (canvasHeight ?? 1000000) -
                    naturalHeight * initial.scale -
                    28,
                  initial.y + dy,
                ),
              ),
        },
      ]);
    }
  }
  function stop() {
    drag.current = undefined;
    setInteracting(false);
  }
  return (
    <div
      data-testid={`group-frame-${group.id}`}
      className={`group-frame ${arranging ? 'arranging' : ''} ${interacting ? 'group-interacting' : ''}`}
      style={
        {
          position: 'absolute',
          left: placement.x * unit,
          top: placement.y * unit,
          width: frameWidth,
          height: frameHeight,
          '--group-bar-height': `${28 * unit}px`,
          '--group-content-width': `${frameWidth}px`,
          '--group-content-height': `${naturalHeight * scale * unit}px`,
        } as CSSProperties
      }
    >
      <div
        className="group-position-handle"
        style={{
          height: 28 * unit,
          fontSize: 12 * unit,
          visibility: arranging ? 'visible' : 'hidden',
        }}
        onPointerDown={(e) => start(e, false)}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        ⠿ Move {group.title}
      </div>
      <div
        className="group-viewport"
        style={{ height: naturalHeight * scale * unit }}
      >
        <div
          className="scaled-group-content"
          ref={content}
          style={{ width: designWidth, transform: `scale(${scale * unit})` }}
        >
          {children(section, index, scale * unit)}
        </div>
      </div>
      {arranging && (
        <button
          type="button"
          aria-label={`Resize group ${group.title}`}
          className="group-resize-grip"
          onPointerDown={(e) => start(e, true)}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
        >
          ◢
        </button>
      )}
    </div>
  );
}
export function GroupArrangement({
  sections,
  designWidth,
  canvasHeight,
  ungroupedOnCanvas = false,
  width,
  canvasScale,
  arranging,
  snapToGrid,
  onChange,
  children,
}: {
  sections: GroupSection[];
  designWidth?: number;
  canvasHeight?: number;
  ungroupedOnCanvas?: boolean;
  width: number;
  canvasScale: number;
  arranging: boolean;
  snapToGrid: boolean;
  onChange: (layout: Change[]) => void;
  children: (section: GroupSection, index: number, scale: number) => ReactNode;
}) {
  const [extents, setExtents] = useState<Record<string, number>>({});
  const [reportExtent] = useState(
    () => (id: string, bottom: number) =>
      setExtents((previous) =>
        previous[id] === bottom ? previous : { ...previous, [id]: bottom },
      ),
  );
  if (!designWidth) return <>{sections.map((s, i) => children(s, i, 1))}</>;
  const named = sections.filter((s) => s.group);
  const unit = width / designWidth;
  return (
    <>
      <div
        className="group-arrangement-grid"
        style={{
          position: 'relative',
          height: Math.max(
            Math.max(1, ...named.map((s) => extents[s.group!.id] ?? 0)) * unit,
            ungroupedOnCanvas
              ? Math.max(
                  0,
                  ...sections
                    .filter((s) => !s.group)
                    .flatMap((s) =>
                      s.widgets.map((tile) => (tile.y + tile.h) * 92 - 20),
                    ),
                )
              : 0,
          ),
        }}
      >
        {named.map((section, index) => (
          <GroupFrame
            key={section.group!.id}
            section={section}
            index={index}
            designWidth={designWidth}
            canvasHeight={
              canvasHeight === undefined ? undefined : canvasHeight / unit
            }
            unit={unit}
            canvasScale={canvasScale}
            arranging={arranging}
            snapToGrid={snapToGrid}
            fallbackY={named
              .slice(0, index)
              .reduce(
                (bottom, s) =>
                  Math.max(bottom, extents[s.group!.id] ?? bottom + 400),
                0,
              )}
            onChange={onChange}
            onExtent={reportExtent}
          >
            {children}
          </GroupFrame>
        ))}
        {ungroupedOnCanvas && (
          <div className="canvas-ungrouped-layer">
            {sections
              .filter((s) => !s.group)
              .map((s) => children(s, named.length, 1))}
          </div>
        )}
      </div>
      {!ungroupedOnCanvas &&
        sections
          .filter((s) => !s.group)
          .map((s) => children(s, named.length, 1))}
    </>
  );
}
