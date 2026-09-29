import {
  historyKeys,
  readingBindings,
  withTotalReadings,
} from '../shared/totals.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z, ZodError } from 'zod';
import {
  dashboardInput,
  isConsumptionTile,
  projectName,
} from '../shared/model.js';
import type { Config } from './config.js';
import { Store } from './store.js';
import {
  GridVisError,
  MockGridVis,
  RestGridVis,
  type GridVis,
} from './gridvis.js';
import { ModbusSource, readModbusBlock } from './modbus.js';
import { HistorySampler } from './history.js';
import { EventCollector } from './eventCollector.js';
import {
  dashboardAlertTargets,
  testDashboardAlertMessage,
} from './dashboardAlerts.js';
import {
  NotificationDispatcher,
  sendNotification,
  type NotificationSender,
} from './notifications.js';
import {
  notificationSettingsInput,
  publicNotificationSettings,
} from './notificationSettings.js';
import { fetchDeviceEvents } from './deviceEvents.js';
import {
  downloadDeviceRecordingBatch,
  listDeviceRecordings,
  parseRecordingFile,
  readDeviceRecording,
  readDeviceRecordingRanges,
} from './deviceHistory.js';
import type { DeviceRecordingProfile } from '../shared/deviceHistory.js';
import { RecordingSyncJobs } from './recordingSyncJobs.js';
import type { DeviceEvent } from '../shared/deviceEvents.js';
import type { ModbusDevice } from './sourceSettings.js';
import { collectorSettingsInput } from './collectorSettings.js';
import {
  initialSourceSettings,
  mappedModbusValues,
  publicSourceSettings,
  updatedSourceSettings,
  type SourceSettings,
} from './sourceSettings.js';
import { bindingKey, type Binding, type Reading } from '../shared/model.js';

