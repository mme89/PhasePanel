import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bindingKey, isTotalTile, type Dashboard } from '../shared/model';
import { measurementSources, totalHistoryKey } from '../shared/totals';
import { api, message } from './api';
import { timeGrid, timeGridLabel } from './chartGrid';
import type { GraphSample } from './graphHistory';
import { graphPhaseGroup } from './graphPhaseGroup';
import { GRAPH_COLORS } from './LineGraph';
import { Modal } from './Modal';
import { HistoryPdfReport } from './HistoryPdfReport';
import { downloadHistoryPdf } from './historyPdfDownload';

type HistorySource = {
  key: string;
  label: string;
  unit: string;
  project: string;
  device: string;
  value: string;
  dashboardId?: string;
  dashboardRevision?: number;
};
type MappedValue = {
  key: string;
  binding: {
    project: string;
    deviceId: string;
    measurement: string;
    channel: string;
  };
  deviceName: string;
  label: string;
  channelLabel: string;
  unit: string;
};
type ValueOption = {
  key: string;
  label: string;
  unit: string;
  sources: HistorySource[];
  project: string;
  device: string;
  deviceKey: string;
  value: string;
};
type HistoryResponse = {
  revision: number;
  sourceRevision: number;
  samples: Record<string, GraphSample[]>;
};
export type HistoryJump = {
  project: string;
  deviceId: string;
  atMs: number;
  phase: string | null;
  unit: 'V' | 'A' | null;
};

function pdfTitle(sources: HistorySource[], date: Date) {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const part = (names: string[], maxLength = 65) => {
    const unique = [...new Set(names.map((name) => name.trim()))].filter(
      Boolean,
    );
    const suffix = unique.length > 1 ? ` + ${unique.length - 1} more` : '';
    const first =
      (unique[0] ?? 'Unknown')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, maxLength - suffix.length)
        .replace(/[. ]+$/, '') || 'Unknown';
    return `${first}${suffix}`;
  };
  const values = [...new Set(sources.map((source) => source.value))];
  const phaseValues = values.map((value) => /^(.*) · (L[1-4])$/.exec(value));
  const valueName =
    values.length > 1 &&
    phaseValues.every((match) => match && match[1] === phaseValues[0]?.[1])
      ? part(
          [
            `${phaseValues[0]![1]} · ${phaseValues.map((match) => match![2]).join(' + ')}`,
          ],
          90,
        )
      : part(values);
  return [
    day,
    part(sources.map((source) => source.project)),
    part(sources.map((source) => source.device)),
    valueName,
  ].join(' - ');
}

function periodOptions(retentionDays: number) {
  return [
    { minutes: 60, label: '1 hour' },
    { minutes: 360, label: '6 hours' },
    ...Array.from({ length: retentionDays }, (_, index) => {
      const days = index + 1;
      return {
        minutes: days * 1440,
        label: `${days === 1 ? '24 hours' : `${days} days`}${days === retentionDays ? ' (retention limit)' : ''}`,
      };
    }),
  ];
}

