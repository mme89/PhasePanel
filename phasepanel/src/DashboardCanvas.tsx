import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import type { DashboardResolution } from '../shared/model';

export function DashboardCanvas({
  resolution,
  width,
  fitHeight,
  editing = false,
  fullscreen = false,
  children,
}: {
  resolution?: DashboardResolution;
  width: number;
  fitHeight: boolean;
  editing?: boolean;
  fullscreen?: boolean;
  children: (scale: number) => ReactNode;
}) {
  const [zoom, setZoom] = useState<number | 'width' | 'fit'>('fit');
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setZoom('fit');
    viewport.current?.scrollTo(0, 0);
  }, [editing, resolution?.width, resolution?.height]);
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(window.innerHeight);
  const [overflow, setOverflow] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  useLayoutEffect(() => {
    if (!resolution || !frame.current || !content.current) return;
    const update = () => {
      setAvailableHeight(
        Math.max(
          1,
          fullscreen
            ? window.innerHeight
            : editing
              ? // Give the canvas its own workspace. Settings above it scroll
                // off the page instead of consuming the canvas's height budget.
                window.innerHeight - 100
              : window.innerHeight -
                (viewport.current ?? frame.current!).getBoundingClientRect()
                  .top -
                20,
        ),
      );
      // The group resize grip sits below its frame while editing. Measure
      // layout boxes so that control does not count as overflowing content.
      const height = Math.max(
        0,
        ...Array.from(
          content.current!.children,
          (child) =>
            (child as HTMLElement).offsetTop +
            (child as HTMLElement).offsetHeight,
        ),
      );
      setContentHeight(height);
      setOverflow(height > resolution.height + 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(content.current);
    observer.observe(frame.current.parentElement!);
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
    };
  }, [resolution?.width, resolution?.height, fitHeight, editing, fullscreen]);
  if (!resolution) return <>{children(1)}</>;
  const automaticScale = Math.max(
    0.001,
    Math.min(
      fullscreen ? Infinity : 1,
      width / resolution.width,
      fitHeight ? availableHeight / resolution.height : 1,
    ),
  );
  const editorHeight = Math.max(240, availableHeight);
  const scrollHeight = editing
    ? Math.max(resolution.height, contentHeight)
    : resolution.height;
  const scale = editing
    ? typeof zoom === 'number'
      ? zoom
      : zoom === 'fit'
        ? Math.max(
            0.001,
            Math.min(
              1,
              (width - 12) / resolution.width,
              (editorHeight - 12) / scrollHeight,
            ),
          )
        : Math.min(
            automaticScale,
            Math.max(0.001, (width - 12) / resolution.width),
          )
    : automaticScale;
  const percentages = [10, 25, 50, 75, 100, 125, 150, 200];
  const percentage = Math.round(scale * 100);
  function stepZoom(direction: -1 | 1) {
    const next =
      direction === 1
        ? (percentages.find((value) => value > percentage) ?? 200)
        : ([...percentages].reverse().find((value) => value < percentage) ??
          10);
    setZoom(next / 100);
  }
  return (
    <>
      {editing && (
        <div
          className="canvas-zoom-controls"
          role="group"
          aria-label="Canvas zoom"
        >
          <span className="canvas-zoom-title">Canvas zoom</span>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={scale <= 0.1}
            onClick={() => stepZoom(-1)}
          >
            −
          </button>
          <select
            aria-label="Zoom level"
            value={zoom}
            onChange={(e) =>
              setZoom(
                e.target.value === 'width' || e.target.value === 'fit'
                  ? e.target.value
                  : Number(e.target.value),
              )
            }
          >
            <option value="width">Fit width</option>
            <option value="fit">Fit canvas</option>
            {percentages.map((value) => (
              <option key={value} value={value / 100}>
                {value}%
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={scale >= 2}
            onClick={() => stepZoom(1)}
          >
            +
          </button>
        </div>
      )}
      {!fitHeight && (
        <p className="canvas-caption">
          {resolution.width} × {resolution.height} canvas ·{' '}
          {Math.round(scale * 100)}% preview. Layout stays fixed across screen
          sizes.
        </p>
      )}
      {overflow && !fitHeight && (
        <p className="field-error" role="status">
          Content exceeds the target height. Resize tiles or increase the canvas
          height; the canvas can be scrolled.
        </p>
      )}
      <div
        ref={viewport}
        className={
          editing
            ? 'canvas-edit-viewport'
            : fullscreen
              ? 'canvas-fullscreen-viewport'
              : undefined
        }
        style={editing ? { height: editorHeight } : undefined}
      >
        <div
          className="canvas-frame"
          ref={frame}
          style={{
            width: resolution.width * scale,
            height: scrollHeight * scale,
          }}
        >
          <div
            className="fixed-canvas"
            data-testid="dashboard-canvas"
            data-scale={scale}
            style={
              {
                // Typography uses Full HD as its baseline, independently of preview zoom.
                '--canvas-text-scale': Math.max(1, resolution.width / 1920),
                '--graph-ui-scale':
                  Math.max(1, resolution.width / 1920) ** 1.25,
                '--canvas-grid-line': `${1 / scale}px`,
                width: resolution.width,
                height: resolution.height,
                transform: `scale(${scale})`,
              } as CSSProperties
            }
          >
            <div ref={content}>{children(scale)}</div>
          </div>
        </div>
      </div>
    </>
  );
}
