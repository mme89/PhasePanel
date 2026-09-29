import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DeviceRecordingPoint,
  DeviceRecordingProfile,
  DeviceRecordingRange,
  RecordingSyncJob,
  RecordingSyncScope,
} from '../shared/deviceHistory';
import { api, message } from './api';
import { HistoryPlot } from './HistoryView';
import { Modal } from './Modal';
import {
  recordingFieldLabel,
  recordingFileLabel,
  recordingFileSize,
  recordingInterval,
  recordingLabel,
  syncTransferLabel,
  syncTimingLabel,
  syncFileDuration,
  syncFileRate,
} from './deviceHistoryLabels';

type Device = {
  key: string;
  project: string;
  name: string;
  host: string;
  hasFtpLogin: boolean;
  hasSavedHistory?: boolean;
  removed?: boolean;
};
type DevicesResponse = {
  source: 'mock' | 'gridvis' | 'modbus';
  devices: Device[];
};
type PointsResponse = {
  points: DeviceRecordingPoint[];
  range: DeviceRecordingRange | null;
  source?: 'saved';
  storedAt?: string;
};
type RangeBatch = {
  ranges: Record<string, DeviceRecordingRange>;
  failed: string[];
  total: number;
  nextOffset: number;
};
type ScanTarget = {
  deviceKey: string;
  profileId: string;
  deviceName: string;
  recordingName: string;
  fileCount: number;
};
const ignoreViewChange = () => {};
const time = (value: number) => new Date(value).toLocaleString();

