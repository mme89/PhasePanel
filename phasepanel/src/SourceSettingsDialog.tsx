import { useEffect, useState } from 'react';
import type { Dashboard } from '../shared/model';
import { defaultModbusModel, type ModbusModel } from '../shared/modbusModels';
import { measurementSources } from '../shared/totals';
import { api, message } from './api';
import { Modal } from './Modal';
import { ModbusModelsDialog } from './ModbusModelsDialog';

type DeviceRow = {
  project: string;
  id: string;
  name: string;
  model: string;
  host: string;
  port: number;
  ftpPort?: number;
  ftpUsername?: string;
  ftpPassword?: string;
  hasFtpPassword: boolean;
  clearFtpPassword?: boolean;
};
type Settings = {
  revision: number;
  source: 'mock' | 'gridvis' | 'modbus';
  gridvis: {
    baseUrl: string;
    username: string;
    timeoutMs: number;
    hasPassword: boolean;
  };
  modbus: { devices: DeviceRow[]; models: ModbusModel[]; timeoutMs: number };
  staleMs: number;
};

function deviceWebInterfaceUrl(host: string): string | undefined {
  const address = host.trim();
  if (!address || !/^[a-z0-9.:-]+$/i.test(address)) return;
  try {
    return new URL(
      `http://${address.includes(':') ? `[${address}]` : address}/`,
    ).href;
  } catch {
    return;
  }
}

