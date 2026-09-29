import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';
import { FolderChooserDialog } from './FolderChooserDialog';

type StorageSettings = {
  directory: string;
  defaultDirectory: string;
  currentDirectory: string;
  restartRequired: boolean;
  readOnly: boolean;
};

export function StorageSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<StorageSettings>();
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void api<StorageSettings>('/settings/storage')
      .then((value) => {
        if (!mounted) return;
        setSettings(value);
        setDirectory(value.directory);
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
      const value = await api<StorageSettings>('/settings/storage', {
        method: 'PUT',
        body: JSON.stringify({ directory }),
      });
      setSettings(value);
      setDirectory(value.directory);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal labelledBy="storage-settings-title" onClose={onClose}>
        <section className="modal storage-settings-modal">
          <h2 id="storage-settings-title">Data location</h2>
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
                void save();
              }}
            >
              {settings.readOnly && (
                <p className="notice" role="status">
                  Docker preview: storage is set by the container volume mounted
                  at this folder.
                </p>
              )}
              <div className="storage-folder-field">
                <span id="storage-folder-label">Data folder</span>
                <button
                  className="storage-path-picker"
                  type="button"
                  aria-labelledby="storage-folder-label"
                  disabled={settings.readOnly || saving}
                  onClick={() => setChooserOpen(true)}
                >
                  <code>{directory}</code>
                  {!settings.readOnly && <span>Browse…</span>}
                </button>
              </div>
              <div className="storage-default-location">
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
                <div className="storage-default-location-text">
                  <span>Default location</span>
                  <code>{settings.defaultDirectory}</code>
                </div>
                {!settings.readOnly && (
                  <button
                    type="button"
                    disabled={saving || directory === settings.defaultDirectory}
                    onClick={() => setDirectory(settings.defaultDirectory)}
                  >
                    Use default
                  </button>
                )}
              </div>
              {settings.restartRequired && (
                <p className="notice" role="status">
                  Restart PhasePanel to use this folder. On first use, no file
                  needs to be moved. If you have dashboards or history to keep,
                  quit PhasePanel and move dashboards.db from{' '}
                  {settings.currentDirectory} to {settings.directory} before
                  reopening.
                </p>
              )}
              <footer className="modal-actions">
                <button type="button" onClick={onClose} disabled={saving}>
                  Close
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    saving ||
                    settings.readOnly ||
                    directory.trim() === settings.directory
                  }
                >
                  {saving ? 'Saving…' : 'Save location'}
                </button>
              </footer>
            </form>
          )}
        </section>
      </Modal>
      {chooserOpen && settings && (
        <FolderChooserDialog
          initialDirectory={directory}
          defaultDirectory={settings.defaultDirectory}
          onChoose={(chosen) => {
            setDirectory(chosen);
            setChooserOpen(false);
          }}
          onClose={() => setChooserOpen(false)}
        />
      )}
    </>
  );
}
