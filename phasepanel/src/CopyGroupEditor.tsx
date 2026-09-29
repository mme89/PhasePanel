import { measurementSources } from '../shared/totals';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  isGraphTile,
  isTotalTile,
  type Dashboard,
  type DashboardGroup,
  type Device,
  type Project,
  type Measurement,
  type TotalSource,
} from '../shared/model';
import { sourceDeviceKey, type DeviceAssignment } from '../shared/copyGroup';
import { api, message } from './api';
import { Modal } from './Modal';

type Assignments = Record<string, DeviceAssignment | null>;
function DeviceReplacement({
  sourceKey,
  widgets,
  projects,
  setAssignments,
}: {
  sourceKey: string;
  widgets: TotalSource[];
  projects: Project[];
  setAssignments: Dispatch<SetStateAction<Assignments>>;
}) {
  const source = widgets[0];
  const [project, setProject] = useState(source.binding.project);
  const [devices, setDevices] = useState<Device[]>([]);
  const [device, setDevice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setDevices([]);
    api<Device[]>(`/devices?${new URLSearchParams({ project })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setDevices(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [project, retry]);
  useEffect(() => {
    if (!device) return;
    const controller = new AbortController();
    setPending(true);
    setError('');
    setAssignments((current) => ({ ...current, [sourceKey]: null }));
    api<Measurement[]>(
      `/measurements?${new URLSearchParams({ project, device })}`,
      { signal: controller.signal },
    )
      .then((measurements) => {
        if (controller.signal.aborted) return;
        const missing = widgets.filter(
          (tile) =>
            !measurements.some(
              (m) =>
                m.measurement === tile.binding.measurement &&
                m.channel === tile.binding.channel &&
                m.unit === tile.unit,
            ),
        );
        if (missing.length) {
          setError(
            `This device does not support: ${missing.map((tile) => `${tile.label} (${tile.binding.measurement} / ${tile.binding.channel}, ${tile.unit || 'no unit'})`).join(', ')}.`,
          );
          return;
        }
        const target = devices.find((d) => d.id === device);
        if (target)
          setAssignments((current) => ({
            ...current,
            [sourceKey]: { project, deviceId: device, deviceName: target.name },
          }));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [project, device, devices, retry, sourceKey, widgets, setAssignments]);
  function reset() {
    setDevice('');
    setPending(false);
    setError('');
    setAssignments((current) => {
      const next = { ...current };
      delete next[sourceKey];
      return next;
    });
  }
  return (
    <fieldset className="display-settings">
      <legend>
        {source.deviceName} · {source.binding.project} · ID{' '}
        {source.binding.deviceId}
      </legend>
      <p className="muted">
        {widgets.length} measurement {widgets.length === 1 ? 'tile' : 'tiles'}
      </p>
      <label>
        Replacement project
        <select
          value={project}
          onChange={(e) => {
            reset();
            setProject(e.target.value);
          }}
        >
          {[
            ...new Set([
              source.binding.project,
              ...projects.map((p) => p.name),
            ]),
          ].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Replacement device
        <select
          value={device}
          onChange={(e) => {
            reset();
            setDevice(e.target.value);
            if (e.target.value)
              setAssignments((current) => ({ ...current, [sourceKey]: null }));
          }}
        >
          <option value="">Keep original device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.model} · ID {d.id}
            </option>
          ))}
        </select>
      </label>
      {pending && <p role="status">Checking measurements…</p>}
      {device && !pending && !error && (
        <p className="muted">All measurements are compatible.</p>
      )}
      {error && (
        <div className="field-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry discovery
          </button>
        </div>
      )}
    </fieldset>
  );
}

export function CopyGroupEditor({
  source,
  dashboard,
  onCopy,
  onClose,
}: {
  source: DashboardGroup;
  dashboard: Dashboard;
  onCopy: (
    title: string,
    assignments: Record<string, DeviceAssignment>,
  ) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(`${source.title.slice(0, 93)} (copy)`);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [members] = useState(() =>
    dashboard.widgets.filter((tile) => tile.groupId === source.id),
  );
  const [sources] = useState(() => {
    const result = new Map<string, TotalSource[]>();
    for (const tile of members.flatMap(measurementSources)) {
      const key = sourceDeviceKey(tile.binding);
      result.set(key, [...(result.get(key) ?? []), tile]);
    }
    return [...result];
  });
  useEffect(() => {
    if (!sources.length) return;
    const controller = new AbortController();
    setError('');
    api<Project[]>('/projects', { signal: controller.signal })
      .then(setProjects)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [retry, sources]);
  const limit =
    (dashboard.groups?.length ?? 0) >= 50 ||
    dashboard.widgets.length + members.length > 100;
  const duplicateTotalInputs = members
    .filter((tile) => isTotalTile(tile) || isGraphTile(tile))
    .some((tile) => {
      const keys = tile.sources.map((source) => {
        const target = assignments[sourceDeviceKey(source.binding)];
        return JSON.stringify([
          target?.project ?? source.binding.project,
          target?.deviceId ?? source.binding.deviceId,
          source.binding.measurement,
          source.binding.channel,
        ]);
      });
      return new Set(keys).size !== keys.length;
    });
  const valid =
    title.trim() &&
    !limit &&
    !duplicateTotalInputs &&
    Object.values(assignments).every(Boolean);
  return (
    <Modal onClose={onClose} labelledBy="copy-group-title">
      <section className="modal">
        <div className="modal-heading">
          <h2 id="copy-group-title">Copy group</h2>
          <button aria-label="Close copy group" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          Copy {members.length} tiles with their layout and settings. Choose
          replacement devices below, or keep the originals.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid)
              onCopy(
                title.trim(),
                assignments as Record<string, DeviceAssignment>,
              );
          }}
        >
          <label>
            New group headline
            <input
              autoFocus
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {error && (
            <div role="alert" className="field-error">
              {error}{' '}
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Retry projects
              </button>
            </div>
          )}
          {sources.map(([key, widgets]) => (
            <DeviceReplacement
              key={key}
              sourceKey={key}
              widgets={widgets}
              projects={projects}
              setAssignments={setAssignments}
            />
          ))}
          {duplicateTotalInputs && (
            <p role="alert" className="field-error">
              These replacements would count the same input twice in a total.
              Choose different replacement devices.
            </p>
          )}
          {limit && (
            <p role="alert" className="field-error">
              The copy would exceed the dashboard limit of 50 groups or 100
              tiles.
            </p>
          )}
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!valid}>
              Create copy
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
