import { UpdatesDialog } from './UpdatesDialog';
import { LogTileEditor, LogTileView } from './LogTile';
import type { LogTile } from '../shared/model';
import { DashboardBackgroundEditor } from './DashboardBackgroundEditor';
import { TotalTileEditor } from './TotalTileEditor';
import { readingBindings, totalReading } from '../shared/totals';
import {
  isGraphTile,
  isTotalTile,
  type GraphTile,
  type TotalTile,
} from '../shared/model';
import { fixedCanvasDashboard, saveCanvasWidget } from './ungroupedCanvas';
import { CopyGroupEditor } from './CopyGroupEditor';
import { copyGroup } from '../shared/copyGroup';
import { groupTextColor } from './groupColor';
import { GroupArrangement } from './GroupArrangement';
import { DateTimeTileEditor, dateTimeContent } from './DateTimeTile';
import type { DateTimeTile } from '../shared/model';
import {
  isMeasurementTile,
  type DashboardTile,
  type TextTile as TextTileModel,
} from '../shared/model';
import { TextTileEditor, TextTileView } from './TextTile';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  exportDashboards,
  importDashboards,
  MAX_DASHBOARD_FILE_BYTES,
} from '../shared/dashboardTransfer';
import { transformStrategy } from 'react-grid-layout/core';
import { DashboardCanvas } from './DashboardCanvas';
import { useContainerWidth, type Layout } from 'react-grid-layout';
import { CanvasTileGrid } from './CanvasTileGrid';
import { TilePositionEditor } from './TilePositionEditor';
import { snapLinkedWidgets, validTileLinks } from './tileLinks';
import {
  bindingKey,
  dashboardInput,
  dashboardResolutionSchema,
  type Dashboard,
  type DisplayDefaults,
  type DashboardGroup,
  type Reading,
  type Widget,
} from '../shared/model';
import { api, message } from './api';
import { TileSizeEditor } from './TileSizeEditor';
import { DashboardDefaultsEditor } from './DashboardDefaultsEditor';
import { BulkWidgetEditor } from './BulkWidgetEditor';
import { WidgetEditor } from './WidgetEditor';
import { useReadings } from './useReadings';
import { useAlarmSound } from './useAlarmSound';
import { useAlarmStatuses } from './useAlarmStatuses';
import { SoundSettingsDialog } from './SoundSettingsDialog';
import { useFullscreen } from './useFullscreen';
import { Modal } from './Modal';
import { SourceSettingsDialog } from './SourceSettingsDialog';
import { CollectorSettingsDialog } from './CollectorSettingsDialog';
import { StorageSettingsDialog } from './StorageSettingsDialog';
import { ServerSettingsDialog } from './ServerSettingsDialog';
import { NotificationSettingsDialog } from './NotificationSettingsDialog';
import { ExportDashboardsDialog } from './ExportDashboardsDialog';
import { GroupEditor } from './GroupEditor';
import { saveGroup, removeGroup, applyTileSize } from '../shared/groups';
import { NumericValue } from './NumericValue';
import { Gauge } from './Gauge';
import {
  BarDisplay,
  SparklineDisplay,
  StatusDisplay,
} from './MeasurementDisplays';
import { LineGraph } from './LineGraph';
import { GraphTileEditor } from './GraphTileEditor';
import { GraphTileView } from './GraphTileView';
import { ConsumptionTileEditor, ConsumptionTileView } from './ConsumptionTile';
import { isConsumptionTile, type ConsumptionTile } from '../shared/model';
import { HistoryView, type HistoryJump } from './HistoryView';
import { EventHistoryView } from './EventHistoryView';
import { DeviceHistoryView } from './DeviceHistoryView';
import type { GraphSample } from './graphHistory';
import {
  evaluateRange,
  withDashboardDefaults,
  dashboardMeasurementDefaults,
  defaultsForMeasurement,
  editableDashboard,
} from '../shared/range';
import type { CSSProperties } from 'react';

const time = (value?: string | null) =>
  value ? new Date(value).toLocaleTimeString('en-GB') : '—';
