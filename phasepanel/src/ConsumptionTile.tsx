import { newId } from '../shared/id.js';
import { useEffect, useState } from 'react';
import {
  bindingKey,
  consumptionTileSchema,
  type ConsumptionTile,
  type DashboardGroup,
  type Device,
  type Measurement,
  type Project,
  type TotalSource,
} from '../shared/model';
import { api, message } from './api';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';

type Result = {
  revision: number;
  sourceRevision: number;
  value: number | null;
  unit: string;
  partial: boolean;
  reset: boolean;
  stale: boolean;
  baselineTime: number | null;
  lastTime: number | null;
  buckets: {
    start: number;
    value: number | null;
    partial: boolean;
    reset: boolean;
  }[];
};

export function periodStart(period: ConsumptionTile['period'], now: number) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (period === 'week')
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (period === 'month') date.setDate(1);
  return date.getTime();
}

export function periodBuckets(period: ConsumptionTile['period'], now: number) {
  const starts: number[] = [];
  const date = new Date(periodStart(period, now));
  while (date.getTime() <= now && starts.length < 32) {
    starts.push(date.getTime());
    if (period === 'day') date.setHours(date.getHours() + 1);
    else date.setDate(date.getDate() + 1);
  }
  return starts;
}

function chartBuckets(period: ConsumptionTile['period'], now: number) {
  const starts: number[] = [];
  const date = new Date(periodStart(period, now));
  const end = new Date(date);
  if (period === 'day') end.setDate(end.getDate() + 1);
  else if (period === 'week') end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  while (date < end) {
    starts.push(date.getTime());
    if (period === 'day') date.setHours(date.getHours() + 1);
    else date.setDate(date.getDate() + 1);
  }
  return starts;
}

