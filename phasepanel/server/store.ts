import { omitRetiredTiles } from '../shared/legacyDashboard.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  dashboardAlertMessage,
  type DashboardAlertTarget,
} from './dashboardAlerts.js';
import { evaluateRange } from '../shared/range.js';
import {
  defaultNotificationSettings,
  type NotificationSettings,
} from './notificationSettings.js';
import type { Dashboard, DashboardInput, Reading } from '../shared/model.js';
import type {
  DeviceEvent,
  DeviceEventFetchStatus,
} from '../shared/deviceEvents.js';
import type {
  DeviceRecordingProfile,
  DeviceRecordingRange,
} from '../shared/deviceHistory.js';
import {
  builtInModbusModels,
  upgradeBuiltInModbusModel,
} from './modbusModels.js';
import { modbusDeviceSchema, type SourceSettings } from './sourceSettings.js';
import {
  defaultCollectorSettings,
  parseStoredCollectorSettings,
  type CollectorSettings,
} from './collectorSettings.js';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, config TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, config TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collector_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, config TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reading_history (
        source_revision INTEGER NOT NULL,
        binding_key TEXT NOT NULL,
        sampled_at_ms INTEGER NOT NULL,
        value REAL,
        status TEXT NOT NULL,
        unit TEXT NOT NULL,
        source_timestamp_ns TEXT,
        PRIMARY KEY (source_revision, binding_key, sampled_at_ms)
      );
      CREATE INDEX IF NOT EXISTS reading_history_by_time
        ON reading_history(sampled_at_ms);
      CREATE TABLE IF NOT EXISTS device_recording_profiles (
        device_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        PRIMARY KEY (device_key, profile_id)
      );
      CREATE TABLE IF NOT EXISTS device_recording_files (
        device_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at TEXT,
        bytes BLOB NOT NULL,
        start_ms INTEGER,
        end_ms INTEGER,
        stored_at TEXT NOT NULL,
        PRIMARY KEY (device_key, name)
      );
      CREATE INDEX IF NOT EXISTS device_recording_files_by_profile
        ON device_recording_files(device_key, profile_id);
      CREATE TABLE IF NOT EXISTS device_events (
        project TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        host TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER NOT NULL,
        reason INTEGER NOT NULL,
        type TEXT NOT NULL,
        phase TEXT,
        unit TEXT,
        threshold REAL NOT NULL,
        minimum REAL NOT NULL,
        maximum REAL NOT NULL,
        average REAL NOT NULL,
        PRIMARY KEY (project, device_id, host, started_at_ms, ended_at_ms, reason)
      );
      CREATE INDEX IF NOT EXISTS device_events_by_time
        ON device_events(started_at_ms DESC);
      CREATE TABLE IF NOT EXISTS device_event_fetch_status (
        project TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        host TEXT NOT NULL,
        last_attempt_ms INTEGER NOT NULL,
        last_success_ms INTEGER,
        error TEXT,
        PRIMARY KEY (project, device_id, host)
      );
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, config TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_ms INTEGER NOT NULL,
        last_error TEXT,
        sent_at_ms INTEGER,
        UNIQUE (event_key, provider)
      );
      CREATE TABLE IF NOT EXISTS notification_dashboard_state (
        key TEXT PRIMARY KEY,
        source_revision INTEGER NOT NULL,
        signature TEXT NOT NULL,
        state TEXT NOT NULL,
        candidate TEXT NOT NULL,
        candidate_count INTEGER NOT NULL
      );`);
    // Rules from older versions are no longer active; do not retry their alerts.
    this.db
      .prepare(
        "UPDATE notification_deliveries SET status='cancelled' WHERE status='pending' AND event_key LIKE 'live:%'",
      )
      .run();
    const eventColumns = this.db
      .prepare('PRAGMA table_info(device_events)')
      .all();
    if (!eventColumns.some((column) => column.name === 'unit'))
      this.db.exec('ALTER TABLE device_events ADD COLUMN unit TEXT');
    const columns = this.db.prepare('PRAGMA table_info(dashboards)').all();
    if (!columns.some((column) => column.name === 'sort_order')) {
      this.db.exec(
        'ALTER TABLE dashboards ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
      );
      const rows = this.db
        .prepare('SELECT id FROM dashboards ORDER BY updated_at DESC, id')
        .all();
      const update = this.db.prepare(
        'UPDATE dashboards SET sort_order=? WHERE id=?',
      );
      this.db.exec('BEGIN');
      try {
        rows.forEach((row, index) => update.run(index, row.id));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    this.db.exec('PRAGMA user_version=5');
  }
  private decode(row: Record<string, unknown>): Dashboard {
    return {
      ...(omitRetiredTiles(JSON.parse(String(row.config))) as DashboardInput),
      id: String(row.id),
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
    };
  }
  list(): Dashboard[] {
    return this.db
      .prepare('SELECT * FROM dashboards ORDER BY sort_order, id')
      .all()
      .map((row) => this.decode(row));
  }
  get(id: string): Dashboard | undefined {
    const row = this.db.prepare('SELECT * FROM dashboards WHERE id=?').get(id);
    return row ? this.decode(row) : undefined;
  }
  create(input: DashboardInput): Dashboard {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO dashboards (id, revision, updated_at, config, sort_order)
         VALUES (?, 1, ?, ?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM dashboards))`,
      )
      .run(id, new Date().toISOString(), JSON.stringify(input));
    return this.get(id)!;
  }
  createMany(inputs: DashboardInput[]): Dashboard[] {
    this.db.exec('BEGIN');
    let ids: string[];
    try {
      const insert = this.db.prepare(
        `INSERT INTO dashboards (id, revision, updated_at, config, sort_order)
         VALUES (?, 1, ?, ?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM dashboards))`,
      );
      ids = inputs.map((input) => {
        const id = randomUUID();
        insert.run(id, new Date().toISOString(), JSON.stringify(input));
        return id;
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return ids.map((id) => this.get(id)!);
  }
  update(
    id: string,
    revision: number,
    input: DashboardInput,
  ): Dashboard | undefined {
    const result = this.db
      .prepare(
        'UPDATE dashboards SET config=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?',
      )
      .run(JSON.stringify(input), new Date().toISOString(), id, revision);
    return result.changes ? this.get(id) : undefined;
  }
  delete(id: string, revision: number): boolean {
    return Boolean(
      this.db
        .prepare('DELETE FROM dashboards WHERE id=? AND revision=?')
        .run(id, revision).changes,
    );
  }
  reorder(ids: string[]): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT id FROM dashboards').all();
      if (
        ids.length !== existing.length ||
        new Set(ids).size !== ids.length ||
        !existing.every((row) => ids.includes(String(row.id)))
      ) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const update = this.db.prepare(
        'UPDATE dashboards SET sort_order=? WHERE id=?',
      );
      ids.forEach((id, index) => update.run(index, id));
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  getSourceSettings(initial: SourceSettings): {
    revision: number;
    settings: SourceSettings;
  } {
    let row = this.db
      .prepare('SELECT revision, config FROM app_settings WHERE id=1')
      .get();
    if (!row) {
      this.db
        .prepare('INSERT OR IGNORE INTO app_settings VALUES (1, 1, ?)')
        .run(JSON.stringify(initial));
      row = this.db
        .prepare('SELECT revision, config FROM app_settings WHERE id=1')
        .get()!;
    }
    const settings = JSON.parse(String(row.config)) as SourceSettings;
    return {
      revision: Number(row.revision),
      settings: {
        ...settings,
        modbus: {
          ...settings.modbus,
          models: (settings.modbus.models ?? builtInModbusModels).map(
            upgradeBuiltInModbusModel,
          ),
          devices: settings.modbus.devices.map((device) =>
            modbusDeviceSchema.parse(device),
          ),
        },
      },
    };
  }
  updateSourceSettings(revision: number, settings: SourceSettings): boolean {
    return Boolean(
      this.db
        .prepare(
          'UPDATE app_settings SET revision=revision+1, config=? WHERE id=1 AND revision=?',
        )
        .run(JSON.stringify(settings), revision).changes,
    );
  }
  getCollectorSettings(): { revision: number; settings: CollectorSettings } {
    let row = this.db
      .prepare('SELECT revision, config FROM collector_settings WHERE id=1')
      .get();
    if (!row) {
      this.db
        .prepare('INSERT OR IGNORE INTO collector_settings VALUES (1, 1, ?)')
        .run(JSON.stringify(defaultCollectorSettings));
      row = this.db
        .prepare('SELECT revision, config FROM collector_settings WHERE id=1')
        .get()!;
    }
    const revision = Number(row.revision);
    const { settings, migrated } = parseStoredCollectorSettings(
      JSON.parse(String(row.config)),
      revision,
    );
    if (migrated)
      this.db
        .prepare('UPDATE collector_settings SET config=? WHERE id=1')
        .run(JSON.stringify(settings));
    return { revision, settings };
  }
  updateCollectorSettings(
    revision: number,
    settings: CollectorSettings,
  ): boolean {
    return Boolean(
      this.db
        .prepare(
          'UPDATE collector_settings SET revision=revision+1, config=? WHERE id=1 AND revision=?',
        )
        .run(JSON.stringify(settings), revision).changes,
    );
  }
  getNotificationSettings(): {
    revision: number;
    settings: NotificationSettings;
  } {
    this.db
      .prepare('INSERT OR IGNORE INTO notification_settings VALUES (1, 1, ?)')
      .run(JSON.stringify(defaultNotificationSettings));
    const row = this.db
      .prepare('SELECT revision, config FROM notification_settings WHERE id=1')
      .get()!;
    return {
      revision: Number(row.revision),
      settings: {
        ...defaultNotificationSettings,
        ...(JSON.parse(String(row.config)) as Partial<NotificationSettings>),
      },
    };
  }
  updateNotificationSettings(
    revision: number,
    settings: NotificationSettings,
  ): boolean {
    const previous = this.getNotificationSettings().settings;
    const updated = Boolean(
      this.db
        .prepare(
          'UPDATE notification_settings SET revision=revision+1, config=? WHERE id=1 AND revision=?',
        )
        .run(JSON.stringify(settings), revision).changes,
    );
    if (updated) {
      if (!settings.dashboardAlarms)
        this.db
          .prepare(
            "UPDATE notification_deliveries SET status='cancelled' WHERE status='pending' AND event_key LIKE 'dashboard:%'",
          )
          .run();
      if (
        (!previous.dashboardAlarms && settings.dashboardAlarms) ||
        (!previous.telegram.enabled &&
          !previous.pushover.enabled &&
          !previous.email.enabled &&
          !previous.discord.enabled &&
          (settings.telegram.enabled ||
            settings.pushover.enabled ||
            settings.email.enabled ||
            settings.discord.enabled))
      )
        this.db.prepare('DELETE FROM notification_dashboard_state').run();
      if (
        JSON.stringify(previous.dashboardIds) !==
        JSON.stringify(settings.dashboardIds)
      ) {
        const selected = new Set(settings.dashboardIds ?? []);
        const states = this.db
          .prepare('SELECT key FROM notification_dashboard_state')
          .all() as { key: string }[];
        for (const { key } of states) {
          if (settings.dashboardIds === null || selected.has(key.split(':')[0]))
            continue;
          this.db
            .prepare(
              "UPDATE notification_deliveries SET status='cancelled' WHERE status='pending' AND event_key LIKE ?",
            )
            .run(`dashboard:${key}:%`);
          this.db
            .prepare('DELETE FROM notification_dashboard_state WHERE key=?')
            .run(key);
        }
      }
      // A changed selection must not deliver messages queued under an old rule.
      if (
        JSON.stringify(previous.eventTypes) !==
          JSON.stringify(settings.eventTypes) ||
        JSON.stringify(previous.deviceKeys) !==
          JSON.stringify(settings.deviceKeys)
      )
        this.db
          .prepare(
            "UPDATE notification_deliveries SET status='cancelled' WHERE status='pending' AND event_key NOT LIKE 'dashboard:%'",
          )
          .run();
      for (const provider of [
        'telegram',
        'pushover',
        'email',
        'discord',
      ] as const) {
        if (!settings[provider].enabled)
          this.db
            .prepare(
              "UPDATE notification_deliveries SET status='cancelled' WHERE provider=? AND status='pending'",
            )
            .run(provider);
      }
    }
    return updated;
  }
  pendingNotifications(now: number) {
    return this.db
      .prepare(
        `SELECT id, provider, message, attempts FROM notification_deliveries
       WHERE status='pending' AND next_attempt_ms<=? ORDER BY id LIMIT 20`,
      )
      .all(now) as {
      id: number;
      provider: string;
      message: string;
      attempts: number;
    }[];
  }
  finishNotification(
    id: number,
    sent: boolean,
    attempts: number,
    now: number,
    error: string | null,
    retryDelayMs = 0,
  ) {
    const status = sent ? 'sent' : attempts >= 5 ? 'failed' : 'pending';
    const delay = Math.max(
      Math.min(60 * 60_000, 30_000 * 2 ** (attempts - 1)),
      retryDelayMs,
    );
    this.db
      .prepare(
        `UPDATE notification_deliveries SET status=?, attempts=?, next_attempt_ms=?, last_error=?, sent_at_ms=? WHERE id=?`,
      )
      .run(status, attempts, now + delay, error, sent ? now : null, id);
  }
  notificationDeliveries(limit = 50) {
    return this.db
      .prepare(
        `SELECT id, provider, message, status, attempts, last_error AS lastError,
              sent_at_ms AS sentAtMs FROM notification_deliveries ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }
  recordDashboardAlerts(
    targets: DashboardAlertTarget[],
    sourceRevision: number,
    readings: Reading[],
    sampledAt: number,
    staleMs: number,
  ) {
    const { settings } = this.getNotificationSettings();
    if (
      !settings.dashboardAlarms ||
      (!settings.telegram.enabled &&
        !settings.pushover.enabled &&
        !settings.email.enabled &&
        !settings.discord.enabled)
    )
      return;
    const selectedDashboardIds = new Set(settings.dashboardIds ?? []);
    const selectedTargets =
      settings.dashboardIds === null
        ? targets
        : targets.filter((target) =>
            selectedDashboardIds.has(target.dashboardId),
          );
    const byKey = new Map(readings.map((reading) => [reading.key, reading]));
    const activeKeys = new Set(selectedTargets.map((target) => target.key));
    const oldStates = this.db
      .prepare('SELECT key FROM notification_dashboard_state')
      .all() as { key: string }[];
    const cancelFor = this.db.prepare(
      "UPDATE notification_deliveries SET status='cancelled' WHERE status='pending' AND event_key LIKE ?",
    );
    const deleteState = this.db.prepare(
      'DELETE FROM notification_dashboard_state WHERE key=?',
    );
    const stateQuery = this.db.prepare(
      'SELECT source_revision, signature, state, candidate, candidate_count FROM notification_dashboard_state WHERE key=?',
    );
    const saveState = this.db.prepare(
      `INSERT INTO notification_dashboard_state
       (key, source_revision, signature, state, candidate, candidate_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET source_revision=excluded.source_revision,
         signature=excluded.signature, state=excluded.state,
         candidate=excluded.candidate, candidate_count=excluded.candidate_count`,
    );
    const enqueue = this.db.prepare(
      `INSERT OR IGNORE INTO notification_deliveries
       (event_key, provider, message, next_attempt_ms) VALUES (?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      for (const row of oldStates) {
        if (activeKeys.has(row.key)) continue;
        cancelFor.run(`dashboard:${row.key}:%`);
        deleteState.run(row.key);
      }
      for (const target of selectedTargets) {
        const old = stateQuery.get(target.key) as
          | {
              source_revision: number;
              signature: string;
              state: string;
              candidate: string;
              candidate_count: number;
            }
          | undefined;
        if (old && old.signature !== target.signature)
          cancelFor.run(`dashboard:${target.key}:%`);
        const state =
          old &&
          old.source_revision === sourceRevision &&
          old.signature === target.signature
            ? {
                current: old.state,
                candidate: old.candidate,
                count: old.candidate_count,
              }
            : { current: 'normal', candidate: 'normal', count: 0 };
        const reading = byKey.get(target.readingKey);
        const timestamp = Date.parse(
          reading?.sourceTime ?? reading?.retrievedAt ?? '',
        );
        const valid =
          reading?.status === 'ok' &&
          reading.value !== null &&
          Number.isFinite(reading.value) &&
          Number.isFinite(timestamp) &&
          sampledAt - timestamp <= staleMs;
        if (!valid) {
          state.candidate = 'normal';
          state.count = 0;
        } else {
          const observed = evaluateRange(reading.value, target).state;
          if (observed === state.current) {
            state.candidate = 'normal';
            state.count = 0;
          } else {
            state.count = state.candidate === observed ? state.count + 1 : 1;
            state.candidate = observed;
            if (state.count >= 2) {
              state.current = observed;
              state.candidate = 'normal';
              state.count = 0;
              if (observed === 'low' || observed === 'high') {
                const message = dashboardAlertMessage(
                  target,
                  reading.value!,
                  observed,
                  sampledAt,
                );
                const key = `dashboard:${target.key}:${sourceRevision}:${sampledAt}`;
                if (settings.telegram.enabled)
                  enqueue.run(key, 'telegram', message, sampledAt);
                if (settings.pushover.enabled)
                  enqueue.run(key, 'pushover', message, sampledAt);
                if (settings.email.enabled)
                  enqueue.run(key, 'email', message, sampledAt);
                if (settings.discord.enabled)
                  enqueue.run(key, 'discord', message, sampledAt);
              }
            }
          }
        }
        saveState.run(
          target.key,
          sourceRevision,
          target.signature,
          state.current,
          state.candidate,
          state.count,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  recordReadings(
    sourceRevision: number,
    keys: string[],
    readings: Reading[],
    sampledAt: number,
  ) {
    const byKey = new Map(readings.map((reading) => [reading.key, reading]));
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO reading_history
       (source_revision, binding_key, sampled_at_ms, value, status, unit, source_timestamp_ns)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      for (const key of keys) {
        const reading = byKey.get(key);
        const status = reading?.status ?? 'unavailable';
        const value =
          reading?.value !== null && Number.isFinite(reading?.value)
            ? reading!.value
            : null;
        insert.run(
          sourceRevision,
          key,
          sampledAt,
          value,
          status,
          reading?.unit ?? '',
          reading?.sourceTimestampNs ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  readingHistory(
    sourceRevision: number,
    keys: string[],
    since: number,
    until = Number.MAX_SAFE_INTEGER,
  ): Record<
    string,
    {
      time: number;
      value: number | null;
      status: Reading['status'];
      unit: string;
      sourceTimestampNs: string | null;
    }[]
  > {
    const history: Record<
      string,
      {
        time: number;
        value: number | null;
        status: Reading['status'];
        unit: string;
        sourceTimestampNs: string | null;
      }[]
    > = {};
    const query = this.db.prepare(
      `SELECT sampled_at_ms, value, status, unit, source_timestamp_ns FROM reading_history
       WHERE source_revision=? AND binding_key=? AND sampled_at_ms>=? AND sampled_at_ms<=?
       ORDER BY sampled_at_ms`,
    );
    for (const key of keys) {
      history[key] = query
        .all(sourceRevision, key, since, until)
        .map((row) => ({
          time: Number(row.sampled_at_ms),
          value: row.value === null ? null : Number(row.value),
          status: String(row.status) as Reading['status'],
          unit: String(row.unit),
          sourceTimestampNs:
            row.source_timestamp_ns === null
              ? null
              : String(row.source_timestamp_ns),
        }));
    }
    return history;
  }
  consumption(
    sourceRevision: number,
    key: string,
    unit: string,
    start: number,
    end: number,
    intervalMs: number,
  ) {
    type Point = { sampled_at_ms: number; value: number };
    const base = this.db
      .prepare(
        `SELECT sampled_at_ms, value FROM reading_history
         WHERE source_revision=? AND binding_key=? AND unit=? AND status='ok'
           AND value IS NOT NULL AND sampled_at_ms<=?
         ORDER BY sampled_at_ms DESC LIMIT 1`,
      )
      .get(sourceRevision, key, unit, start) as Point | undefined;
    const first = this.db
      .prepare(
        `SELECT sampled_at_ms, value FROM reading_history
         WHERE source_revision=? AND binding_key=? AND unit=? AND status='ok'
           AND value IS NOT NULL AND sampled_at_ms>=? AND sampled_at_ms<=?
         ORDER BY sampled_at_ms LIMIT 1`,
      )
      .get(sourceRevision, key, unit, start, end) as Point | undefined;
    const last = this.db
      .prepare(
        `SELECT sampled_at_ms, value FROM reading_history
         WHERE source_revision=? AND binding_key=? AND unit=? AND status='ok'
           AND value IS NOT NULL AND sampled_at_ms>=? AND sampled_at_ms<=?
         ORDER BY sampled_at_ms DESC LIMIT 1`,
      )
      .get(sourceRevision, key, unit, start, end) as Point | undefined;
    const baseline =
      base && start - base.sampled_at_ms <= intervalMs * 2 ? base : first;
    if (!baseline || !last || baseline.sampled_at_ms >= last.sampled_at_ms)
      return {
        value: null,
        partial: true,
        reset: false,
        baselineTime: baseline?.sampled_at_ms ?? null,
        lastTime: last?.sampled_at_ms ?? null,
      };
    const drops = this.db
      .prepare(
        `WITH points AS (
           SELECT value, LAG(value) OVER (ORDER BY sampled_at_ms) AS previous
           FROM reading_history
           WHERE source_revision=? AND binding_key=? AND unit=? AND status='ok'
             AND value IS NOT NULL AND sampled_at_ms>=? AND sampled_at_ms<=?
         ) SELECT COUNT(*) AS count FROM points WHERE previous > value`,
      )
      .get(sourceRevision, key, unit, baseline.sampled_at_ms, end) as {
      count: number;
    };
    const reset = drops.count > 0;
    const value = last.value - baseline.value;
    return {
      value: reset || !Number.isFinite(value) || value < 0 ? null : value,
      partial: baseline.sampled_at_ms > start + intervalMs * 2,
      reset,
      baselineTime: baseline.sampled_at_ms,
      lastTime: last.sampled_at_ms,
    };
  }
  pruneReadings(before: number) {
    return Number(
      this.db
        .prepare('DELETE FROM reading_history WHERE sampled_at_ms < ?')
        .run(before).changes,
    );
  }
  recordDeviceEvents(events: DeviceEvent[]) {
    const insert = this.db.prepare(
      `INSERT INTO device_events
       (project, device_id, device_name, host, started_at_ms, ended_at_ms,
        reason, type, phase, unit, threshold, minimum, maximum, average)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project, device_id, host, started_at_ms, ended_at_ms, reason)
       DO NOTHING`,
    );
    const enqueue = this.db.prepare(
      `INSERT OR IGNORE INTO notification_deliveries
       (event_key, provider, message, next_attempt_ms) VALUES (?, ?, ?, ?)`,
    );
    const rename = this.db.prepare(
      `UPDATE device_events SET device_name=?
       WHERE project=? AND device_id=? AND host=? AND started_at_ms=? AND ended_at_ms=? AND reason=?`,
    );
    const { settings } = this.getNotificationSettings();
    this.db.exec('BEGIN');
    try {
      for (const event of events) {
        const result = insert.run(
          event.project,
          event.deviceId,
          event.deviceName,
          event.host,
          event.startedAtMs,
          event.endedAtMs,
          event.reason,
          event.type,
          event.phase,
          event.unit,
          event.threshold,
          event.minimum,
          event.maximum,
          event.average,
        );
        if (!result.changes)
          rename.run(
            event.deviceName,
            event.project,
            event.deviceId,
            event.host,
            event.startedAtMs,
            event.endedAtMs,
            event.reason,
          );
        if (!result.changes || event.startedAtMs < settings.enabledAtMs)
          continue;
        const key = JSON.stringify([
          event.project,
          event.deviceId,
          event.host,
          event.startedAtMs,
          event.endedAtMs,
          event.reason,
        ]);
        const deviceKey = JSON.stringify([
          event.project,
          event.deviceId,
          event.host,
        ]);
        if (
          (settings.eventTypes !== null &&
            !settings.eventTypes.some((type) => type === event.type)) ||
          (settings.deviceKeys !== null &&
            !settings.deviceKeys.includes(deviceKey))
        )
          continue;
        const message = `${event.deviceName}: ${event.type}${event.phase ? ` (${event.phase})` : ''} at ${new Date(event.startedAtMs).toISOString()}`;
        if (settings.telegram.enabled)
          enqueue.run(key, 'telegram', message, Date.now());
        if (settings.pushover.enabled)
          enqueue.run(key, 'pushover', message, Date.now());
        if (settings.email.enabled)
          enqueue.run(key, 'email', message, Date.now());
        if (settings.discord.enabled)
          enqueue.run(key, 'discord', message, Date.now());
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  recordDeviceEventFetchStatus(status: DeviceEventFetchStatus) {
    this.db
      .prepare(
        `INSERT INTO device_event_fetch_status
         (project, device_id, device_name, host, last_attempt_ms, last_success_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project, device_id, host) DO UPDATE SET
           device_name=excluded.device_name,
           last_attempt_ms=excluded.last_attempt_ms,
           last_success_ms=COALESCE(excluded.last_success_ms, device_event_fetch_status.last_success_ms),
           error=excluded.error`,
      )
      .run(
        status.project,
        status.deviceId,
        status.deviceName,
        status.host,
        status.lastAttemptMs,
        status.lastSuccessMs,
        status.error,
      );
  }
  deviceEvents(
    offset: number,
    limit: number,
    device?: { project: string; deviceId: string; host: string },
  ): DeviceEvent[] {
    const where = device ? 'WHERE project=? AND device_id=? AND host=?' : '';
    const parameters = device
      ? [device.project, device.deviceId, device.host, limit, offset]
      : [limit, offset];
    return this.db
      .prepare(
        `SELECT * FROM device_events
         ${where}
         ORDER BY started_at_ms DESC, project, device_id, host, ended_at_ms, reason
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters)
      .map((row) => ({
        project: String(row.project),
        deviceId: String(row.device_id),
        deviceName: String(row.device_name),
        host: String(row.host),
        startedAtMs: Number(row.started_at_ms),
        endedAtMs: Number(row.ended_at_ms),
        reason: Number(row.reason),
        type: String(row.type),
        phase: row.phase === null ? null : String(row.phase),
        unit: row.unit === null ? null : (String(row.unit) as 'V' | 'A'),
        threshold: Number(row.threshold),
        minimum: Number(row.minimum),
        maximum: Number(row.maximum),
        average: Number(row.average),
      }));
  }
  deviceEventFetchStatuses(): DeviceEventFetchStatus[] {
    return this.db
      .prepare('SELECT * FROM device_event_fetch_status ORDER BY device_name')
      .all()
      .map((row) => ({
        project: String(row.project),
        deviceId: String(row.device_id),
        deviceName: String(row.device_name),
        host: String(row.host),
        lastAttemptMs: Number(row.last_attempt_ms),
        lastSuccessMs:
          row.last_success_ms === null ? null : Number(row.last_success_ms),
        error: row.error === null ? null : String(row.error),
      }));
  }
  historyUsage(): { samples: number; allocatedBytes: number } {
    const count = this.db
      .prepare('SELECT COUNT(*) AS samples FROM reading_history')
      .get()!;
    const storage = this.db
      .prepare(
        `SELECT COALESCE(SUM(pgsize), 0) AS allocated_bytes FROM dbstat
         WHERE name = 'reading_history' OR name IN (
           SELECT name FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'reading_history'
         )`,
      )
      .get()!;
    return {
      samples: Number(count.samples),
      allocatedBytes: Number(storage.allocated_bytes),
    };
  }
  close() {
    this.db.close();
  }

  hasDeviceRecordings(deviceKey: string) {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM device_recording_files WHERE device_key=? LIMIT 1',
        )
        .get(deviceKey),
    );
  }

  hasAnyDeviceRecordings() {
    return Boolean(
      this.db.prepare('SELECT 1 FROM device_recording_files LIMIT 1').get(),
    );
  }

  deviceRecordingDeviceKeys() {
    return this.db
      .prepare('SELECT DISTINCT device_key FROM device_recording_files')
      .all()
      .map((row) => String(row.device_key));
  }

  deleteDeviceRecordings(deviceKey: string) {
    this.db.exec('BEGIN');
    try {
      const result = this.db
        .prepare('DELETE FROM device_recording_files WHERE device_key=?')
        .run(deviceKey);
      this.db
        .prepare('DELETE FROM device_recording_profiles WHERE device_key=?')
        .run(deviceKey);
      this.db.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deviceRecordingCatalog(deviceKey: string): DeviceRecordingProfile[] {
    const profiles = this.db
      .prepare(
        'SELECT profile_json FROM device_recording_profiles WHERE device_key=?',
      )
      .all(deviceKey);
    const files = this.db
      .prepare(
        `SELECT profile_id, name, size, modified_at, start_ms, end_ms, stored_at
         FROM device_recording_files WHERE device_key=?`,
      )
      .all(deviceKey);
    return profiles.map((row) => {
      const profile = JSON.parse(
        String(row.profile_json),
      ) as DeviceRecordingProfile;
      return {
        ...profile,
        files: files
          .filter((file) => file.profile_id === profile.id)
          .map((file) => ({
            name: String(file.name),
            size: Number(file.size),
            modifiedAt:
              file.modified_at === null ? null : String(file.modified_at),
            storedAt: String(file.stored_at),
            range:
              file.start_ms === null || file.end_ms === null
                ? null
                : {
                    startMs: Number(file.start_ms),
                    endMs: Number(file.end_ms),
                  },
          }))
          .sort((a, b) =>
            b.name.localeCompare(a.name, undefined, { numeric: true }),
          ),
      };
    });
  }

  deviceRecordingFile(deviceKey: string, name: string) {
    const row = this.db
      .prepare(
        `SELECT profile_id, size, modified_at, bytes, start_ms, end_ms, stored_at
         FROM device_recording_files WHERE device_key=? AND name=?`,
      )
      .get(deviceKey, name);
    if (!row) return null;
    return {
      profileId: String(row.profile_id),
      size: Number(row.size),
      modifiedAt: row.modified_at === null ? null : String(row.modified_at),
      bytes: Buffer.from(row.bytes as Uint8Array),
      storedAt: String(row.stored_at),
      range:
        row.start_ms === null || row.end_ms === null
          ? null
          : { startMs: Number(row.start_ms), endMs: Number(row.end_ms) },
    };
  }

  saveDeviceRecording(
    deviceKey: string,
    profile: Omit<DeviceRecordingProfile, 'files'>,
    file: { name: string; size: number; modifiedAt: string | null },
    bytes: Buffer,
    range: DeviceRecordingRange | null,
  ) {
    const storedAt = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO device_recording_profiles(device_key, profile_id, profile_json)
           VALUES (?, ?, ?)
           ON CONFLICT(device_key, profile_id) DO UPDATE SET profile_json=excluded.profile_json`,
        )
        .run(deviceKey, profile.id, JSON.stringify(profile));
      this.db
        .prepare(
          `INSERT INTO device_recording_files
           (device_key, profile_id, name, size, modified_at, bytes, start_ms, end_ms, stored_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(device_key, name) DO UPDATE SET
             profile_id=excluded.profile_id, size=excluded.size,
             modified_at=excluded.modified_at, bytes=excluded.bytes,
             start_ms=excluded.start_ms, end_ms=excluded.end_ms,
             stored_at=excluded.stored_at`,
        )
        .run(
          deviceKey,
          profile.id,
          file.name,
          file.size,
          file.modifiedAt,
          bytes,
          range?.startMs ?? null,
          range?.endMs ?? null,
          storedAt,
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return storedAt;
  }
}