const rotationIntervals = [5, 10, 30, 60, 120, 300] as const;
const initialRotationSeconds = Number(
  new URLSearchParams(window.location.search).get('rotate'),
);
function moveDashboard(
  dashboards: Dashboard[],
  sourceId: string,
  targetId: string,
  after: boolean,
) {
  const source = dashboards.findIndex((dashboard) => dashboard.id === sourceId);
  const target = dashboards.findIndex((dashboard) => dashboard.id === targetId);
  if (source < 0 || target < 0 || source === target) return dashboards;
  const reordered = [...dashboards];
  const [moved] = reordered.splice(source, 1);
  const destination = reordered.findIndex(
    (dashboard) => dashboard.id === targetId,
  );
  reordered.splice(destination + Number(after), 0, moved);
  return reordered;
}
function Bolt() {
  return (
    <svg
      width="22"
      height="26"
      viewBox="0 0 24 28"
      fill="none"
      aria-hidden="true"
    >
      <path d="M14 1 2 16h8L8 27 22 10h-9z" fill="currentColor" />
    </svg>
  );
}
function editableGraphFromLegacy(widget: Widget): GraphTile {
  return {
    id: widget.id,
    kind: 'graph',
    ...(widget.groupId ? { groupId: widget.groupId } : {}),
    label: widget.label,
    sources: [
      {
        binding: widget.binding,
        deviceName: widget.deviceName,
        label: widget.label,
        unit: widget.unit,
      },
    ],
    unit: widget.unit,
    decimals: widget.decimals,
    graphMinutes: widget.graphMinutes ?? 15,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
  };
}
function Tile({
  widget: original,
  defaults,
  reading,
  graphSamples = [],
  editing,
  loading,
  error,
  staleMs,
  now,
  onEdit,
  onRemove,
}: {
  widget: Widget | TotalTile;
  defaults?: DisplayDefaults;
  reading?: Reading;
  graphSamples?: GraphSample[];
  editing: boolean;
  loading: boolean;
  error: string;
  staleMs: number;
  now: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const widget = isMeasurementTile(original)
    ? withDashboardDefaults(original, defaults)
    : original;
  const [graphControlsTarget, setGraphControlsTarget] =
    useState<HTMLElement | null>(null);
  const legacyGraph = isMeasurementTile(widget) && widget.display === 'graph';
  let status: string =
    loading && !reading ? 'loading' : (reading?.status ?? 'unavailable');
  if (error) status = 'error';
  if (
    (status === 'ok' || status === 'partial') &&
    reading &&
    now - Date.parse(reading.sourceTime ?? reading.retrievedAt) > staleMs
  )
    status = 'stale';
  const showNoData = status === 'error' || status === 'unavailable';
  const noDataReason =
    status === 'error'
      ? error || reading?.message || 'Measurement request failed.'
      : 'No current reading.';
  const missingCount = isTotalTile(widget)
    ? (reading?.missingInputs?.length ?? 0)
    : 0;
  const value = reading?.value;
  const rangeState = evaluateRange(value, widget.range).state;
  const alarm =
    status === 'ok' && (rangeState === 'low' || rangeState === 'high');
  const gauge = widget.display === 'gauge' && (widget.scale ?? widget.range);
  const bar = widget.display === 'bar' && (widget.scale ?? widget.range);
  const normalColor = widget.normalColor ?? widget.range?.color ?? '#32a852';
  const rangeLabel =
    rangeState === 'low'
      ? 'Below lower limit'
      : rangeState === 'high'
        ? 'Above upper limit'
        : 'Within range';
  return (
    <article
      className={`metric-tile ${isTotalTile(widget) ? 'total-tile' : ''} state-${status} ${widget.w < 3 || widget.h < 3 ? 'compact-tile' : ''} ${widget.display === 'status' ? 'traffic-light-tile' : ''} ${widget.display === 'status' && (widget.w < 2 || widget.h < 2) ? 'traffic-light-tile--mini' : ''} ${gauge ? 'gauge-tile' : ''} ${alarm ? 'range-alarm' : ''}`}
      style={
        {
          backgroundColor: widget.backgroundColor,
          '--range-color':
            status === 'ok' &&
            (widget.range ||
              (defaults?.normalColor &&
                original.useDashboardDefaults !== false))
              ? normalColor
              : undefined,
        } as CSSProperties
      }
    >
      <header
        className={
          legacyGraph
            ? 'graph-tile-header'
            : editing
              ? 'drag-handle'
              : undefined
        }
      >
        {!legacyGraph && (
          <div className="tile-top">
            <span className="tile-device">
              {editing && <span aria-hidden="true">⠿ </span>}
              {isTotalTile(widget)
                ? `Total · ${widget.sources.length} values`
                : widget.deviceName}
            </span>
          </div>
        )}
        <h2 className={legacyGraph && editing ? 'drag-handle' : undefined}>
          {legacyGraph && editing && <span aria-hidden="true">⠿ </span>}
          {widget.label}
        </h2>
        {legacyGraph && (
          <div ref={setGraphControlsTarget} className="graph-header-controls" />
        )}
      </header>
      {isTotalTile(widget) && missingCount > 0 && (
        <div className="total-warning" role="status" title={reading?.message}>
          ⚠ {missingCount} of {widget.sources.length} values missing
        </div>
      )}
      <div className="tile-value-area">
        <div
          className={`tile-error ${status === 'error' ? 'tile-error--failure' : ''}`}
          role={showNoData ? 'status' : undefined}
          aria-hidden={!showNoData}
          title={noDataReason}
          aria-label={`${status === 'error' ? 'Error' : 'No data'}: ${noDataReason}`}
        >
          {status === 'error' ? (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="m9 9 6 6m0-6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3 2 21h20L12 3Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M12 9v5m0 3v1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span>{status === 'error' ? 'Error' : 'No data'}</span>
        </div>
        {widget.display === 'graph' && isMeasurementTile(widget) ? (
          <LineGraph
            series={[
              {
                key: bindingKey(widget.binding),
                label: widget.binding.channel,
                samples: graphSamples,
                color: alarm ? '#c62828' : normalColor,
              },
            ]}
            minutes={widget.graphMinutes ?? 15}
            now={now}
            unit={reading?.unit || widget.unit}
            decimals={widget.decimals}
            controlsTarget={graphControlsTarget}
          />
        ) : gauge ? (
          <Gauge
            value={value}
            unit={reading?.unit || widget.unit}
            decimals={widget.decimals}
            scale={gauge}
            range={widget.range}
            color={normalColor}
            current={status === 'ok'}
          />
        ) : bar ? (
          <BarDisplay
            value={value}
            unit={reading?.unit || widget.unit}
            decimals={widget.decimals}
            scale={bar}
            range={widget.range}
            current={status === 'ok'}
          />
        ) : widget.display === 'status' ? (
          <StatusDisplay
            value={value}
            unit={reading?.unit || widget.unit}
            decimals={widget.decimals}
            range={widget.range}
            status={status}
          />
        ) : widget.display === 'sparkline' && isMeasurementTile(widget) ? (
          <SparklineDisplay
            value={value}
            unit={reading?.unit || widget.unit}
            decimals={widget.decimals}
            samples={graphSamples}
            now={now}
            current={status === 'ok'}
          />
        ) : (
          <NumericValue
            value={
              value !== null && value !== undefined
                ? value.toLocaleString('en-GB', {
                    minimumFractionDigits: widget.decimals,
                    maximumFractionDigits: widget.decimals,
                  })
                : '—'
            }
            unit={reading?.unit || widget.unit}
            minimumIntegerDigits={isTotalTile(widget) ? 4 : 0}
          />
        )}
      </div>
      {widget.range && !gauge && (
        <div className="range-caption">
          {status === 'ok' ? rangeLabel : 'Limits'}: {widget.range.min}–
          {widget.range.max} {reading?.unit || widget.unit}
        </div>
      )}
      <div className="tile-bottom">
        <span>
          {isTotalTile(widget) ? (
            <span
              title={widget.sources
                .map((source) => `${source.deviceName}: ${source.label}`)
                .join(' + ')}
            >
              Σ {widget.sources.map((source) => source.label).join(' + ')}
            </span>
          ) : (
            <>
              {widget.binding.channel} <span className="separator">/</span>{' '}
              {widget.binding.project}
            </>
          )}
        </span>
        <span
          title={
            reading?.sourceTimestampNs
              ? `${reading.sourceTimestampNs} ns`
              : 'Source timestamp unavailable'
          }
        >
          {reading?.sourceTime
            ? time(reading.sourceTime)
            : reading
              ? `Fetched ${time(reading.retrievedAt)}`
              : 'No reading yet'}
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
export default function App() {
  const importFile = useRef<HTMLInputElement>(null);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeId, setActiveId] = useState(
    () => new URLSearchParams(window.location.search).get('dashboard') ?? '',
  );
  const [displayMode, setDisplayMode] = useState(
    () => new URLSearchParams(window.location.search).get('view') === 'display',
  );
  const [historyOpen, setHistoryOpen] = useState(
    () => new URLSearchParams(window.location.search).get('view') === 'history',
  );
  const [eventHistoryOpen, setEventHistoryOpen] = useState(
    () => new URLSearchParams(window.location.search).get('view') === 'events',
  );
  const [deviceHistoryOpen, setDeviceHistoryOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get('view') ===
      'device-history',
  );
  const [historyJump, setHistoryJump] = useState<HistoryJump>();
  const [rotationSeconds, setRotationSeconds] = useState(() =>
    rotationIntervals.some((seconds) => seconds === initialRotationSeconds)
      ? initialRotationSeconds
      : 0,
  );
  const [chosenRotationSeconds, setChosenRotationSeconds] = useState(
    rotationSeconds || 30,
  );
  const [jumpToAlarms, setJumpToAlarms] = useState(true);
  const [alarmFocusId, setAlarmFocusId] = useState<string>();
  const acknowledgedAlarmIds = useRef(new Set<string>());
  const seenAlarmIds = useRef(new Set<string>());
  const alarmStatuses = useAlarmStatuses(dashboards.length > 0);
  const alarmSound = useAlarmSound();
  const fullscreen = useFullscreen();
  function dashboardUrl(
    id: string,
    display: boolean,
    history: 'history' | 'events' | 'device-history' | null = null,
  ) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('dashboard', id);
    else url.searchParams.delete('dashboard');
    if (display) url.searchParams.set('view', 'display');
    else if (history) url.searchParams.set('view', history);
    else url.searchParams.delete('view');
    if (rotationSeconds)
      url.searchParams.set('rotate', String(rotationSeconds));
    else url.searchParams.delete('rotate');
    return url.pathname + url.search;
  }
  const [draft, setDraft] = useState<Dashboard>();
  const [config, setConfig] = useState<{
    mock: boolean;
    source: 'mock' | 'gridvis' | 'modbus';
    staleMs: number;
    sourceRevision: number;
    hasSavedDeviceHistory?: boolean;
    version?: string;
    storageSettingsVisible?: boolean;
    serverSettingsVisible?: boolean;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [arrangingGroups, setArrangingGroups] = useState(false);
  const [positioningTiles, setPositioningTiles] = useState(false);
  const [placementRevision, setPlacementRevision] = useState(0);
  const [dateTimeEditor, setDateTimeEditor] = useState<DateTimeTile | 'new'>();
  const [totalEditor, setTotalEditor] = useState<TotalTile | 'new'>();
  const [graphEditor, setGraphEditor] = useState<GraphTile | 'new'>();
  const [consumptionEditor, setConsumptionEditor] = useState<
    ConsumptionTile | 'new'
  >();
  const [logEditor, setLogEditor] = useState<LogTile | 'new'>();
  const [textEditor, setTextEditor] = useState<TextTileModel | 'new'>();
  const [tileEditor, setTileEditor] = useState<
    DashboardTile | 'new' | 'bulk'
  >();
  const [copyingGroup, setCopyingGroup] = useState<DashboardGroup>();
  const [groupEditor, setGroupEditor] = useState<DashboardGroup | 'new'>();
  const [newTileGroup, setNewTileGroup] = useState<string>();
  function addTile(groupId?: string) {
    setNewTileGroup(groupId);
    setTileEditor('new');
  }
  const [dialog, setDialog] = useState<'create' | 'delete'>();
  const [dashboardSettingsDialog, setDashboardSettingsDialog] = useState<
    'general' | 'shared'
  >();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [sourceSettingsOpen, setSourceSettingsOpen] = useState(false);
  const [collectorSettingsOpen, setCollectorSettingsOpen] = useState(false);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [notificationSettingsOpen, setNotificationSettingsOpen] =
    useState(false);
  const [soundSettingsOpen, setSoundSettingsOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsNavigationOpen, setSettingsNavigationOpen] = useState(false);
  const [draggedDashboardId, setDraggedDashboardId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    after: boolean;
  }>();
  const [newName, setNewName] = useState('');
  const [now, setNow] = useState(Date.now());
  const { width, containerRef, mounted, measureWidth } = useContainerWidth();
  useEffect(() => {
    if ((historyOpen || eventHistoryOpen || deviceHistoryOpen) && !displayMode)
      return;
    const node = containerRef.current;
    if (!node) return;
    // History removes the grid node; reconnect measurement to the new node.
    measureWidth();
    const observer = new ResizeObserver(measureWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    historyOpen,
    eventHistoryOpen,
    deviceHistoryOpen,
    displayMode,
    measureWidth,
  ]);
  const active = dashboards.find((d) => d.id === activeId);
  const rawShown = draft ?? active;
  const {
    readings,
    graphHistory,
    events,
    error: readingError,
    changed,
    loading,
    lastRefresh,
  } = useReadings(active, config?.sourceRevision, historyVersion);
  const resolution = dashboardResolutionSchema.safeParse(rawShown?.resolution)
    .success
    ? rawShown?.resolution
    : undefined;
  const gridWidth = resolution?.width ?? width;
  const shown = useMemo(
    () =>
      rawShown && {
        ...rawShown,
        widgets: snapLinkedWidgets(
          rawShown.widgets,
          rawShown.tileLinks,
          gridWidth,
          (rawShown.groupLayoutWidth ?? gridWidth) - 40,
        ),
      },
    [rawShown, gridWidth],
  );
  const editing = Boolean(draft) && !displayMode;
  useEffect(() => {
    if (!alarmStatuses) return;
    const activeIds = new Set(
      alarmStatuses.dashboards
        .filter((dashboard) => dashboard.active)
        .map((dashboard) => dashboard.id),
    );
    const newlyActive = [...activeIds].filter(
      (id) => !seenAlarmIds.current.has(id),
    );
    seenAlarmIds.current = activeIds;
    if (
      alarmSound.enabled &&
      !editing &&
      newlyActive.some(
        (id) => id === activeId || (rotationSeconds > 0 && jumpToAlarms),
      )
    )
      alarmSound.play();
  }, [
    alarmStatuses,
    alarmSound.enabled,
    alarmSound.play,
    activeId,
    editing,
    rotationSeconds,
    jumpToAlarms,
  ]);
  useEffect(() => {
    if (!rotationSeconds || !jumpToAlarms || draft || booting) {
      setAlarmFocusId(undefined);
      acknowledgedAlarmIds.current.clear();
      return;
    }
    if (!alarmStatuses) return;
    const activeIds = new Set(
      alarmStatuses.dashboards
        .filter((dashboard) => dashboard.active)
        .map((dashboard) => dashboard.id),
    );
    for (const id of acknowledgedAlarmIds.current)
      if (!activeIds.has(id)) acknowledgedAlarmIds.current.delete(id);
    if (alarmFocusId && activeIds.has(alarmFocusId)) return;
    const next = dashboards.find(
      (dashboard) =>
        activeIds.has(dashboard.id) &&
        !acknowledgedAlarmIds.current.has(dashboard.id),
    );
    setAlarmFocusId(next?.id);
    if (next && next.id !== activeId) setActiveId(next.id);
  }, [
    alarmStatuses,
    rotationSeconds,
    jumpToAlarms,
    draft,
    booting,
    alarmFocusId,
    dashboards,
    activeId,
  ]);
  function resumeRotation() {
    for (const dashboard of alarmStatuses?.dashboards ?? [])
      if (dashboard.active) acknowledgedAlarmIds.current.add(dashboard.id);
    setAlarmFocusId(undefined);
  }
  useEffect(() => {
    setArrangingGroups(false);
  }, [editing, activeId]);
  async function load(preferred?: string) {
    const [items, settings] = await Promise.all([
      api<Dashboard[]>('/dashboards'),
      api<{
        mock: boolean;
        source: 'mock' | 'gridvis' | 'modbus';
        staleMs: number;
        sourceRevision: number;
        hasSavedDeviceHistory?: boolean;
        version?: string;
        storageSettingsVisible?: boolean;
        serverSettingsVisible?: boolean;
      }>('/config'),
    ]);
    setDashboards(items);
    setConfig(settings);
    setActiveId((id) =>
      items.some((d) => d.id === (preferred ?? id))
        ? (preferred ?? id)
        : displayMode
          ? (preferred ?? id)
          : (items[0]?.id ?? ''),
    );
  }
  useEffect(() => {
    void load()
      .catch((e) => setError(message(e)))
      .finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!booting && (active || eventHistoryOpen || deviceHistoryOpen))
      window.history.replaceState(
        null,
        '',
        dashboardUrl(
          active?.id ?? '',
          displayMode,
          historyOpen
            ? 'history'
            : eventHistoryOpen
              ? 'events'
              : deviceHistoryOpen
                ? 'device-history'
                : null,
        ),
      );
  }, [
    booting,
    active?.id,
    displayMode,
    historyOpen,
    eventHistoryOpen,
    deviceHistoryOpen,
    rotationSeconds,
  ]);
  useEffect(() => {
    if (
      !rotationSeconds ||
      alarmFocusId ||
      booting ||
      busy ||
      draft ||
      !active ||
      dashboards.length < 2
    )
      return;
    const timer = window.setTimeout(() => {
      const index = dashboards.findIndex(
        (dashboard) => dashboard.id === activeId,
      );
      setActiveId(dashboards[(index + 1) % dashboards.length].id);
    }, rotationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [
    rotationSeconds,
    alarmFocusId,
    booting,
    busy,
    draft,
    activeId,
    dashboards,
  ]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!draft) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function uploadDashboard(file: File) {
    await action(async () => {
      if (file.size > MAX_DASHBOARD_FILE_BYTES)
        throw new Error('Dashboard files must be 4 MB or smaller.');
      const bodies = importDashboards(await file.text());
      const created =
        bodies.length === 1
          ? [
              await api<Dashboard>('/dashboards', {
                method: 'POST',
                body: JSON.stringify(bodies[0]),
              }),
            ]
          : await api<Dashboard[]>('/dashboards/batch', {
              method: 'POST',
              body: JSON.stringify(bodies),
            });
      setDashboards((items) => [...created].reverse().concat(items));
      setActiveId(created[0].id);
    });
  }
  function downloadDashboards(selected: Dashboard[]) {
    const blob = new Blob([exportDashboards(selected)], {
      type: 'application/json',
    });
    if (blob.size > MAX_DASHBOARD_FILE_BYTES)
      throw new Error('Dashboard exports must be 4 MB or smaller.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      selected.length === 1
        ? `${selected[0].name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'dashboard'}.json`
        : 'phasepanel-dashboards.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function save() {
    if (!draft) return;
    await action(async () => {
      const { id, updatedAt: _, ...body } = draft;
      const tileLinks = validTileLinks(body.tileLinks, body.widgets);
      body.tileLinks = tileLinks.length ? tileLinks : undefined;
      body.widgets = snapLinkedWidgets(
        body.widgets,
        body.tileLinks,
        gridWidth,
        (body.groupLayoutWidth ?? gridWidth) - 40,
      );
      const saved = await api<Dashboard>(`/dashboards/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setDashboards((list) => list.map((d) => (d.id === saved.id ? saved : d)));
      setDraft(undefined);
      setDashboardSettingsDialog(undefined);
    });
  }
  async function saveDashboardOrder(reordered: Dashboard[]) {
    if (reordered === dashboards) return;
    const previous = dashboards;
    setDashboards(reordered);
    await action(async () => {
      try {
        const saved = await api<Dashboard[]>('/dashboards/order', {
          method: 'PUT',
          body: JSON.stringify({
            ids: reordered.map((dashboard) => dashboard.id),
          }),
        });
        setDashboards(saved);
      } catch (failure) {
        setDashboards(previous);
        throw failure;
      }
    });
  }
  function updateLayout(layout: Layout, groupId?: string) {
    if (!editing) return;
    setDraft((d) => {
      if (!d) return d;
      const widgets = d.widgets.map((w) => {
        const item =
          w.groupId === groupId ? layout.find((l) => l.i === w.id) : undefined;
        return item ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h } : w;
      });
      return JSON.stringify(widgets) === JSON.stringify(d.widgets)
        ? d
        : { ...d, widgets };
    });
  }
  const groups = shown?.groups ?? [];
  const ungrouped = shown?.widgets.filter((w) => !w.groupId) ?? [];
  const sections = [
    ...groups.map((group) => ({
      group,
      widgets: shown!.widgets.filter((w) => w.groupId === group.id),
    })),
    ...(ungrouped.length ? [{ group: undefined, widgets: ungrouped }] : []),
  ];
  const linkedTileIds = new Set(
    validTileLinks(shown?.tileLinks, shown?.widgets ?? []).flat(),
  );
  const layoutFor = (widgets: DashboardTile[]) =>
    widgets.map((w) => ({
      i: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      minW: 1,
      minH: 1,
      isResizable: !linkedTileIds.has(w.id),
    }));
  const failures = readings.filter((r) => r.status === 'error').length;
  const rotationControls = (
    <div className="rotation-controls">
      <label>
        Switch every{' '}
        <select
          aria-label="Dashboard rotation interval"
          value={chosenRotationSeconds}
          onChange={(event) => {
            const seconds = Number(event.target.value);
            setChosenRotationSeconds(seconds);
            if (rotationSeconds) setRotationSeconds(seconds);
          }}
        >
          {rotationIntervals.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minutes`}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={
          busy || booting || (dashboards.length < 2 && !rotationSeconds)
        }
        onClick={() =>
          setRotationSeconds(rotationSeconds ? 0 : chosenRotationSeconds)
        }
      >
        {rotationSeconds ? 'Stop rotation' : 'Start rotation'}
      </button>
      <button
        type="button"
        className={`alarm-jump-button ${jumpToAlarms ? 'is-on' : ''}`}
        aria-pressed={jumpToAlarms}
        title="During rotation, show an alarming dashboard until its readings recover."
        onClick={() => setJumpToAlarms((enabled) => !enabled)}
      >
        Jump to alarms
      </button>
    </div>
  );
  const fullscreenButton = (
    <button
      className="fullscreen-button"
      disabled={busy || fullscreen.pending || !fullscreen.supported}
      title={
        fullscreen.supported
          ? 'Use the entire screen. Press Esc to leave fullscreen.'
          : 'Fullscreen is not supported by this browser.'
      }
      onClick={() => {
        if (!fullscreen.fullscreen) {
          setDisplayMode(true);
          window.history.replaceState(null, '', dashboardUrl(activeId, true));
        }
        void fullscreen.toggle();
      }}
    >
      {fullscreen.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    </button>
  );
  const alarmSoundButton = (
    <button
      type="button"
      className={`alarm-sound-button ${alarmSound.enabled ? 'is-on' : 'is-off'}`}
      aria-label={alarmSound.enabled ? 'Sound alerts on' : 'Sound alerts off'}
      aria-pressed={alarmSound.enabled}
      title={
        alarmSound.enabled
          ? 'Sound alerts on in this tab. Click to mute.'
          : 'Sound alerts off. Click to enable in this tab.'
      }
      onClick={() => void alarmSound.toggle()}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {alarmSound.enabled ? (
          <>
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M18.5 6a8 8 0 0 1 0 12" />
          </>
        ) : (
          <path d="m17 9 5 6m0-6-5 6" />
        )}
      </svg>
    </button>
  );
  const alarmSoundControls = (
    <div className="alarm-sound-controls">
      {alarmSoundButton}
      <button
        type="button"
        className="alarm-sound-settings-button"
        aria-label="Sound settings"
        title="Choose alarm sound and volume"
        onClick={() => setSoundSettingsOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2" fill="white" />
          <circle cx="16" cy="12" r="2" fill="white" />
          <circle cx="11" cy="18" r="2" fill="white" />
        </svg>
      </button>
    </div>
  );

  return (
    <div
      style={
        {
          '--dashboard-background-color': shown?.backgroundColor,
          '--dashboard-background-image': shown?.backgroundImage
            ? `url("${shown.backgroundImage}")`
            : undefined,
        } as CSSProperties
      }
      className={`app-shell ${displayMode ? 'display-mode' : ''} ${displayMode && fullscreen.fullscreen ? 'fullscreen-mode' : ''} ${sidebarCollapsed && !displayMode ? 'sidebar-collapsed' : ''} ${(historyOpen || eventHistoryOpen || deviceHistoryOpen) && !displayMode ? 'history-mode' : ''}`}
    >
      {displayMode && fullscreen.fullscreen && (
        <div className="fullscreen-controls">
          {active && alarmSoundControls}
          <button
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
            onClick={() => void fullscreen.toggle()}
          >
            Exit fullscreen
          </button>
        </div>
      )}
      {!displayMode && (
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <a
              className="brand"
              href="/"
              aria-label="PhasePanel dashboards"
              onClick={(e) => e.preventDefault()}
            >
              <span className="brand-icon">
                <Bolt />
              </span>
              <span className="brand-wordmark">
                PhasePanel<span className="brand-sub">LIVE DASHBOARDS</span>
              </span>
            </a>
            <button
              className="sidebar-toggle"
              aria-label={
                sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
              }
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={sidebarCollapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
              </svg>
            </button>
          </div>
          {!settingsNavigationOpen && (
            <div className="sidebar-dashboard-section">
              <div className="nav-heading">
                <span>DASHBOARDS</span>
                <span>{dashboards.length.toString().padStart(2, '0')}</span>
              </div>
              <nav aria-label="Dashboards">
                {dashboards.map((d) => (
                  <button
                    className={`nav-item ${d.id === activeId && !historyOpen && !eventHistoryOpen && !deviceHistoryOpen ? 'selected' : ''} ${d.id === draggedDashboardId ? 'dragging' : ''} ${dropTarget?.id === d.id ? (dropTarget.after ? 'drop-after' : 'drop-before') : ''}`}
                    key={d.id}
                    aria-label={d.name}
                    aria-current={
                      d.id === activeId &&
                      !historyOpen &&
                      !eventHistoryOpen &&
                      !deviceHistoryOpen
                        ? 'page'
                        : undefined
                    }
                    title={`${d.name} — drag to reorder, or use Alt+Arrow keys`}
                    disabled={editing || busy}
                    draggable={!editing && !busy}
                    onDragStart={(event) => {
                      setDraggedDashboardId(d.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', d.id);
                    }}
                    onDragOver={(event) => {
                      if (!draggedDashboardId || draggedDashboardId === d.id)
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const after =
                        event.clientY > bounds.top + bounds.height / 2;
                      setDropTarget((current) =>
                        current?.id === d.id && current.after === after
                          ? current
                          : { id: d.id, after },
                      );
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const after =
                        event.clientY > bounds.top + bounds.height / 2;
                      if (draggedDashboardId)
                        void saveDashboardOrder(
                          moveDashboard(
                            dashboards,
                            draggedDashboardId,
                            d.id,
                            after,
                          ),
                        );
                      setDraggedDashboardId(undefined);
                      setDropTarget(undefined);
                    }}
                    onDragEnd={() => {
                      setDraggedDashboardId(undefined);
                      setDropTarget(undefined);
                    }}
                    onKeyDown={(event) => {
                      if (!event.altKey || editing || busy) return;
                      const direction =
                        event.key === 'ArrowUp'
                          ? -1
                          : event.key === 'ArrowDown'
                            ? 1
                            : 0;
                      if (!direction) return;
                      event.preventDefault();
                      const index = dashboards.findIndex(
                        (item) => item.id === d.id,
                      );
                      const target = dashboards[index + direction];
                      if (target)
                        void saveDashboardOrder(
                          moveDashboard(
                            dashboards,
                            d.id,
                            target.id,
                            direction > 0,
                          ),
                        );
                    }}
                    onClick={() => {
                      if (alarmFocusId) resumeRotation();
                      setActiveId(d.id);
                      setHistoryOpen(false);
                      setEventHistoryOpen(false);
                      setDeviceHistoryOpen(false);
                      setError('');
                    }}
                  >
                    <span className="nav-drag-handle" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className="grid-icon" aria-hidden="true">
                      ▦
                    </span>
                    <span className="nav-item-name">{d.name}</span>
                    {d.id === activeId &&
                      !historyOpen &&
                      !eventHistoryOpen &&
                      !deviceHistoryOpen && <span className="nav-indicator" />}
                  </button>
                ))}
              </nav>
              <button
                className="new-dashboard"
                aria-label="New dashboard"
                title={sidebarCollapsed ? 'New dashboard' : undefined}
                disabled={editing || busy}
                onClick={() => {
                  setNewName('');
                  setDialog('create');
                }}
              >
                <span className="new-dashboard-icon" aria-hidden="true">
                  ＋
                </span>
                <span className="new-dashboard-label">New dashboard</span>
              </button>
            </div>
          )}
          <input
            ref={importFile}
            type="file"
            accept=".json,application/json"
            aria-label="Dashboard import file"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void uploadDashboard(file);
            }}
          />
          <div
            className={`sidebar-bottom ${settingsNavigationOpen ? 'settings-navigation' : ''}`}
          >
            {!settingsNavigationOpen && (
              <>
                <div className="sidebar-history">
                  <div className="sidebar-section-heading">HISTORY</div>
                  <button
                    className={`sidebar-utility-button ${historyOpen ? 'selected' : ''}`}
                    aria-label="Value history"
                    aria-current={historyOpen ? 'page' : undefined}
                    title={sidebarCollapsed ? 'Value history' : undefined}
                    disabled={editing || busy || booting}
                    onClick={() => {
                      setHistoryJump(undefined);
                      setHistoryOpen(true);
                      setEventHistoryOpen(false);
                      setDeviceHistoryOpen(false);
                      setRotationSeconds(0);
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 18h18M4 14l5-5 4 3 7-8" />
                    </svg>
                    <span className="sidebar-utility-label">Value history</span>
                  </button>
                  <button
                    className={`sidebar-utility-button ${eventHistoryOpen ? 'selected' : ''}`}
                    aria-label="Event history"
                    aria-current={eventHistoryOpen ? 'page' : undefined}
                    title={
                      config?.source !== 'modbus'
                        ? 'Event history requires Direct Modbus/TCP with FTP.'
                        : sidebarCollapsed
                          ? 'Event history'
                          : undefined
                    }
                    disabled={
                      editing || busy || booting || config?.source !== 'modbus'
                    }
                    onClick={() => {
                      setEventHistoryOpen(true);
                      setHistoryOpen(false);
                      setDeviceHistoryOpen(false);
                      setRotationSeconds(0);
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3 2.5 20h19L12 3ZM12 9v5m0 3h.01" />
                    </svg>
                    <span className="sidebar-utility-label">Event history</span>
                  </button>
                  <button
                    className={`sidebar-utility-button ${deviceHistoryOpen ? 'selected' : ''}`}
                    aria-label="Device history"
                    aria-current={deviceHistoryOpen ? 'page' : undefined}
                    title={sidebarCollapsed ? 'Device history' : undefined}
                    disabled={
                      editing ||
                      busy ||
                      booting ||
                      (config?.source !== 'modbus' &&
                        !config?.hasSavedDeviceHistory)
                    }
                    onClick={() => {
                      setDeviceHistoryOpen(true);
                      setHistoryOpen(false);
                      setEventHistoryOpen(false);
                      setRotationSeconds(0);
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 18h18M4 14l4-4 4 2 4-6 4 2M4 4h16" />
                    </svg>
                    <span className="sidebar-utility-label">
                      Device history
                    </span>
                  </button>
                </div>
                <div className="sidebar-tools">
                  <div className="sidebar-section-heading">DASHBOARD TOOLS</div>
                  <button
                    className="sidebar-utility-button"
                    aria-label="Export dashboards"
                    title={sidebarCollapsed ? 'Export dashboards' : undefined}
                    disabled={
                      editing || busy || booting || dashboards.length === 0
                    }
                    onClick={() => setExportOpen(true)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 4v12m-4-4 4 4 4-4M4 18v2h16v-2" />
                    </svg>
                    <span className="sidebar-utility-label">
                      Export dashboards
                    </span>
                  </button>
                  <button
                    className="sidebar-utility-button"
                    aria-label="Import dashboard"
                    title={sidebarCollapsed ? 'Import dashboard' : undefined}
                    disabled={editing || busy || booting}
                    onClick={() => importFile.current?.click()}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 16V4m-4 4 4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                    </svg>
                    <span className="sidebar-utility-label">
                      Import dashboard
                    </span>
                  </button>
                </div>
                <div className="sidebar-settings">
                  <button
                    className="sidebar-utility-button"
                    aria-label="Settings"
                    title={sidebarCollapsed ? 'Settings' : undefined}
                    aria-controls="sidebar-settings-navigation"
                    aria-expanded={settingsNavigationOpen}
                    disabled={editing || busy || booting}
                    onClick={() => setSettingsNavigationOpen(true)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 7h8m4 0h4M4 17h4m4 0h8" />
                      <circle cx="14" cy="7" r="2" />
                      <circle cx="10" cy="17" r="2" />
                    </svg>
                    <span className="sidebar-utility-label">Settings</span>
                  </button>
                </div>
              </>
            )}
            {settingsNavigationOpen && (
              <nav
                id="sidebar-settings-navigation"
                className="sidebar-settings"
                aria-label="Settings"
              >
                <button
                  className="sidebar-utility-button sidebar-settings-back"
                  aria-label="Back to dashboards"
                  title={sidebarCollapsed ? 'Back to dashboards' : undefined}
                  onClick={() => setSettingsNavigationOpen(false)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m12 5-7 7 7 7M5 12h14" />
                  </svg>
                  <span className="sidebar-utility-label">
                    Back to dashboards
                  </span>
                </button>
                <div className="sidebar-section-heading">SETTINGS</div>
                <button
                  className="sidebar-utility-button"
                  aria-label="Source settings"
                  title={sidebarCollapsed ? 'Source settings' : undefined}
                  disabled={editing || busy || booting}
                  onClick={() => setSourceSettingsOpen(true)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 7h8m4 0h4M4 17h4m4 0h8" />
                    <circle cx="14" cy="7" r="2" />
                    <circle cx="10" cy="17" r="2" />
                  </svg>
                  <span className="sidebar-utility-label">Source settings</span>
                </button>
                <button
                  className="sidebar-utility-button"
                  aria-label="Collector settings"
                  title={sidebarCollapsed ? 'Collector settings' : undefined}
                  disabled={editing || busy || booting}
                  onClick={() => setCollectorSettingsOpen(true)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2M3 12h2m14 0h2" />
                  </svg>
                  <span className="sidebar-utility-label">
                    Collector settings
                  </span>
                </button>
                {config?.storageSettingsVisible && (
                  <button
                    className="sidebar-utility-button"
                    aria-label="Data location"
                    title={sidebarCollapsed ? 'Data location' : undefined}
                    disabled={editing || busy || booting}
                    onClick={() => setStorageSettingsOpen(true)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 7h7l2 2h9v10H3zM3 7V5h8l2 2" />
                    </svg>
                    <span className="sidebar-utility-label">Data location</span>
                  </button>
                )}
                {config?.serverSettingsVisible && (
                  <button
                    className="sidebar-utility-button"
                    aria-label="Server address"
                    title={sidebarCollapsed ? 'Server address' : undefined}
                    disabled={editing || busy || booting}
                    onClick={() => setServerSettingsOpen(true)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M3 9h18M8 14h2m4 0h2" />
                    </svg>
                    <span className="sidebar-utility-label">
                      Server address
                    </span>
                  </button>
                )}
                <button
                  className="sidebar-utility-button"
                  aria-label="Notifications"
                  title={sidebarCollapsed ? 'Notifications' : undefined}
                  disabled={editing || busy || booting}
                  onClick={() => setNotificationSettingsOpen(true)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                  </svg>
                  <span className="sidebar-utility-label">Notifications</span>
                </button>
                <button
                  className="sidebar-utility-button"
                  aria-label="Updates"
                  title={sidebarCollapsed ? 'Updates' : undefined}
                  disabled={editing || busy || booting}
                  onClick={() => setUpdatesOpen(true)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 2M18 17a7 7 0 0 1-12 2l-2-2" />
                  </svg>
                  <span className="sidebar-utility-label">Updates</span>
                </button>
              </nav>
            )}
            <div className="source-label">
              <span className="source-mode-label">Mode:</span>
              {config?.mock
                ? 'Demo data source'
                : config?.source === 'modbus'
                  ? 'Direct Modbus/TCP'
                  : 'GridVis REST API'}
            </div>
            {config?.mock && <p>Simulated values for exploration.</p>}
            <div className="sidebar-foot">
              <span className="sidebar-copyright">© MME89 2026</span>
              <div className="sidebar-footer-links">
                {config?.version && (
                  <span className="sidebar-version">v{config.version}</span>
                )}
                <a
                  className="sidebar-github-link"
                  href="https://github.com/mme89/PhasePanel"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub repository"
                  title="GitHub repository"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.01-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.15a10.78 10.78 0 0 1 5.62 0c2.14-1.45 3.08-1.15 3.08-1.15.62 1.55.23 2.7.12 2.98.72.78 1.16 1.78 1.16 3.01 0 4.33-2.63 5.29-5.14 5.57.4.35.76 1.03.76 2.08v3.1c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </aside>
      )}
      <div className="main-shell">
        <main>
          {historyOpen && !displayMode ? (
            <HistoryView
              dashboards={dashboards}
              version={historyVersion}
              jump={historyJump}
            />
          ) : eventHistoryOpen && !displayMode ? (
            <EventHistoryView
              source={config?.source}
              onViewValues={(jump) => {
                setHistoryJump(jump);
                setHistoryOpen(true);
                setEventHistoryOpen(false);
                setDeviceHistoryOpen(false);
                setRotationSeconds(0);
              }}
            />
          ) : deviceHistoryOpen && !displayMode ? (
            <DeviceHistoryView
              source={config?.source}
              onSavedHistoryChange={(hasSavedDeviceHistory) =>
                setConfig((current) =>
                  current ? { ...current, hasSavedDeviceHistory } : current,
                )
              }
            />
          ) : (
            <>
              {displayMode ? (
                <header className="display-header">
                  <div className="display-title">
                    <h1>
                      {shown?.name ??
                        (booting
                          ? 'Loading dashboard…'
                          : 'Dashboard unavailable')}
                    </h1>
                    {config?.mock && (
                      <span
                        className="demo-badge"
                        title="Simulated measurements; no live GridVis server is connected."
                      >
                        MOCK MODE
                      </span>
                    )}
                  </div>
                  <div className="display-actions">
                    {active && (
                      <div className="action-group">{rotationControls}</div>
                    )}
                    <div className="action-group">
                      {active && alarmSoundControls}
                      {active && fullscreenButton}
                      <a
                        className="button-link"
                        href={dashboardUrl(activeId, false)}
                      >
                        Show workspace
                      </a>
                    </div>
                  </div>
                </header>
              ) : (
                <div className="page-heading">
                  <div>
                    <div className="page-title-line">
                      <h1>{shown?.name ?? 'Your energy, at a glance.'}</h1>
                      {config?.mock && (
                        <span className="demo-badge">MOCK MODE</span>
                      )}
                    </div>
                    {!shown && (
                      <p className="page-description">
                        Bring your measurements together in a dashboard.
                      </p>
                    )}
                  </div>
                  {active && (
                    <div className="heading-actions">
                      {editing ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await load(activeId);
                                setDraft(undefined);
                                setDashboardSettingsDialog(undefined);
                              })
                            }
                          >
                            Cancel
                          </button>
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              !dashboardInput.safeParse({
                                name: draft!.name,
                                refreshSeconds: draft!.refreshSeconds,
                                resolution: draft!.resolution,
                                groupLayoutWidth: draft!.groupLayoutWidth,
                                ungroupedOnCanvas: draft!.ungroupedOnCanvas,
                                minimumTileSize: draft!.minimumTileSize,
                                widgets: draft!.widgets,
                                groups: draft!.groups,
                                displayDefaults: draft!.displayDefaults,
                                measurementDefaults: draft!.measurementDefaults,
                              }).success
                            }
                            onClick={() => void save()}
                          >
                            {busy ? 'Saving…' : 'Save dashboard'}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="action-group">{rotationControls}</div>
                          <div className="action-group">
                            {alarmSoundControls}
                            <a
                              className="button-link"
                              href={dashboardUrl(active.id, true)}
                            >
                              Dashboard only
                            </a>
                            {fullscreenButton}
                          </div>
                          <div className="action-group">
                            <button
                              disabled={busy}
                              onClick={() => {
                                setRotationSeconds(0);
                                setDashboardSettingsDialog(undefined);
                                setDraft(
                                  fixedCanvasDashboard(
                                    editableDashboard(active),
                                    containerRef.current,
                                  ),
                                );
                                setError('');
                              }}
                            >
                              <span aria-hidden="true">✎ </span>Edit dashboard
                            </button>
                            <button
                              className="delete-dashboard-button"
                              disabled={busy}
                              onClick={() => setDialog('delete')}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M4 7h16m-10-3h4M6 7l1 13h10l1-13M10 11v6m4-6v6" />
                              </svg>
                              Delete dashboard
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {fullscreen.error && (
                <div className="notice error" role="alert">
                  {fullscreen.error}
                  <button onClick={fullscreen.clearError}>Dismiss</button>
                </div>
              )}
              {alarmFocusId && rotationSeconds > 0 && (
                <div className="notice alarm-focus-notice" role="status">
                  Alarm on {active?.name ?? 'dashboard'} · Rotation paused
                  <button type="button" onClick={resumeRotation}>
                    Resume rotation
                  </button>
                </div>
              )}
              {alarmSound.audioError && (
                <div className="notice error" role="alert">
                  {alarmSound.audioError}
                </div>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                  {!editing && (
                    <button onClick={() => void action(() => load())}>
                      Reload
                    </button>
                  )}
                </div>
              )}
              {config?.mock && !displayMode && (
                <div className="demo-notice">
                  <span className="demo-symbol">◈</span>
                  <span>
                    <strong>Demo workspace</strong> You’re viewing simulated
                    measurements. No live GridVis server is connected.
                  </span>
                </div>
              )}
              {changed && (
                <div className="notice">
                  This dashboard has changed in another session.{' '}
                  {editing ? (
                    'Cancel to load the latest version.'
                  ) : (
                    <button onClick={() => void action(() => load(activeId))}>
                      Load latest
                    </button>
                  )}
                </div>
              )}
              {readingError && (
                <div className="notice error" role="alert">
                  Connection error: {readingError} Retrying automatically.
                </div>
              )}
              {editing && (
                <section
                  className="edit-toolbar"
                  aria-label="Dashboard settings"
                >
                  <div className="editor-intro">
                    <div>
                      <h2>Dashboard editor</h2>
                    </div>
                    <span className="editor-draft-note">
                      Changes are saved with Save dashboard
                    </span>
                  </div>
                  <div className="editor-settings-list">
                    <button
                      type="button"
                      className="editor-settings-trigger"
                      onClick={() => setDashboardSettingsDialog('general')}
                    >
                      <span className="editor-settings-icon" aria-hidden="true">
                        ⚙
                      </span>
                      <span>
                        <span>General settings</span>
                        <small>Name, refresh, background and canvas</small>
                      </span>
                      <span
                        className="editor-settings-arrow"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    </button>
                    <button
                      type="button"
                      className="editor-settings-trigger"
                      onClick={() => setDashboardSettingsDialog('shared')}
                    >
                      <span className="editor-settings-icon" aria-hidden="true">
                        ◫
                      </span>
                      <span>
                        <span>Shared value settings</span>
                        <small>
                          Scale, alarms, decimals and color by measurement
                        </small>
                      </span>
                      <span
                        className="editor-settings-arrow"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    </button>
                  </div>
                  {dashboardSettingsDialog === 'general' && (
                    <Modal
                      labelledBy="dashboard-general-settings-title"
                      className="dashboard-settings-shell"
                      onClose={() => setDashboardSettingsDialog(undefined)}
                    >
                      <section className="modal dashboard-settings-modal">
                        <h2 id="dashboard-general-settings-title">
                          General settings
                        </h2>
                        <p className="muted">
                          These changes stay in the dashboard draft until you
                          save it.
                        </p>
                        <div className="editor-settings-content dashboard-settings-modal-body">
                          <div className="edit-fields">
                            <label>
                              Dashboard name
                              <input
                                value={draft!.name}
                                maxLength={100}
                                onChange={(e) =>
                                  setDraft(
                                    (d) => d && { ...d, name: e.target.value },
                                  )
                                }
                              />
                            </label>
                            <label>
                              Refresh (seconds)
                              <input
                                type="number"
                                min={1}
                                max={3600}
                                value={draft!.refreshSeconds}
                                onChange={(e) =>
                                  setDraft(
                                    (d) =>
                                      d && {
                                        ...d,
                                        refreshSeconds: Number(e.target.value),
                                      },
                                  )
                                }
                              />
                            </label>
                          </div>
                          <DashboardBackgroundEditor
                            key={draft!.id}
                            dashboard={draft!}
                            disabled={busy}
                            onChange={(background) =>
                              setDraft((d) => d && { ...d, ...background })
                            }
                          />
                          <fieldset className="display-settings">
                            <legend>Canvas resolution</legend>
                            {draft!.resolution && (
                              <>
                                <div className="form-row">
                                  <label>
                                    Canvas width (px)
                                    <input
                                      type="number"
                                      min={640}
                                      max={7680}
                                      step={1}
                                      value={
                                        Number.isFinite(draft!.resolution.width)
                                          ? draft!.resolution.width
                                          : ''
                                      }
                                      onChange={(e) =>
                                        setDraft((d) =>
                                          d?.resolution
                                            ? {
                                                ...d,
                                                resolution: {
                                                  ...d.resolution,
                                                  width:
                                                    e.target.value === ''
                                                      ? NaN
                                                      : Number(e.target.value),
                                                },
                                              }
                                            : d,
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    Canvas height (px)
                                    <input
                                      type="number"
                                      min={360}
                                      max={4320}
                                      step={1}
                                      value={
                                        Number.isFinite(
                                          draft!.resolution.height,
                                        )
                                          ? draft!.resolution.height
                                          : ''
                                      }
                                      onChange={(e) =>
                                        setDraft((d) =>
                                          d?.resolution
                                            ? {
                                                ...d,
                                                resolution: {
                                                  ...d.resolution,
                                                  height:
                                                    e.target.value === ''
                                                      ? NaN
                                                      : Number(e.target.value),
                                                },
                                              }
                                            : d,
                                        )
                                      }
                                    />
                                  </label>
                                </div>
                                {!resolution && (
                                  <p className="field-error" role="alert">
                                    Use whole pixels: width 640–7680 and height
                                    360–4320.
                                  </p>
                                )}
                                <p className="muted">
                                  Set the intended display resolution, for
                                  example 1920 × 1080. Tiles keep this
                                  arrangement on every screen. The preview
                                  scales down; dashboard-only and fullscreen
                                  views fit the canvas into the available space.
                                  Oversized content scrolls inside the canvas.
                                </p>
                              </>
                            )}
                          </fieldset>
                          <TileSizeEditor
                            dashboard={draft!}
                            disabled={busy}
                            onApply={(size) =>
                              setDraft((d) => d && applyTileSize(d, size))
                            }
                          />
                        </div>
                        <footer className="modal-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setDashboardSettingsDialog(undefined)
                            }
                          >
                            Done
                          </button>
                        </footer>
                      </section>
                    </Modal>
                  )}
                  {dashboardSettingsDialog === 'shared' && (
                    <Modal
                      labelledBy="dashboard-shared-settings-title"
                      className="dashboard-settings-shell"
                      onClose={() => setDashboardSettingsDialog(undefined)}
                    >
                      <section className="modal dashboard-settings-modal">
                        <h2 id="dashboard-shared-settings-title">
                          Shared value settings
                        </h2>
                        <p className="muted">
                          Set defaults for measurements used across this
                          dashboard. Save the dashboard to keep them.
                        </p>
                        <div className="dashboard-settings-modal-body">
                          <DashboardDefaultsEditor
                            value={dashboardMeasurementDefaults(draft!)}
                            widgets={draft!.widgets.filter(isMeasurementTile)}
                            onChange={(measurementDefaults) =>
                              setDraft(
                                (d) =>
                                  d && {
                                    ...d,
                                    displayDefaults: undefined,
                                    measurementDefaults,
                                  },
                              )
                            }
                          />
                        </div>
                        <footer className="modal-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setDashboardSettingsDialog(undefined)
                            }
                          >
                            Done
                          </button>
                        </footer>
                      </section>
                    </Modal>
                  )}
                  <div className="editor-layout">
                    <div className="editor-section-heading">
                      <h3>Arrange content</h3>
                      <p>Move and size tiles on the canvas below.</p>
                    </div>
                    <div className="editor-layout-controls">
                      <button
                        disabled={busy || !draft!.widgets.length}
                        onClick={() => setPositioningTiles(true)}
                      >
                        Position tiles
                      </button>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={draft!.snapToGrid ?? false}
                          disabled={busy}
                          onChange={(e) => {
                            const snapToGrid = e.target.checked;
                            setDraft((d) => d && { ...d, snapToGrid });
                          }}
                        />
                        Snap to canvas grid (20 px)
                      </label>
                      {(draft!.groupLayoutWidth || groups.length > 0) && (
                        <button
                          aria-pressed={arrangingGroups}
                          disabled={busy || !resolution}
                          onClick={() => {
                            if (!draft!.groupLayoutWidth) {
                              setDraft(
                                (d) =>
                                  d &&
                                  fixedCanvasDashboard(
                                    {
                                      ...d,
                                      groupLayoutWidth: resolution!.width,
                                    },
                                    containerRef.current,
                                  ),
                              );
                            }
                            setArrangingGroups((v) => !v);
                          }}
                        >
                          {arrangingGroups
                            ? 'Hide group handles'
                            : 'Show group handles'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="editor-content-section">
                    <div className="editor-section-heading">
                      <h3>Add content</h3>
                      <p>Choose what to place on the dashboard.</p>
                    </div>
                    <div
                      className="editor-add-actions"
                      role="group"
                      aria-label="Add dashboard content"
                    >
                      <span className="editor-action-label">Measurements</span>
                      <button className="primary" onClick={() => addTile()}>
                        ＋ Add tile
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => setTotalEditor('new')}
                      >
                        ＋ Add total tile
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => {
                          setNewTileGroup(undefined);
                          setGraphEditor('new');
                        }}
                      >
                        ＋ Add graph tile
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => setConsumptionEditor('new')}
                      >
                        ＋ Add consumption tile
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => setLogEditor('new')}
                      >
                        ＋ Add log window
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => {
                          setNewTileGroup(undefined);
                          setTileEditor('bulk');
                        }}
                      >
                        ＋ Add multiple values
                      </button>
                      <span className="editor-action-label">Other</span>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => setTextEditor('new')}
                      >
                        ＋ Add text tile
                      </button>
                      <button
                        disabled={busy || draft!.widgets.length >= 100}
                        onClick={() => setDateTimeEditor('new')}
                      >
                        ＋ Add date/time tile
                      </button>
                      <button
                        disabled={busy || groups.length >= 50}
                        onClick={() => setGroupEditor('new')}
                      >
                        ＋ Add group
                      </button>
                    </div>
                  </div>
                </section>
              )}
              {shown && (
                <div className="dashboard-meta">
                  <div>
                    <span
                      className={`live-dot ${readingError || failures ? 'offline' : ''}`}
                    />
                    <strong>
                      {readingError || failures
                        ? 'Connection issue'
                        : loading
                          ? 'Connecting'
                          : readingBindings(shown.widgets).length > 0
                            ? 'Monitoring'
                            : 'Ready to configure'}
                    </strong>
                    <span className="meta-divider" />
                    <span>
                      {shown.widgets.filter(isMeasurementTile).length}{' '}
                      measurement
                      {shown.widgets.filter(isMeasurementTile).length === 1
                        ? ''
                        : 's'}
                      {shown.widgets.some(isTotalTile) &&
                        ` · ${shown.widgets.filter(isTotalTile).length} total${shown.widgets.filter(isTotalTile).length === 1 ? '' : 's'}`}
                      {shown.widgets.some(isGraphTile) &&
                        ` · ${shown.widgets.filter(isGraphTile).length} graph${shown.widgets.filter(isGraphTile).length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div>
                    <span>Refresh every {shown.refreshSeconds}s</span>
                    <span className="meta-divider" />
                    <span>Updated {time(lastRefresh)}</span>
                  </div>
                </div>
              )}
              <div
                ref={containerRef}
                className={`dashboard-grid ${editing ? 'editing' : ''}`}
              >
                <DashboardCanvas
                  key={activeId}
                  editing={editing}
                  resolution={resolution}
                  width={width}
                  fitHeight={displayMode}
                  fullscreen={displayMode && fullscreen.fullscreen}
                >
                  {(canvasScale) => (
                    <>
                      {booting ? (
                        <div className="empty-state">
                          <div className="empty-icon">◌</div>
                          <h2>Loading your workspace…</h2>
                        </div>
                      ) : !shown ? (
                        displayMode ? (
                          <div className="empty-state">
                            <h2>Dashboard unavailable</h2>
                            <p>
                              This dashboard may have been deleted, or the link
                              is missing a valid dashboard ID.
                            </p>
                            <a className="button-link" href="/">
                              Choose a dashboard
                            </a>
                          </div>
                        ) : (
                          <div className="empty-state">
                            <div className="empty-icon">▦</div>
                            <span className="eyebrow">MAKE IT YOURS</span>
                            <h2>Your first dashboard starts here</h2>
                            <p>
                              Choose your devices. Pick your measurements.
                              <br />
                              Keep the important numbers in view.
                            </p>
                            <button
                              className="primary"
                              onClick={() => {
                                setNewName('');
                                setDialog('create');
                              }}
                            >
                              ＋ Create dashboard
                            </button>
                          </div>
                        )
                      ) : shown.widgets.length === 0 && groups.length === 0 ? (
                        displayMode ? (
                          <div className="empty-state">
                            <h2>No values configured</h2>
                            <p>This dashboard has no measurement tiles yet.</p>
                          </div>
                        ) : (
                          <div className="empty-state">
                            <div className="empty-icon">
                              <Bolt />
                            </div>
                            <h2>A blank canvas for your energy</h2>
                            <p>
                              Add a measurement tile to start monitoring this
                              dashboard.
                            </p>
                            <button
                              className="primary"
                              onClick={() => {
                                if (!editing)
                                  setDraft(
                                    fixedCanvasDashboard(
                                      editableDashboard(active!),
                                      containerRef.current,
                                    ),
                                  );
                                addTile();
                              }}
                            >
                              ＋ Add your first tile
                            </button>
                          </div>
                        )
                      ) : (
                        mounted && (
                          <GroupArrangement
                            sections={sections}
                            designWidth={shown.groupLayoutWidth}
                            canvasHeight={resolution?.height}
                            ungroupedOnCanvas={shown.ungroupedOnCanvas ?? false}
                            width={gridWidth}
                            canvasScale={canvasScale}
                            snapToGrid={shown.snapToGrid ?? false}
                            arranging={editing && arrangingGroups && !busy}
                            onChange={(layout) => {
                              if (!editing || !arrangingGroups) return;
                              setDraft((d) => {
                                if (!d) return d;
                                const groups = (d.groups ?? []).map((g) => {
                                  const p = layout.find((p) => p.i === g.id);
                                  return p
                                    ? {
                                        ...g,
                                        placement: {
                                          x: p.x,
                                          y: p.y,
                                          scale: p.scale,
                                        },
                                      }
                                    : g;
                                });
                                return JSON.stringify(groups) ===
                                  JSON.stringify(d.groups)
                                  ? d
                                  : { ...d, groups };
                              });
                            }}
                          >
                            {(section, _index, groupScale) => (
                              <section
                                key={section.group?.id ?? 'ungrouped'}
                                data-ungrouped={
                                  !section.group ? true : undefined
                                }
                                className={
                                  section.group
                                    ? 'value-group padded-group'
                                    : groups.length &&
                                        !(
                                          shown.groupLayoutWidth &&
                                          shown.ungroupedOnCanvas
                                        )
                                      ? 'value-group'
                                      : 'ungrouped-grid'
                                }
                                aria-label={
                                  section.group?.title ?? 'Ungrouped values'
                                }
                                style={
                                  {
                                    backgroundColor:
                                      section.group?.backgroundColor,
                                    '--group-text-color': groupTextColor(
                                      section.group?.backgroundColor,
                                    ),
                                    ...(section.group && section.widgets.length
                                      ? {
                                          width:
                                            (Math.max(
                                              ...section.widgets.map(
                                                (w) => w.x + w.w,
                                              ),
                                            ) *
                                              ((shown.groupLayoutWidth ??
                                                gridWidth) -
                                                40 +
                                                20)) /
                                              12 -
                                            20 +
                                            40,
                                        }
                                      : {}),
                                  } as CSSProperties
                                }
                              >
                                {groups.length > 0 &&
                                  (section.group ||
                                    !(
                                      shown.groupLayoutWidth &&
                                      shown.ungroupedOnCanvas
                                    )) &&
                                  (editing ||
                                    section.group?.showTitle !== false) && (
                                    <header
                                      className="group-heading"
                                      style={
                                        {
                                          '--group-font-size': `${section.group?.showTitle === false ? 20 : (section.group?.fontSize ?? 20)}px`,
                                        } as CSSProperties
                                      }
                                    >
                                      {section.group?.showTitle !== false && (
                                        <div>
                                          <h2>
                                            {section.group?.title ??
                                              'Ungrouped'}
                                          </h2>
                                          <span>
                                            {section.widgets.length} value
                                            {section.widgets.length === 1
                                              ? ''
                                              : 's'}
                                          </span>
                                        </div>
                                      )}
                                      {editing && (
                                        <div className="group-actions">
                                          {section.group && (
                                            <>
                                              <button
                                                aria-label={`Edit group ${section.group.title}`}
                                                disabled={busy}
                                                onClick={() =>
                                                  setGroupEditor(section.group)
                                                }
                                              >
                                                Edit group
                                              </button>
                                              <button
                                                aria-label={`Copy group ${section.group.title}`}
                                                disabled={busy}
                                                onClick={() =>
                                                  setCopyingGroup(section.group)
                                                }
                                              >
                                                Copy group
                                              </button>
                                            </>
                                          )}
                                          <button
                                            disabled={busy}
                                            onClick={() =>
                                              addTile(section.group?.id)
                                            }
                                          >
                                            ＋ Add value
                                          </button>
                                          <button
                                            disabled={
                                              busy ||
                                              draft!.widgets.length >= 100
                                            }
                                            onClick={() => {
                                              setNewTileGroup(
                                                section.group?.id,
                                              );
                                              setGraphEditor('new');
                                            }}
                                          >
                                            ＋ Add graph
                                          </button>
                                        </div>
                                      )}
                                    </header>
                                  )}
                                {section.widgets.length === 0 ? (
                                  <div className="group-empty">
                                    No tiles in this group yet.
                                    {editing && (
                                      <span>
                                        {' '}
                                        Use “Add value”, “Add graph”, or “Edit
                                        group” to select existing tiles.
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <CanvasTileGrid
                                    key={placementRevision}
                                    rearrange={Boolean(section.group)}
                                    linkedTiles={validTileLinks(
                                      shown.tileLinks,
                                      shown.widgets,
                                    ).filter((link) =>
                                      section.widgets.some(
                                        (widget) => widget.id === link[0],
                                      ),
                                    )}
                                    canvasPlacement={
                                      shown.snapToGrid !== undefined ||
                                      (!section.group &&
                                        Boolean(
                                          shown.groupLayoutWidth &&
                                          shown.ungroupedOnCanvas,
                                        ))
                                    }
                                    snapToGrid={shown.snapToGrid ?? false}
                                    canvasScale={canvasScale}
                                    canvasHeight={resolution?.height}
                                    canvasBottomInset={
                                      section.group ? 20 * groupScale : 0
                                    }
                                    groupScale={groupScale}
                                    width={
                                      section.group
                                        ? (shown.groupLayoutWidth ??
                                            gridWidth) - 40
                                        : gridWidth
                                    }
                                    positionStrategy={{
                                      ...transformStrategy,
                                      scale: canvasScale * groupScale,
                                    }}
                                    layout={layoutFor(section.widgets)}
                                    gridConfig={{
                                      cols: 12,
                                      rowHeight: 72,
                                      margin: [20, 20],
                                      containerPadding: [0, 0],
                                    }}
                                    dragConfig={{
                                      enabled: editing && !busy,
                                      handle: '.drag-handle',
                                    }}
                                    resizeConfig={{
                                      enabled: editing && !busy,
                                    }}
                                    onLayoutChange={(layout) =>
                                      updateLayout(layout, section.group?.id)
                                    }
                                  >
                                    {section.widgets.map((widget) => (
                                      <div
                                        key={widget.id}
                                        data-testid={`tile-${widget.id}`}
                                        aria-label={`Tile ${widget.label}`}
                                      >
                                        {'kind' in widget &&
                                        widget.kind === 'log' ? (
                                          <LogTileView
                                            widget={widget}
                                            events={events}
                                            editing={editing}
                                            onEdit={() => setLogEditor(widget)}
                                            onRemove={() =>
                                              setDraft(
                                                (d) =>
                                                  d && {
                                                    ...d,
                                                    widgets: d.widgets.filter(
                                                      (w) => w.id !== widget.id,
                                                    ),
                                                  },
                                              )
                                            }
                                          />
                                        ) : isConsumptionTile(widget) ? (
                                          <ConsumptionTileView
                                            widget={widget}
                                            dashboardId={shown.id}
                                            dashboardRevision={shown.revision}
                                            sourceRevision={
                                              config?.sourceRevision
                                            }
                                            ready={Boolean(
                                              active?.widgets.some(
                                                (saved) =>
                                                  isConsumptionTile(saved) &&
                                                  saved.id === widget.id &&
                                                  bindingKey(saved.binding) ===
                                                    bindingKey(
                                                      widget.binding,
                                                    ) &&
                                                  saved.unit === widget.unit,
                                              ),
                                            )}
                                            now={now}
                                            editing={editing}
                                            onEdit={() =>
                                              setConsumptionEditor(widget)
                                            }
                                            onRemove={() =>
                                              setDraft(
                                                (d) =>
                                                  d && {
                                                    ...d,
                                                    widgets: d.widgets.filter(
                                                      (w) => w.id !== widget.id,
                                                    ),
                                                  },
                                              )
                                            }
                                          />
                                        ) : isGraphTile(widget) ? (
                                          <GraphTileView
                                            widget={widget}
                                            history={graphHistory}
                                            readings={readings}
                                            error={readingError}
                                            staleMs={config?.staleMs ?? 60000}
                                            now={now}
                                            editing={editing}
                                            onEdit={() =>
                                              setGraphEditor(widget)
                                            }
                                            onRemove={() =>
                                              setDraft(
                                                (d) =>
                                                  d && {
                                                    ...d,
                                                    widgets: d.widgets.filter(
                                                      (w) => w.id !== widget.id,
                                                    ),
                                                  },
                                              )
                                            }
                                          />
                                        ) : !isMeasurementTile(widget) &&
                                          !isTotalTile(widget) ? (
                                          <TextTileView
                                            widget={widget}
                                            editing={editing}
                                            content={
                                              widget.kind === 'datetime'
                                                ? dateTimeContent(widget, now)
                                                : undefined
                                            }
                                            onEdit={() =>
                                              widget.kind === 'datetime'
                                                ? setDateTimeEditor(widget)
                                                : setTextEditor(widget)
                                            }
                                            onRemove={() =>
                                              setDraft(
                                                (d) =>
                                                  d && {
                                                    ...d,
                                                    widgets: d.widgets.filter(
                                                      (w) => w.id !== widget.id,
                                                    ),
                                                  },
                                              )
                                            }
                                          />
                                        ) : (
                                          <Tile
                                            widget={widget}
                                            defaults={
                                              isMeasurementTile(widget)
                                                ? defaultsForMeasurement(
                                                    dashboardMeasurementDefaults(
                                                      shown!,
                                                    ),
                                                    widget.binding.measurement,
                                                    widget.unit,
                                                  )
                                                : undefined
                                            }
                                            reading={
                                              isTotalTile(widget)
                                                ? readings.length
                                                  ? totalReading(
                                                      widget,
                                                      readings,
                                                    )
                                                  : undefined
                                                : readings.find(
                                                    (r) =>
                                                      r.key ===
                                                      bindingKey(
                                                        widget.binding,
                                                      ),
                                                  )
                                            }
                                            graphSamples={
                                              isMeasurementTile(widget)
                                                ? graphHistory[
                                                    bindingKey(widget.binding)
                                                  ]
                                                : undefined
                                            }
                                            editing={editing}
                                            loading={loading}
                                            error={readingError}
                                            staleMs={config?.staleMs ?? 60000}
                                            now={now}
                                            onEdit={() =>
                                              isTotalTile(widget)
                                                ? setTotalEditor(widget)
                                                : widget.display === 'graph'
                                                  ? setGraphEditor(
                                                      editableGraphFromLegacy(
                                                        widget,
                                                      ),
                                                    )
                                                  : setTileEditor(widget)
                                            }
                                            onRemove={() =>
                                              setDraft(
                                                (d) =>
                                                  d && {
                                                    ...d,
                                                    widgets: d.widgets.filter(
                                                      (w) => w.id !== widget.id,
                                                    ),
                                                  },
                                              )
                                            }
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </CanvasTileGrid>
                                )}
                              </section>
                            )}
                          </GroupArrangement>
                        )
                      )}
                    </>
                  )}
                </DashboardCanvas>
              </div>
            </>
          )}
        </main>
      </div>
      {dateTimeEditor && draft && (
        <DateTimeTileEditor
          initial={dateTimeEditor === 'new' ? undefined : dateTimeEditor}
          groups={draft.groups ?? []}
          onClose={() => setDateTimeEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setDateTimeEditor(undefined);
          }}
        />
      )}
      {totalEditor && draft && (
        <TotalTileEditor
          initial={totalEditor === 'new' ? undefined : totalEditor}
          widgets={draft.widgets}
          groups={draft.groups ?? []}
          defaultProject={readingBindings(draft.widgets)[0]?.project}
          onClose={() => setTotalEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setTotalEditor(undefined);
          }}
        />
      )}
      {graphEditor && draft && (
        <GraphTileEditor
          initial={graphEditor === 'new' ? undefined : graphEditor}
          groups={draft.groups ?? []}
          defaultProject={readingBindings(draft.widgets)[0]?.project}
          defaultGroupId={newTileGroup}
          onClose={() => setGraphEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setGraphEditor(undefined);
          }}
        />
      )}
      {consumptionEditor && draft && (
        <ConsumptionTileEditor
          initial={consumptionEditor === 'new' ? undefined : consumptionEditor}
          groups={draft.groups ?? []}
          defaultProject={readingBindings(draft.widgets)[0]?.project}
          onClose={() => setConsumptionEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setConsumptionEditor(undefined);
          }}
        />
      )}
      {logEditor && draft && (
        <LogTileEditor
          initial={logEditor === 'new' ? undefined : logEditor}
          groups={draft.groups ?? []}
          onClose={() => setLogEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setLogEditor(undefined);
          }}
        />
      )}
      {textEditor && draft && (
        <TextTileEditor
          initial={textEditor === 'new' ? undefined : textEditor}
          groups={draft.groups ?? []}
          onClose={() => setTextEditor(undefined)}
          onSave={(widget) => {
            setDraft(
              (d) => d && saveCanvasWidget(d, widget, containerRef.current),
            );
            setTextEditor(undefined);
          }}
        />
      )}
      {tileEditor &&
        tileEditor !== 'bulk' &&
        draft &&
        (tileEditor === 'new' || isMeasurementTile(tileEditor)) && (
          <WidgetEditor
            initial={tileEditor === 'new' ? undefined : tileEditor}
            groups={draft.groups ?? []}
            defaultProject={readingBindings(draft.widgets)[0]?.project}
            measurementDefaults={dashboardMeasurementDefaults(draft)}
            defaultGroupId={newTileGroup}
            onClose={() => setTileEditor(undefined)}
            onSave={(widget) => {
              setDraft(
                (d) => d && saveCanvasWidget(d, widget, containerRef.current),
              );
              setTileEditor(undefined);
            }}
          />
        )}
      {tileEditor === 'bulk' && draft && (
        <BulkWidgetEditor
          widgets={draft.widgets}
          groups={draft.groups ?? []}
          defaultProject={readingBindings(draft.widgets)[0]?.project}
          measurementDefaults={dashboardMeasurementDefaults(draft)}
          defaultGroupId={newTileGroup}
          onClose={() => setTileEditor(undefined)}
          onSave={(widgets) => {
            setDraft(
              (d) =>
                d &&
                widgets.reduce(
                  (next, widget) =>
                    saveCanvasWidget(next, widget, containerRef.current),
                  d,
                ),
            );
            setTileEditor(undefined);
          }}
        />
      )}
      {copyingGroup && draft && (
        <CopyGroupEditor
          source={copyingGroup}
          dashboard={draft}
          onClose={() => setCopyingGroup(undefined)}
          onCopy={(title, assignments) => {
            setDraft(
              (d) => d && copyGroup(d, copyingGroup, title, assignments),
            );
            setCopyingGroup(undefined);
          }}
        />
      )}
      {groupEditor && draft && (
        <GroupEditor
          initial={groupEditor === 'new' ? undefined : groupEditor}
          widgets={draft.widgets}
          onClose={() => setGroupEditor(undefined)}
          onSave={(group, tileSize) => {
            setDraft((d) => {
              if (!d) return d;
              const ids = d.widgets
                .filter((widget) => widget.groupId === group.id)
                .map((widget) => widget.id);
              const updated = saveGroup(d, group, ids);
              return tileSize
                ? applyTileSize(updated, tileSize, group.id)
                : updated;
            });
            setGroupEditor(undefined);
          }}
          onRemove={(group) => {
            setDraft((d) => d && removeGroup(d, group));
            setGroupEditor(undefined);
          }}
        />
      )}
      {positioningTiles && draft && containerRef.current && (
        <TilePositionEditor
          dashboard={draft}
          root={containerRef.current}
          width={gridWidth}
          onClose={() => setPositioningTiles(false)}
          onSave={(widgets, tileLinks) => {
            setDraft(
              (d) =>
                d && {
                  ...d,
                  widgets,
                  tileLinks,
                  snapToGrid: d.snapToGrid ?? false,
                },
            );
            // Start the grid from the complete applied layout, avoiding echoes
            // of its previous internal state after a programmatic placement.
            setPlacementRevision((revision) => revision + 1);
            setPositioningTiles(false);
          }}
        />
      )}
      {dialog && (
        <Modal
          labelledBy="dashboard-dialog-title"
          onClose={() => {
            if (!busy) {
              setDialog(undefined);
              setError('');
            }
          }}
        >
          <section className="modal compact">
            <span className="eyebrow">SHARED WORKSPACE</span>
            <h2 id="dashboard-dialog-title">
              {dialog === 'create'
                ? 'Create a dashboard'
                : 'Delete this dashboard?'}
            </h2>
            <p className="muted">
              {dialog === 'create'
                ? 'Give your new view a name. You can add measurements next.'
                : `“${active?.name}” and its tile configuration will be deleted for everyone.`}
            </p>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  if (dialog === 'create') {
                    const created = await api<Dashboard>('/dashboards', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: newName,
                        refreshSeconds: 5,
                        resolution: { width: 1920, height: 1080 },
                        groupLayoutWidth: 1920,
                        ungroupedOnCanvas: true,
                        snapToGrid: false,
                        widgets: [],
                      }),
                    });
                    setDashboards((ds) => [created, ...ds]);
                    setActiveId(created.id);
                    setDraft(
                      fixedCanvasDashboard(editableDashboard(created), null),
                    );
                  } else if (active) {
                    await api(`/dashboards/${active.id}`, {
                      method: 'DELETE',
                      body: JSON.stringify({ revision: active.revision }),
                    });
                    setDashboards((ds) => ds.filter((d) => d.id !== active.id));
                    setActiveId(
                      dashboards.find((d) => d.id !== active.id)?.id ?? '',
                    );
                  }
                  setDialog(undefined);
                });
              }}
            >
              {dialog === 'create' && (
                <label>
                  Dashboard name
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={newName}
                    placeholder="e.g. Building overview"
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
              )}
              <footer className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDialog(undefined);
                    setError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className={dialog === 'delete' ? 'danger' : 'primary'}
                  disabled={busy || (dialog === 'create' && !newName.trim())}
                  type="submit"
                >
                  {busy
                    ? 'Working…'
                    : dialog === 'create'
                      ? 'Create dashboard'
                      : 'Delete dashboard'}
                </button>
              </footer>
            </form>
          </section>
        </Modal>
      )}
      {updatesOpen && (
        <UpdatesDialog
          currentVersion={config?.version}
          onClose={() => setUpdatesOpen(false)}
        />
      )}
      {sourceSettingsOpen && (
        <SourceSettingsDialog
          dashboards={dashboards}
          onClose={() => setSourceSettingsOpen(false)}
          onSaved={() => {
            setSourceSettingsOpen(false);
            setHistoryVersion((version) => version + 1);
            void load(activeId).catch((failure) => setError(message(failure)));
          }}
        />
      )}
      {collectorSettingsOpen && (
        <CollectorSettingsDialog
          source={config?.source}
          onClose={() => {
            setCollectorSettingsOpen(false);
            setHistoryVersion((version) => version + 1);
          }}
          onDeleted={() => setHistoryVersion((version) => version + 1)}
        />
      )}
      {storageSettingsOpen && (
        <StorageSettingsDialog onClose={() => setStorageSettingsOpen(false)} />
      )}
      {serverSettingsOpen && (
        <ServerSettingsDialog onClose={() => setServerSettingsOpen(false)} />
      )}
      {notificationSettingsOpen && (
        <NotificationSettingsDialog
          source={config?.source}
          onClose={() => setNotificationSettingsOpen(false)}
        />
      )}
      {soundSettingsOpen && (
        <SoundSettingsDialog
          tone={alarmSound.tone}
          volume={alarmSound.volume}
          error={alarmSound.audioError}
          onToneChange={alarmSound.setTone}
          onVolumeChange={alarmSound.setVolume}
          onPreview={() => void alarmSound.preview()}
          onClose={() => setSoundSettingsOpen(false)}
        />
      )}
      {exportOpen && (
        <ExportDashboardsDialog
          dashboards={dashboards}
          activeId={activeId}
          onClose={() => setExportOpen(false)}
          onExport={downloadDashboards}
        />
      )}
    </div>
  );
}
