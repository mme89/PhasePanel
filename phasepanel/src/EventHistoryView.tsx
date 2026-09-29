import { useEffect, useState } from 'react';
import type {
  DeviceEvent,
  DeviceEventFetchStatus,
} from '../shared/deviceEvents';
import { api, message } from './api';
import type { HistoryJump } from './HistoryView';

type DeviceOption = Pick<
  DeviceEvent,
  'project' | 'deviceId' | 'deviceName' | 'host'
>;
type EventResponse = {
  source: 'mock' | 'gridvis' | 'modbus';
  devices: DeviceOption[];
  events: DeviceEvent[];
  hasMore: boolean;
  fetchStatuses: DeviceEventFetchStatus[];
};
const PAGE_SIZE = 100;
const deviceKey = (device: DeviceOption) =>
  JSON.stringify([device.project, device.deviceId, device.host]);
const eventTime = (ms: number) => new Date(ms).toLocaleString();
const number = (value: number) =>
  value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

export function EventHistoryView({
  source,
  onViewValues,
}: {
  source: EventResponse['source'] | undefined;
  onViewValues: (jump: HistoryJump) => void;
}) {
  const [device, setDevice] = useState('');
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [statuses, setStatuses] = useState<DeviceEventFetchStatus[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  async function load(offset = 0, selectedDevice = device) {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
      });
      if (selectedDevice) query.set('deviceKey', selectedDevice);
      const response = await api<EventResponse>(`/events?${query}`);
      setDevices(response.devices);
      setStatuses(response.fetchStatuses);
      setEvents((current) =>
        offset === 0 ? response.events : [...current, ...response.events],
      );
      setHasMore(response.hasMore);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (source === 'modbus') void load(0, device);
  }, [device, source]);

  async function fetchNow() {
    setFetching(true);
    setError('');
    try {
      await api('/events/collect', { method: 'POST' });
      await load(0);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setFetching(false);
    }
  }

  const deviceOptions = new Map<string, DeviceOption>();
  for (const item of [...devices, ...statuses])
    deviceOptions.set(deviceKey(item), item);

  if (source !== 'modbus')
    return (
      <section className="event-history">
        <header className="event-history-header device-history-header">
          <div>
            <span className="eyebrow">HISTORY</span>
            <h1>Event history</h1>
          </div>
        </header>
        <p className="notice event-history-unavailable">
          Event history is available only in Direct Modbus/TCP mode with FTP
          access configured for the devices. Select Direct Modbus/TCP in Source
          settings to use it.
        </p>
      </section>
    );

  return (
    <section className="event-history">
      <header className="event-history-header device-history-header">
        <div>
          <span className="eyebrow">HISTORY</span>
          <h1>Event history</h1>
        </div>
        <div className="event-history-actions device-history-actions">
          <button type="button" disabled={loading} onClick={() => void load(0)}>
            Refresh list
          </button>
          {source === 'modbus' && (
            <button
              type="button"
              disabled={fetching}
              onClick={() => void fetchNow()}
            >
              {fetching ? 'Fetching…' : 'Fetch now'}
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="event-history-controls event-history-filter">
        <label>
          Device
          <select
            value={device}
            onChange={(event) => setDevice(event.target.value)}
          >
            <option value="">All devices</option>
            {[...deviceOptions].map(([key, option]) => (
              <option key={key} value={key}>
                {option.project} · {option.deviceName} ({option.host})
              </option>
            ))}
          </select>
        </label>
      </div>
      {statuses.some((status) => status.error) && (
        <div className="notice error" role="status">
          {statuses
            .filter((status) => status.error)
            .map((status) => `${status.deviceName}: ${status.error}`)
            .join(' · ')}
        </div>
      )}
      <div className="event-history-results-heading">
        <h2>Saved events</h2>
        {statuses.length > 0 && (
          <p className="muted event-history-updated">
            Last successful fetch:{' '}
            {(() => {
              const latest = Math.max(
                ...statuses.map((status) => status.lastSuccessMs ?? 0),
              );
              return latest ? eventTime(latest) : 'none yet';
            })()}
          </p>
        )}
      </div>
      <div className="event-history-table-wrap">
        <table aria-label="Device events">
          <thead>
            <tr>
              <th scope="col">Start</th>
              <th scope="col">Device</th>
              <th scope="col">Event</th>
              <th scope="col">Duration</th>
              <th scope="col">Threshold</th>
              <th scope="col">Minimum</th>
              <th scope="col">Maximum</th>
              <th scope="col">Average</th>
              <th scope="col">Values</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr
                key={JSON.stringify([
                  event.project,
                  event.deviceId,
                  event.host,
                  event.startedAtMs,
                  event.endedAtMs,
                  event.reason,
                ])}
              >
                <td>{eventTime(event.startedAtMs)}</td>
                <td>
                  {event.deviceName}
                  <small>{event.project}</small>
                </td>
                <td>
                  {event.type}
                  {event.phase ? ` · ${event.phase}` : ''}
                </td>
                <td>
                  {number((event.endedAtMs - event.startedAtMs) / 1000)} s
                </td>
                <td>
                  {number(event.threshold)} {event.unit}
                </td>
                <td>
                  {number(event.minimum)} {event.unit}
                </td>
                <td>
                  {number(event.maximum)} {event.unit}
                </td>
                <td>
                  {number(event.average)} {event.unit}
                </td>
                <td>
                  <button
                    type="button"
                    className="event-history-value-button"
                    aria-label={`View values for ${event.deviceName} at ${eventTime(event.startedAtMs)}`}
                    onClick={() =>
                      onViewValues({
                        project: event.project,
                        deviceId: event.deviceId,
                        atMs: event.startedAtMs,
                        phase: event.phase,
                        unit: event.unit,
                      })
                    }
                  >
                    View values →
                  </button>
                </td>
              </tr>
            ))}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={9} className="event-history-empty">
                  No saved events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button
          type="button"
          className="event-history-more"
          disabled={loading}
          onClick={() => void load(events.length)}
        >
          {loading ? 'Loading…' : 'Load older events'}
        </button>
      )}
    </section>
  );
}
