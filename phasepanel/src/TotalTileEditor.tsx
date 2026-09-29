import { newId } from '../shared/id.js';
import { useEffect, useState } from 'react';
import {
  bindingKey,
  totalTileSchema,
  type DashboardGroup,
  type DashboardTile,
  type Device,
  type Measurement,
  type Project,
  type TotalSource,
  type TotalTile,
} from '../shared/model';
import { measurementSources } from '../shared/totals';
import { api, message } from './api';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';

export function TotalTileEditor({
  initial,
  widgets,
  groups,
  defaultProject,
  onSave,
  onClose,
}: {
  initial?: TotalTile;
  widgets: DashboardTile[];
  groups: DashboardGroup[];
  defaultProject?: string;
  onSave: (tile: TotalTile) => void;
  onClose: () => void;
}) {
  const [id] = useState(initial?.id ?? newId());
  const [label, setLabel] = useState(initial?.label ?? 'Total');
  const [sources, setSources] = useState<TotalSource[]>(initial?.sources ?? []);
  const [decimals, setDecimals] = useState(initial?.decimals ?? 1);
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const [project, setProject] = useState('');
  const [device, setDevice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState(true);
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
        const preferred =
          initial?.sources[0]?.binding.project ?? defaultProject;
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
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [project, device, retry]);
  const existing = [
    ...new Map(
      widgets.flatMap(measurementSources).map((source) => [
        bindingKey(source.binding),
        {
          binding: source.binding,
          label: source.label,
          deviceName: source.deviceName,
          unit: source.unit,
        },
      ]),
    ).values(),
  ];
  const unit = sources[0]?.unit ?? '';
  const available = [
    ...new Map(
      measurements.map((m) => [JSON.stringify([m.measurement, m.channel]), m]),
    ).values(),
  ];
  const matching = available.filter((item) =>
    `${item.label} ${item.measurement} ${item.channelLabel} ${item.channel} ${item.unit}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const visible = matching.slice(0, 200);
  const selected = new Set(sources.map((source) => bindingKey(source.binding)));
  function canAdd(source: TotalSource) {
    return (
      sources.length < 50 &&
      !selected.has(bindingKey(source.binding)) &&
      (!sources.length || source.unit === unit)
    );
  }
  function add(source: TotalSource) {
    if (canAdd(source)) setSources((current) => [...current, source]);
  }
  const parsed = totalTileSchema.safeParse({
    ...initial,
    id,
    kind: 'total',
    label,
    sources,
    unit,
    decimals,
    groupId: groupId || undefined,
    backgroundColor,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 4,
    h: initial?.h ?? 3,
  });
  return (
    <Modal onClose={onClose} labelledBy="total-tile-title">
      <section className="modal">
        <div className="modal-heading">
          <h2 id="total-tile-title">
            {initial ? 'Edit total tile' : 'Add total tile'}
          </h2>
          <button aria-label="Close total editor" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          Add two or more measurements with the same unit. The total updates
          with live readings. If inputs are missing, available values are added
          and the tile shows a warning.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success) onSave(parsed.data);
          }}
        >
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
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <fieldset className="display-settings total-sources">
            <legend>Values in this total ({sources.length}/50)</legend>
            {sources.length === 0 && (
              <p className="muted">Choose values below to build the total.</p>
            )}
            {sources.map((source, index) => (
              <div className="total-source" key={bindingKey(source.binding)}>
                <span>
                  <strong>
                    {index > 0 ? '+ ' : ''}
                    {source.label}
                  </strong>
                  <small>
                    {source.deviceName} · {source.binding.project} ·{' '}
                    {source.unit || 'no unit'}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`Remove source ${source.label}`}
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
            {sources.length > 0 && (
              <p className="muted">
                Result unit: {unit || 'no unit'}. Select at least two values.
              </p>
            )}
          </fieldset>
          {existing.length > 0 && (
            <label>
              Add a dashboard value
              <select
                value=""
                onChange={(e) => {
                  const source = existing.find(
                    (item) => bindingKey(item.binding) === e.target.value,
                  );
                  if (source) add(source);
                }}
              >
                <option value="">Choose an existing value</option>
                {existing.map((source) => (
                  <option
                    key={bindingKey(source.binding)}
                    value={bindingKey(source.binding)}
                    disabled={!canAdd(source)}
                  >
                    {source.label} · {source.deviceName} (
                    {source.unit || 'no unit'})
                  </option>
                ))}
              </select>
            </label>
          )}
          <details
            className="dashboard-settings-disclosure"
            open={existing.length === 0 ? true : undefined}
          >
            <summary>Choose values from a device</summary>
            <label>
              Project
              <select
                value={project}
                onChange={(e) => {
                  if (e.target.value === project) return;
                  setProject(e.target.value);
                  setDevice('');
                  setDevices([]);
                  setMeasurements([]);
                  setFilter('');
                }}
              >
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <label>
              Device
              <select
                value={device}
                disabled={!project}
                onChange={(e) => {
                  setDevice(e.target.value);
                  setMeasurements([]);
                  setFilter('');
                }}
              >
                <option value="">Select a device</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.model}
                  </option>
                ))}
              </select>
            </label>
            {pending && <p role="status">Loading measurements…</p>}
            {error && (
              <div className="field-error" role="alert">
                {error}{' '}
                <button type="button" onClick={() => setRetry((n) => n + 1)}>
                  Retry discovery
                </button>
              </div>
            )}
            {device && !pending && !error && (
              <>
                <label>
                  Filter values
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Measurement, phase or unit"
                  />
                </label>
                <fieldset className="bulk-values">
                  <legend>Available values</legend>
                  {matching.length > visible.length && (
                    <p className="muted">
                      Showing the first {visible.length} of {matching.length}{' '}
                      values. Filter to find more.
                    </p>
                  )}
                  {visible.map((m) => {
                    const source: TotalSource = {
                      binding: {
                        project,
                        deviceId: device,
                        measurement: m.measurement,
                        channel: m.channel,
                      },
                      deviceName:
                        devices.find((d) => d.id === device)?.name ?? device,
                      label: `${m.label} · ${m.channelLabel}`.slice(0, 100),
                      unit: m.unit,
                    };
                    const checked = selected.has(bindingKey(source.binding));
                    return (
                      <label
                        className="checkbox-label"
                        key={bindingKey(source.binding)}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && !canAdd(source)}
                          onChange={(e) =>
                            e.target.checked
                              ? add(source)
                              : setSources((current) =>
                                  current.filter(
                                    (item) =>
                                      bindingKey(item.binding) !==
                                      bindingKey(source.binding),
                                  ),
                                )
                          }
                        />
                        {source.label} ({m.unit || 'no unit'})
                      </label>
                    );
                  })}
                  {available.length === 0 && (
                    <p className="muted">No measurements available.</p>
                  )}
                </fieldset>
              </>
            )}
          </details>
          <p className="muted">
            Values with different units are disabled. You can combine values
            from multiple devices. Source tiles do not need to stay on the
            dashboard.
          </p>
          <div className="form-row">
            <label>
              Decimal places
              <select
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Group
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">Ungrouped</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!parsed.success}
            >
              {initial ? 'Apply total changes' : 'Add total tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
