import { newId } from '../shared/id.js';
import { useEffect, useState } from 'react';
import { api, message } from './api';
import { defaultsForMeasurement } from '../shared/range';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';
import type {
  DashboardGroup,
  MeasurementDefaults,
  Device,
  Measurement,
  Project,
  Widget,
} from '../shared/model';

type Props = {
  initial?: Widget;
  measurementDefaults: MeasurementDefaults[];
  onSave: (widget: Widget) => void;
  onClose: () => void;
  groups: DashboardGroup[];
  defaultGroupId?: string;
  defaultProject?: string;
};
export function WidgetEditor({
  initial,
  measurementDefaults,
  onSave,
  onClose,
  groups,
  defaultGroupId,
  defaultProject,
}: Props) {
  const [groupId, setGroupId] = useState(
    initial ? (initial.groupId ?? '') : (defaultGroupId ?? ''),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measurementFilter, setMeasurementFilter] = useState('');
  const [project, setProject] = useState(initial?.binding.project ?? '');
  const [device, setDevice] = useState(initial?.binding.deviceId ?? '');
  const [measurement, setMeasurement] = useState(
    initial?.binding.measurement ?? '',
  );
  const [channel, setChannel] = useState(initial?.binding.channel ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const [decimals, setDecimals] = useState(initial?.decimals ?? 1);
  const [display, setDisplay] = useState<Widget['display']>(
    initial?.display ?? 'number',
  );
  const [graphMinutes, setGraphMinutes] = useState<5 | 15 | 60>(
    initial?.graphMinutes ?? 15,
  );
  const [useDefaults, setUseDefaults] = useState(
    initial?.useDashboardDefaults !== false,
  );

  const [limits, setLimits] = useState(Boolean(initial?.range));
  const [minimum, setMinimum] = useState(
    initial?.range ? String(initial.range.min) : '0',
  );
  const [maximum, setMaximum] = useState(
    initial?.range ? String(initial.range.max) : '100',
  );
  const [color, setColor] = useState(
    initial?.normalColor ?? initial?.range?.color ?? '#32a852',
  );
  const rangeEnabled = limits;
  const [scaleMin, setScaleMin] = useState(
    String(initial?.scale?.min ?? initial?.range?.min ?? 0),
  );
  const [scaleMax, setScaleMax] = useState(
    String(initial?.scale?.max ?? initial?.range?.max ?? 100),
  );
  const scaleValid =
    scaleMin.trim() !== '' &&
    scaleMax.trim() !== '' &&
    Number.isFinite(Number(scaleMin)) &&
    Number.isFinite(Number(scaleMax)) &&
    Number(scaleMax) > Number(scaleMin) &&
    Number.isFinite(Number(scaleMax) - Number(scaleMin));
  const rangeValid =
    minimum.trim() !== '' &&
    maximum.trim() !== '' &&
    Number.isFinite(Number(minimum)) &&
    Number.isFinite(Number(maximum)) &&
    Number(maximum) > Number(minimum) &&
    Number.isFinite(Number(maximum) - Number(minimum));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<Project[]>('/projects', { signal: controller.signal })
      .then((found) => {
        setProjects(found);
        setProject(
          (current) =>
            current ||
            found.find((item) => item.name === defaultProject)?.name ||
            found[0]?.name ||
            '',
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    setDevices([]);
    setError('');
    api<Device[]>(`/devices?${new URLSearchParams({ project })}`, {
      signal: controller.signal,
    })
      .then(setDevices)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [project, retry]);
  useEffect(() => {
    if (!project || !device) return;
    const controller = new AbortController();
    setMeasurements([]);
    setPending(true);
    setError('');
    api<Measurement[]>(
      `/measurements?${new URLSearchParams({ project, device })}`,
      { signal: controller.signal },
    )
      .then(setMeasurements)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [project, device, retry]);
  const available = measurements.filter((m) => m.measurement === measurement);
  const filteredMeasurementOptions = [
    ...new Map(
      [
        ...measurements.filter((item) => item.measurement === measurement),
        ...measurements,
      ]
        .filter(
          (item) =>
            item.measurement === measurement ||
            `${item.label} ${item.measurement} ${item.channelLabel} ${item.unit}`
              .toLowerCase()
              .includes(measurementFilter.toLowerCase()),
        )
        .map((item) => [item.measurement, item]),
    ).values(),
  ];
  const selected = available.find((m) => m.channel === channel);
  const dashboardDefaults = defaultsForMeasurement(
    measurementDefaults,
    measurement,
    selected?.unit ?? initial?.unit ?? '',
  );
  const inheriting = Boolean(dashboardDefaults) && useDefaults;
  return (
    <Modal onClose={onClose} labelledBy="tile-dialog-title">
      <section className="modal content-editor-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">MEASUREMENT TILE</span>
            <h2 id="tile-dialog-title">
              {initial ? 'Edit tile' : 'Add a live value'}
            </h2>
          </div>
          <button aria-label="Close tile editor" onClick={onClose}>
            ×
          </button>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}{' '}
            <button onClick={() => setRetry((v) => v + 1)}>
              Retry discovery
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !selected ||
              (!inheriting && rangeEnabled && !rangeValid) ||
              (!inheriting &&
                (display === 'gauge' || display === 'bar') &&
                !scaleValid)
            )
              return;
            onSave({
              id: initial?.id ?? newId(),
              binding: { project, deviceId: device, measurement, channel },
              ...(groupId ? { groupId } : {}),
              label:
                label.trim() || `${selected.label} · ${selected.channelLabel}`,
              deviceName: devices.find((d) => d.id === device)?.name ?? device,
              unit: selected.unit,
              measurementLabel: selected.label,
              decimals,
              display,
              ...(display === 'graph' ? { graphMinutes } : {}),
              normalColor: color,
              backgroundColor,
              ...(initial?.useDashboardDefaults !== undefined ||
              dashboardDefaults
                ? { useDashboardDefaults: useDefaults }
                : {}),
              ...(display === 'gauge' || display === 'bar'
                ? {
                    scale:
                      inheriting && !scaleValid
                        ? dashboardDefaults!.scale
                        : { min: Number(scaleMin), max: Number(scaleMax) },
                  }
                : {}),
              ...(rangeEnabled && rangeValid
                ? {
                    range: {
                      min: Number(minimum),
                      max: Number(maximum),
                      color,
                    },
                  }
                : {}),
              x: initial?.x ?? 0,
              y: initial?.y ?? 0,
              w: initial?.w ?? 4,
              h: initial?.h ?? 3,
            });
          }}
        >
          <div className="editor-content">
            <section
              className="editor-section"
              aria-labelledby="tile-source-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="tile-source-title">Measurement source</h3>
                  <p>
                    Choose a device and live value. Change the project if
                    needed.
                  </p>
                </div>
              </div>
              <div className="editor-fields">
                <label>
                  Project
                  <select
                    autoFocus
                    value={project}
                    required
                    onChange={(e) => {
                      if (e.target.value === project) return;
                      setProject(e.target.value);
                      setDevice('');
                      setMeasurement('');
                      setChannel('');
                      setMeasurements([]);
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
                    required
                    disabled={!project}
                    onChange={(e) => {
                      setDevice(e.target.value);
                      setMeasurement('');
                      setChannel('');
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
                <label>
                  Filter measurements
                  <input
                    value={measurementFilter}
                    onChange={(event) =>
                      setMeasurementFilter(event.target.value)
                    }
                    placeholder="Filter by name, unit or register"
                    disabled={!device || pending}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Measurement
                    <select
                      value={measurement}
                      required
                      disabled={!device || pending}
                      onChange={(e) => {
                        setMeasurement(e.target.value);
                        setChannel('');
                      }}
                    >
                      <option value="">
                        {pending ? 'Loading…' : 'Select a measurement'}
                      </option>
                      {filteredMeasurementOptions.slice(0, 200).map((m) => (
                        <option key={m.measurement} value={m.measurement}>
                          {m.label}
                          {m.measurement.startsWith('JZ_')
                            ? ` · ${m.measurement}`
                            : ''}
                        </option>
                      ))}
                    </select>
                    {filteredMeasurementOptions.length > 200 && (
                      <span className="muted">
                        Showing 200 of {filteredMeasurementOptions.length}.
                        Filter to find more.
                      </span>
                    )}
                  </label>
                  <label>
                    Phase / channel
                    <select
                      value={channel}
                      required
                      disabled={!measurement}
                      onChange={(e) => setChannel(e.target.value)}
                    >
                      <option value="">Select a channel</option>
                      {available.map((m) => (
                        <option key={m.channel} value={m.channel}>
                          {m.channelLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {device && !pending && !error && measurements.length === 0 && (
                  <p className="muted">
                    No live measurements available for this device.
                  </p>
                )}
              </div>
            </section>
            <section
              className="editor-section"
              aria-labelledby="tile-appearance-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="tile-appearance-title">Tile details</h3>
                  <p>Set its name, group, and number format.</p>
                </div>
              </div>
              <div className="editor-fields">
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
                  Tile label <span className="optional">optional</span>
                  <input
                    value={label}
                    maxLength={100}
                    placeholder={
                      selected
                        ? `${selected.label} · ${selected.channelLabel}`
                        : 'e.g. Main supply voltage'
                    }
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <TileBackgroundColor
                  value={backgroundColor}
                  onChange={setBackgroundColor}
                />
                <div className="form-row">
                  <label>
                    Decimal places
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={
                        inheriting && dashboardDefaults?.decimals !== undefined
                          ? dashboardDefaults.decimals
                          : decimals
                      }
                      disabled={
                        inheriting && dashboardDefaults?.decimals !== undefined
                      }
                      required
                      onChange={(e) => setDecimals(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Unit from GridVis
                    <input value={selected?.unit ?? '—'} readOnly />
                  </label>
                </div>
              </div>
            </section>
            <section
              className="editor-section"
              aria-labelledby="tile-display-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="tile-display-title">Display & limits</h3>
                  <p>
                    Choose how readings appear and when they trigger an alarm.
                  </p>
                </div>
              </div>
              <fieldset className="display-settings editor-inner-fieldset">
                <legend>Display & limits</legend>
                <label>
                  Display type
                  <select
                    value={display}
                    onChange={(e) =>
                      setDisplay(e.target.value as Widget['display'])
                    }
                  >
                    <option value="number">Number</option>
                    <option value="gauge">Semicircular gauge</option>
                    <option value="bar">Horizontal bar</option>
                    <option value="status">Traffic light</option>
                    <option value="sparkline">Number with sparkline</option>
                    {initial?.display === 'graph' && (
                      <option value="graph">Line graph (legacy tile)</option>
                    )}
                  </select>
                </label>
                {display === 'graph' && (
                  <label>
                    Time window
                    <select
                      value={graphMinutes}
                      onChange={(e) =>
                        setGraphMinutes(Number(e.target.value) as 5 | 15 | 60)
                      }
                    >
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={60}>60 minutes</option>
                    </select>
                  </label>
                )}
                {dashboardDefaults && (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={useDefaults}
                        onChange={(e) => setUseDefaults(e.target.checked)}
                      />
                      Use dashboard settings
                    </label>
                    {inheriting && (
                      <p className="muted">
                        Shared {selected?.label ?? measurement} scale:{' '}
                        {dashboardDefaults.scale.min}–
                        {dashboardDefaults.scale.max}.{' '}
                        {dashboardDefaults.limits
                          ? `Alarm limits: ${dashboardDefaults.limits.min}–${dashboardDefaults.limits.max}.`
                          : 'Dashboard alarm limits disabled.'}{' '}
                        {dashboardDefaults.decimals !== undefined &&
                          ` Shared decimal places: ${dashboardDefaults.decimals}. `}
                        {dashboardDefaults.normalColor !== undefined &&
                          ' Normal color is also shared. '}
                        Change these in Shared value settings. Saved individual
                        settings are retained when you opt out.
                      </p>
                    )}
                  </>
                )}
                {(display === 'gauge' || display === 'bar') && !inheriting && (
                  <>
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
                    {!scaleValid && (
                      <p className="field-error" role="alert">
                        Scale maximum must be greater than scale minimum.
                      </p>
                    )}
                    <p className="muted">
                      The scale controls the indicator and its endpoint labels
                      only.
                    </p>
                  </>
                )}
                <label>
                  Normal color
                  <input
                    type="color"
                    value={
                      inheriting && dashboardDefaults?.normalColor !== undefined
                        ? dashboardDefaults.normalColor
                        : color
                    }
                    disabled={
                      inheriting && dashboardDefaults?.normalColor !== undefined
                    }
                    onChange={(e) => setColor(e.target.value)}
                  />
                </label>
                {!inheriting && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={limits}
                      onChange={(e) => setLimits(e.target.checked)}
                    />
                    Enable alarm limits
                  </label>
                )}
                {rangeEnabled && !inheriting && (
                  <>
                    <div className="form-row">
                      <label>
                        Lower limit
                        <input
                          type="number"
                          step="any"
                          required
                          value={minimum}
                          onChange={(e) => setMinimum(e.target.value)}
                        />
                      </label>
                      <label>
                        Upper limit
                        <input
                          type="number"
                          step="any"
                          required
                          value={maximum}
                          onChange={(e) => setMaximum(e.target.value)}
                        />
                      </label>
                    </div>
                    {!rangeValid && (
                      <p className="field-error" role="alert">
                        Upper limit must be greater than lower limit.
                      </p>
                    )}
                    <p className="muted">
                      Values below the lower limit or above the upper limit turn
                      red. Limits are independent of the gauge scale; exact
                      boundary values remain in range.
                    </p>
                  </>
                )}
              </fieldset>
            </section>
          </div>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={
                !selected ||
                Boolean(error) ||
                (!inheriting && rangeEnabled && !rangeValid) ||
                (!inheriting &&
                  (display === 'gauge' || display === 'bar') &&
                  !scaleValid)
              }
            >
              {initial ? 'Apply changes' : 'Add tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
