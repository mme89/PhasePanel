import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';

type ServerSettings = {
  mode: 'auto' | 'fixed';
  port: number | null;
  currentMode: 'auto' | 'fixed';
  currentPort: number;
  restartRequired: boolean;
  readOnly: boolean;
};

export function ServerSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ServerSettings>();
  const [mode, setMode] = useState<'auto' | 'fixed'>('auto');
  const [port, setPort] = useState('3000');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void api<ServerSettings>('/settings/server')
      .then((value) => {
        if (!mounted) return;
        setSettings(value);
        setMode(value.mode);
        setPort(String(value.port ?? 3000));
      })
      .catch((failure) => {
        if (mounted) setError(message(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const value = await api<ServerSettings>('/settings/server', {
        method: 'PUT',
        body: JSON.stringify({
          mode,
          port: mode === 'fixed' ? Number(port) : null,
        }),
      });
      setSettings(value);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  const changed =
    settings &&
    (mode !== settings.mode ||
      (mode === 'fixed' && Number(port) !== settings.port));

  return (
    <Modal labelledBy="server-settings-title" onClose={onClose}>
      <section className="modal server-settings-modal">
        <h2 id="server-settings-title">Server address</h2>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!settings ? (
          !error && <p>Loading settings…</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!settings.readOnly) void save();
            }}
          >
            {settings.readOnly && (
              <p className="notice" role="status">
                Docker preview: this is the container port. Set the published
                host port in Docker configuration.
              </p>
            )}
            <div className="server-current-address">
              <span>
                {settings.readOnly ? 'Container port' : 'Current address'}
              </span>
              <code>
                {settings.readOnly
                  ? settings.currentPort
                  : `http://127.0.0.1:${settings.currentPort}/`}
              </code>
            </div>
            <fieldset className="server-port-options">
              <legend>Port on next start</legend>
              <label>
                <input
                  type="radio"
                  name="server-port-mode"
                  value="auto"
                  checked={mode === 'auto'}
                  disabled={settings.readOnly}
                  onChange={() => setMode('auto')}
                />
                Automatic — choose an available port
              </label>
              <label>
                <input
                  type="radio"
                  name="server-port-mode"
                  value="fixed"
                  checked={mode === 'fixed'}
                  disabled={settings.readOnly}
                  onChange={() => setMode('fixed')}
                />
                Fixed port
              </label>
              <input
                type="number"
                aria-label="Fixed port number"
                min={1024}
                max={65535}
                step={1}
                required={mode === 'fixed'}
                disabled={settings.readOnly || mode !== 'fixed'}
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </fieldset>
            {settings.restartRequired && (
              <p className="notice" role="status">
                Restart PhasePanel to apply this port.{' '}
                {settings.mode === 'fixed'
                  ? `The dashboard will open at http://127.0.0.1:${settings.port}/. If that port is already in use, PhasePanel will show a startup error.`
                  : 'The dashboard will choose an available port on each start.'}
              </p>
            )}
            <footer className="modal-actions">
              <button type="button" onClick={onClose} disabled={saving}>
                Close
              </button>
              <button
                className="primary"
                type="submit"
                disabled={saving || settings.readOnly || !changed}
              >
                {saving ? 'Saving…' : 'Save port'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </Modal>
  );
}