export async function buildApp(
  config: Config,
  options: {
    gridvis?: GridVis;
    store?: Store;
    logger?: boolean;
    staticRoot?: string;
    eventFetcher?: (
      device: ModbusDevice,
      timeoutMs: number,
    ) => Promise<DeviceEvent[]>;
    recordingLister?: typeof listDeviceRecordings;
    recordingReader?: typeof readDeviceRecording;
    recordingRangeReader?: typeof readDeviceRecordingRanges;
    recordingBatchDownloader?: typeof downloadDeviceRecordingBatch;
    notificationSender?: NotificationSender;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
  });
  const store = options.store ?? new Store(config.DATABASE_PATH);
  let recordingSyncJobs: RecordingSyncJobs | null = null;
  const initialSettings = initialSourceSettings(config);
  let activeRevision = 0;
  let activeSettings: SourceSettings;
  let gridvis: GridVis;
  const inFlightReadings = new Map<string, Promise<Reading[]>>();
  function currentSource() {
    const current = store.getSourceSettings(initialSettings);
    if (current.revision !== activeRevision) {
      activeRevision = current.revision;
      activeSettings = current.settings;
      if (options.gridvis) gridvis = options.gridvis;
      else if (activeSettings.source === 'mock') gridvis = new MockGridVis();
      else if (activeSettings.source === 'modbus')
        gridvis = new ModbusSource(
          {
            ...config,
            modbusDevices: activeSettings.modbus.devices,
            MODBUS_TIMEOUT_MS: activeSettings.modbus.timeoutMs,
          },
          Date.now,
          readModbusBlock,
          activeSettings.modbus.models,
        );
      else if (
        activeSettings.gridvis.baseUrl &&
        Boolean(activeSettings.gridvis.username) ===
          Boolean(activeSettings.gridvis.password)
      )
        gridvis = new RestGridVis({
          ...config,
          GRIDVIS_BASE_URL: activeSettings.gridvis.baseUrl,
          GRIDVIS_USERNAME: activeSettings.gridvis.username,
          GRIDVIS_PASSWORD: activeSettings.gridvis.password,
          GRIDVIS_TIMEOUT_MS: activeSettings.gridvis.timeoutMs,
          GRIDVIS_STALE_MS: activeSettings.staleMs,
        });
      else {
        const message = 'Configure the GridVis connection in Source settings.';
        const fail = async () => {
          throw new GridVisError(message);
        };
        gridvis = {
          projects: fail,
          devices: fail,
          measurements: fail,
          readings: async (bindings: Binding[]): Promise<Reading[]> =>
            bindings.map((binding) => ({
              key: bindingKey(binding),
              value: null,
              unit: '',
              sourceTimestampNs: null,
              sourceTime: null,
              retrievedAt: new Date().toISOString(),
              status: 'error',
              message,
            })),
        };
      }
    }
    return {
      settings: activeSettings,
      revision: activeRevision,
      source: gridvis,
    };
  }
  async function acquireReadings(bindings: Binding[]): Promise<Reading[]> {
    const current = currentSource();
    const key = JSON.stringify([
      current.revision,
      bindings.map(bindingKey).sort(),
    ]);
    const existing = inFlightReadings.get(key);
    if (existing) return existing;
    const pending = current.source.readings(bindings);
    inFlightReadings.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlightReadings.delete(key);
    }
  }
  const historySampler = new HistorySampler(
    store,
    acquireReadings,
    () => currentSource().revision,
    Date.now,
    undefined,
    () => app.log.error('History sampling failed'),
    () =>
      mappedModbusValues(currentSource().settings).map(
        (value) => value.binding,
      ),
    () => currentSource().settings.staleMs,
  );
  const eventCollector = new EventCollector(
    store,
    currentSource,
    options.eventFetcher ?? fetchDeviceEvents,
    Date.now,
    () => app.log.error('Device event collection failed'),
  );
  const notificationDispatcher = new NotificationDispatcher(
    store,
    options.notificationSender,
  );
  const collectorSettings = store.getCollectorSettings().settings;
  historySampler.configure(collectorSettings);
  eventCollector.configure(collectorSettings.eventIntervalMinutes);
  app.addHook('onReady', async () => {
    historySampler.start();
    eventCollector.start();
    notificationDispatcher.start();
  });
  app.addHook('onClose', async () => {
    await recordingSyncJobs?.stop();
    await historySampler.stop();
    await eventCollector.stop();
    await notificationDispatcher.stop();
    store.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    if (
      config.DESKTOP_DATA_DIR &&
      (request.url.startsWith('/api/settings/storage') ||
        request.url.startsWith('/api/settings/server')) &&
      !['127.0.0.1', 'localhost'].includes(request.hostname)
    )
      return reply.code(403).send({ message: 'Local access is required.' });
    // No app login: nevertheless reject cross-origin browser mutations.
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      const origin = request.headers.origin;
      let sameOrigin = !origin;
      if (origin) {
        try {
          sameOrigin = new URL(origin).host === request.headers.host;
        } catch {
          sameOrigin = false;
        }
      }
      if (request.headers['sec-fetch-site'] === 'cross-site' || !sameOrigin) {
        return reply
          .code(403)
          .send({ message: 'Cross-origin changes are not allowed.' });
      }
    }
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/'))
      reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: error.issues
          .map((i) => `${i.path.join('.') || 'Configuration'}: ${i.message}`)
          .join('; '),
      });
    if (error instanceof GridVisError)
      return reply.code(502).send({ message: error.message });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    request.log.error({ err: error }, 'Request failed');
    return reply
      .code(500)
      .send({ message: 'Request failed. Check the server logs.' });
  });
  const idFrom = (params: unknown) =>
    z.object({ id: z.string().uuid() }).parse(params).id;
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/config', async () => ({
    mock: currentSource().settings.source === 'mock',
    source: currentSource().settings.source,
    staleMs: currentSource().settings.staleMs,
    sourceRevision: currentSource().revision,
    hasSavedDeviceHistory: store.hasAnyDeviceRecordings(),
    storageSettingsVisible:
      Boolean(config.DESKTOP_DATA_DIR) ||
      config.DESKTOP_SETTINGS_PREVIEW === 'true',
    serverSettingsVisible:
      Boolean(config.DESKTOP_DATA_DIR) ||
      config.DESKTOP_SETTINGS_PREVIEW === 'true',
  }));
  function serverSettings() {
    if (!config.DESKTOP_DATA_DIR)
      return {
        mode: 'fixed' as const,
        port: config.PORT,
        currentMode: 'fixed' as const,
        currentPort: config.PORT,
        restartRequired: false,
        readOnly: true,
      };
    const settingFile = join(config.DESKTOP_DATA_DIR!, 'server-port.txt');
    const saved = existsSync(settingFile)
      ? readFileSync(settingFile, 'utf8').trim()
      : 'auto';
    const port = saved === 'auto' ? null : Number(saved);
    if (
      saved !== 'auto' &&
      (!/^\d+$/.test(saved) || port === null || port < 1024 || port > 65535)
    )
      throw new Error(`Invalid desktop port setting in ${settingFile}.`);
    const mode = saved === 'auto' ? 'auto' : 'fixed';
    const currentMode = config.DESKTOP_PORT_MODE ?? 'auto';
    return {
      mode,
      port,
      currentMode,
      currentPort: config.PORT,
      restartRequired:
        mode !== currentMode || (mode === 'fixed' && port !== config.PORT),
      readOnly: false,
    };
  }
  app.get('/api/settings/server', async (_request, reply) => {
    if (!config.DESKTOP_DATA_DIR && config.DESKTOP_SETTINGS_PREVIEW !== 'true')
      return reply
        .code(404)
        .send({ message: 'Desktop server settings are unavailable.' });
    return serverSettings();
  });
  app.put('/api/settings/server', async (request, reply) => {
    if (!config.DESKTOP_DATA_DIR)
      return reply
        .code(config.DESKTOP_SETTINGS_PREVIEW === 'true' ? 403 : 404)
        .send({
          message: 'The Docker host port is controlled by port publishing.',
        });
    const input = z
      .object({
        mode: z.enum(['auto', 'fixed']),
        port: z.number().int().min(1024).max(65535).nullable(),
      })
      .parse(request.body);
    if (input.mode === 'fixed' && input.port === null)
      return reply
        .code(400)
        .send({ message: 'Choose a port from 1024 to 65535.' });
    const saved = input.mode === 'auto' ? 'auto' : String(input.port);
    const settingFile = join(config.DESKTOP_DATA_DIR, 'server-port.txt');
    const temporary = `${settingFile}.tmp`;
    writeFileSync(temporary, `${saved}\n`);
    renameSync(temporary, settingFile);
    return serverSettings();
  });
  function storageSettings() {
    const currentDirectory = dirname(config.DATABASE_PATH);
    if (!config.DESKTOP_DATA_DIR)
      return {
        directory: currentDirectory,
        defaultDirectory: currentDirectory,
        currentDirectory,
        restartRequired: false,
        readOnly: true,
      };
    const defaultDirectory = config.DESKTOP_DATA_DIR;
    const pathFile = join(defaultDirectory, 'data-directory.txt');
    const directory = existsSync(pathFile)
      ? readFileSync(pathFile, 'utf8').trim()
      : defaultDirectory;
    return {
      directory,
      defaultDirectory,
      currentDirectory,
      restartRequired: resolve(directory) !== resolve(currentDirectory),
      readOnly: false,
    };
  }
  app.get('/api/settings/storage', async (_request, reply) => {
    if (!config.DESKTOP_DATA_DIR && config.DESKTOP_SETTINGS_PREVIEW !== 'true')
      return reply
        .code(404)
        .send({ message: 'Storage settings are unavailable.' });
    return storageSettings();
  });
  app.put('/api/settings/storage', async (request, reply) => {
    if (!config.DESKTOP_DATA_DIR)
      return reply
        .code(config.DESKTOP_SETTINGS_PREVIEW === 'true' ? 403 : 404)
        .send({ message: 'Data location is controlled by the Docker volume.' });
    const { directory: input } = z
      .object({ directory: z.string() })
      .parse(request.body);
    const directory = input.trim();
    if (!isAbsolute(directory) || /[\r\n\0]/.test(directory))
      return reply
        .code(400)
        .send({ message: 'Enter an absolute folder path on this computer.' });
    const selected = resolve(directory);
    try {
      mkdirSync(selected, { recursive: true });
      accessSync(selected, constants.W_OK);
      const pathFile = join(config.DESKTOP_DATA_DIR, 'data-directory.txt');
      const temporary = `${pathFile}.tmp`;
      writeFileSync(temporary, `${selected}\n`);
      renameSync(temporary, pathFile);
    } catch {
      return reply.code(400).send({
        message: 'Cannot save to that folder. Choose a writable location.',
      });
    }
    return storageSettings();
  });
  app.get('/api/settings/storage/folders', async (request, reply) => {
    if (!config.DESKTOP_DATA_DIR)
      return reply
        .code(404)
        .send({ message: 'Folder browsing is available in the desktop app.' });
    const { path: requested } = z
      .object({ path: z.string().optional() })
      .parse(request.query);
    const directory = requested ?? homedir();
    if (!isAbsolute(directory) || /[\r\n\0]/.test(directory))
      return reply
        .code(400)
        .send({ message: 'Choose an absolute folder path.' });
    const selected = resolve(directory);
    try {
      const entries = readdirSync(selected, { withFileTypes: true })
        .filter((entry) => {
          if (entry.isDirectory()) return true;
          if (!entry.isSymbolicLink()) return false;
          try {
            return statSync(join(selected, entry.name)).isDirectory();
          } catch {
            return false;
          }
        })
        .map((entry) => ({
          name: entry.name,
          path: join(selected, entry.name),
        }))
        .sort(
          (a, b) =>
            Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) ||
            a.name.localeCompare(b.name),
        );
      const parent = dirname(selected);
      const roots =
        process.platform === 'win32'
          ? Array.from(
              { length: 26 },
              (_, index) => `${String.fromCharCode(65 + index)}:\\`,
            ).filter(existsSync)
          : ['/'];
      return {
        directory: selected,
        parent: parent === selected ? null : parent,
        homeDirectory: homedir(),
        roots,
        entries,
      };
    } catch {
      return reply.code(400).send({ message: 'Cannot open this folder.' });
    }
  });
  app.post('/api/settings/storage/folders', async (request, reply) => {
    if (!config.DESKTOP_DATA_DIR)
      return reply
        .code(404)
        .send({ message: 'Folder creation is available in the desktop app.' });
    const { parent, name } = z
      .object({ parent: z.string(), name: z.string() })
      .parse(request.body);
    const folderName = name.trim();
    if (
      !isAbsolute(parent) ||
      /[\r\n\0]/.test(parent) ||
      !folderName ||
      folderName === '.' ||
      folderName === '..' ||
      /[\\/\r\n\0]/.test(folderName) ||
      (process.platform === 'win32' && /[:*?"<>|]/.test(folderName))
    )
      return reply.code(400).send({ message: 'Enter a valid folder name.' });
    const directory = join(resolve(parent), folderName);
    try {
      mkdirSync(directory);
    } catch {
      return reply.code(400).send({ message: 'Cannot create this folder.' });
    }
    return reply.code(201).send({ directory });
  });
  app.get('/api/settings/source', async () => {
    const { settings, revision } = currentSource();
    return publicSourceSettings(settings, revision);
  });
  app.put(
    '/api/settings/source',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const { settings: current } = currentSource();
      const { revision, settings } = updatedSourceSettings(
        current,
        request.body,
      );
      if (!store.updateSourceSettings(revision, settings))
        return reply.code(409).send({
          message: 'Source settings changed. Reload them before saving.',
        });
      const saved = currentSource();
      eventCollector.refresh();
      return publicSourceSettings(saved.settings, saved.revision);
    },
  );
  app.get('/api/settings/collector', async () => store.getCollectorSettings());
  app.get('/api/settings/notifications', async () => {
    const { revision, settings } = store.getNotificationSettings();
    const source = currentSource().settings;
    const dashboards = store.list();
    const targets = dashboardAlertTargets(dashboards);
    return {
      ...publicNotificationSettings(settings, revision),
      dashboards: dashboards.map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        limitTiles: targets.filter(
          (target) => target.dashboardId === dashboard.id,
        ).length,
      })),
      devices:
        source.source === 'modbus'
          ? source.modbus.devices.map(({ project, id, name, host }) => ({
              project,
              deviceId: id,
              name,
              host,
              key: JSON.stringify([project, id, host]),
            }))
          : [],
    };
  });
  app.put('/api/settings/notifications', async (request, reply) => {
    const input = notificationSettingsInput.parse(request.body);
    const current = store.getNotificationSettings();
    const settings = {
      telegram: {
        enabled: input.telegram.enabled,
        chatId: input.telegram.chatId,
        botToken:
          input.telegram.botToken === null
            ? ''
            : input.telegram.botToken || current.settings.telegram.botToken,
      },
      pushover: {
        enabled: input.pushover.enabled,
        userKey: input.pushover.userKey,
        appToken:
          input.pushover.appToken === null
            ? ''
            : input.pushover.appToken || current.settings.pushover.appToken,
      },
      email: input.email
        ? {
            ...input.email,
            password:
              input.email.password === null
                ? ''
                : input.email.password || current.settings.email.password,
          }
        : current.settings.email,
      discord: input.discord
        ? {
            enabled: input.discord.enabled,
            webhookUrl:
              input.discord.webhookUrl === null
                ? ''
                : input.discord.webhookUrl ||
                  current.settings.discord.webhookUrl,
          }
        : current.settings.discord,
      eventTypes:
        input.eventTypes === undefined
          ? current.settings.eventTypes
          : input.eventTypes,
      deviceKeys:
        input.deviceKeys === undefined
          ? current.settings.deviceKeys
          : input.deviceKeys,
      dashboardAlarms:
        input.dashboardAlarms === undefined
          ? current.settings.dashboardAlarms
          : input.dashboardAlarms,
      dashboardIds:
        input.dashboardIds === undefined
          ? current.settings.dashboardIds
          : input.dashboardIds,
      enabledAtMs: current.settings.enabledAtMs || Date.now(),
    };
    if (
      settings.telegram.enabled &&
      (!settings.telegram.chatId || !settings.telegram.botToken)
    )
      return reply
        .code(400)
        .send({ message: 'Telegram needs a bot token and chat ID.' });
    if (
      settings.pushover.enabled &&
      (!settings.pushover.userKey || !settings.pushover.appToken)
    )
      return reply
        .code(400)
        .send({ message: 'Pushover needs an app token and user key.' });
    if (
      settings.email.enabled &&
      (!settings.email.host ||
        !settings.email.from ||
        !settings.email.recipients.length ||
        (settings.email.username && !settings.email.password))
    )
      return reply.code(400).send({
        message:
          'Email needs an SMTP host, sender, recipients, and a password when a username is set.',
      });
    if (settings.discord.enabled && !settings.discord.webhookUrl)
      return reply
        .code(400)
        .send({ message: 'Discord needs a channel webhook URL.' });
    if (!store.updateNotificationSettings(input.revision, settings))
      return reply.code(409).send({
        message: 'Notification settings changed. Reload before saving.',
      });
    const saved = store.getNotificationSettings();
    return publicNotificationSettings(saved.settings, saved.revision);
  });
  app.get('/api/notifications/deliveries', async () => ({
    deliveries: store.notificationDeliveries(),
  }));
  app.post('/api/notifications/test', async (request, reply) => {
    const { provider } = z
      .object({
        provider: z.enum(['telegram', 'pushover', 'email', 'discord']),
      })
      .strict()
      .parse(request.body);
    const { settings } = store.getNotificationSettings();
    const configured =
      provider === 'discord'
        ? Boolean(settings.discord.webhookUrl)
        : provider === 'email'
          ? Boolean(
              settings.email.host &&
              settings.email.from &&
              settings.email.recipients.length &&
              (!settings.email.username || settings.email.password),
            )
          : provider === 'telegram'
            ? Boolean(settings.telegram.botToken && settings.telegram.chatId)
            : Boolean(settings.pushover.appToken && settings.pushover.userKey);
    if (!settings[provider].enabled || !configured)
      return reply
        .code(400)
        .send({ message: `Configure and enable ${provider} first.` });
    try {
      await (options.notificationSender ?? sendNotification)(
        provider,
        testDashboardAlertMessage(Date.now()),
        settings,
      );
      return { sent: true };
    } catch {
      return reply.code(502).send({
        message: `${provider} delivery failed. Check the credentials and recipient.`,
      });
    }
  });
  app.get('/api/history/usage', async () => store.historyUsage());
  app.put('/api/settings/collector', async (request, reply) => {
    const { revision, ...settings } = collectorSettingsInput.parse(
      request.body,
    );
    if (!store.updateCollectorSettings(revision, settings))
      return reply.code(409).send({
        message: 'Collector settings changed. Reload them before saving.',
      });
    historySampler.configure(settings);
    eventCollector.configure(settings.eventIntervalMinutes);
    return store.getCollectorSettings();
  });
  app.get('/api/events', async (request) => {
    const { offset, limit, deviceKey } = z
      .object({
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        deviceKey: z.string().max(500).optional(),
      })
      .strict()
      .parse(request.query);
    let device: { project: string; deviceId: string; host: string } | undefined;
    if (deviceKey !== undefined) {
      try {
        const [project, deviceId, host] = z
          .tuple([z.string(), z.string(), z.string()])
          .parse(JSON.parse(deviceKey));
        device = { project, deviceId, host };
      } catch {
        throw Object.assign(new Error('Invalid device filter.'), {
          statusCode: 400,
        });
      }
    }
    const current = currentSource().settings;
    const rows = store.deviceEvents(offset, limit + 1, device);
    const configuredDevices = current.modbus.devices.map(
      ({ project, id, name, host }) => ({
        project,
        deviceId: id,
        deviceName: name,
        host,
      }),
    );
    const statuses = store.deviceEventFetchStatuses();
    const configuredKeys = new Set(
      configuredDevices.map((item) =>
        JSON.stringify([item.project, item.deviceId, item.host]),
      ),
    );
    return {
      source: current.source,
      devices: [...statuses, ...configuredDevices],
      events: rows.slice(0, limit),
      hasMore: rows.length > limit,
      fetchStatuses:
        current.source === 'modbus'
          ? statuses.filter((item) =>
              configuredKeys.has(
                JSON.stringify([item.project, item.deviceId, item.host]),
              ),
            )
          : [],
    };
  });
  const recordingDevice = (key: string) => {
    const source = currentSource().settings;
    if (source.source !== 'modbus')
      throw Object.assign(new Error('Select Direct Modbus/TCP first.'), {
        statusCode: 400,
      });
    const device = source.modbus.devices.find(
      (item) => JSON.stringify([item.project, item.id, item.host]) === key,
    );
    if (!device)
      throw Object.assign(new Error('Device is not configured.'), {
        statusCode: 404,
      });
    return { device, timeoutMs: source.modbus.timeoutMs };
  };
  async function syncRecordingBatch(
    deviceKey: string,
    profileId: string,
    offset: number,
    limit: number,
    signal: AbortSignal,
    measureAll = false,
  ) {
    const { device, timeoutMs } = recordingDevice(deviceKey);
    const known = Object.fromEntries(
      (
        store
          .deviceRecordingCatalog(deviceKey)
          .find((item) => item.id === profileId)?.files ?? []
      ).map((file) => [
        file.name,
        { size: file.size, modifiedAt: file.modifiedAt },
      ]),
    );
    const batch = await (
      options.recordingBatchDownloader ?? downloadDeviceRecordingBatch
    )(
      device,
      timeoutMs,
      profileId,
      offset,
      limit,
      measureAll ? {} : known,
      signal,
    );
    signal.throwIfAborted();
    const { files: _files, ...profile } =
      batch.profile as DeviceRecordingProfile;
    const ranges: Record<string, { startMs: number; endMs: number } | null> =
      {};
    const saveStarted = performance.now();
    for (const item of batch.downloaded) {
      store.saveDeviceRecording(
        deviceKey,
        profile,
        item.file,
        item.bytes,
        item.range,
      );
      ranges[item.file.name] = item.range;
    }
    const saveMs = performance.now() - saveStarted;
    return {
      downloaded: batch.downloaded.length,
      downloadedBytes: batch.downloaded.reduce(
        (total, item) => total + item.bytes.length,
        0,
      ),
      skipped: batch.skipped,
      failed: batch.failed,
      total: batch.total,
      nextOffset: batch.nextOffset,
      ranges,
      timings: {
        connectMs: batch.timings?.connectMs ?? 0,
        setupMs: batch.timings?.setupMs ?? 0,
        downloadMs: batch.timings?.downloadMs ?? 0,
        saveMs,
      },
      fileTimings: batch.fileTimings ?? [],
    };
  }
  recordingSyncJobs = new RecordingSyncJobs(
    () => {
      const source = currentSource().settings;
      return source.source === 'modbus'
        ? source.modbus.devices
            .filter((device) => device.ftpUsername && device.ftpPassword)
            .map((device) => ({
              key: JSON.stringify([device.project, device.id, device.host]),
              name: device.name,
            }))
        : [];
    },
    async (key, signal) => {
      const { device, timeoutMs } = recordingDevice(key);
      return (options.recordingLister ?? listDeviceRecordings)(
        device,
        timeoutMs,
        signal,
      );
    },
    (key, profileId, offset, signal, measureAll) =>
      syncRecordingBatch(key, profileId, offset, 10, signal, measureAll),
  );
  app.get('/api/device-history/sync-job', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { job: recordingSyncJobs!.status() };
  });
  app.post('/api/device-history/sync-job', async (request) => {
    const { scope, deviceKey, profileId, measureAll } = z
      .object({
        scope: z.enum(['recording', 'device', 'all']),
        deviceKey: z.string().min(1).max(500).optional(),
        profileId: z
          .string()
          .regex(/^(?:rec|hiddenrec)[0-9a-f]+$/i)
          .optional(),
        measureAll: z.boolean().optional(),
      })
      .strict()
      .parse(request.body);
    return {
      job: recordingSyncJobs!.start(scope, deviceKey, profileId, measureAll),
    };
  });
  app.delete('/api/device-history/sync-job', async () => ({
    job: recordingSyncJobs!.cancel(),
  }));
  app.get('/api/device-history/devices', async () => {
    const source = currentSource().settings;
    const configured = source.modbus.devices.map((device) => ({
      key: JSON.stringify([device.project, device.id, device.host]),
      project: device.project,
      name: device.name,
      host: device.host,
      hasFtpLogin:
        source.source === 'modbus' &&
        Boolean(device.ftpUsername && device.ftpPassword),
      hasSavedHistory: store.hasDeviceRecordings(
        JSON.stringify([device.project, device.id, device.host]),
      ),
      removed: false,
    }));
    const configuredKeys = new Set(configured.map((device) => device.key));
    const archived = store
      .deviceRecordingDeviceKeys()
      .filter((key) => !configuredKeys.has(key))
      .flatMap((key) => {
        try {
          const identity: unknown = JSON.parse(key);
          if (
            !Array.isArray(identity) ||
            identity.length !== 3 ||
            !identity.every((part) => typeof part === 'string')
          )
            return [];
          const [project, id, host] = identity as [string, string, string];
          return [
            {
              key,
              project,
              name: `Device ${id}`,
              host,
              hasFtpLogin: false,
              hasSavedHistory: true,
              removed: true,
            },
          ];
        } catch {
          return [];
        }
      });
    return {
      source: source.source,
      devices: [...configured, ...archived],
    };
  });
  app.get('/api/device-history/catalog', async (request, reply) => {
    const { deviceKey } = z
      .object({ deviceKey: z.string().min(1).max(500) })
      .strict()
      .parse(request.query);
    const saved = store.deviceRecordingCatalog(deviceKey);
    let connection: ReturnType<typeof recordingDevice>;
    try {
      connection = recordingDevice(deviceKey);
    } catch (error) {
      if (!saved.length) throw error;
      const removed = !currentSource().settings.modbus.devices.some(
        (item) =>
          JSON.stringify([item.project, item.id, item.host]) === deviceKey,
      );
      return { profiles: saved, offline: true, removed };
    }
    let live: DeviceRecordingProfile[];
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      live = await (options.recordingLister ?? listDeviceRecordings)(
        connection.device,
        connection.timeoutMs,
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (!saved.length) throw error;
      return { profiles: saved, offline: true };
    } finally {
      reply.raw.off('close', abort);
    }
    const profiles = live.map((profile) => {
      const stored = saved.find((item) => item.id === profile.id);
      if (!stored) return profile;
      const liveNames = new Set(profile.files.map((file) => file.name));
      return {
        ...profile,
        files: [
          ...profile.files.map((file) => {
            const copy = stored.files.find((item) => item.name === file.name);
            return copy
              ? {
                  ...file,
                  storedAt: copy.storedAt,
                  storedSize: copy.size,
                  range: copy.range,
                }
              : file;
          }),
          ...stored.files.filter((file) => !liveNames.has(file.name)),
        ].sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true }),
        ),
      };
    });
    profiles.push(
      ...saved.filter(
        (item) => !live.some((profile) => profile.id === item.id),
      ),
    );
    return { profiles, offline: false };
  });
  app.get('/api/device-history/points', async (request) => {
    const { deviceKey, file, field, statistic } = z
      .object({
        deviceKey: z.string().min(1).max(500),
        file: z.string().min(1).max(200),
        field: z.coerce.number().int().min(0).max(199),
        statistic: z.enum(['average', 'minimum', 'maximum']).default('average'),
      })
      .strict()
      .parse(request.query);
    const saved = store.deviceRecordingFile(deviceKey, file);
    if (saved) {
      const profile = store
        .deviceRecordingCatalog(deviceKey)
        .find((item) => item.id === saved.profileId);
      if (!profile) throw new Error('Saved recording header is missing.');
      const points = parseRecordingFile(saved.bytes, profile, field, statistic);
      return {
        profile,
        file,
        fieldIndex: field,
        statistic,
        range: saved.range,
        points,
        source: 'saved',
        storedAt: saved.storedAt,
      };
    }
    const { device, timeoutMs } = recordingDevice(deviceKey);
    return (options.recordingReader ?? readDeviceRecording)(
      device,
      timeoutMs,
      file,
      field,
      statistic,
    );
  });
  app.post('/api/device-history/ranges', async (request, reply) => {
    const { deviceKey, profileId, offset, limit } = z
      .object({
        deviceKey: z.string().min(1).max(500),
        profileId: z.string().regex(/^(?:rec|hiddenrec)[0-9a-f]+$/i),
        offset: z.number().int().min(0).max(2000),
        limit: z.number().int().min(1).max(10),
      })
      .strict()
      .parse(request.body);
    const { device, timeoutMs } = recordingDevice(deviceKey);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      return await (options.recordingRangeReader ?? readDeviceRecordingRanges)(
        device,
        timeoutMs,
        profileId,
        offset,
        limit,
        controller.signal,
      );
    } finally {
      reply.raw.off('close', abort);
    }
  });
  app.post('/api/device-history/sync', async (request, reply) => {
    const { deviceKey, profileId, offset, limit } = z
      .object({
        deviceKey: z.string().min(1).max(500),
        profileId: z.string().regex(/^(?:rec|hiddenrec)[0-9a-f]+$/i),
        offset: z.number().int().min(0).max(2000),
        limit: z.number().int().min(1).max(10),
      })
      .strict()
      .parse(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      return await syncRecordingBatch(
        deviceKey,
        profileId,
        offset,
        limit,
        controller.signal,
      );
    } finally {
      reply.raw.off('close', abort);
    }
  });
  app.delete('/api/device-history/recordings', async (request) => {
    const { deviceKey } = z
      .object({ deviceKey: z.string().min(1).max(500) })
      .strict()
      .parse(request.body);
    const deleted = store.deleteDeviceRecordings(deviceKey);
    return { deleted, hasSavedDeviceHistory: store.hasAnyDeviceRecordings() };
  });
  app.post('/api/events/collect', async (request, reply) => {
    if (currentSource().settings.source !== 'modbus')
      return reply.code(400).send({
        message: 'Select Direct Modbus/TCP in Source settings first.',
      });
    await eventCollector.collectOnce();
    return { fetchStatuses: store.deviceEventFetchStatuses() };
  });
  app.delete('/api/history', async (request, reply) => {
    const { before } = z
      .object({ before: z.iso.datetime({ offset: true }) })
      .strict()
      .parse(request.body);
    const cutoff = Date.parse(before);
    if (!Number.isFinite(cutoff) || cutoff > Date.now())
      return reply.code(400).send({
        message: 'Choose a date that is not in the future.',
      });
    return { deleted: store.pruneReadings(cutoff) };
  });
  app.get('/api/dashboards', async () => store.list());
  app.get('/api/dashboards/alarm-status', async () =>
    historySampler.currentAlarmStatus(),
  );
  app.put('/api/dashboards/order', async (request, reply) => {
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).max(500) })
      .strict()
      .parse(request.body);
    if (!store.reorder(ids))
      return reply.code(409).send({
        message: 'Dashboard list changed. Reload before reordering.',
      });
    return store.list();
  });
  app.post(
    '/api/dashboards',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) =>
      reply.code(201).send(store.create(dashboardInput.parse(request.body))),
  );
  app.post(
    '/api/dashboards/batch',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          store.createMany(
            z.array(dashboardInput).min(2).max(500).parse(request.body),
          ),
        ),
  );
  app.get('/api/dashboards/:id', async (request, reply) => {
    const dashboard = store.get(idFrom(request.params));
    return (
      dashboard ?? reply.code(404).send({ message: 'Dashboard not found.' })
    );
  });
  app.put(
    '/api/dashboards/:id',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const id = idFrom(request.params);
      const { revision, ...input } = z
        .object({ revision: z.number().int().positive() })
        .passthrough()
        .parse(request.body);
      const parsed = dashboardInput.parse(input);
      if (!store.get(id))
        return reply.code(404).send({
          message: 'Dashboard was deleted. Reload the dashboard list.',
        });
      return (
        store.update(id, revision, parsed) ??
        reply.code(409).send({
          message:
            'This dashboard was changed by someone else. Cancel your edits to load the latest version.',
        })
      );
    },
  );
  app.delete('/api/dashboards/:id', async (request, reply) => {
    const id = idFrom(request.params);
    const { revision } = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .parse(request.body);
    if (!store.get(id))
      return reply.code(404).send({ message: 'Dashboard not found.' });
    if (!store.delete(id, revision))
      return reply.code(409).send({
        message: 'This dashboard changed. Reload before deleting it.',
      });
    return reply.code(204).send();
  });
  app.get('/api/projects', async () => currentSource().source.projects());
  app.get('/api/devices', async (request) => {
    const { project } = z.object({ project: projectName }).parse(request.query);
    return currentSource().source.devices(project);
  });
  app.get('/api/measurements', async (request) => {
    const { project, device } = z
      .object({
        project: projectName,
        device: z.string().regex(/^\d+$/).max(20),
      })
      .parse(request.query);
    return currentSource().source.measurements(project, device);
  });
  app.get('/api/dashboards/:id/readings', async (request, reply) => {
    const dashboard = store.get(idFrom(request.params));
    if (!dashboard)
      return reply.code(404).send({ message: 'Dashboard not found.' });
    const bindings = readingBindings(dashboard.widgets);
    const snapshot = await historySampler.readingsFor(
      bindings,
      currentSource().settings.staleMs,
    );
    return {
      revision: dashboard.revision,
      sourceRevision: snapshot.sourceRevision,
      sampledAt: snapshot.sampledAt,
      readings: withTotalReadings(dashboard.widgets, snapshot.readings),
    };
  });
  app.get('/api/history/values', async () =>
    mappedModbusValues(currentSource().settings).map((value) => ({
      ...value,
      key: bindingKey(value.binding),
    })),
  );
  app.get('/api/history', async (request, reply) => {
    const retentionMs =
      store.getCollectorSettings().settings.retentionDays * 24 * 60 * 60 * 1000;
    const { key, minutes, end } = z
      .object({
        key: z.string(),
        minutes: z.coerce
          .number()
          .int()
          .min(1)
          .max(retentionMs / 60_000)
          .default(60),
        end: z.coerce
          .number()
          .int()
          .min(0)
          .max(8_640_000_000_000_000)
          .optional(),
      })
      .strict()
      .parse(request.query);
    if (
      !mappedModbusValues(currentSource().settings).some(
        (value) => bindingKey(value.binding) === key,
      )
    )
      return reply
        .code(400)
        .send({ message: 'Value is not in the active mapping.' });
    const windowEnd = end ?? Date.now();
    return {
      sourceRevision: currentSource().revision,
      samples: store.readingHistory(
        currentSource().revision,
        [key],
        windowEnd - minutes * 60_000,
        windowEnd,
      ),
    };
  });
  app.get('/api/dashboards/:id/history', async (request, reply) => {
    const dashboard = store.get(idFrom(request.params));
    if (!dashboard)
      return reply.code(404).send({ message: 'Dashboard not found.' });
    const retentionMs =
      store.getCollectorSettings().settings.retentionDays * 24 * 60 * 60 * 1000;
    const { minutes, key, end } = z
      .object({
        minutes: z.coerce
          .number()
          .int()
          .min(1)
          .max(retentionMs / 60_000)
          .default(60),
        key: z.string().optional(),
        end: z.coerce
          .number()
          .int()
          .min(0)
          .max(8_640_000_000_000_000)
          .optional(),
      })
      .strict()
      .parse(request.query);
    const keys = historyKeys(dashboard);
    if (key !== undefined && !keys.includes(key))
      return reply
        .code(400)
        .send({ message: 'Value is not on this dashboard.' });
    const sourceRevision = currentSource().revision;
    const windowEnd = end ?? Date.now();
    const since = windowEnd - minutes * 60_000;
    return {
      revision: dashboard.revision,
      sourceRevision,
      samples: store.readingHistory(
        sourceRevision,
        key === undefined ? keys : [key],
        since,
        windowEnd,
      ),
    };
  });
  app.get('/api/dashboards/:id/consumption/:tileId', async (request, reply) => {
    const dashboard = store.get(idFrom(request.params));
    if (!dashboard)
      return reply.code(404).send({ message: 'Dashboard not found.' });
    const tileId = z
      .object({ tileId: z.string().uuid() })
      .parse(request.params).tileId;
    const tile = dashboard.widgets.find(
      (candidate) => isConsumptionTile(candidate) && candidate.id === tileId,
    );
    if (!tile || !isConsumptionTile(tile))
      return reply.code(404).send({ message: 'Consumption tile not found.' });
    const { start, buckets } = z
      .object({
        start: z.coerce.number().int().nonnegative(),
        buckets: z.string().optional(),
      })
      .strict()
      .parse(request.query);
    const now = Date.now();
    if (start > now || now - start > 32 * 24 * 60 * 60 * 1000)
      return reply.code(400).send({ message: 'Invalid consumption period.' });
    const bucketStarts = buckets?.split(',').map(Number) ?? [];
    if (
      bucketStarts.length > 32 ||
      (buckets !== undefined && bucketStarts.length === 0) ||
      bucketStarts.some(
        (time, index) =>
          !Number.isSafeInteger(time) ||
          time < start ||
          time > now ||
          (index > 0 && time <= bucketStarts[index - 1]),
      ) ||
      (bucketStarts.length > 0 && bucketStarts[0] !== start)
    )
      return reply.code(400).send({ message: 'Invalid consumption buckets.' });
    const settings = store.getCollectorSettings().settings;
    const sourceRevision = currentSource().revision;
    const sources = tile.sources ?? [
      {
        binding: tile.binding,
        deviceName: tile.deviceName,
        label: tile.label,
        unit: tile.unit,
      },
    ];
    function consumption(from: number, to: number) {
      const readings = sources.map((source) => ({
        ...store.consumption(
          sourceRevision,
          bindingKey(source.binding),
          source.unit,
          from,
          to,
          settings.intervalSeconds * 1000,
        ),
        unit: source.unit,
      }));
      const factor = (unit: string) =>
        ({ wh: 0.001, kwh: 1, mwh: 1000, gwh: 1_000_000, twh: 1_000_000_000 })[
          unit.toLowerCase() as 'wh' | 'kwh' | 'mwh' | 'gwh' | 'twh'
        ];
      const value = readings.every((reading) => reading.value !== null)
        ? readings.reduce(
            (sum, reading) => sum + reading.value! * factor(reading.unit),
            0,
          )
        : null;
      return {
        value: value !== null && Number.isFinite(value) ? value : null,
        partial: readings.some((reading) => reading.partial),
        reset: readings.some((reading) => reading.reset),
        baselineTime:
          readings.length && readings.every((r) => r.baselineTime !== null)
            ? Math.max(...readings.map((r) => r.baselineTime!))
            : null,
        lastTime:
          readings.length && readings.every((r) => r.lastTime !== null)
            ? Math.min(...readings.map((r) => r.lastTime!))
            : null,
      };
    }
    const reading = consumption(start, now);
    return {
      revision: dashboard.revision,
      sourceRevision,
      unit: 'kWh',
      ...reading,
      buckets: bucketStarts.map((time, index) => ({
        start: time,
        ...consumption(time, bucketStarts[index + 1] ?? now),
      })),
      stale:
        reading.lastTime !== null &&
        now - reading.lastTime >
          Math.max(60_000, settings.intervalSeconds * 3000),
    };
  });
  const root = options.staticRoot ?? resolve('dist/client');
  if (existsSync(root)) {
    await app.register(fastifyStatic, { root });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/api/') ||
        request.method !== 'GET' ||
        !request.headers.accept?.includes('text/html')
      ) {
        return reply.code(404).send({ message: 'Not found.' });
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}