function valuesFor(
  dashboards: Dashboard[],
  mappedValues: MappedValue[],
): ValueOption[] {
  const choices = new Map<string, ValueOption>();
  const dashboardKeys = new Set<string>();
  const groups = new Map<string, { label: string; sources: HistorySource[] }>();
  for (const dashboard of dashboards) {
    for (const tile of dashboard.widgets) {
      for (const source of measurementSources(tile)) {
        const key = bindingKey(source.binding);
        dashboardKeys.add(key);
        const entry: HistorySource = {
          key,
          label: `${source.binding.project} · ${source.deviceName || source.binding.deviceId} · ${source.label} · ${source.binding.channel}`,
          unit: source.unit,
          project: source.binding.project,
          device: source.deviceName || source.binding.deviceId,
          value: source.label.endsWith(` · ${source.binding.channel}`)
            ? source.label
            : `${source.label} · ${source.binding.channel}`,
          dashboardId: dashboard.id,
          dashboardRevision: dashboard.revision,
        };
        if (!choices.has(key))
          choices.set(key, {
            ...entry,
            sources: [entry],
            project: source.binding.project,
            device: source.deviceName || source.binding.deviceId,
            deviceKey: JSON.stringify([
              source.binding.project,
              source.binding.deviceId,
            ]),
            value: entry.value,
          });
        const phaseGroup = graphPhaseGroup(source);
        if (phaseGroup) {
          const group = groups.get(phaseGroup.key) ?? {
            label: `${source.binding.project} · ${phaseGroup.label}`,
            sources: [],
          };
          if (!group.sources.some((item) => item.key === key))
            group.sources.push(entry);
          groups.set(phaseGroup.key, group);
        }
      }
      if (isTotalTile(tile)) {
        const key = totalHistoryKey(dashboard.id, tile);
        const entry: HistorySource = {
          key,
          label: `Total · ${tile.label}`,
          unit: tile.unit,
          project: '—',
          device: `Totals · ${dashboard.name}`,
          value: tile.label,
          dashboardId: dashboard.id,
          dashboardRevision: dashboard.revision,
        };
        choices.set(key, {
          ...entry,
          sources: [entry],
          project: '—',
          device: `Totals · ${dashboard.name}`,
          deviceKey: `totals:${dashboard.id}`,
          value: tile.label,
        });
      }
    }
  }
  for (const [groupKey, group] of groups) {
    if (group.sources.length < 2) continue;
    group.sources.sort((a, b) => a.label.localeCompare(b.label));
    for (const source of group.sources) choices.delete(source.key);
    const phases = group.sources.map((source) =>
      source.label.split(' · ').at(-1),
    );
    choices.set(`group:${groupKey}`, {
      key: `group:${groupKey}`,
      label: `${group.label} · ${phases.join(' + ')}`,
      unit: group.sources[0].unit,
      sources: group.sources,
      project: group.sources[0].project,
      device: group.sources[0].device,
      deviceKey: JSON.stringify(groupKey.split('\u0000').slice(0, 2)),
      value: `${group.label.split(' · ').at(-1)} · ${phases.join(' + ')}`,
    });
  }
  for (const mapped of mappedValues) {
    if (dashboardKeys.has(mapped.key)) continue;
    const { project, deviceId, channel } = mapped.binding;
    const value = mapped.label.endsWith(` · ${channel}`)
      ? mapped.label
      : `${mapped.label} · ${channel}`;
    const source: HistorySource = {
      key: mapped.key,
      label: `${project} · ${mapped.deviceName} · ${value}`,
      unit: mapped.unit,
      project,
      device: mapped.deviceName,
      value,
    };
    choices.set(mapped.key, {
      ...source,
      sources: [source],
      deviceKey: JSON.stringify([project, deviceId]),
    });
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function HistoryPlot({
  series,
  legendTitle,
  minutes,
  now,
  unit,
  onViewChange,
}: {
  series: {
    label: string;
    legendLabel: string;
    samples: GraphSample[];
    color: string;
  }[];
  legendTitle?: string;
  minutes: number;
  now: number;
  unit: string;
  onViewChange: (start: number, end: number) => void;
}) {
  const fullStart = now - minutes * 60_000;
  const [view, setView] = useState({ start: fullStart, end: now });
  const [hovered, setHovered] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{
    clientX: number;
    start: number;
    end: number;
    width: number;
  } | null>(null);
  const fullDuration = now - fullStart;
  const zoomed = view.end - view.start < fullDuration - 1;

  useEffect(() => {
    onViewChange(view.start, view.end);
  }, [view.start, view.end, onViewChange]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = (event: WheelEvent) => {
      event.preventDefault();
      setHovered(null);
      const bounds = svg.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width),
      );
      setView((current) => {
        const duration = current.end - current.start;
        const nextDuration = Math.max(
          Math.min(60_000, fullDuration),
          Math.min(fullDuration, duration * Math.exp(event.deltaY * 0.0015)),
        );
        const anchor = current.start + ratio * duration;
        const start = Math.max(
          fullStart,
          Math.min(now - nextDuration, anchor - ratio * nextDuration),
        );
        return { start, end: start + nextDuration };
      });
    };
    svg.addEventListener('wheel', zoom, { passive: false });
    return () => svg.removeEventListener('wheel', zoom);
  }, [fullStart, fullDuration, now]);

  function startPan(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !zoomed) return;
    event.preventDefault();
    setHovered(null);
    const width = event.currentTarget.getBoundingClientRect().width;
    pan.current = { clientX: event.clientX, ...view, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event: React.PointerEvent<SVGSVGElement>) {
    if (!pan.current) return;
    const { clientX, start, end, width } = pan.current;
    const duration = end - start;
    const movedStart = start - ((event.clientX - clientX) / width) * duration;
    const nextStart = Math.max(fullStart, Math.min(now - duration, movedStart));
    setView({ start: nextStart, end: nextStart + duration });
  }
  function endPan() {
    pan.current = null;
  }

  const visible = useMemo(() => {
    return series.map((item) => ({
      ...item,
      samples: item.samples.filter(
        (sample) => sample.time >= view.start && sample.time <= view.end,
      ),
    }));
  }, [series, view.start, view.end]);
  const valid = visible
    .flatMap((item) => item.samples)
    .filter((sample) => sample.status === 'ok' && sample.value !== null);
  const hasFreshSamples = useMemo(
    () =>
      series.some((item) =>
        item.samples.some(
          (sample) => sample.status === 'ok' && sample.value !== null,
        ),
      ),
    [series],
  );
  if (!hasFreshSamples)
    return <p className="history-empty">No fresh values in this period.</p>;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const sample of valid) {
    minimum = Math.min(minimum, sample.value!);
    maximum = Math.max(maximum, sample.value!);
  }
  const padding = valid.length
    ? Math.max((maximum - minimum) * 0.1, Math.abs(maximum) * 0.01, 0.1)
    : 1;
  const low = valid.length ? Math.floor(minimum - padding) : 0;
  const high = valid.length ? Math.ceil(maximum + padding) : 1;
  const duration = view.end - view.start;
  const timeTicks = timeGrid(view.start, view.end);
  const valueTicks = Array.from(
    { length: 11 },
    (_, index) => high - ((high - low) * index) / 10,
  );
  const x = (time: number) =>
    10 + ((time - view.start) / (view.end - view.start)) * 780;
  const y = (value: number) => 10 + ((high - value) / (high - low)) * 180;
  function movePointer(event: React.PointerEvent<SVGSVGElement>) {
    if (pan.current) {
      movePan(event);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * 800;
    const allSamples = visible.flatMap((item) => item.samples);
    if (pointerX < 10 || pointerX > 790 || !allSamples.length) {
      setHovered(null);
      return;
    }
    const targetTime =
      view.start + ((pointerX - 10) / 780) * (view.end - view.start);
    let lowIndex = 0;
    let highIndex = allSamples.length;
    allSamples.sort((a, b) => a.time - b.time);
    while (lowIndex < highIndex) {
      const middle = (lowIndex + highIndex) >>> 1;
      if (allSamples[middle].time < targetTime) lowIndex = middle + 1;
      else highIndex = middle;
    }
    const nearest =
      lowIndex === allSamples.length
        ? allSamples[allSamples.length - 1]
        : lowIndex === 0 ||
            allSamples[lowIndex].time - targetTime <
              targetTime - allSamples[lowIndex - 1].time
          ? allSamples[lowIndex]
          : allSamples[lowIndex - 1];
    setHovered(
      Math.abs(x(nearest.time) - pointerX) <= 24 ? nearest.time : null,
    );
  }
  function pathFor(samples: GraphSample[]) {
    // Keep extremes and gap boundaries when a long period needs fewer SVG points.
    const step = Math.max(1, Math.ceil(samples.length / 600));
    const indices = new Set<number>();
    if (samples.length) {
      indices.add(0);
      indices.add(samples.length - 1);
    }
    for (let startIndex = 0; startIndex < samples.length; startIndex += step) {
      const endIndex = Math.min(samples.length, startIndex + step);
      let minIndex = -1;
      let maxIndex = -1;
      indices.add(startIndex);
      indices.add(endIndex - 1);
      for (let index = startIndex; index < endIndex; index++) {
        const sample = samples[index];
        const missing = sample.status !== 'ok' || sample.value === null;
        if (!missing) {
          if (minIndex < 0 || sample.value! < samples[minIndex].value!)
            minIndex = index;
          if (maxIndex < 0 || sample.value! > samples[maxIndex].value!)
            maxIndex = index;
        }
        if (index > 0) {
          const previous = samples[index - 1];
          if (
            missing !== (previous.status !== 'ok' || previous.value === null)
          ) {
            indices.add(index - 1);
            indices.add(index);
          }
        }
      }
      if (minIndex >= 0) indices.add(minIndex);
      if (maxIndex >= 0) indices.add(maxIndex);
    }
    const reduced = [...indices]
      .sort((a, b) => a - b)
      .map((index) => samples[index]);
    let path = '';
    let gap = true;
    for (const sample of reduced) {
      if (sample.status !== 'ok' || sample.value === null) {
        gap = true;
        continue;
      }
      path += `${gap ? 'M' : 'L'}${x(sample.time).toFixed(1)} ${y(sample.value).toFixed(1)} `;
      gap = false;
    }
    return path;
  }
  return (
    <div
      className="history-plot"
      data-view-start={view.start}
      data-view-end={view.end}
    >
      <div className="history-plot-toolbar">
        <button
          type="button"
          onClick={() => {
            setHovered(null);
            setView({ start: fullStart, end: now });
          }}
          disabled={!zoomed}
        >
          Reset view
        </button>
      </div>
      <div className="history-plot-canvas">
        <div className="history-plot-labels">
          {valid.length > 0 &&
            valueTicks.map((value, index) =>
              index % 2 === 0 ? (
                <span key={index} style={{ top: `${(index / 10) * 90 + 5}%` }}>
                  {value.toLocaleString('en-GB', {
                    maximumFractionDigits: 2,
                  })}
                </span>
              ) : null,
            )}
        </div>
        <svg
          ref={svgRef}
          viewBox="0 0 800 200"
          preserveAspectRatio="none"
          role="img"
          aria-label={`History chart with ${valid.length} fresh samples${valid.length ? `, from ${minimum} to ${maximum}` : ''}. Scroll to zoom, drag to pan, double-click to reset.`}
          className={zoomed ? 'can-pan' : undefined}
          onPointerDown={startPan}
          onPointerMove={movePointer}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onLostPointerCapture={endPan}
          onPointerLeave={() => setHovered(null)}
          onDoubleClick={() => {
            setHovered(null);
            setView({ start: fullStart, end: now });
          }}
        >
          {timeTicks.map(({ time, major }) => (
            <line
              key={time}
              data-time={major ? time : undefined}
              x1={x(time)}
              x2={x(time)}
              y1="10"
              y2="190"
              className={major ? 'history-grid-major' : 'history-grid-minor'}
            />
          ))}
          {valueTicks.map((value, index) => (
            <line
              key={index}
              x1="10"
              x2="790"
              y1={y(value)}
              y2={y(value)}
              className={
                index % 2 === 0
                  ? 'history-grid-horizontal'
                  : 'history-grid-minor'
              }
            />
          ))}
          {visible.map((item) => {
            const fresh = item.samples.filter(
              (sample) => sample.status === 'ok' && sample.value !== null,
            );
            return (
              <g key={item.label}>
                <path
                  d={pathFor(item.samples)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {fresh.length === 1 && (
                  <circle
                    cx={x(fresh[0].time)}
                    cy={y(fresh[0].value!)}
                    r="4"
                    fill={item.color}
                  />
                )}
              </g>
            );
          })}
          {hovered && (
            <>
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1="10"
                y2="190"
                className="history-hover-line"
              />
              {visible.map((item) => {
                const sample = item.samples.find(
                  (entry) => entry.time === hovered,
                );
                return sample?.status === 'ok' && sample.value !== null ? (
                  <circle
                    key={item.label}
                    cx={x(hovered)}
                    cy={y(sample.value)}
                    r="5"
                    fill={item.color}
                    stroke="white"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null;
              })}
            </>
          )}
        </svg>
        {hovered && (
          <div
            className="history-hover-tooltip"
            role="tooltip"
            style={{
              left: `${(x(hovered) / 800) * 100}%`,
              transform:
                x(hovered) > 400
                  ? 'translateX(calc(-100% - 16px))'
                  : 'translateX(16px)',
            }}
          >
            <time dateTime={new Date(hovered).toISOString()}>
              {new Date(hovered).toLocaleString()}
            </time>
            {visible.map((item) => {
              const sample = item.samples.find(
                (entry) => entry.time === hovered,
              );
              if (!sample) return null;
              return (
                <strong key={item.label} style={{ color: item.color }}>
                  {item.label}:{' '}
                  {sample.value === null
                    ? 'No data'
                    : `${sample.value.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${sample.unit || unit}`.trim()}
                  {sample.status && sample.status !== 'ok'
                    ? ` (${sample.status})`
                    : ''}
                </strong>
              );
            })}
          </div>
        )}
        {!valid.length && (
          <div className="history-plot-no-data">
            No fresh values in this view.
          </div>
        )}
      </div>
      <div className="history-plot-times">
        {timeTicks
          .filter(({ time, major }) => major && x(time) >= 55 && x(time) <= 745)
          .map(({ time }) => (
            <time
              key={time}
              dateTime={new Date(time).toISOString()}
              style={{ left: `${(x(time) / 800) * 100}%` }}
            >
              {timeGridLabel(time, duration)}
            </time>
          ))}
      </div>
      {series.length > 1 && (
        <div className="history-legend">
          {legendTitle && <h3>{legendTitle}</h3>}
          <div className="history-legend-items">
            {series.map((item) => (
              <span key={item.label} title={item.label}>
                <i style={{ background: item.color }} />
                {item.legendLabel}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryView({
  dashboards,
  version,
  jump,
}: {
  dashboards: Dashboard[];
  version: number;
  jump?: HistoryJump;
}) {
  const [mappedValues, setMappedValues] = useState<MappedValue[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void api<MappedValue[]>('/history/values', { signal: controller.signal })
      .then((values) => {
        if (!controller.signal.aborted) setMappedValues(values);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMappedValues([]);
      });
    return () => controller.abort();
  }, [version]);
  const options = useMemo(
    () => valuesFor(dashboards, mappedValues),
    [dashboards, mappedValues],
  );
  const [keys, setKeys] = useState<string[]>([]);
  const [anchorMs, setAnchorMs] = useState<number | null>(jump?.atMs ?? null);
  useEffect(() => {
    if (!jump) return;
    const deviceKey = JSON.stringify([jump.project, jump.deviceId]);
    const deviceOptions = options.filter(
      (option) => option.deviceKey === deviceKey,
    );
    const matchingUnit = deviceOptions.filter(
      (option) => option.unit === jump.unit,
    );
    const matchingPhase = matchingUnit.filter((option) =>
      option.sources.some((source) => {
        const binding = JSON.parse(source.key) as string[];
        return binding[3] === jump.phase;
      }),
    );
    setKeys(
      (matchingPhase.length
        ? matchingPhase
        : matchingUnit.length
          ? matchingUnit
          : deviceOptions
      )
        .slice(0, 8)
        .map((option) => option.key),
    );
    setAnchorMs(jump.atMs);
  }, [jump, options]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [pickerDeviceKey, setPickerDeviceKey] = useState<string | null>(null);
  const devices = useMemo(() => {
    const choices = new Map<
      string,
      { key: string; project: string; name: string; values: ValueOption[] }
    >();
    for (const option of options) {
      const device = choices.get(option.deviceKey) ?? {
        key: option.deviceKey,
        project: option.project,
        name: option.device,
        values: [],
      };
      device.values.push(option);
      choices.set(option.deviceKey, device);
    }
    return [...choices.values()].sort((a, b) =>
      `${a.project} ${a.name}`.localeCompare(`${b.project} ${b.name}`),
    );
  }, [options]);
  const pickerDevice = devices.find((device) => device.key === pickerDeviceKey);
  const selectedOptions = options.filter((option) => keys.includes(option.key));
  const selectedSources = selectedOptions.flatMap((option) => option.sources);
  const selectedSignature = selectedOptions
    .map((option) => option.key)
    .join('\u0000');
  const selectedLabel = selectedOptions
    .map((option) => option.label)
    .join(' + ');
  const singlePhaseGroup =
    selectedOptions.length === 1 && selectedSources.length > 1;
  const [minutes, setMinutes] = useState(60);
  const [retentionDays, setRetentionDays] = useState<number>();
  const [settingsError, setSettingsError] = useState('');
  const availablePeriods = periodOptions(retentionDays ?? 1);
  const selectedMinutes = Math.min(minutes, (retentionDays ?? 1) * 1440);
  const [result, setResult] = useState<Record<string, GraphSample[]>>();
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const plotKey = `${selectedSignature}:${selectedMinutes}:${loadedAt}`;
  const [reportView, setReportView] = useState<{
    key: string;
    start: number;
    end: number;
  }>();
  const onPlotViewChange = useCallback(
    (start: number, end: number) => setReportView({ key: plotKey, start, end }),
    [plotKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    setRetentionDays(undefined);
    setSettingsError('');
    void api<{ settings: { retentionDays: number } }>('/settings/collector', {
      signal: controller.signal,
    })
      .then(({ settings }) => {
        if (controller.signal.aborted) return;
        setRetentionDays(settings.retentionDays);
        setMinutes((current) =>
          Math.min(current, settings.retentionDays * 1440),
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setSettingsError(message(failure));
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    if (!selectedSources.length || retentionDays === undefined) {
      setResult(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(undefined);
    const end =
      anchorMs === null
        ? Date.now()
        : Math.min(Date.now(), anchorMs + selectedMinutes * 30_000);
    void Promise.all(
      selectedSources.map(async (source) => {
        const response = await api<HistoryResponse>(
          `${source.dashboardId ? `/dashboards/${source.dashboardId}/history` : '/history'}?minutes=${selectedMinutes}&key=${encodeURIComponent(source.key)}${anchorMs === null ? '' : `&end=${end}`}`,
          { signal: controller.signal },
        );
        if (
          source.dashboardId &&
          response.revision !== source.dashboardRevision
        )
          throw new Error(
            'The saved values changed. Reload to view the current history.',
          );
        return [source.key, response.samples[source.key] ?? []] as const;
      }),
    )
      .then((entries) => {
        if (controller.signal.aborted) return;
        setResult(Object.fromEntries(entries));
        setLoadedAt(end);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    selectedSignature,
    selectedMinutes,
    retentionDays,
    refresh,
    version,
    anchorMs,
  ]);

  const commonProject = selectedSources.every(
    (source) => source.project === selectedSources[0]?.project,
  );
  const commonDevice = selectedSources.every(
    (source) => source.device === selectedSources[0]?.device,
  );
  const commonValue = selectedSources.every(
    (source) =>
      source.value === selectedSources[0]?.value &&
      source.unit === selectedSources[0]?.unit,
  );
  const legendTitle = singlePhaseGroup
    ? undefined
    : commonProject && commonValue && selectedSources.length > 1
      ? `${selectedSources[0].project} · ${selectedSources[0].value}${selectedSources[0].unit ? ` (${selectedSources[0].unit})` : ''}`
      : commonProject && commonDevice && selectedSources.length > 1
        ? `${selectedSources[0].project} · ${selectedSources[0].device}`
        : undefined;
  const series = selectedSources.map((source, index) => ({
    label: singlePhaseGroup
      ? (source.label.split(' · ').at(-1) ?? source.label)
      : source.label,
    legendLabel: singlePhaseGroup
      ? (source.label.split(' · ').at(-1) ?? source.label)
      : commonProject && commonValue
        ? source.device
        : commonProject && commonDevice
          ? source.value
          : `${commonProject ? '' : `${source.project} · `}${source.device} · ${source.value}`,
    samples: result?.[source.key] ?? [],
    color:
      selectedSources.length > 1
        ? GRAPH_COLORS[index % GRAPH_COLORS.length]
        : '#28794f',
  }));
  const samples = series.flatMap((item) => item.samples);
  const rows = selectedSources
    .flatMap((source) =>
      (result?.[source.key] ?? []).map((sample) => ({
        sample,
        sourceLabel: singlePhaseGroup
          ? source.label.split(' · ').at(-1)
          : source.label,
      })),
    )
    .sort((a, b) => b.sample.time - a.sample.time)
    .slice(0, 100);
  const reportStart =
    reportView?.key === plotKey
      ? reportView.start
      : loadedAt - selectedMinutes * 60_000;
  const reportEnd = reportView?.key === plotKey ? reportView.end : loadedAt;
  const reportSeries = series.map((item) => ({
    ...item,
    samples: item.samples.filter(
      (sample) => sample.time >= reportStart && sample.time <= reportEnd,
    ),
  }));
  async function exportPdf() {
    if (!result || loading || !selectedSources.length) return;
    setExporting(true);
    setError('');
    try {
      await downloadHistoryPdf({
        filename: pdfTitle(selectedSources, new Date()),
        title:
          selectedOptions.length === 1
            ? selectedLabel
            : `${selectedOptions.length} selected values`,
        start: reportStart,
        end: reportEnd,
        series: reportSeries,
        chart: document.querySelector<SVGSVGElement>('.history-pdf-report svg'),
      });
    } catch (failure) {
      setError(`PDF export failed: ${message(failure)}`);
    } finally {
      setExporting(false);
    }
  }
  function downloadCsv() {
    if (!selectedSources.length) return;
    const csv = [
      'Sampled at,Value name,Value,Unit,Status,Source timestamp (ns)',
      ...selectedSources.flatMap((source) =>
        (result?.[source.key] ?? []).map((sample) =>
          [
            new Date(sample.time).toISOString(),
            JSON.stringify(
              singlePhaseGroup
                ? source.label.split(' · ').at(-1)
                : source.label,
            ),
            sample.value ?? '',
            JSON.stringify(sample.unit ?? source.unit),
            sample.status ?? '',
            sample.sourceTimestampNs ?? '',
          ].join(','),
        ),
      ),
    ].join('\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gridvis-value-history.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="event-history history-view" aria-label="Value history">
      <header className="event-history-header device-history-header">
        <div>
          <span className="eyebrow">HISTORY</span>
          <h1>Value history</h1>
        </div>
        <div className="event-history-actions device-history-actions">
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={!selectedSources.length || loading}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!samples.length}
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={!result || loading || exporting || !samples.length}
          >
            {exporting ? 'Exporting PDF…' : 'Export PDF'}
          </button>
        </div>
      </header>
      <div className="history-panel">
        {anchorMs !== null && (
          <div className="history-event-context">
            <span>
              Showing values around {new Date(anchorMs).toLocaleString()}
            </span>
            <button type="button" onClick={() => setAnchorMs(null)}>
              Back to latest
            </button>
          </div>
        )}
        {jump && anchorMs !== null && selectedOptions.length === 0 && (
          <p className="muted">
            No saved dashboard values match this device. Choose values to
            inspect another measurement.
          </p>
        )}
        <div className="history-controls">
          <div className="history-value-control">
            <span>Values</span>
            <button
              type="button"
              onClick={() => {
                setDraftKeys(selectedOptions.map((option) => option.key));
                setPickerDeviceKey(null);
                setPickerOpen(true);
              }}
              disabled={!options.length}
            >
              Choose values ({selectedOptions.length})
            </button>
          </div>
          <label>
            Period
            <select
              aria-label="Period"
              value={selectedMinutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              disabled={retentionDays === undefined}
            >
              {availablePeriods.map((period) => (
                <option key={period.minutes} value={period.minutes}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!dashboards.length ? (
          <p>
            No dashboards yet. Create one and add measurement values to start
            collecting history.
          </p>
        ) : !options.length ? (
          <p>No saved dashboards contain measurement values yet.</p>
        ) : null}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {settingsError && (
          <div className="notice error" role="alert">
            Collector settings could not be loaded: {settingsError}
          </div>
        )}
        {loading && <p role="status">Loading history…</p>}
        {result && selectedSources.length > 0 && (
          <>
            <h2>
              {selectedOptions.length === 1
                ? selectedLabel
                : `${selectedOptions.length} selected values`}
            </h2>
            <p className="muted">
              {samples.length.toLocaleString()} samples ·{' '}
              {[
                ...new Set(
                  selectedSources.map((source) => source.unit || 'No unit'),
                ),
              ].join(', ')}{' '}
              · {anchorMs === null ? 'Updated' : 'Window ends'}{' '}
              {new Date(loadedAt).toLocaleString()}
            </p>
            <HistoryPlot
              key={plotKey}
              series={series}
              legendTitle={legendTitle}
              minutes={selectedMinutes}
              now={loadedAt}
              unit={selectedSources[0].unit}
              onViewChange={onPlotViewChange}
            />
            <h2>Recent samples</h2>
            {rows.length ? (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Sampled at</th>
                      {selectedSources.length > 1 && (
                        <th>{singlePhaseGroup ? 'Phase' : 'Value name'}</th>
                      )}
                      <th>Value</th>
                      <th>Status</th>
                      <th>Source timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ sample, sourceLabel }, index) => (
                      <tr key={`${sample.time}-${sourceLabel}-${index}`}>
                        <td>{new Date(sample.time).toLocaleString()}</td>
                        {selectedSources.length > 1 && <td>{sourceLabel}</td>}
                        <td>
                          {sample.value === null
                            ? '—'
                            : `${sample.value.toLocaleString('en-GB')} ${sample.unit || ''}`}
                        </td>
                        <td>{sample.status ?? 'ok'}</td>
                        <td>{sample.sourceTimestampNs ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                No samples in this period. The collector records mapped device
                and saved dashboard values while the backend is running.
              </p>
            )}
          </>
        )}
      </div>
      {result && !loading && selectedSources.length > 0 && (
        <HistoryPdfReport
          title={
            selectedOptions.length === 1
              ? selectedLabel
              : `${selectedOptions.length} selected values`
          }
          series={reportSeries}
          start={reportStart}
          end={reportEnd}
        />
      )}
      {pickerOpen && (
        <Modal
          labelledBy="history-values-title"
          onClose={() => setPickerOpen(false)}
          className="source-settings-shell"
        >
          <section className="modal source-settings-modal">
            <span className="eyebrow">VALUE HISTORY</span>
            <h2 id="history-values-title">Choose values</h2>
            {pickerDevice ? (
              <div className="history-picker-step">
                <button type="button" onClick={() => setPickerDeviceKey(null)}>
                  ← Devices
                </button>
                <p className="muted">
                  {pickerDevice.project} · {pickerDevice.name}
                </p>
              </div>
            ) : (
              <p className="muted">
                Choose a device to see its saved values. You can return here to
                select values from another device.
              </p>
            )}
            <div className="source-settings-table-wrap history-picker-table-wrap">
              <table
                className="history-picker-table"
                aria-label={
                  pickerDevice
                    ? `Values for ${pickerDevice.name}`
                    : 'Devices with history'
                }
              >
                <thead>
                  {pickerDevice ? (
                    <tr>
                      <th scope="col">Select</th>
                      <th scope="col">Value</th>
                      <th scope="col">Unit</th>
                    </tr>
                  ) : (
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Device</th>
                      <th scope="col">Values</th>
                      <th scope="col">Selected</th>
                      <th scope="col">Action</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {pickerDevice
                    ? pickerDevice.values.map((option) => (
                        <tr key={option.key}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${option.label}`}
                              checked={draftKeys.includes(option.key)}
                              onChange={(event) =>
                                setDraftKeys((current) =>
                                  event.target.checked
                                    ? [...current, option.key]
                                    : current.filter(
                                        (key) => key !== option.key,
                                      ),
                                )
                              }
                            />
                          </td>
                          <td>{option.value}</td>
                          <td>{option.unit || '—'}</td>
                        </tr>
                      ))
                    : devices.map((device) => (
                        <tr key={device.key}>
                          <td>{device.project}</td>
                          <td>{device.name}</td>
                          <td>{device.values.length}</td>
                          <td>
                            {
                              device.values.filter((value) =>
                                draftKeys.includes(value.key),
                              ).length
                            }
                          </td>
                          <td>
                            <button
                              type="button"
                              aria-label={`Choose values for ${device.project} · ${device.name}`}
                              onClick={() => setPickerDeviceKey(device.key)}
                            >
                              Choose values
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <span className="history-picker-count">
                {draftKeys.length} selected
              </span>
              <button
                type="button"
                onClick={() => setDraftKeys([])}
                disabled={!draftKeys.length}
              >
                Clear selection
              </button>
              <button type="button" onClick={() => setPickerOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!draftKeys.length}
                onClick={() => {
                  setKeys(draftKeys);
                  setPickerOpen(false);
                }}
              >
                Show {draftKeys.length}{' '}
                {draftKeys.length === 1 ? 'value' : 'values'}
              </button>
            </div>
          </section>
        </Modal>
      )}
    </section>
  );
}
