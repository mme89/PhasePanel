import { newId } from '../shared/id.js';
import { useEffect, useState } from 'react';
import {
  bindingKey,
  graphTileSchema,
  type DashboardGroup,
  type Device,
  type GraphTile,
  type Measurement,
  type Project,
  type TotalSource,
} from '../shared/model';
import { api, message } from './api';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';
import { graphPhaseGroup } from './graphPhaseGroup';

const PHASES = ['L1', 'L2', 'L3'] as const;

function phase(channel: string): (typeof PHASES)[number] | undefined {
  const match = /^L([123])$/i.exec(channel.trim());
  return match ? (`L${match[1]}` as (typeof PHASES)[number]) : undefined;
}

function isThreePhaseMeasurement(measurement: string, label: string) {
  return (
    /^(U_Effective|I_Effective)$/i.test(measurement) ||
    /\b(voltage|current|spannung|strom)\b/i.test(label)
  );
}

function phaseMeasurements(item: Measurement, all: Measurement[]) {
  if (
    !isThreePhaseMeasurement(item.measurement, item.label) ||
    !phase(item.channel)
  )
    return [item];
  return PHASES.flatMap((channel) => {
    const match = all.find(
      (candidate) =>
        candidate.measurement === item.measurement &&
        candidate.unit === item.unit &&
        phase(candidate.channel) === channel,
    );
    return match ? [match] : [];
  });
}

type GraphValueChoice = {
  key: string;
  label: string;
  items: Measurement[];
  kind: 'current' | 'voltage' | 'other';
};

function valueChoices(measurements: Measurement[]): GraphValueChoice[] {
  const seen = new Set<string>();
  return measurements.flatMap((item) => {
    const items = phaseMeasurements(item, measurements);
    const grouped =
      isThreePhaseMeasurement(item.measurement, item.label) &&
      phase(item.channel);
    const key = grouped
      ? `${item.measurement}\u0000${item.unit}`
      : `${item.measurement}\u0000${item.channel}\u0000${item.unit}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const kind =
      /^(I_Effective)$/i.test(item.measurement) ||
      /\b(current|strom)\b/i.test(item.label)
        ? 'current'
        : /^(U_Effective)$/i.test(item.measurement) ||
            /\b(voltage|spannung)\b/i.test(item.label)
          ? 'voltage'
          : 'other';
    return [{ key, label: item.label, items, kind }];
  });
}

function sourceFromMeasurement(
  item: Measurement,
  project: string,
  device: string,
  deviceName: string,
): TotalSource {
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

function selectedSourceGroups(sources: TotalSource[]) {
  const groups = new Map<
    string,
    { sources: TotalSource[]; grouped: boolean; measurementLabel: string }
  >();
  for (const source of sources) {
    const { binding } = source;
    const phaseGroup = graphPhaseGroup(source);
    const grouped = phaseGroup !== null;
    const key = phaseGroup
      ? `phase:${phaseGroup.key}`
      : `single:${bindingKey(binding)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        sources: [],
        grouped,
        measurementLabel: phaseGroup?.measurementLabel ?? source.label,
      };
      groups.set(key, group);
    }
    group.sources.push(source);
  }
  return [...groups.values()];
}