export function ConsumptionTileEditor({
  initial,
  groups,
  defaultProject,
  onSave,
  onClose,
}: {
  initial?: ConsumptionTile;
  groups: DashboardGroup[];
  defaultProject?: string;
  onSave: (tile: ConsumptionTile) => void;
  onClose: () => void;
}) {
  const [id] = useState(initial?.id ?? newId());
  const [project, setProject] = useState('');
  const [device, setDevice] = useState('');
  const [sources, setSources] = useState<TotalSource[]>(
    initial?.sources ??
      (initial
        ? [
            {
              binding: initial.binding,
              deviceName: initial.deviceName,
              label: initial.label,
              unit: initial.unit,
            },
          ]
        : []),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [label, setLabel] = useState(initial?.label ?? 'Energy consumption');
  const [period, setPeriod] = useState<ConsumptionTile['period']>(
    initial?.period ?? 'day',
  );
  const [decimals, setDecimals] = useState(initial?.decimals ?? 2);
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [valueFilter, setValueFilter] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError('');
    async function discover() {
      if (!project) {
        const found = await api<Project[]>('/projects', {
          signal: controller.signal,
        });
        setProjects(found);
        const preferred = initial?.binding.project ?? defaultProject;
        setProject(
          found.find((item) => item.name === preferred)?.name ??
            found[0]?.name ??
            '',
        );
      } else if (!device)
        setDevices(
          await api<Device[]>(`/devices?${new URLSearchParams({ project })}`, {
            signal: controller.signal,
          }),
        );
      else
        setMeasurements(
          await api<Measurement[]>(
            `/measurements?${new URLSearchParams({ project, device })}`,
            { signal: controller.signal },
          ),
        );
    }
    void discover()
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [project, device, retry]);
  const energyMeasurements = measurements.filter((item) =>
    /^(?:[kMGT]?Wh)$/i.test(item.unit),
  );
  const filtered = energyMeasurements.filter((item) =>
    `${item.label} ${item.measurement} ${item.channelLabel} ${item.channel} ${item.unit}`
      .toLowerCase()
      .includes(valueFilter.toLowerCase()),
  );
  const shown = filtered.slice(0, 120);
  const selectedKeys = new Set(
    sources.map((source) => bindingKey(source.binding)),
  );
  const deviceName = devices.find((item) => item.id === device)?.name ?? device;
  function sourceFor(item: Measurement): TotalSource {
    return {
      binding: {
        project,
        deviceId: device,
        measurement: item.measurement,
        channel: item.channel,
      },
      deviceName,
      label: `${item.label} · ${item.channelLabel}`.slice(0, 100),
      unit: item.unit,
    };
  }
  const parsed = consumptionTileSchema.safeParse({
    id,
    kind: 'consumption',
    ...(groupId ? { groupId } : {}),
    label,
    period,
    decimals,
    backgroundColor,
    binding: sources[0]?.binding,
    deviceName: sources[0]?.deviceName,
    sources,
    unit: sources[0]?.unit,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 4,
    h: initial?.h ?? 3,
  });
  return (
    <Modal onClose={onClose} labelledBy="consumption-tile-title">
      <section className="modal content-editor-modal graph-editor-modal">
        <div className="modal-heading">
          <h2 id="consumption-tile-title">
            {initial ? 'Edit consumption tile' : 'Add consumption tile'}
          </h2>
          <button aria-label="Close consumption editor" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed.success) onSave(parsed.data);
          }}
        >
          <div className="editor-content">
            <section
              className="editor-section"
              aria-labelledby="consumption-details-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="consumption-details-title">Consumption details</h3>
                  <p>
                    Choose a title and the calendar period shown in the bar
                    chart.
                  </p>
                </div>
              </div>
              <TileBackgroundColor
                value={backgroundColor}
                onChange={setBackgroundColor}
              />
              <label>
                Title
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <div className="editor-fields three-columns">
                <label>
                  Period
                  <select
                    value={period}
                    onChange={(event) =>
                      setPeriod(event.target.value as ConsumptionTile['period'])
                    }
                  >
                    <option value="day">Current day</option>
                    <option value="week">Current ISO week</option>
                    <option value="month">Current month</option>
                  </select>
                </label>
                <label>
                  Decimal places
                  <select
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Number(event.target.value))
                    }
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                {groups.length > 0 && (
                  <label>
                    Group
                    <select
                      value={groupId}
                      onChange={(event) => setGroupId(event.target.value)}
                    >
                      <option value="">Ungrouped</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </section>
            <section
              className="editor-section"
              aria-labelledby="consumption-selected-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="consumption-selected-title">Selected meters</h3>
                  <p>
                    Consumption from these cumulative energy counters is added
                    in kWh.
                  </p>
                </div>
                <span className="editor-count">{sources.length} / 12</span>
              </div>
              <fieldset className="display-settings total-sources editor-inner-fieldset">
                <legend>Meters in this tile ({sources.length}/12)</legend>
                {sources.length === 0 && (
                  <p className="muted">Choose a meter below to start.</p>
                )}
                {sources.map((source) => (
                  <div
                    className="total-source"
                    key={bindingKey(source.binding)}
                  >
                    <span>
                      <strong>
                        {source.deviceName || source.binding.deviceId}
                      </strong>
                      <small>
                        {source.label} · {source.binding.project} ·{' '}
                        {source.unit}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={
                        'Remove source ' +
                        source.label +
                        ' from ' +
                        source.deviceName
                      }
                      onClick={() =>
                        setSources((current) =>
                          current.filter(
                            (item) =>
                              bindingKey(item.binding) !==
                              bindingKey(source.binding),
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </fieldset>
            </section>
            <section
              className="editor-section"
              aria-labelledby="consumption-add-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="consumption-add-title">Add meters</h3>
                  <p>
                    Choose a device and select cumulative energy readings. Wh
                    and larger units are converted to kWh.
                  </p>
                </div>
              </div>
              <div className="graph-device-picker">
                <div className="form-row">
                  <label>
                    Project
                    <select
                      value={project}
                      onChange={(event) => {
                        if (event.target.value === project) return;
                        setProject(event.target.value);
                        setDevice('');
                        setDevices([]);
                        setMeasurements([]);
                      }}
                    >
                      <option value="">Select a project</option>
                      {projects.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Device
                    <select
                      value={device}
                      disabled={!project}
                      onChange={(event) => {
                        setDevice(event.target.value);
                        setMeasurements([]);
                      }}
                    >
                      <option value="">Select a device</option>
                      {devices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.model}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {pending && <p role="status">Loading measurements…</p>}
                {error && (
                  <div className="field-error" role="alert">
                    {error}{' '}
                    <button
                      type="button"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      Retry discovery
                    </button>
                  </div>
                )}
                {device && !pending && !error && (
                  <>
                    <label>
                      Filter values
                      <input
                        value={valueFilter}
                        onChange={(event) => setValueFilter(event.target.value)}
                        placeholder="Measurement, channel or unit"
                      />
                    </label>
                    <fieldset className="bulk-values graph-available-values">
                      <legend>Available energy values</legend>
                      {filtered.length > shown.length && (
                        <p className="muted">
                          Showing the first {shown.length} of {filtered.length}{' '}
                          values. Filter to find more.
                        </p>
                      )}
                      <div className="graph-value-grid">
                        {shown.map((item) => {
                          const source = sourceFor(item);
                          const key = bindingKey(source.binding);
                          const checked = selectedKeys.has(key);
                          return (
                            <label className="graph-value-choice" key={key}>
                              <input
                                type="checkbox"
                                aria-label={
                                  item.label +
                                  ' · ' +
                                  item.channelLabel +
                                  ' (' +
                                  item.unit +
                                  ')'
                                }
                                checked={checked}
                                disabled={!checked && sources.length >= 12}
                                onChange={() =>
                                  setSources((current) =>
                                    checked
                                      ? current.filter(
                                          (entry) =>
                                            bindingKey(entry.binding) !== key,
                                        )
                                      : [...current, source],
                                  )
                                }
                              />
                              <span>
                                <strong>{item.label}</strong>
                                <small>
                                  {item.channelLabel} · {item.unit}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {energyMeasurements.length === 0 && (
                        <p className="muted">
                          This device has no cumulative energy readings in Wh,
                          kWh, MWh, GWh, or TWh.
                        </p>
                      )}
                      {energyMeasurements.length > 0 &&
                        filtered.length === 0 && (
                          <p className="muted">
                            No energy readings match this filter.
                          </p>
                        )}
                    </fieldset>
                  </>
                )}
              </div>
              <p className="muted">
                Each meter needs enough stored readings to calculate consumption
                for a period.
              </p>
            </section>
          </div>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!parsed.success}
            >
              {initial ? 'Apply consumption changes' : 'Add consumption tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}

export function ConsumptionTileView({
  widget,
  dashboardId,
  dashboardRevision,
  sourceRevision,
  ready,
  now,
  editing,
  onEdit,
  onRemove,
}: {
  widget: ConsumptionTile;
  dashboardId: string;
  dashboardRevision: number;
  sourceRevision?: number;
  ready: boolean;
  now: number;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const start = periodStart(widget.period, now);
  const bucketStarts = periodBuckets(widget.period, now);
  const bucketQuery = bucketStarts.join(',');
  useEffect(() => {
    setResult(undefined);
    setError('');
    if (!ready) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const next = await api<Result>(
          `/dashboards/${dashboardId}/consumption/${widget.id}?${new URLSearchParams({ start: String(start), buckets: bucketQuery })}`,
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted &&
          next.revision === dashboardRevision &&
          (sourceRevision === undefined ||
            next.sourceRevision === sourceRevision)
        ) {
          setResult(next);
          setError('');
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    dashboardId,
    dashboardRevision,
    sourceRevision,
    widget.id,
    start,
    bucketQuery,
    ready,
  ]);
  const byStart = new Map(
    result?.buckets?.map((bar) => [bar.start, bar]) ?? [],
  );
  const bars = chartBuckets(widget.period, now).map(
    (time) =>
      byStart.get(time) ?? {
        start: time,
        value: null,
        partial: false,
        reset: false,
      },
  );
  const maximum = Math.max(0, ...bars.map((bar) => bar.value ?? 0));
  const status =
    (!ready && 'Save the dashboard to start collecting energy.') ||
    error ||
    (result?.reset
      ? 'Meter counter reset during this period.'
      : result?.value === null
        ? 'Waiting for readings from every meter.'
        : [
            result?.partial &&
              `Partial period: readings begin ${new Date(result.baselineTime!).toLocaleString()}.`,
            result?.stale && 'Latest reading is old.',
          ]
            .filter(Boolean)
            .join(' · '));
  return (
    <article
      className={`metric-tile consumption-tile ${widget.w < 3 || widget.h < 3 ? 'compact-tile' : ''}`}
      style={{ backgroundColor: widget.backgroundColor }}
    >
      <div className="tile-top">
        <span className="tile-device">
          {(widget.sources?.length ?? 1) > 1
            ? `${widget.sources!.length} METERS`
            : widget.deviceName}
        </span>
        <span className="tile-device">
          {widget.period === 'week'
            ? 'THIS WEEK'
            : widget.period === 'month'
              ? 'THIS MONTH'
              : 'TODAY'}
        </span>
      </div>
      <h2 className={editing ? 'drag-handle' : undefined}>
        {editing && <span aria-hidden="true">⠿ </span>}
        {widget.label}
      </h2>
      <div className="measurement">
        <span className="numeric">
          {result?.value === null || result === undefined
            ? '—'
            : result.value.toLocaleString(undefined, {
                minimumFractionDigits: widget.decimals,
                maximumFractionDigits: widget.decimals,
              })}
        </span>
        <span className="unit">kWh</span>
      </div>
      <div
        className="consumption-chart"
        role="img"
        aria-label={`${widget.label} by ${widget.period === 'day' ? 'hour' : 'day'} in kWh`}
      >
        {bars.map((bar, index) => {
          const date = new Date(bar.start);
          const label =
            widget.period === 'day'
              ? `${String(date.getHours()).padStart(2, '0')}:00`
              : widget.period === 'week'
                ? date.toLocaleDateString(undefined, { weekday: 'short' })
                : String(date.getDate());
          const showLabel =
            widget.period === 'week' ||
            (widget.period === 'day'
              ? date.getHours() % 3 === 0
              : date.getDate() === 1 || date.getDate() % 5 === 0);
          const title = `${date.toLocaleString()}: ${bar.start > now ? 'Upcoming' : bar.value === null ? 'No complete reading' : `${bar.value.toLocaleString(undefined, { maximumFractionDigits: widget.decimals })} kWh`}${bar.partial ? ' (partial)' : ''}${bar.reset ? ' (counter reset)' : ''}`;
          return (
            <div
              className="consumption-bar-slot"
              key={`${bar.start}-${index}`}
              title={title}
            >
              <div className="consumption-bar-track">
                <div
                  className={`consumption-bar ${bar.value === null ? 'missing' : bar.value > 0 ? 'has-value' : ''}`}
                  style={{
                    height:
                      bar.value === null
                        ? '3px'
                        : `${Math.max(4, maximum > 0 ? (bar.value / maximum) * 100 : 0)}%`,
                  }}
                >
                  {bar.value !== null && bar.value > 0 && (
                    <span className="consumption-bar-value">
                      {bar.value.toLocaleString(undefined, {
                        maximumFractionDigits: widget.decimals,
                      })}{' '}
                      kWh
                    </span>
                  )}
                </div>
              </div>
              <span>{showLabel ? label : '\u00a0'}</span>
            </div>
          );
        })}
      </div>
      <div className="tile-bottom">
        <span>{status || `Since ${new Date(start).toLocaleDateString()}`}</span>
        <span>
          {result?.lastTime
            ? new Date(result.lastTime).toLocaleTimeString()
            : ''}
        </span>
      </div>
      {editing && (
        <div className="tile-controls">
          <button aria-label={`Edit ${widget.label}`} onClick={onEdit}>
            Configure
          </button>
          <button aria-label={`Remove ${widget.label}`} onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </article>
  );
}
