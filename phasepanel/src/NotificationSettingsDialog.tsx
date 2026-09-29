import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';
import { deviceEventTypes, type DeviceEventType } from '../shared/deviceEvents';

type DeviceOption = {
  key: string;
  project: string;
  deviceId: string;
  name: string;
  host: string;
};
type DashboardOption = { id: string; name: string; limitTiles: number };

type Settings = {
  revision: number;
  telegram: { enabled: boolean; chatId: string; configured: boolean };
  pushover: { enabled: boolean; userKey: string; configured: boolean };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    security: 'starttls' | 'tls';
    username: string;
    from: string;
    recipients: string[];
    configured: boolean;
    passwordSaved: boolean;
  };
  discord: { enabled: boolean; configured: boolean };
  eventTypes: DeviceEventType[] | null;
  deviceKeys: string[] | null;
  devices: DeviceOption[];
  dashboardAlarms: boolean;
  dashboardIds: string[] | null;
  dashboards: DashboardOption[];
};
type Delivery = {
  id: number;
  provider: string;
  message: string;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAtMs: number | null;
};
type Provider = 'email' | 'telegram' | 'pushover' | 'discord';

export function NotificationSettingsDialog({
  source,
  onClose,
}: {
  source: 'mock' | 'gridvis' | 'modbus' | undefined;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [clearCredentials, setClearCredentials] = useState<
    Record<Provider, boolean>
  >({
    email: false,
    telegram: false,
    pushover: false,
    discord: false,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      api<Settings>('/settings/notifications'),
      api<{ deliveries: Delivery[] }>('/notifications/deliveries'),
    ])
      .then(([next, history]) => {
        if (mounted) {
          setSettings(next);
          setEmailRecipients(next.email.recipients.join(', '));
          setDeliveries(history.deliveries);
        }
      })
      .catch((failure) => {
        if (mounted) setError(message(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      await api('/settings/notifications', {
        method: 'PUT',
        body: JSON.stringify({
          revision: settings.revision,
          eventTypes: settings.eventTypes,
          deviceKeys: settings.deviceKeys,
          dashboardAlarms: settings.dashboardAlarms,
          dashboardIds: settings.dashboardIds,
          telegram: {
            enabled: settings.telegram.enabled,
            chatId: settings.telegram.chatId,
            ...(botToken
              ? { botToken }
              : clearCredentials.telegram
                ? { botToken: null }
                : {}),
          },
          pushover: {
            enabled: settings.pushover.enabled,
            userKey: settings.pushover.userKey,
            ...(appToken
              ? { appToken }
              : clearCredentials.pushover
                ? { appToken: null }
                : {}),
          },
          email: {
            enabled: settings.email.enabled,
            host: settings.email.host,
            port: settings.email.port,
            security: settings.email.security,
            username: settings.email.username,
            from: settings.email.from,
            recipients: emailRecipients
              .split(/[\n,;]+/)
              .map((address) => address.trim())
              .filter(Boolean),
            ...(emailPassword
              ? { password: emailPassword }
              : clearCredentials.email
                ? { password: null }
                : {}),
          },
          discord: {
            enabled: settings.discord.enabled,
            ...(discordWebhookUrl
              ? { webhookUrl: discordWebhookUrl }
              : clearCredentials.discord
                ? { webhookUrl: null }
                : {}),
          },
        }),
      });
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(
    provider: 'telegram' | 'pushover' | 'email' | 'discord',
  ) {
    setTestStatus('Sending…');
    try {
      await api('/notifications/test', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      setTestStatus(`Test sent to ${provider}.`);
    } catch (failure) {
      setTestStatus(message(failure));
    }
  }

  function toggleEventType(type: DeviceEventType, checked: boolean) {
    if (!settings) return;
    const selected = settings.eventTypes ?? [...deviceEventTypes];
    const next = checked
      ? [...new Set([...selected, type])]
      : selected.filter((item) => item !== type);
    setSettings({
      ...settings,
      eventTypes: next.length === deviceEventTypes.length ? null : next,
    });
    setHasChanges(true);
  }

  function toggleDevice(key: string, checked: boolean) {
    if (!settings) return;
    const selected =
      settings.deviceKeys ?? settings.devices.map((item) => item.key);
    const next = checked
      ? [...new Set([...selected, key])]
      : selected.filter((item) => item !== key);
    setSettings({
      ...settings,
      deviceKeys: next.length === settings.devices.length ? null : next,
    });
    setHasChanges(true);
  }

  function toggleDashboard(id: string, checked: boolean) {
    if (!settings) return;
    const selected =
      settings.dashboardIds ?? settings.dashboards.map((item) => item.id);
    const next = checked
      ? [...new Set([...selected, id])]
      : selected.filter((item) => item !== id);
    setSettings({
      ...settings,
      dashboardIds: next.length === settings.dashboards.length ? null : next,
    });
    setHasChanges(true);
  }

  function updateEmail(changes: Partial<Settings['email']>) {
    if (!settings) return;
    setSettings({
      ...settings,
      email: { ...settings.email, ...changes },
    });
    setHasChanges(true);
  }

  function removeCredentials(provider: Provider) {
    setClearCredentials((current) => ({ ...current, [provider]: true }));
    setHasChanges(true);
    if (provider === 'email') {
      setEmailPassword('');
      setEmailRecipients('');
    } else if (provider === 'telegram') setBotToken('');
    else if (provider === 'pushover') setAppToken('');
    else setDiscordWebhookUrl('');
    setSettings((current) => {
      if (!current) return current;
      switch (provider) {
        case 'email':
          return {
            ...current,
            email: {
              enabled: false,
              host: '',
              port: 587,
              security: 'starttls',
              username: '',
              from: '',
              recipients: [],
              configured: false,
              passwordSaved: false,
            },
          };
        case 'telegram':
          return {
            ...current,
            telegram: { enabled: false, chatId: '', configured: false },
          };
        case 'pushover':
          return {
            ...current,
            pushover: { enabled: false, userKey: '', configured: false },
          };
        case 'discord':
          return {
            ...current,
            discord: { enabled: false, configured: false },
          };
      }
    });
  }

  const monitoredTiles =
    settings?.dashboards
      .filter(
        (dashboard) =>
          settings.dashboardIds === null ||
          settings.dashboardIds.includes(dashboard.id),
      )
      .reduce((count, dashboard) => count + dashboard.limitTiles, 0) ?? 0;

  return (
    <Modal
      labelledBy="notification-settings-title"
      onClose={onClose}
      className="notification-shell"
    >
      <section className="modal notification-modal">
        <header className="notification-intro">
          <span className="eyebrow">SHARED WORKSPACE</span>
          <div className="notification-title-row">
            <h2 id="notification-settings-title">Notifications</h2>
            <button
              type="button"
              aria-expanded={showDeliveries}
              onClick={() => setShowDeliveries((open) => !open)}
            >
              Recent deliveries
              {deliveries.length ? ` (${deliveries.length})` : ''}
            </button>
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!settings ? (
          <p>Loading settings…</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="notification-content">
              <h3 className="notification-settings-group-heading">
                <span aria-hidden="true">1</span>
                What to send
              </h3>
              <section
                className="notification-dashboard-limits"
                aria-labelledby="notification-dashboard-limits-title"
              >
                <div className="notification-dashboard-heading">
                  <div>
                    <h3 id="notification-dashboard-limits-title">
                      Dashboard limits
                    </h3>
                    <span>
                      {monitoredTiles} {monitoredTiles === 1 ? 'tile' : 'tiles'}{' '}
                      with limits
                    </span>
                  </div>
                  <label className="notification-switch">
                    <input
                      type="checkbox"
                      aria-label="Notify for dashboard limits"
                      checked={settings.dashboardAlarms}
                      onChange={(event) => {
                        setSettings({
                          ...settings,
                          dashboardAlarms: event.target.checked,
                        });
                        setHasChanges(true);
                      }}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <fieldset
                  className="notification-dashboard-selection"
                  disabled={!settings.dashboardAlarms}
                >
                  <legend>Dashboards</legend>
                  <label className="notification-rule-choice notification-rule-all">
                    <input
                      type="checkbox"
                      checked={settings.dashboardIds === null}
                      onChange={(event) => {
                        setSettings({
                          ...settings,
                          dashboardIds: event.target.checked ? null : [],
                        });
                        setHasChanges(true);
                      }}
                    />
                    All dashboards
                  </label>
                  {settings.dashboards.length ? (
                    <div className="notification-dashboard-list">
                      {settings.dashboards.map((dashboard) => (
                        <label
                          className="notification-rule-choice"
                          key={dashboard.id}
                        >
                          <input
                            type="checkbox"
                            checked={
                              settings.dashboardIds === null ||
                              settings.dashboardIds.includes(dashboard.id)
                            }
                            onChange={(event) =>
                              toggleDashboard(
                                dashboard.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            {dashboard.name}
                            <small>
                              {dashboard.limitTiles}{' '}
                              {dashboard.limitTiles === 1 ? 'tile' : 'tiles'}{' '}
                              with limits
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p>No dashboards yet.</p>
                  )}
                </fieldset>
              </section>
              {source === 'modbus' && (
                <section
                  className="notification-rules"
                  aria-labelledby="notification-rules-title"
                >
                  <h3 id="notification-rules-title">FTP device events</h3>
                  <div className="notification-rule-groups">
                    <fieldset>
                      <legend>Event types</legend>
                      <label className="notification-rule-choice notification-rule-all">
                        <input
                          type="checkbox"
                          checked={settings.eventTypes === null}
                          onChange={(event) => {
                            setSettings({
                              ...settings,
                              eventTypes: event.target.checked ? null : [],
                            });
                            setHasChanges(true);
                          }}
                        />
                        All event types
                      </label>
                      {deviceEventTypes.map((type) => (
                        <label className="notification-rule-choice" key={type}>
                          <input
                            type="checkbox"
                            checked={
                              settings.eventTypes === null ||
                              settings.eventTypes.includes(type)
                            }
                            onChange={(event) =>
                              toggleEventType(type, event.target.checked)
                            }
                          />
                          {type}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend>Devices</legend>
                      {settings.devices.length ? (
                        <>
                          <label className="notification-rule-choice notification-rule-all">
                            <input
                              type="checkbox"
                              checked={settings.deviceKeys === null}
                              onChange={(event) => {
                                setSettings({
                                  ...settings,
                                  deviceKeys: event.target.checked ? null : [],
                                });
                                setHasChanges(true);
                              }}
                            />
                            All devices
                          </label>
                          {settings.devices.map((device) => (
                            <label
                              className="notification-rule-choice"
                              key={device.key}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  settings.deviceKeys === null ||
                                  settings.deviceKeys.includes(device.key)
                                }
                                onChange={(event) =>
                                  toggleDevice(device.key, event.target.checked)
                                }
                              />
                              <span>
                                {device.name || device.deviceId}
                                <small>
                                  {device.project} · {device.host}
                                </small>
                              </span>
                            </label>
                          ))}
                        </>
                      ) : (
                        <p>No Modbus devices configured.</p>
                      )}
                    </fieldset>
                  </div>
                </section>
              )}
              <h3 className="notification-settings-group-heading notification-settings-group-heading--providers">
                <span aria-hidden="true">2</span>
                Provider setup
              </h3>
              <div className="notification-providers">
                <section
                  className={`notification-provider${settings.email.enabled ? ' is-open' : ''}`}
                  aria-labelledby="notification-email-title"
                >
                  <div className="notification-provider-heading">
                    <div>
                      <h3 id="notification-email-title">Email</h3>
                    </div>
                    <div className="notification-provider-actions">
                      {(settings.email.configured ||
                        settings.email.passwordSaved ||
                        settings.email.host ||
                        settings.email.username ||
                        settings.email.from ||
                        settings.email.recipients.length > 0) && (
                        <button
                          type="button"
                          aria-label="Remove Email credentials"
                          onClick={() => removeCredentials('email')}
                        >
                          Remove credentials
                        </button>
                      )}
                      <label className="notification-switch">
                        <input
                          type="checkbox"
                          aria-label="Enable Email"
                          checked={settings.email.enabled}
                          onChange={(event) =>
                            updateEmail({ enabled: event.target.checked })
                          }
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                  </div>
                  <div className="notification-fields">
                    <label>
                      SMTP host
                      <input
                        value={settings.email.host}
                        onChange={(event) =>
                          updateEmail({ host: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      SMTP port
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={settings.email.port}
                        onChange={(event) =>
                          updateEmail({ port: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Encryption
                      <select
                        value={settings.email.security}
                        onChange={(event) =>
                          updateEmail({
                            security: event.target.value as 'starttls' | 'tls',
                          })
                        }
                      >
                        <option value="starttls">STARTTLS</option>
                        <option value="tls">SSL/TLS</option>
                      </select>
                    </label>
                    <label>
                      Username (optional)
                      <input
                        autoComplete="username"
                        value={settings.email.username}
                        onChange={(event) =>
                          updateEmail({ username: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          settings.email.passwordSaved
                            ? 'Saved; leave blank to keep'
                            : ''
                        }
                        value={emailPassword}
                        onChange={(event) => {
                          setEmailPassword(event.target.value);
                          setHasChanges(true);
                        }}
                      />
                    </label>
                    <label>
                      Sender email
                      <input
                        type="email"
                        value={settings.email.from}
                        onChange={(event) =>
                          updateEmail({ from: event.target.value })
                        }
                      />
                    </label>
                    <label className="notification-fields-wide">
                      Recipients
                      <textarea
                        rows={2}
                        placeholder="Separate addresses with commas or new lines"
                        value={emailRecipients}
                        onChange={(event) => {
                          setEmailRecipients(event.target.value);
                          setHasChanges(true);
                        }}
                      />
                    </label>
                  </div>
                  <div className="notification-provider-footer">
                    <span>{settings.email.enabled ? 'Enabled' : 'Off'}</span>
                    <button
                      type="button"
                      disabled={
                        hasChanges ||
                        !settings.email.enabled ||
                        !settings.email.configured
                      }
                      onClick={() => void sendTest('email')}
                    >
                      Send test
                    </button>
                  </div>
                </section>
                <section
                  className={`notification-provider${settings.telegram.enabled ? ' is-open' : ''}`}
                  aria-labelledby="notification-telegram-title"
                >
                  <div className="notification-provider-heading">
                    <div>
                      <h3 id="notification-telegram-title">Telegram</h3>
                    </div>
                    <div className="notification-provider-actions">
                      {(settings.telegram.configured ||
                        settings.telegram.chatId) && (
                        <button
                          type="button"
                          aria-label="Remove Telegram credentials"
                          onClick={() => removeCredentials('telegram')}
                        >
                          Remove credentials
                        </button>
                      )}
                      <label className="notification-switch">
                        <input
                          type="checkbox"
                          aria-label="Enable Telegram"
                          checked={settings.telegram.enabled}
                          onChange={(event) => {
                            setHasChanges(true);
                            setSettings({
                              ...settings,
                              telegram: {
                                ...settings.telegram,
                                enabled: event.target.checked,
                              },
                            });
                          }}
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                  </div>
                  <div className="notification-fields">
                    <label>
                      Chat ID
                      <input
                        value={settings.telegram.chatId}
                        onChange={(event) => {
                          setHasChanges(true);
                          setSettings({
                            ...settings,
                            telegram: {
                              ...settings.telegram,
                              chatId: event.target.value,
                            },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Bot token
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={
                          settings.telegram.configured
                            ? 'Saved; leave blank to keep'
                            : ''
                        }
                        value={botToken}
                        onChange={(event) => {
                          setHasChanges(true);
                          setBotToken(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="notification-provider-footer">
                    <span>{settings.telegram.enabled ? 'Enabled' : 'Off'}</span>
                    <button
                      type="button"
                      disabled={
                        hasChanges ||
                        !settings.telegram.enabled ||
                        !settings.telegram.configured
                      }
                      onClick={() => void sendTest('telegram')}
                    >
                      Send test
                    </button>
                  </div>
                </section>
                <section
                  className={`notification-provider${settings.pushover.enabled ? ' is-open' : ''}`}
                  aria-labelledby="notification-pushover-title"
                >
                  <div className="notification-provider-heading">
                    <div>
                      <h3 id="notification-pushover-title">Pushover</h3>
                    </div>
                    <div className="notification-provider-actions">
                      {(settings.pushover.configured ||
                        settings.pushover.userKey) && (
                        <button
                          type="button"
                          aria-label="Remove Pushover credentials"
                          onClick={() => removeCredentials('pushover')}
                        >
                          Remove credentials
                        </button>
                      )}
                      <label className="notification-switch">
                        <input
                          type="checkbox"
                          aria-label="Enable Pushover"
                          checked={settings.pushover.enabled}
                          onChange={(event) => {
                            setHasChanges(true);
                            setSettings({
                              ...settings,
                              pushover: {
                                ...settings.pushover,
                                enabled: event.target.checked,
                              },
                            });
                          }}
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                  </div>
                  <div className="notification-fields">
                    <label>
                      User or group key
                      <input
                        value={settings.pushover.userKey}
                        onChange={(event) => {
                          setHasChanges(true);
                          setSettings({
                            ...settings,
                            pushover: {
                              ...settings.pushover,
                              userKey: event.target.value,
                            },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Application token
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={
                          settings.pushover.configured
                            ? 'Saved; leave blank to keep'
                            : ''
                        }
                        value={appToken}
                        onChange={(event) => {
                          setHasChanges(true);
                          setAppToken(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="notification-provider-footer">
                    <span>{settings.pushover.enabled ? 'Enabled' : 'Off'}</span>
                    <button
                      type="button"
                      disabled={
                        hasChanges ||
                        !settings.pushover.enabled ||
                        !settings.pushover.configured
                      }
                      onClick={() => void sendTest('pushover')}
                    >
                      Send test
                    </button>
                  </div>
                </section>
                <section
                  className={`notification-provider${settings.discord.enabled ? ' is-open' : ''}`}
                  aria-labelledby="notification-discord-title"
                >
                  <div className="notification-provider-heading">
                    <div>
                      <h3 id="notification-discord-title">Discord</h3>
                    </div>
                    <div className="notification-provider-actions">
                      {settings.discord.configured && (
                        <button
                          type="button"
                          aria-label="Remove Discord credentials"
                          onClick={() => removeCredentials('discord')}
                        >
                          Remove credentials
                        </button>
                      )}
                      <label className="notification-switch">
                        <input
                          type="checkbox"
                          aria-label="Enable Discord"
                          checked={settings.discord.enabled}
                          onChange={(event) => {
                            setSettings({
                              ...settings,
                              discord: {
                                ...settings.discord,
                                enabled: event.target.checked,
                              },
                            });
                            setHasChanges(true);
                          }}
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                  </div>
                  <div className="notification-fields">
                    <label className="notification-fields-wide">
                      Channel webhook URL
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={
                          settings.discord.configured
                            ? 'Saved; leave blank to keep'
                            : 'https://discord.com/api/webhooks/...'
                        }
                        value={discordWebhookUrl}
                        onChange={(event) => {
                          setDiscordWebhookUrl(event.target.value);
                          setHasChanges(true);
                        }}
                      />
                    </label>
                  </div>
                  <div className="notification-provider-footer">
                    <span>{settings.discord.enabled ? 'Enabled' : 'Off'}</span>
                    <button
                      type="button"
                      disabled={
                        hasChanges ||
                        !settings.discord.enabled ||
                        !settings.discord.configured
                      }
                      onClick={() => void sendTest('discord')}
                    >
                      Send test
                    </button>
                  </div>
                </section>
              </div>
              {hasChanges && (
                <p className="notification-save-hint">
                  Save changes before sending a test.
                </p>
              )}
              {testStatus && (
                <p className="notification-test-status" role="status">
                  {testStatus}
                </p>
              )}
              {showDeliveries && (
                <section
                  className="notification-deliveries"
                  aria-labelledby="notification-deliveries-title"
                >
                  <div className="notification-deliveries-heading">
                    <h3 id="notification-deliveries-title">
                      Recent deliveries
                    </h3>
                    {deliveries.length > 0 && (
                      <span>{deliveries.length} recent</span>
                    )}
                  </div>
                  {deliveries.length ? (
                    <ul>
                      {deliveries.map((item) => (
                        <li key={item.id}>
                          <span
                            className={`notification-delivery-status ${item.status}`}
                          >
                            {item.status}
                          </span>
                          <div>
                            <strong>{item.provider}</strong>
                            <p>
                              {item.message}
                              {item.lastError ? ` · ${item.lastError}` : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted notification-empty">
                      No deliveries yet.
                    </p>
                  )}
                </section>
              )}
            </div>
            <footer className="modal-actions notification-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </Modal>
  );
}