export function SourceSettingsDialog({
  dashboards,
  onClose,
  onSaved,
}: {
  dashboards: Dashboard[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  useEffect(() => {
    let mounted = true;
    void api<Settings>('/settings/source')
      .then((result) => {
        if (mounted)
          setSettings({
            ...result,
            source: result.source === 'mock' ? 'modbus' : result.source,
          });
      })
      .catch((failure) => {
        if (mounted) setError(message(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  function setDevice(index: number, change: Partial<DeviceRow>) {
    setSettings(
      (current) =>
        current && {
          ...current,
          modbus: {
            ...current.modbus,
            devices: current.modbus.devices.map((device, i) =>
              i === index ? { ...device, ...change } : device,
            ),
          },
        },
    );
  }

  function applyFtpCredentialsToAll(index: number) {
    setSettings((current) => {
      if (!current) return current;
      const source = current.modbus.devices[index];
      if (
        !source?.ftpUsername ||
        !source.ftpPassword ||
        source.clearFtpPassword
      )
        return current;
      return {
        ...current,
        modbus: {
          ...current.modbus,
          devices: current.modbus.devices.map((device) => ({
            ...device,
            ftpUsername: source.ftpUsername,
            ftpPassword: source.ftpPassword,
            clearFtpPassword: false,
          })),
        },
      };
    });
  }

  function addDashboardDevices() {
    setSettings((current) => {
      if (!current) return current;
      const devices = [...current.modbus.devices];
      const known = new Set(
        devices.map((device) => JSON.stringify([device.project, device.id])),
      );
      for (const dashboard of dashboards)
        for (const tile of dashboard.widgets)
          for (const source of measurementSources(tile)) {
            const key = JSON.stringify([
              source.binding.project,
              source.binding.deviceId,
            ]);
            if (known.has(key)) continue;
            known.add(key);
            devices.push({
              project: source.binding.project,
              id: source.binding.deviceId,
              name: source.deviceName,
              model: defaultModbusModel,
              host: '',
              port: 502,
              ftpPort: 21,
              ftpUsername: '',
              hasFtpPassword: false,
            });
          }
      return { ...current, modbus: { ...current.modbus, devices } };
    });
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      await api<Settings>('/settings/source', {
        method: 'PUT',
        body: JSON.stringify({
          revision: settings.revision,
          source: settings.source,
          gridvis: {
            baseUrl: settings.gridvis.baseUrl,
            username: settings.gridvis.username,
            timeoutMs: settings.gridvis.timeoutMs,
            ...(password ? { password } : {}),
            clearPassword,
          },
          modbus: settings.modbus,
          staleMs: settings.staleMs,
        }),
      });
      onSaved();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        labelledBy="source-settings-title"
        onClose={onClose}
        className="source-settings-shell"
      >
        <section className="modal source-settings-modal">
          <span className="eyebrow">SHARED WORKSPACE</span>
          <h2 id="source-settings-title">Source settings</h2>
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
              <label>
                Data source
                <select
                  value={settings.source}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      source: event.target.value as Settings['source'],
                    })
                  }
                >
                  <option value="modbus">Direct Modbus/TCP</option>
                  <option value="gridvis">GridVis REST API</option>
                </select>
              </label>
              {settings.source === 'gridvis' && (
                <fieldset className="display-settings">
                  <legend>GridVis connection</legend>
                  <div className="source-settings-table-wrap">
                    <table
                      className="source-config-table"
                      aria-label="GridVis REST API settings"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Setting</th>
                          <th scope="col">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">Service URL</th>
                          <td>
                            <input
                              aria-label="Service URL"
                              type="url"
                              required
                              placeholder="https://gridvis.example.internal"
                              value={settings.gridvis.baseUrl}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  gridvis: {
                                    ...settings.gridvis,
                                    baseUrl: event.target.value,
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Username</th>
                          <td>
                            <input
                              aria-label="Username"
                              autoComplete="off"
                              value={settings.gridvis.username}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  gridvis: {
                                    ...settings.gridvis,
                                    username: event.target.value,
                                  },
                                })
                              }
                            />
                            <span className="source-setting-hint">
                              Optional
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Password</th>
                          <td>
                            <input
                              aria-label="Password"
                              type="password"
                              autoComplete="new-password"
                              value={password}
                              onChange={(event) =>
                                setPassword(event.target.value)
                              }
                              disabled={clearPassword}
                            />
                            <span className="source-setting-hint">
                              {settings.gridvis.hasPassword
                                ? 'Leave blank to keep the saved password.'
                                : 'Optional'}
                            </span>
                            {settings.gridvis.hasPassword && (
                              <label className="source-checkbox">
                                <input
                                  type="checkbox"
                                  checked={clearPassword}
                                  onChange={(event) =>
                                    setClearPassword(event.target.checked)
                                  }
                                />
                                Clear saved password
                              </label>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Request timeout (ms)</th>
                          <td>
                            <input
                              aria-label="Request timeout (ms)"
                              type="number"
                              min="100"
                              max="60000"
                              value={settings.gridvis.timeoutMs}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  gridvis: {
                                    ...settings.gridvis,
                                    timeoutMs: Number(event.target.value),
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Reading age threshold (ms)</th>
                          <td>
                            <input
                              aria-label="Reading age threshold (ms)"
                              type="number"
                              min="1000"
                              max="3600000"
                              value={settings.staleMs}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  staleMs: Number(event.target.value),
                                })
                              }
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              )}
              {settings.source === 'modbus' && (
                <>
                  <fieldset className="display-settings">
                    <legend>Modbus devices</legend>
                    <div className="source-device-actions">
                      <button type="button" onClick={() => setModelsOpen(true)}>
                        Manage device models
                      </button>
                      <button type="button" onClick={addDashboardDevices}>
                        Add devices from dashboards
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            modbus: {
                              ...settings.modbus,
                              devices: [
                                ...settings.modbus.devices,
                                {
                                  project: '',
                                  id: '',
                                  name: '',
                                  model: defaultModbusModel,
                                  host: '',
                                  port: 502,
                                  ftpPort: 21,
                                  ftpUsername: '',
                                  hasFtpPassword: false,
                                },
                              ],
                            },
                          })
                        }
                      >
                        Add device
                      </button>
                    </div>
                    <div className="source-settings-table-wrap">
                      <table
                        className="source-device-table"
                        aria-label="Modbus devices"
                      >
                        <thead>
                          <tr>
                            <th scope="col">Model</th>
                            <th scope="col">Dashboard project</th>
                            <th scope="col">Device ID</th>
                            <th scope="col">Display name</th>
                            <th scope="col">Device IP / hostname</th>
                            <th scope="col">Port</th>
                            <th scope="col" aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {settings.modbus.devices.length === 0 && (
                            <tr>
                              <td className="source-device-empty" colSpan={7}>
                                No Modbus devices added yet.
                              </td>
                            </tr>
                          )}
                          {settings.modbus.devices.map((device, index) => (
                            <tr key={index}>
                              <td>
                                <select
                                  aria-label={`Model for device ${index + 1}`}
                                  value={device.model}
                                  onChange={(event) =>
                                    setDevice(index, {
                                      model: event.target
                                        .value as DeviceRow['model'],
                                    })
                                  }
                                >
                                  {settings.modbus.models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  aria-label={`Dashboard project for device ${index + 1}`}
                                  required
                                  value={device.project}
                                  onChange={(event) =>
                                    setDevice(index, {
                                      project: event.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Dashboard device ID for device ${index + 1}`}
                                  required
                                  inputMode="numeric"
                                  value={device.id}
                                  onChange={(event) =>
                                    setDevice(index, {
                                      id: event.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Display name for device ${index + 1}`}
                                  required
                                  value={device.name}
                                  onChange={(event) =>
                                    setDevice(index, {
                                      name: event.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <div className="source-device-address">
                                  <input
                                    aria-label={`Device IP address or hostname for device ${index + 1}`}
                                    required
                                    value={device.host}
                                    onChange={(event) =>
                                      setDevice(index, {
                                        host: event.target.value,
                                      })
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="source-device-web-button"
                                    aria-label={`Open web interface for device ${index + 1}`}
                                    title="Open web interface in a new tab"
                                    disabled={
                                      !deviceWebInterfaceUrl(device.host)
                                    }
                                    onClick={() => {
                                      const url = deviceWebInterfaceUrl(
                                        device.host,
                                      );
                                      if (url)
                                        window.open(
                                          url,
                                          '_blank',
                                          'noopener,noreferrer',
                                        );
                                    }}
                                  >
                                    <span aria-hidden="true">↗</span>
                                  </button>
                                </div>
                              </td>
                              <td>
                                <input
                                  aria-label={`Modbus/TCP port for device ${index + 1}`}
                                  type="number"
                                  required
                                  min="1"
                                  max="65535"
                                  value={device.port}
                                  onChange={(event) =>
                                    setDevice(index, {
                                      port: Number(event.target.value),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="source-device-remove-button"
                                  aria-label={`Remove device ${index + 1}`}
                                  title="Remove device"
                                  onClick={() =>
                                    setSettings({
                                      ...settings,
                                      modbus: {
                                        ...settings.modbus,
                                        devices: settings.modbus.devices.filter(
                                          (_, i) => i !== index,
                                        ),
                                      },
                                    })
                                  }
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    width="18"
                                    height="18"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M4 7h16M10 7V4h4v3m4 0-1 13H7L6 7m4 4v5m4-5v5" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {settings.modbus.devices.length > 0 && (
                      <section
                        className="source-device-ftp-section"
                        aria-labelledby="source-device-ftp-title"
                      >
                        <h3 id="source-device-ftp-title">FTP Settings</h3>
                        <div className="source-settings-table-wrap">
                          <table
                            className="source-device-ftp-table"
                            aria-label="Device FTP settings"
                          >
                            <thead>
                              <tr>
                                <th scope="col">Device</th>
                                <th scope="col">FTP user</th>
                                <th scope="col">FTP password</th>
                                <th scope="col">FTP port</th>
                              </tr>
                            </thead>
                            <tbody>
                              {settings.modbus.devices.map((device, index) => (
                                <tr
                                  className="source-device-ftp-row"
                                  key={index}
                                >
                                  <th scope="row">
                                    {device.name || `Device ${index + 1}`}
                                    <small>{device.host}</small>
                                  </th>
                                  <td>
                                    <div className="source-device-ftp-user">
                                      <button
                                        type="button"
                                        className="source-device-ftp-apply"
                                        disabled={
                                          settings.modbus.devices.length < 2 ||
                                          !device.ftpUsername ||
                                          !device.ftpPassword ||
                                          Boolean(device.clearFtpPassword)
                                        }
                                        title="Enter an FTP user and password to copy them to all devices. FTP ports stay unchanged."
                                        onClick={() =>
                                          applyFtpCredentialsToAll(index)
                                        }
                                      >
                                        Apply to all
                                      </button>
                                      <input
                                        aria-label="FTP user"
                                        value={device.ftpUsername ?? ''}
                                        autoComplete="off"
                                        onChange={(event) =>
                                          setDevice(index, {
                                            ftpUsername: event.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                  </td>
                                  <td>
                                    <div className="source-device-ftp-password">
                                      <input
                                        aria-label="FTP password"
                                        type="password"
                                        value={device.ftpPassword ?? ''}
                                        placeholder={
                                          device.clearFtpPassword
                                            ? 'Will be removed'
                                            : device.hasFtpPassword
                                              ? 'Saved password'
                                              : ''
                                        }
                                        autoComplete="new-password"
                                        onChange={(event) =>
                                          setDevice(index, {
                                            ftpPassword: event.target.value,
                                            clearFtpPassword: false,
                                          })
                                        }
                                      />
                                      {device.hasFtpPassword && (
                                        <button
                                          type="button"
                                          className="source-device-ftp-clear"
                                          aria-label={
                                            device.clearFtpPassword
                                              ? 'FTP login cleared'
                                              : 'Clear saved FTP login'
                                          }
                                          title="Remove the saved FTP user and password when settings are saved."
                                          disabled={Boolean(
                                            device.clearFtpPassword,
                                          )}
                                          onClick={() =>
                                            setDevice(index, {
                                              ftpUsername: '',
                                              ftpPassword: '',
                                              clearFtpPassword: true,
                                            })
                                          }
                                        >
                                          {device.clearFtpPassword
                                            ? 'Cleared'
                                            : 'Clear'}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <input
                                      aria-label="FTP port"
                                      type="number"
                                      min="1"
                                      max="65535"
                                      required
                                      value={device.ftpPort ?? 21}
                                      onChange={(event) =>
                                        setDevice(index, {
                                          ftpPort: Number(event.target.value),
                                        })
                                      }
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                    <label>
                      Request timeout (ms)
                      <input
                        type="number"
                        min="100"
                        max="60000"
                        value={settings.modbus.timeoutMs}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            modbus: {
                              ...settings.modbus,
                              timeoutMs: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </fieldset>
                </>
              )}
              <footer className="modal-actions">
                <button type="button" disabled={saving} onClick={onClose}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save settings'}
                </button>
              </footer>
            </form>
          )}
        </section>
      </Modal>
      {settings && modelsOpen && (
        <ModbusModelsDialog
          models={settings.modbus.models}
          usedModelIds={settings.modbus.devices.map((device) => device.model)}
          onClose={() => setModelsOpen(false)}
          onApply={(models) => {
            setSettings(
              (current) =>
                current && {
                  ...current,
                  modbus: { ...current.modbus, models },
                },
            );
            setModelsOpen(false);
          }}
        />
      )}
    </>
  );
}