export function GraphTileEditor({
  initial,
  groups,
  defaultGroupId,
  defaultProject,
  onSave,
  onClose,
}: {
  initial?: GraphTile;
  groups: DashboardGroup[];
  defaultGroupId?: string;
  defaultProject?: string;
  onSave: (tile: GraphTile) => void;
  onClose: () => void;
}) {
  const [id] = useState(initial?.id ?? newId());
  const [label, setLabel] = useState(initial?.label ?? 'Value graph');
  const [sources, setSources] = useState<TotalSource[]>(initial?.sources ?? []);
  const [graphMinutes, setGraphMinutes] = useState<5 | 15 | 60>(
    initial?.graphMinutes ?? 15,
  );
  const [decimals, setDecimals] = useState(initial?.decimals ?? 1);
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const [groupId, setGroupId] = useState(
    initial?.groupId ?? defaultGroupId ?? '',
  );
  const [project, setProject] = useState('');
  const [device, setDevice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [valueFilter, setValueFilter] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
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

  const unit = sources[0]?.unit ?? '';
  const sourceGroups = selectedSourceGroups(sources);
  const selected = new Set(sources.map((source) => bindingKey(source.binding)));
  const canAdd = (candidates: TotalSource[]) => {
    const missing = candidates.filter(
      (source) => !selected.has(bindingKey(source.binding)),
    );
    return (
      missing.length > 0 &&
      sources.length + missing.length <= 12 &&
      (!sources.length || candidates.every((source) => source.unit === unit))
    );
  };
  const add = (candidates: TotalSource[]) => {
    if (!canAdd(candidates)) {
      setSelectionError(
        'These values exceed the graph limit or use another unit.',
      );
      return;
    }
    setSelectionError('');
    setSources((current) => {
      const currentKeys = new Set(
        current.map((source) => bindingKey(source.binding)),
      );
      return [
        ...current,
        ...candidates.filter(
          (source) => !currentKeys.has(bindingKey(source.binding)),
        ),
      ];
    });
  };
  const remove = (key: string) =>
    setSources((current) =>
      current.filter((source) => bindingKey(source.binding) !== key),
    );
  const removeGroup = (groupSources: TotalSource[]) => {
    const keys = new Set(
      groupSources.map((source) => bindingKey(source.binding)),
    );
    setSources((current) =>
      current.filter((source) => !keys.has(bindingKey(source.binding))),
    );
  };
  const deviceName =
    devices.find((entry) => entry.id === device)?.name ?? device;
  const choices = valueChoices(measurements);
  const filteredChoices = choices.filter((choice) =>
    `${choice.label} ${choice.items.map((item) => `${item.measurement} ${item.channelLabel} ${item.unit}`).join(' ')}`
      .toLowerCase()
      .includes(valueFilter.toLowerCase()),
  );
  const shownChoices = filteredChoices.slice(0, 120);
  const electricalChoices = shownChoices
    .filter((choice) => choice.kind !== 'other')
    .sort((a, b) =>
      a.kind === b.kind
        ? a.label.localeCompare(b.label)
        : a.kind === 'current'
          ? -1
          : 1,
    );
  const otherChoices = shownChoices.filter((choice) => choice.kind === 'other');
  const renderChoice = (choice: GraphValueChoice) => {
    const candidates = choice.items.map((item) =>
      sourceFromMeasurement(item, project, device, deviceName),
    );
    const keys = candidates.map((source) => bindingKey(source.binding));
    const selectedCount = keys.filter((key) => selected.has(key)).length;
    const fullySelected = selectedCount === keys.length;
    const channels = choice.items.map((item) => item.channelLabel).join(', ');
    const unitLabel = choice.items[0].unit || 'no unit';
    return (
      <label className="graph-value-choice" key={choice.key}>
        <input
          type="checkbox"
          aria-label={`${choice.label} · ${channels} (${unitLabel})`}
          checked={fullySelected}
          ref={(element) => {
            if (element)
              element.indeterminate = selectedCount > 0 && !fullySelected;
          }}
          disabled={!fullySelected && !canAdd(candidates)}
          onChange={() => {
            if (fullySelected) keys.forEach(remove);
            else add(candidates);
          }}
        />
        <span>
          <strong>{choice.label}</strong>
          <small>
            {channels} · {unitLabel}
          </small>
        </span>
      </label>
    );
  };
  const parsed = graphTileSchema.safeParse({
    ...initial,
    id,
    kind: 'graph',
    label,
    sources,
    unit,
    decimals,
    graphMinutes,
    backgroundColor,
    groupId: groupId || undefined,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 5,
    h: initial?.h ?? 4,
  });
  return (
    <Modal onClose={onClose} labelledBy="graph-tile-title">
      <section className="modal content-editor-modal graph-editor-modal">
        <div className="modal-heading">
          <h2 id="graph-tile-title">
            {initial ? 'Edit graph tile' : 'Add graph tile'}
          </h2>
          <button aria-label="Close graph editor" onClick={onClose}>
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
              aria-labelledby="graph-details-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="graph-details-title">Graph details</h3>
                  <p>Choose a title and display settings.</p>
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
                  Time window
                  <select
                    value={graphMinutes}
                    onChange={(event) =>
                      setGraphMinutes(Number(event.target.value) as 5 | 15 | 60)
                    }
                  >
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={60}>60 minutes</option>
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
              aria-labelledby="graph-selected-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="graph-selected-title">Selected values</h3>
                  <p>
                    Each value appears as one line. Values must share a unit.
                  </p>
                </div>
                <span className="editor-count">{sources.length} / 12</span>
              </div>
              <fieldset className="display-settings total-sources editor-inner-fieldset">
                <legend>Values in this graph ({sources.length}/12)</legend>
                {sources.length === 0 && (
                  <p className="muted">
                    Choose a value below to start the graph.
                  </p>
                )}
                {sourceGroups.map((group) => {
                  const source = group.sources[0];
                  const channels = group.sources
                    .map((item) => item.binding.channel)
                    .sort((a, b) =>
                      a.localeCompare(b, undefined, { numeric: true }),
                    )
                    .join(' · ');
                  return (
                    <div
                      className="total-source"
                      key={bindingKey(source.binding)}
                    >
                      <span>
                        <strong>
                          {source.deviceName ||
                            (group.grouped
                              ? source.binding.deviceId
                              : source.label)}
                          {group.grouped && ` · ${group.measurementLabel}`}
                        </strong>
                        <small>
                          {group.grouped ? channels : source.label} ·{' '}
                          {source.binding.project} · {source.unit || 'no unit'}
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label={
                          group.grouped
                            ? `Remove ${group.measurementLabel} from ${source.deviceName || source.binding.deviceId}`
                            : `Remove source ${source.label}`
                        }
                        onClick={() => removeGroup(group.sources)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </fieldset>
              {selectionError && (
                <p role="alert" className="field-error">
                  {selectionError}
                </p>
              )}
            </section>
            <section
              className="editor-section"
              aria-labelledby="graph-add-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="graph-add-title">Add values</h3>
                  <p>
                    Choose a device and select its values. Voltage and Current
                    selections include all available phases.
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
                        <option key={item.name}>{item.name}</option>
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
                      <legend>Available values</legend>
                      {filteredChoices.length > shownChoices.length && (
                        <p className="muted">
                          Showing the first {shownChoices.length} of{' '}
                          {filteredChoices.length} values. Filter to find more.
                        </p>
                      )}
                      {electricalChoices.length > 0 && (
                        <div className="graph-value-section">
                          <h4>Current & voltage</h4>
                          <div className="graph-value-grid">
                            {electricalChoices.map(renderChoice)}
                          </div>
                        </div>
                      )}
                      {otherChoices.length > 0 && (
                        <div className="graph-value-section">
                          <h4>Other values</h4>
                          <div className="graph-value-grid">
                            {otherChoices.map(renderChoice)}
                          </div>
                        </div>
                      )}
                      {measurements.length === 0 && (
                        <p className="muted">No measurements available.</p>
                      )}
                    </fieldset>
                  </>
                )}
              </div>
              <p className="muted">
                Values with different units are disabled. Source values do not
                need their own dashboard tiles.
              </p>
            </section>
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
              {initial ? 'Apply graph changes' : 'Add graph tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