export function DeviceHistoryView({
  source,
  onSavedHistoryChange,
}: {
  source?: DevicesResponse['source'];
  onSavedHistoryChange?: (hasSavedDeviceHistory: boolean) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deviceKey, setDeviceKey] = useState('');
  const [profiles, setProfiles] = useState<DeviceRecordingProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [fieldIndex, setFieldIndex] = useState(0);
  const [statistic, setStatistic] = useState<'average' | 'minimum' | 'maximum'>(
    'average',
  );
  const [points, setPoints] = useState<DeviceRecordingPoint[]>([]);
  const [pointsSource, setPointsSource] = useState('');
  const [catalogOffline, setCatalogOffline] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    deviceKey: string;
    deviceName: string;
    fileCount: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [fileRanges, setFileRanges] = useState<
    Record<string, DeviceRecordingRange>
  >({});
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [confirmation, setConfirmation] = useState<ScanTarget | null>(null);
  const [syncConfirmation, setSyncConfirmation] = useState(false);
  const [syncScope, setSyncScope] = useState<RecordingSyncScope>('recording');
  const [measureAll, setMeasureAll] = useState(false);
  const [syncJob, setSyncJob] = useState<RecordingSyncJob | null>(null);
  const [syncLoaded, setSyncLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanNotice, setScanNotice] = useState('');
  const scanAbort = useRef<AbortController | null>(null);
  const seenSyncResult = useRef('');
  const onSavedHistoryChangeRef = useRef(onSavedHistoryChange);
  onSavedHistoryChangeRef.current = onSavedHistoryChange;

  const syncing = syncJob?.state === 'running';
  const syncProgress = { done: syncJob?.done ?? 0, total: syncJob?.total ?? 0 };
  const syncTransfer = {
    bytes: syncJob?.downloadedBytes ?? 0,
    durationMs: syncJob?.transferDurationMs ?? 0,
  };
  const syncPhase = syncJob?.phase ?? '';
  const syncCurrent = syncJob?.current ?? '';
  const syncNotice = syncJob?.notice ?? '';

  useEffect(
    () => () => {
      scanAbort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    async function updateSync() {
      if (polling) return;
      polling = true;
      try {
        const { job } = await api<{ job: RecordingSyncJob | null }>(
          '/device-history/sync-job',
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setSyncJob(job);
        setSyncLoaded(true);
        if (job && job.state !== 'running') {
          const resultKey = `${job.id}:${job.state}`;
          if (seenSyncResult.current !== resultKey) {
            seenSyncResult.current = resultKey;
            setRefresh((value) => value + 1);
            if (job.downloaded) onSavedHistoryChangeRef.current?.(true);
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setSyncLoaded(true);
          setError(message(failure));
        }
      } finally {
        polling = false;
      }
    }
    void updateSync();
    const interval = window.setInterval(() => void updateSync(), 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  async function syncRecordings(scope: RecordingSyncScope) {
    setSyncConfirmation(false);
    setScanNotice('');
    setError('');
    try {
      const { job } = await api<{ job: RecordingSyncJob }>(
        '/device-history/sync-job',
        {
          method: 'POST',
          body: JSON.stringify({
            scope,
            ...(scope === 'all' ? {} : { deviceKey }),
            ...(scope === 'recording' ? { profileId } : {}),
            measureAll,
          }),
        },
      );
      setSyncJob(job);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function cancelSync() {
    try {
      const { job } = await api<{ job: RecordingSyncJob | null }>(
        '/device-history/sync-job',
        { method: 'DELETE' },
      );
      setSyncJob(job);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function deleteSavedRecordings(
    target: NonNullable<typeof deleteConfirmation>,
  ) {
    setDeleteConfirmation(null);
    setDeleting(true);
    setError('');
    setScanNotice('');
    try {
      const result = await api<{
        deleted: number;
        hasSavedDeviceHistory: boolean;
      }>('/device-history/recordings', {
        method: 'DELETE',
        body: JSON.stringify({ deviceKey: target.deviceKey }),
      });
      setDeleteNotice(
        `Deleted ${result.deleted} saved ${result.deleted === 1 ? 'file' : 'files'} for ${target.deviceName}.`,
      );
      onSavedHistoryChange?.(result.hasSavedDeviceHistory);
      setFileName('');
      setDevices((current) =>
        current
          .filter((item) => item.key !== target.deviceKey || !item.removed)
          .map((item) =>
            item.key === target.deviceKey
              ? { ...item, hasSavedHistory: false }
              : item,
          ),
      );
      if (device?.removed || !device?.hasFtpLogin) {
        setDeviceKey('');
        setProfileId('');
        setProfiles([]);
      } else {
        setRefresh((value) => value + 1);
      }
    } catch (failure) {
      setError(message(failure));
    } finally {
      setDeleting(false);
    }
  }

  async function scanTimestamps(target: ScanTarget) {
    setConfirmation(null);
    const controller = new AbortController();
    scanAbort.current = controller;
    setScanning(true);
    setScanNotice('');
    setError('');
    setScanProgress({ done: 0, total: target.fileCount });
    let offset = 0;
    let failures = 0;
    let total = target.fileCount;
    try {
      do {
        const batch = await api<RangeBatch>(
          '/device-history/ranges',
          {
            method: 'POST',
            body: JSON.stringify({
              deviceKey: target.deviceKey,
              profileId: target.profileId,
              offset,
              limit: 10,
            }),
            signal: controller.signal,
          },
          300_000,
        );
        if (controller.signal.aborted) return;
        setFileRanges((current) => ({ ...current, ...batch.ranges }));
        failures += batch.failed.length;
        total = batch.total;
        if (batch.nextOffset <= offset && offset < total)
          throw new Error('The device did not advance the timestamp scan.');
        offset = batch.nextOffset;
        setScanProgress({ done: offset, total });
      } while (offset < total);
      setScanNotice(
        `Updated timestamps for ${total - failures} of ${total} files${failures ? `; ${failures} could not be read` : ''}.`,
      );
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
      if (!controller.signal.aborted) setScanning(false);
    }
  }

  function cancelScan() {
    if (!scanAbort.current) return;
    scanAbort.current.abort();
    scanAbort.current = null;
    setScanning(false);
    setScanNotice(
      `Timestamp scan canceled after ${scanProgress.done} of ${scanProgress.total} files.`,
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoadingDevices(true);
    void api<DevicesResponse>('/device-history/devices', {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setDevices(result.devices);
        setDeviceKey((current) =>
          result.devices.some(
            (device) =>
              device.key === current &&
              (device.hasFtpLogin || device.hasSavedHistory),
          )
            ? current
            : '',
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDevices(false);
      });
    return () => controller.abort();
  }, [source, refresh]);

  useEffect(() => {
    setProfiles([]);
    setPoints([]);
    setFileRanges({});
    setCatalogOffline(false);
    if (!deviceKey) {
      setLoadingCatalog(false);
      return;
    }
    const controller = new AbortController();
    setLoadingCatalog(true);
    setError('');
    void api<{ profiles: DeviceRecordingProfile[]; offline?: boolean }>(
      `/device-history/catalog?${new URLSearchParams({ deviceKey })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setProfiles(result.profiles);
        setCatalogOffline(Boolean(result.offline));
        setFileRanges(
          Object.fromEntries(
            result.profiles.flatMap((item) =>
              item.files
                .filter((file) => file.range)
                .map((file) => [file.name, file.range!]),
            ),
          ),
        );
        const next =
          result.profiles.find((item) => item.id === profileId) ??
          result.profiles.find((item) => item.files.length > 0);
        setProfileId(next?.id ?? '');
        setFileName((current) =>
          next?.files.some((file) => file.name === current) ? current : '',
        );
        setFieldIndex(0);
        setStatistic('average');
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCatalog(false);
      });
    return () => controller.abort();
  }, [deviceKey, refresh]);

  const profile = profiles.find((item) => item.id === profileId);
  const device = devices.find((item) => item.key === deviceKey);
  useEffect(() => {
    setPoints([]);
    setPointsSource('');
    if (!deviceKey || !profile || !fileName) {
      setLoadingPoints(false);
      return;
    }
    const controller = new AbortController();
    setLoadingPoints(true);
    setError('');
    const query = new URLSearchParams({
      deviceKey,
      file: fileName,
      field: String(fieldIndex),
      statistic,
    });
    void api<PointsResponse>(`/device-history/points?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPoints(result.points);
        setPointsSource(
          result.source === 'saved' ? 'Saved on server' : 'Read from device',
        );
        const range = result.range;
        if (range)
          setFileRanges((current) => ({
            ...current,
            [fileName]: range,
          }));
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPoints(false);
      });
    return () => controller.abort();
  }, [deviceKey, profileId, fileName, fieldIndex, statistic, profiles]);

  const field = profile?.fields[fieldIndex];
  const totalFiles = profiles.reduce(
    (count, item) => count + item.files.length,
    0,
  );
  const totalSavedFiles = profiles.reduce(
    (count, item) => count + item.files.filter((file) => file.storedAt).length,
    0,
  );
  const totalSavedBytes = profiles.reduce(
    (total, item) =>
      total +
      item.files.reduce(
        (bytes, file) =>
          bytes + (file.storedAt ? (file.storedSize ?? file.size) : 0),
        0,
      ),
    0,
  );
  const syncableDevices = devices.filter((item) => item.hasFtpLogin);
  const fileIndex =
    profile?.files.findIndex((file) => file.name === fileName) ?? -1;
  const series = useMemo(
    () => [
      {
        label: field ? recordingFieldLabel(field.name) : '',
        legendLabel: field ? recordingFieldLabel(field.name) : '',
        color: '#4a83d7',
        samples: points.map((point) => ({
          time: point.time,
          value: point.value,
          status: 'ok' as const,
          unit: field?.unit ?? '',
        })),
      },
    ],
    [points, field],
  );
  const first = points[0];
  const last = points.at(-1);
  const chartEnd = last?.time ?? Date.now();
  const chartMinutes = first
    ? Math.max(1, Math.ceil((chartEnd - first.startMs) / 60_000))
    : 1;

  if (source !== 'modbus' && !devices.length && !loadingDevices)
    return (
      <section className="event-history">
        <header className="event-history-header">
          <div>
            <span className="eyebrow">HISTORY</span>
            <h1>Device history</h1>
          </div>
        </header>
        {deleteNotice && (
          <p className="notice" role="status">
            {deleteNotice}
          </p>
        )}
        <p className="notice">
          Select Direct Modbus/TCP mode to browse device recordings.
        </p>
      </section>
    );

  return (
    <section className="event-history device-history">
      <header className="event-history-header device-history-header">
        <div>
          <span className="eyebrow">HISTORY · DEVICE RECORDINGS</span>
          <h1>Device history</h1>
        </div>
        <div className="event-history-actions device-history-actions">
          <button
            type="button"
            className="primary"
            disabled={
              !syncLoaded ||
              !syncableDevices.length ||
              scanning ||
              syncing ||
              deleting
            }
            onClick={() => {
              setMeasureAll(false);
              setSyncScope(
                device?.hasFtpLogin && profile
                  ? 'recording'
                  : device?.hasFtpLogin
                    ? 'device'
                    : 'all',
              );
              setSyncConfirmation(true);
            }}
          >
            Sync recordings
          </button>
          {syncing && (
            <button type="button" className="danger" onClick={cancelSync}>
              Cancel sync
            </button>
          )}
          <button
            type="button"
            disabled={loadingCatalog || scanning || syncing || deleting}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh recordings
          </button>
          <button
            type="button"
            disabled={
              !device?.hasFtpLogin ||
              !profile?.files.length ||
              loadingCatalog ||
              scanning ||
              syncing
            }
            onClick={() =>
              device &&
              profile &&
              setConfirmation({
                deviceKey,
                profileId: profile.id,
                deviceName: device.name,
                recordingName: recordingLabel(profile).split(' · ')[0],
                fileCount: profile.files.length,
              })
            }
          >
            Refresh file timestamps
          </button>
          {scanning && (
            <button type="button" onClick={cancelScan}>
              Cancel scan
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {syncJob?.state === 'failed' && (
        <div className="notice error" role="alert">
          Recording sync failed: {syncJob.error}
        </div>
      )}
      {catalogOffline && (
        <p className="notice">
          {device?.removed
            ? 'This device was removed from Source settings. Its saved recordings are still available here.'
            : source !== 'modbus'
              ? 'Direct Modbus/TCP is inactive. Showing recordings saved on this server.'
              : 'Device unavailable. Showing recordings saved on this server.'}
        </p>
      )}
      {deleteNotice && (
        <p className="notice" role="status">
          {deleteNotice}
        </p>
      )}
      {(loadingDevices || loadingCatalog) && (
        <div className="device-history-scan" role="status" aria-live="polite">
          <div className="device-history-scan-heading">
            <span>
              {loadingDevices
                ? 'Loading devices…'
                : `Loading device information${device ? ` for ${device.name}` : ''}…`}
            </span>
          </div>
          <progress aria-label="Device information loading" />
        </div>
      )}
      {scanning && (
        <div className="device-history-scan" role="status" aria-live="polite">
          <div className="device-history-scan-heading">
            <span>Reading file timestamps…</span>
            <strong>
              {scanProgress.done} of {scanProgress.total} files
            </strong>
          </div>
          <progress
            aria-label="File timestamp scan progress"
            value={scanProgress.done}
            max={scanProgress.total || 1}
          />
        </div>
      )}
      {scanNotice && !scanning && (
        <p className="muted" role="status">
          {scanNotice}
        </p>
      )}
      {syncing && (
        <div className="device-history-scan" role="status" aria-live="polite">
          <div className="device-history-scan-heading">
            <span>{syncPhase}</span>
            <strong>
              {syncProgress.done} of {syncProgress.total} files
            </strong>
          </div>
          {syncCurrent && (
            <p className="device-history-scan-current">{syncCurrent}</p>
          )}
          {syncJob?.retry && (
            <p className="device-history-scan-retry">
              {syncJob.retry.retryAtMs === null
                ? 'Reconnecting'
                : `Connection lost · retrying in ${Math.max(1, Math.ceil((syncJob.retry.retryAtMs - Date.now()) / 1000))}s`}{' '}
              (retry {syncJob.retry.attempt} of {syncJob.retry.total})
            </p>
          )}
          {syncPhase === 'Syncing recordings…' && (
            <p className="device-history-scan-transfer">
              {syncTransferLabel(syncTransfer.bytes, syncTransfer.durationMs)}
            </p>
          )}
          {syncJob?.timings && syncProgress.done > 0 && (
            <p className="device-history-scan-timing">
              {syncTimingLabel(syncJob.timings)}
            </p>
          )}
          <progress
            aria-label="Recording sync progress"
            value={syncProgress.done}
            max={syncProgress.total || 1}
          />
        </div>
      )}
      {syncNotice && !syncing && !fileName && (
        <div className="device-history-scan" role="status">
          <div className="device-history-scan-heading">
            <span>{syncNotice}</span>
          </div>
          {syncTransfer.bytes > 0 && (
            <p className="device-history-scan-transfer">
              {syncTransferLabel(syncTransfer.bytes, syncTransfer.durationMs)}
            </p>
          )}
          {syncJob?.timings && syncJob.done > 0 && (
            <p className="device-history-scan-timing">
              {syncTimingLabel(syncJob.timings)}
            </p>
          )}
          {syncJob?.fileTimings && syncJob.fileTimings.length > 0 && (
            <details className="device-history-file-timings">
              <summary>
                File download timings ({syncJob.fileTimings.length}
                {syncJob.downloaded > syncJob.fileTimings.length
                  ? ` of ${syncJob.downloaded}, first 100 shown`
                  : ''}
                )
              </summary>
              <div className="device-history-file-timings-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Size</th>
                      <th>Time</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncJob.fileTimings.map((file, index) => (
                      <tr
                        key={`${file.deviceName ?? ''}:${file.name}:${index}`}
                      >
                        <td>
                          {file.deviceName ? `${file.deviceName} · ` : ''}
                          {file.name}
                        </td>
                        <td>{recordingFileSize(file.bytes)}</td>
                        <td>{syncFileDuration(file.durationMs)}</td>
                        <td>{syncFileRate(file.bytes, file.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
      <div className="event-history-controls device-history-controls">
        <label>
          Device
          <select
            aria-label="Device"
            value={deviceKey}
            disabled={scanning || syncing}
            onChange={(event) => {
              setFileName('');
              setDeviceKey(event.target.value);
            }}
          >
            <option value="">Select a device</option>
            {devices.map((device) => (
              <option
                key={device.key}
                value={device.key}
                disabled={!device.hasFtpLogin && !device.hasSavedHistory}
              >
                {device.project} · {device.name} ({device.host})
                {device.removed
                  ? ' · Removed · Saved history'
                  : device.hasFtpLogin
                    ? ''
                    : device.hasSavedHistory
                      ? ' · Saved history'
                      : ' · FTP login needed'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Recording
          <select
            value={profileId}
            disabled={!profiles.length || scanning || syncing}
            onChange={(event) => {
              const next = profiles.find(
                (item) => item.id === event.target.value,
              );
              setProfileId(next?.id ?? '');
              setFileName('');
              setFieldIndex(0);
              setStatistic('average');
            }}
          >
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {recordingLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          File
          <select
            aria-label="File"
            value={fileName}
            disabled={!profile?.files.length}
            onChange={(event) => setFileName(event.target.value)}
          >
            <option value="">Select a file</option>
            {profile?.files.map((file, index) => (
              <option key={file.name} value={file.name} title={file.name}>
                {recordingFileLabel(
                  file.name,
                  index === 0,
                  fileRanges[file.name],
                )}
                {file.storedAt ? ' · Saved' : ' · Not saved'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Measurement
          <select
            aria-label="Measurement"
            value={fieldIndex}
            disabled={!profile}
            onChange={(event) => setFieldIndex(Number(event.target.value))}
          >
            {profile?.fields.map((item, index) => (
              <option key={index} value={index}>
                {recordingFieldLabel(item.name)}
                {item.unit ? ` (${item.unit})` : ''}
              </option>
            ))}
          </select>
        </label>
        {profile?.kind === 'range' && (
          <label>
            Statistic
            <select
              value={statistic}
              onChange={(event) =>
                setStatistic(event.target.value as typeof statistic)
              }
            >
              <option value="average">Average</option>
              <option value="minimum">Minimum</option>
              <option value="maximum">Maximum</option>
            </select>
          </label>
        )}
      </div>
      {profile && profile.files.length > 1 && (
        <div className="device-history-file-actions">
          <button
            type="button"
            disabled={fileIndex <= 0}
            onClick={() => setFileName(profile.files[fileIndex - 1].name)}
          >
            Newer file
          </button>
          <button
            type="button"
            disabled={fileIndex < 0 || fileIndex >= profile.files.length - 1}
            onClick={() => setFileName(profile.files[fileIndex + 1].name)}
          >
            Older file
          </button>
        </div>
      )}
      {!loadingCatalog && deviceKey && !profiles.length && !error && (
        <p className="notice">No supported recordings found on this device.</p>
      )}
      {loadingPoints && <p className="muted">Loading measurements…</p>}
      {!loadingPoints && first && last && field && (
        <div className="history-panel">
          <p className="muted">
            {time(first.startMs)} – {time(last.time)} ·{' '}
            {points.length.toLocaleString()} points · {pointsSource} ·{' '}
            {profile?.kind === 'range' ? statistic : 'Sample'} ·{' '}
            {profile && recordingInterval(profile.intervalSeconds)}
          </p>
          <HistoryPlot
            key={`${deviceKey}:${fileName}:${fieldIndex}:${statistic}`}
            series={series}
            minutes={chartMinutes}
            now={chartEnd}
            unit={field.unit}
            onViewChange={ignoreViewChange}
          />
        </div>
      )}
      {!loadingPoints && fileName && !points.length && !error && (
        <p className="notice">
          This file contains no valid points for the selected measurement.
        </p>
      )}
      {!loadingCatalog && deviceKey && profiles.length > 0 && (
        <section
          className="device-history-overview"
          aria-label="Device sync overview"
        >
          <header className="device-history-overview-header">
            <div>
              <h2>Saved on server</h2>
              <p className="muted">
                {profiles.length} recording types on this device
              </p>
            </div>
            <div className="device-history-overview-total">
              <strong>
                {totalSavedFiles} / {totalFiles}
              </strong>
              <span>files saved</span>
              <span>· {recordingFileSize(totalSavedBytes)} stored</span>
            </div>
          </header>
          <progress
            className="device-history-overview-progress"
            aria-label="Saved files on device"
            value={totalSavedFiles}
            max={totalFiles || 1}
          />
          <div className="device-history-overview-columns" aria-hidden="true">
            <span>Recording</span>
            <span>Saved files</span>
            <span>Last saved</span>
          </div>
          <div className="device-history-overview-list">
            {profiles.map((item) => {
              const saved = item.files.filter((file) => file.storedAt);
              const savedBytes = saved.reduce(
                (bytes, file) => bytes + (file.storedSize ?? file.size),
                0,
              );
              const lastSavedAt = saved
                .map((file) => file.storedAt!)
                .sort()
                .at(-1);
              return (
                <div
                  className={`device-history-overview-row ${item.id === profileId ? 'selected' : ''}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="device-history-overview-name"
                    aria-current={item.id === profileId ? 'true' : undefined}
                    disabled={scanning || syncing}
                    onClick={() => {
                      setProfileId(item.id);
                      setFileName('');
                      setFieldIndex(0);
                      setStatistic('average');
                    }}
                  >
                    {recordingLabel(item).split(' · ').slice(0, 2).join(' · ')}
                  </button>
                  <span className="device-history-overview-count">
                    {saved.length} of {item.files.length} files saved ·{' '}
                    {recordingFileSize(savedBytes)}
                  </span>
                  <span className="device-history-overview-date">
                    {lastSavedAt
                      ? time(Date.parse(lastSavedAt))
                      : 'Never saved'}
                  </span>
                </div>
              );
            })}
          </div>
          {totalSavedFiles > 0 && (
            <footer className="device-history-overview-footer">
              <button
                type="button"
                className="device-history-delete"
                disabled={scanning || syncing || deleting}
                onClick={() =>
                  device &&
                  setDeleteConfirmation({
                    deviceKey,
                    deviceName: device.name,
                    fileCount: totalSavedFiles,
                  })
                }
              >
                Delete saved recordings
              </button>
            </footer>
          )}
        </section>
      )}
      {confirmation && (
        <Modal
          labelledBy="device-history-timestamp-warning"
          onClose={() => setConfirmation(null)}
        >
          <section className="modal compact">
            <h2 id="device-history-timestamp-warning">
              Refresh file timestamps?
            </h2>
            <p>
              This reads all {confirmation.fileCount} files in{' '}
              {confirmation.recordingName} on {confirmation.deviceName}. It can
              take several minutes. Continue?
            </p>
            <footer className="modal-actions">
              <button type="button" onClick={() => setConfirmation(null)}>
                No
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void scanTimestamps(confirmation)}
              >
                Yes
              </button>
            </footer>
          </section>
        </Modal>
      )}
      {syncConfirmation && (
        <Modal
          labelledBy="device-history-sync-warning"
          onClose={() => setSyncConfirmation(false)}
        >
          <section className="modal compact device-history-sync-modal">
            <h2 id="device-history-sync-warning">Sync recordings</h2>
            <fieldset className="device-history-sync-options">
              <legend>Choose what to sync</legend>
              <label className={syncScope === 'recording' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="recording-sync-scope"
                  value="recording"
                  checked={syncScope === 'recording'}
                  disabled={!device?.hasFtpLogin || !profile}
                  onChange={() => setSyncScope('recording')}
                />
                <span>
                  Selected recording
                  <small>
                    {device && profile
                      ? `${device.name} · ${recordingLabel(profile).split(' · ')[0]}`
                      : 'Select a device and recording first'}
                  </small>
                </span>
              </label>
              <label className={syncScope === 'device' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="recording-sync-scope"
                  value="device"
                  checked={syncScope === 'device'}
                  disabled={!device?.hasFtpLogin}
                  onChange={() => setSyncScope('device')}
                />
                <span>
                  All recordings on selected device
                  <small>
                    {device?.hasFtpLogin
                      ? device.name
                      : 'Select a device first'}
                  </small>
                </span>
              </label>
              <label className={syncScope === 'all' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="recording-sync-scope"
                  value="all"
                  checked={syncScope === 'all'}
                  onChange={() => setSyncScope('all')}
                />
                <span>
                  All devices and recordings
                  <small>
                    {syncableDevices.length} devices with FTP access
                  </small>
                </span>
              </label>
            </fieldset>
            <label className="device-history-measure-all">
              <input
                type="checkbox"
                checked={measureAll}
                onChange={(event) => setMeasureAll(event.target.checked)}
              />
              <span>
                <strong>Measure all file speeds</strong>
                <small>Download saved files again to time each one.</small>
              </span>
            </label>
            <p className="device-history-sync-note">
              {measureAll
                ? 'All files will be downloaded and saved again.'
                : 'New and changed files will be saved.'}{' '}
              Sync can take several minutes. Completed files stay saved if you
              cancel, and sync continues if you close this page.
            </p>
            <footer className="modal-actions">
              <button type="button" onClick={() => setSyncConfirmation(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void syncRecordings(syncScope)}
              >
                Start sync
              </button>
            </footer>
          </section>
        </Modal>
      )}
      {deleteConfirmation && (
        <Modal
          labelledBy="device-history-delete-warning"
          onClose={() => setDeleteConfirmation(null)}
        >
          <section className="modal compact">
            <h2 id="device-history-delete-warning">Delete saved recordings?</h2>
            <p>
              Delete all {deleteConfirmation.fileCount} saved files for{' '}
              {deleteConfirmation.deviceName} from this server? This cannot be
              undone. Files on the device are not affected.
            </p>
            <footer className="modal-actions">
              <button type="button" onClick={() => setDeleteConfirmation(null)}>
                No
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void deleteSavedRecordings(deleteConfirmation)}
              >
                Yes, delete saved recordings
              </button>
            </footer>
          </section>
        </Modal>
      )}
    </section>
  );
}
