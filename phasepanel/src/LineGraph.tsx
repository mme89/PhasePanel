import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { timeGrid } from './chartGrid';
import type { GraphSample } from './graphHistory';

function axisTime(time: number, includeSeconds: boolean) {
  return new Date(time).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  });
}

export const GRAPH_COLORS = [
  '#1673b1',
  '#df6b25',
  '#28a15b',
  '#a445a5',
  '#c14353',
  '#8b6d24',
  '#17a5a0',
  '#6e63ba',
  '#a85531',
  '#5e8c34',
  '#be488a',
  '#586b84',
] as const;

export type GraphSeries = {
  key: string;
  label: string;
  groupKey?: string;
  groupLabel?: string;
  shortLabel?: string;
  samples: GraphSample[];
  color: string;
  status?: string;
};

function GraphPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        container.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="graph-picker" ref={container}>
      <span>{label}</span>
      <button
        type="button"
        className="graph-picker-button"
        aria-label={`Graph ${label.toLowerCase()}: ${selected?.label ?? value}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected?.label ?? value}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="graph-picker-menu"
          role="group"
          aria-label={`Graph ${label.toLowerCase()} options`}
        >
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                container.current
                  ?.querySelector<HTMLButtonElement>('.graph-picker-button')
                  ?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LineGraph({
  series,
  minutes,
  now,
  unit,
  decimals,
  controlsTarget,
}: {
  series: GraphSeries[];
  minutes: 5 | 15 | 60;
  now: number;
  unit: string;
  decimals: number;
  controlsTarget?: HTMLElement | null;
}) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [chartSize, setChartSize] = useState({ width: 600, scale: 1 });
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [timeRange, setTimeRange] = useState<1 | 5 | 15 | 60>(minutes);
  const [viewport, setViewport] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{
    clientX: number;
    start: number;
    end: number;
    width: number;
  } | null>(null);
  const [manualInputs, setManualInputs] = useState<{
    min: string;
    max: string;
  }>();
  const [manualBounds, setManualBounds] = useState<{
    min: number;
    max: number;
  }>();
  useEffect(() => {
    setTimeRange(minutes);
    setViewport(null);
  }, [minutes]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const width = svg.getBoundingClientRect().width;
      const scale =
        Number.parseFloat(
          getComputedStyle(svg).getPropertyValue('--graph-ui-scale'),
        ) || 1;
      setChartSize({ width, scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    measure();
    return () => observer.disconnect();
  }, []);
  const fullEnd = Math.max(
    now,
    ...series.map((item) => item.samples.at(-1)?.time ?? now),
  );
  const fullDuration = timeRange * 60_000;
  const fullStart = fullEnd - fullDuration;
  const viewDuration = Math.min(
    fullDuration,
    viewport ? viewport.end - viewport.start : fullDuration,
  );
  const start = viewport
    ? Math.max(fullStart, Math.min(fullEnd - viewDuration, viewport.start))
    : fullStart;
  const end = start + viewDuration;
  const zoomed = viewDuration < fullDuration - 1;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = (event: WheelEvent) => {
      event.preventDefault();
      setHoverTime(null);
      const bounds = svg.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width),
      );
      const duration = end - start;
      const nextDuration = Math.max(
        Math.min(5_000, fullDuration),
        Math.min(fullDuration, duration * Math.exp(event.deltaY * 0.0015)),
      );
      if (nextDuration >= fullDuration - 1) {
        setViewport(null);
        return;
      }
      const anchor = start + ratio * duration;
      const nextStart = Math.max(
        fullStart,
        Math.min(fullEnd - nextDuration, anchor - ratio * nextDuration),
      );
      setViewport({ start: nextStart, end: nextStart + nextDuration });
    };
    svg.addEventListener('wheel', zoom, { passive: false });
    return () => svg.removeEventListener('wheel', zoom);
  }, [start, end, fullStart, fullEnd, fullDuration]);
  const legend = series.map((item) => ({
    ...item,
    samples: item.samples.filter(
      (sample) => sample.time >= start && sample.time <= end,
    ),
  }));
  const visible = legend.filter((item) => !hiddenKeys.has(item.key));
  const legendEntries: (
    | { kind: 'single'; item: GraphSeries }
    | { kind: 'group'; key: string; label: string; items: GraphSeries[] }
  )[] = [];
  for (const item of legend) {
    if (!item.groupKey || !item.groupLabel) {
      legendEntries.push({ kind: 'single', item });
      continue;
    }
    const group = legendEntries.find(
      (entry) => entry.kind === 'group' && entry.key === item.groupKey,
    );
    if (group?.kind === 'group') group.items.push(item);
    else
      legendEntries.push({
        kind: 'group',
        key: item.groupKey,
        label: item.groupLabel,
        items: [item],
      });
  }
  const values = visible.flatMap((item) =>
    item.samples.flatMap((sample) =>
      sample.value === null ? [] : [sample.value],
    ),
  );
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = values.length
    ? Math.max((high - low) * 0.1, Math.abs(high) * 0.01, 0.1)
    : 1;
  const autoMin = values.length ? Math.floor(low - padding) : 0;
  const autoMax = values.length ? Math.ceil(high + padding) : 1;
  const min = manualInputs && manualBounds ? manualBounds.min : autoMin;
  const max = manualInputs && manualBounds ? manualBounds.max : autoMax;
  const timeTicks = timeGrid(start, end);
  const majorTimeTicks = timeTicks.filter((tick) => tick.major);
  const majorStep = majorTimeTicks[1]?.time - majorTimeTicks[0]?.time;
  const tickSpacing = majorStep
    ? (chartSize.width * majorStep) / viewDuration
    : chartSize.width;
  const labelStride = Math.max(
    1,
    Math.ceil((72 * chartSize.scale) / tickSpacing),
  );
  const showSeconds = viewDuration <= 15 * 60_000;
  const valueTicks = Array.from(
    { length: 11 },
    (_, index) => max - ((max - min) * index) / 10,
  );
  const maxLabel = max.toLocaleString('en-GB', { maximumFractionDigits: 6 });
  const minLabel = min.toLocaleString('en-GB', { maximumFractionDigits: 6 });
  const x = (time: number) => 2 + ((time - start) / (end - start)) * 596;
  const y = (value: number) => 12 + ((max - value) / (max - min)) * 132;
  const formatValue = (value: number) =>
    `${value.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${unit}`.trim();
  const sampleTimes = [
    ...new Set(
      visible.flatMap((item) => item.samples.map((sample) => sample.time)),
    ),
  ].sort((a, b) => a - b);
  const hovered =
    hoverTime === null || !sampleTimes.includes(hoverTime)
      ? null
      : visible.map((item) => ({
          key: item.key,
          label: item.label,
          color: item.color,
          sample: item.samples.find((sample) => sample.time === hoverTime),
        }));
  const hoverX = hoverTime === null ? null : x(hoverTime);
  const manualInvalid =
    manualInputs !== undefined &&
    (!manualInputs.min.trim() ||
      !manualInputs.max.trim() ||
      !Number.isFinite(Number(manualInputs.min)) ||
      !Number.isFinite(Number(manualInputs.max)) ||
      Number(manualInputs.min) >= Number(manualInputs.max));

  function updateManual(next: { min: string; max: string }) {
    setManualInputs(next);
    const minimum = Number(next.min);
    const maximum = Number(next.max);
    if (
      next.min.trim() &&
      next.max.trim() &&
      Number.isFinite(minimum) &&
      Number.isFinite(maximum) &&
      minimum < maximum
    )
      setManualBounds({ min: minimum, max: maximum });
  }

  function startPan(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !zoomed) return;
    event.preventDefault();
    setHoverTime(null);
    pan.current = {
      clientX: event.clientX,
      start,
      end,
      width: event.currentTarget.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: React.PointerEvent<SVGSVGElement>) {
    if (pan.current) {
      const {
        clientX,
        start: originalStart,
        end: originalEnd,
        width,
      } = pan.current;
      const duration = originalEnd - originalStart;
      const movedStart =
        originalStart - ((event.clientX - clientX) / width) * duration;
      const nextStart = Math.max(
        fullStart,
        Math.min(fullEnd - duration, movedStart),
      );
      setViewport({ start: nextStart, end: nextStart + duration });
    } else {
      selectSample(event.clientX, event.currentTarget);
    }
  }
  function endPan() {
    pan.current = null;
  }

  function selectSample(clientX: number, target: SVGSVGElement) {
    const bounds = target.getBoundingClientRect();
    const pointerX = ((clientX - bounds.left) / bounds.width) * 600;
    if (pointerX < 2 || pointerX > 598 || !sampleTimes.length) {
      setHoverTime(null);
      return;
    }
    const time = start + ((pointerX - 2) / 596) * (end - start);
    let low = 0;
    let high = sampleTimes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sampleTimes[middle] < time) low = middle + 1;
      else high = middle;
    }
    setHoverTime(
      low === sampleTimes.length
        ? sampleTimes[sampleTimes.length - 1]
        : low === 0 || sampleTimes[low] - time < time - sampleTimes[low - 1]
          ? sampleTimes[low]
          : sampleTimes[low - 1],
    );
  }
  function legendItem(item: GraphSeries) {
    const latest = item.samples.at(-1)?.value;
    const enabled = !hiddenKeys.has(item.key);
    return (
      <button
        type="button"
        key={item.key}
        className={`graph-legend-item${enabled ? '' : ' graph-legend-item-off'}`}
        aria-label={`${item.label} graph value`}
        aria-pressed={enabled}
        title={`${enabled ? 'Hide' : 'Show'} ${item.label}`}
        onClick={() => {
          setHoverTime(null);
          setHiddenKeys((current) => {
            const next = new Set(current);
            if (next.has(item.key)) next.delete(item.key);
            else next.add(item.key);
            return next;
          });
        }}
      >
        <span
          className="graph-legend-swatch"
          style={{ backgroundColor: item.color }}
        />
        <span className="graph-legend-label">
          {item.shortLabel ?? item.label}
        </span>
        <strong className="graph-current">
          {latest == null
            ? (item.status ?? '—')
            : `${formatValue(latest)}${item.status && item.status !== 'Waiting' ? ` · ${item.status}` : ''}`}
        </strong>
      </button>
    );
  }
  const controls = (
    <div className="graph-controls">
      <GraphPicker
        label="Time"
        value={String(timeRange)}
        options={[1, 5, 15, 60].map((option) => ({
          value: String(option),
          label: `${option} min`,
        }))}
        onChange={(value) => {
          setHoverTime(null);
          setViewport(null);
          setTimeRange(Number(value) as 1 | 5 | 15 | 60);
        }}
      />
      <GraphPicker
        label="Y scale"
        value={manualInputs ? 'manual' : 'auto'}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Custom' },
        ]}
        onChange={(value) => {
          if (value === 'auto') {
            setManualInputs(undefined);
            setManualBounds(undefined);
          } else {
            const bounds = { min: autoMin, max: autoMax };
            setManualBounds(bounds);
            setManualInputs({
              min: String(Number(autoMin.toPrecision(6))),
              max: String(Number(autoMax.toPrecision(6))),
            });
          }
        }}
      />
      {manualInputs && (
        <>
          <label>
            Min
            <input
              aria-label="Graph minimum"
              aria-invalid={manualInvalid}
              type="number"
              step="any"
              value={manualInputs.min}
              onChange={(event) =>
                updateManual({ ...manualInputs, min: event.target.value })
              }
            />
          </label>
          <label>
            Max
            <input
              aria-label="Graph maximum"
              aria-invalid={manualInvalid}
              type="number"
              step="any"
              value={manualInputs.max}
              onChange={(event) =>
                updateManual({ ...manualInputs, max: event.target.value })
              }
            />
          </label>
        </>
      )}
    </div>
  );
  return (
    <div
      className="line-graph"
      role="img"
      aria-label={`Last ${timeRange} minute${timeRange === 1 ? '' : 's'}${zoomed ? ', zoomed view' : ''}: ${visible.length} series, ${values.length} valid samples${values.length ? `, range ${formatValue(low)} to ${formatValue(high)}` : ''}`}
      data-view-start={start}
      data-view-end={end}
    >
      <div className="graph-legend">
        {legendEntries.map((entry) => {
          if (entry.kind === 'single') return legendItem(entry.item);
          const allVisible = entry.items.every(
            (item) => !hiddenKeys.has(item.key),
          );
          return (
            <div className="graph-legend-group" key={entry.key}>
              <button
                type="button"
                className="graph-legend-group-toggle"
                aria-label={`${entry.label} graph values`}
                aria-pressed={allVisible}
                title={`${allVisible ? 'Hide' : 'Show'} all ${entry.label} phases`}
                onClick={() => {
                  setHoverTime(null);
                  setHiddenKeys((current) => {
                    const next = new Set(current);
                    const hide = entry.items.every(
                      (item) => !next.has(item.key),
                    );
                    for (const item of entry.items) {
                      if (hide) next.add(item.key);
                      else next.delete(item.key);
                    }
                    return next;
                  });
                }}
              >
                <span className="graph-legend-group-label">{entry.label}</span>
                <span className="graph-legend-group-action">
                  {allVisible ? 'Hide all' : 'Show all'}
                </span>
              </button>
              <div className="graph-legend-group-values">
                {entry.items.map(legendItem)}
              </div>
            </div>
          );
        })}
      </div>
      {controlsTarget === undefined
        ? controls
        : controlsTarget
          ? createPortal(controls, controlsTarget)
          : null}
      <div className="graph-plot">
        {values.length > 0 && (
          <div className="graph-axis" aria-hidden="true">
            <span className="graph-axis-measure">{maxLabel}</span>
            <span className="graph-axis-measure">{minLabel}</span>
            {valueTicks.map((value, index) =>
              index % 2 === 0 ? (
                <span
                  key={index}
                  className={`graph-axis-label${index === 0 ? ' graph-axis-label-top' : index === 10 ? ' graph-axis-label-bottom' : ''}`}
                  style={{ top: `${((12 + (index / 10) * 132) / 170) * 100}%` }}
                >
                  {value.toLocaleString('en-GB', {
                    maximumFractionDigits: 6,
                  })}
                </span>
              ) : null,
            )}
          </div>
        )}
        <div className="graph-chart">
          {visible.length === 0 && (
            <div className="graph-empty">
              Select a value above to show its line
            </div>
          )}
          {zoomed && (
            <button
              type="button"
              className="graph-reset-view"
              onClick={() => {
                setHoverTime(null);
                setViewport(null);
              }}
            >
              Reset view
            </button>
          )}
          <svg
            ref={svgRef}
            viewBox="0 0 600 170"
            preserveAspectRatio="none"
            aria-hidden="true"
            className={zoomed ? 'can-pan' : undefined}
            onPointerDown={startPan}
            onPointerMove={movePointer}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onLostPointerCapture={endPan}
            onPointerLeave={() => setHoverTime(null)}
            onDoubleClick={() => {
              setHoverTime(null);
              setViewport(null);
            }}
          >
            {timeTicks.map(({ time, major }) => (
              <line
                key={time}
                data-time={major ? time : undefined}
                className={major ? 'graph-grid-major' : 'graph-grid-minor'}
                x1={x(time)}
                x2={x(time)}
                y1="12"
                y2="144"
              />
            ))}
            {valueTicks.map((value, index) => (
              <line
                key={index}
                className={
                  index % 2 === 0 ? 'graph-grid-horizontal' : 'graph-grid-minor'
                }
                x1="2"
                x2="598"
                y1={y(value)}
                y2={y(value)}
              />
            ))}
            {visible.flatMap((item) => {
              const segments: GraphSample[][] = [];
              let gap = true;
              for (const sample of item.samples) {
                if (sample.value === null) {
                  gap = true;
                  continue;
                }
                if (gap) segments.push([]);
                segments[segments.length - 1].push(sample);
                gap = false;
              }
              return segments.map((segment, index) =>
                segment.length > 1 ? (
                  <polyline
                    key={`${item.key}-${index}`}
                    data-series={item.key}
                    points={segment
                      .map((sample) => `${x(sample.time)},${y(sample.value!)}`)
                      .join(' ')}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <circle
                    key={`${item.key}-${index}`}
                    data-series={item.key}
                    cx={x(segment[0].time)}
                    cy={y(segment[0].value!)}
                    r="3"
                    fill={item.color}
                  />
                ),
              );
            })}
            {hoverX !== null && hovered && (
              <>
                <line
                  className="graph-hover-line"
                  x1={hoverX}
                  x2={hoverX}
                  y1="12"
                  y2="144"
                />
                {hovered.map(({ key, color, sample }) =>
                  sample?.value == null ? null : (
                    <circle
                      key={key}
                      cx={hoverX}
                      cy={y(sample.value)}
                      r="4"
                      fill={color}
                      stroke="white"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
                )}
              </>
            )}
          </svg>
          <div className="graph-time-labels" aria-hidden="true">
            {majorTimeTicks
              .filter(
                ({ time }) =>
                  x(time) >= 48 &&
                  x(time) <= 552 &&
                  (majorStep === undefined ||
                    Math.round(time / majorStep) % labelStride === 0),
              )
              .map(({ time }) => (
                <time
                  key={time}
                  dateTime={new Date(time).toISOString()}
                  style={{ left: `${(x(time) / 600) * 100}%` }}
                >
                  {axisTime(time, showSeconds)}
                </time>
              ))}
          </div>
          {hoverX !== null && hovered && (
            <div
              className="graph-tooltip"
              style={{
                left: `${(hoverX / 600) * 100}%`,
                transform:
                  hoverX > 380
                    ? 'translateX(calc(-100% - 16px))'
                    : 'translateX(16px)',
              }}
            >
              <time dateTime={new Date(hoverTime!).toISOString()}>
                {new Date(hoverTime!).toLocaleString('en-GB')}
              </time>
              {hovered.map(({ key, label, color, sample }) => (
                <div className="graph-tooltip-reading" key={key}>
                  <span
                    className="graph-legend-swatch"
                    style={{ backgroundColor: color }}
                  />
                  <span>{label}</span>
                  <strong>
                    {sample?.value == null
                      ? 'No data'
                      : formatValue(sample.value)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="graph-footer">
        <span>{axisTime(start, showSeconds)}</span>
        <span>
          {visible.length === 0
            ? 'No values selected'
            : values.length < 2
              ? 'Collecting readings…'
              : `${values.length} samples · ${unit}`}
        </span>
        <span>{zoomed ? axisTime(end, showSeconds) : 'Now'}</span>
      </div>
    </div>
  );
}
