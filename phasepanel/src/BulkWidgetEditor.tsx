import { newId } from '../shared/id.js';
import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';
import {
  bindingKey,
  isMeasurementTile,
  type DashboardTile,
  type DashboardGroup,
  type Device,
  type Measurement,
  type MeasurementDefaults,
  type Project,
  type Widget,
} from '../shared/model';
import { defaultsForMeasurement } from '../shared/range';

export function BulkWidgetEditor({
  widgets,
  groups,
  measurementDefaults,
  defaultGroupId,
  defaultProject,
  onSave,
  onClose,
}: {
  widgets: DashboardTile[];
  groups: DashboardGroup[];
  measurementDefaults: MeasurementDefaults[];
  defaultGroupId?: string;
  defaultProject?: string;
  onSave: (widgets: Widget[]) => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [project, setProject] = useState('');
  const [device, setDevice] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [display, setDisplay] = useState<'number' | 'gauge'>('number');
  const [decimals, setDecimals] = useState(1);
  const [scaleMin, setScaleMin] = useState('0');
  const [scaleMax, setScaleMax] = useState('100');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);
  // One discovery chain at a time; changing source aborts the previous request.
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setPending(true);
    async function discover() {
      if (!project) {
        const found = await api<Project[]>('/projects', {
          signal: controller.signal,
        });
        setProjects(found);
        setProject(
          found.find((item) => item.name === defaultProject)?.name ??
            found[0]?.name ??
            '',
        );
      } else if (!device)
        setDevices(
          await api<Device[]>(`/devices?${new URLSearchParams({ project })}`, {
            signal: controller.signal,
          }),
        );
      else {
        const found = await api<Measurement[]>(
          `/measurements?${new URLSearchParams({ project, device })}`,
          { signal: controller.signal },
        );
        setMeasurements([
          ...new Map(
            found.map((m) => [JSON.stringify([m.measurement, m.channel]), m]),
          ).values(),
        ]);
      }
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
  const key = (m: Measurement) =>
    bindingKey({
      project,
      deviceId: device,
      measurement: m.measurement,
      channel: m.channel,
    });
  const existing = new Set(
    widgets.filter(isMeasurementTile).map((w) => bindingKey(w.binding)),
  );
  const available = measurements.filter((m) => !existing.has(key(m)));
  const chosen = available.filter((m) => selected.includes(key(m)));
  const matching = measurements.filter((m) =>
    `${m.label} ${m.measurement} ${m.channelLabel} ${m.channel} ${m.unit}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const visible = matching.slice(0, 200);
  const remaining = 100 - widgets.length;
  const needsScale =
    display === 'gauge' &&
    chosen.some(
      (m) =>
        !defaultsForMeasurement(measurementDefaults, m.measurement, m.unit),
    );
  const validScale =
    scaleMin.trim() !== '' &&
    scaleMax.trim() !== '' &&
    Number.isFinite(Number(scaleMin)) &&
    Number.isFinite(Number(scaleMax)) &&
    Number(scaleMin) < Number(scaleMax) &&
    Number.isFinite(Number(scaleMax) - Number(scaleMin));
  const canAdd =
    !pending &&
    !error &&
    chosen.length > 0 &&
    chosen.length <= remaining &&
    (!needsScale || validScale);
  return (
    <Modal onClose={onClose} labelledBy="bulk-title">
      <section className="modal">
        <div className="modal-heading">
          <h2 id="bulk-title">Add multiple values</h2>
          <button aria-label="Close multiple value picker" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          Select measurements and phases from one device. Each selection becomes
          a separate tile.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}{' '}
            <button onClick={() => setRetry((n) => n + 1)}>
              Retry discovery
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd) return;
            onSave(
              chosen.map((m) => ({
                id: newId(),
                binding: {
                  project,
                  deviceId: device,
                  measurement: m.measurement,
                  channel: m.channel,
                },
                label: `${m.label} · ${m.channelLabel}`.slice(0, 100),
                measurementLabel: m.label.slice(0, 200),
                deviceName:
                  devices.find((d) => d.id === device)?.name ?? device,
                unit: m.unit,
                ...(groupId ? { groupId } : {}),
                display,
                decimals,
                normalColor: '#32a852',
                useDashboardDefaults: true,
                ...(display === 'gauge'
                  ? {
                      scale: defaultsForMeasurement(
                        measurementDefaults,
                        m.measurement,
                        m.unit,
                      )?.scale ?? {
                        min: Number(scaleMin),
                        max: Number(scaleMax),
                      },
                    }
                  : {}),
                x: 0,
                y: 0,
                w: 4,
                h: 3,
              })),
            );
          }}
        >
          <label>
            Project
            <select
              autoFocus
              required
              value={project}
              onChange={(e) => {
                if (e.target.value === project) return;
                setProject(e.target.value);
                setDevice('');
                setDevices([]);
                setMeasurements([]);
                setSelected([]);
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
              required
              disabled={!project}
              value={device}
              onChange={(e) => {
                setDevice(e.target.value);
                setMeasurements([]);
                setSelected([]);
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
          {pending && <p role="status">Loading discovery…</p>}
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
              <div className="bulk-actions">
                <button
                  type="button"
                  onClick={() =>
                    setSelected([
                      ...new Set([
                        ...selected,
                        ...visible
                          .filter((m) => !existing.has(key(m)))
                          .map(key),
                      ]),
                    ])
                  }
                >
                  Select all shown
                </button>
                <button type="button" onClick={() => setSelected([])}>
                  Clear selection
                </button>
              </div>
              <fieldset className="bulk-values">
                <legend>Available values</legend>
                {matching.length > visible.length && (
                  <p className="muted">
                    Showing the first {visible.length} of {matching.length}{' '}
                    values. Filter to find more.
                  </p>
                )}
                {visible.map((m) => (
                  <label className="checkbox-label" key={key(m)}>
                    <input
                      type="checkbox"
                      disabled={existing.has(key(m))}
                      checked={selected.includes(key(m))}
                      onChange={(e) =>
                        setSelected((items) =>
                          e.target.checked
                            ? [...items, key(m)]
                            : items.filter((item) => item !== key(m)),
                        )
                      }
                    />
                    {m.label} · {m.channelLabel} ({m.unit || 'no unit'})
                    {existing.has(key(m)) ? ' — already on dashboard' : ''}
                  </label>
                ))}
                {visible.length === 0 && (
                  <p className="muted">No matching values.</p>
                )}
              </fieldset>
            </>
          )}
          <p role="status">
            {chosen.length} selected · {remaining} tile slots available
          </p>
          {chosen.length > remaining && (
            <p className="field-error" role="alert">
              A dashboard supports up to 100 tiles. Select fewer values.
            </p>
          )}
          {groups.length > 0 && (
            <label>
              Group
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Display type
            <select
              value={display}
              onChange={(e) => setDisplay(e.target.value as 'number' | 'gauge')}
            >
              <option value="number">Number</option>
              <option value="gauge">Semicircular gauge</option>
            </select>
          </label>
          <label>
            Default decimal places
            <select
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Each value inherits its measurement’s shared scale, alarm limits,
            normal color and decimal places when configured. You can customize
            individual tiles after adding them.
          </p>
          {needsScale && (
            <fieldset className="display-settings">
              <legend>Scale for measurements without shared settings</legend>
              <div className="form-row">
                <label>
                  Scale minimum
                  <input
                    type="number"
                    step="any"
                    required
                    value={scaleMin}
                    onChange={(e) => setScaleMin(e.target.value)}
                  />
                </label>
                <label>
                  Scale maximum
                  <input
                    type="number"
                    step="any"
                    required
                    value={scaleMax}
                    onChange={(e) => setScaleMax(e.target.value)}
                  />
                </label>
              </div>
              {!validScale && (
                <p className="field-error">
                  Scale maximum must be greater than minimum.
                </p>
              )}
            </fieldset>
          )}
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={!canAdd}>
              Add {chosen.length} {chosen.length === 1 ? 'value' : 'values'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
