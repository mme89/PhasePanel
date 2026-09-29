import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';

type CollectorSettingsResponse = {
  revision: number;
  settings: {
    intervalSeconds: number;
    eventIntervalMinutes: number;
    retentionDays: number;
  };
};
type HistoryUsage = { samples: number; allocatedBytes: number };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)) - 1,
    units.length - 1,
  );
  return `${(bytes / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
}

export function CollectorSettingsDialog({
  source,
  onClose,
  onDeleted,
}: {
  source: 'mock' | 'gridvis' | 'modbus' | undefined;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [current, setCurrent] = useState<CollectorSettingsResponse>();
  const [usage, setUsage] = useState<HistoryUsage>();
  const [usageError, setUsageError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBefore, setDeleteBefore] = useState('');
  const today = new Date();
  const latestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    let mounted = true;
    void api<CollectorSettingsResponse>('/settings/collector')
      .then((settings) => {
        if (mounted) setCurrent(settings);
      })
      .catch((failure) => {
        if (mounted) setError(message(failure));
      });
    void api<HistoryUsage>('/history/usage')
      .then((historyUsage) => {
        if (mounted) setUsage(historyUsage);
      })
      .catch((failure) => {
        if (mounted) setUsageError(message(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      await api('/settings/collector', {
        method: 'PUT',
        body: JSON.stringify({
          revision: current.revision,
          ...current.settings,
        }),
      });
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  async function deleteOldData() {
    if (!deleteBefore) return;
    const cutoff = new Date(`${deleteBefore}T00:00:00`);
    if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now()) {
      setError('Choose a date that is not in the future.');
      return;
    }
    if (
      !window.confirm(
        `Delete all stored samples before ${deleteBefore} in your local time zone? This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ deleted: number }>('/history', {
        method: 'DELETE',
        body: JSON.stringify({ before: cutoff.toISOString() }),
      });
      setNotice(
        `${result.deleted} stored sample${result.deleted === 1 ? '' : 's'} deleted.`,
      );
      onDeleted();
      try {
        setUsage(await api<HistoryUsage>('/history/usage'));
        setUsageError('');
      } catch (failure) {
        setUsageError(message(failure));
      }
    } catch (failure) {
      setError(message(failure));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal labelledBy="collector-settings-title" onClose={onClose}>
      <section className="modal collector-settings-modal">
        <header className="collector-settings-header">
          <h2 id="collector-settings-title">Collector settings</h2>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!current ? (
          <p>Loading settings…</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <section
              className="collector-settings-section"
              aria-labelledby="collector-collection-title"
            >
              <h3 id="collector-collection-title">Collection</h3>
              <div className="collector-settings-fields">
                <label>
                  Collect every (seconds)
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    step={1}
                    required
                    value={current.settings.intervalSeconds}
                    onChange={(event) =>
                      setCurrent({
                        ...current,
                        settings: {
                          ...current.settings,
                          intervalSeconds: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                {source === 'modbus' && (
                  <label>
                    Fetch device events every (minutes)
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      required
                      value={current.settings.eventIntervalMinutes}
                      onChange={(event) =>
                        setCurrent({
                          ...current,
                          settings: {
                            ...current.settings,
                            eventIntervalMinutes: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                )}
              </div>
            </section>
            <section
              className="collector-settings-section"
              aria-labelledby="collector-storage-title"
            >
              <h3 id="collector-storage-title">Storage</h3>
              <label className="collector-retention">
                Keep history (days)
                <input
                  type="number"
                  min={1}
                  max={35}
                  step={1}
                  required
                  value={current.settings.retentionDays}
                  onChange={(event) =>
                    setCurrent({
                      ...current,
                      settings: {
                        ...current.settings,
                        retentionDays: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <fieldset className="collector-delete-history">
                <legend>Delete old data</legend>
                <label>
                  Delete samples before
                  <input
                    type="date"
                    max={latestDate}
                    value={deleteBefore}
                    onChange={(event) => setDeleteBefore(event.target.value)}
                  />
                </label>
                <button
                  className="danger"
                  type="button"
                  disabled={!deleteBefore || deleting || saving}
                  onClick={() => void deleteOldData()}
                >
                  {deleting ? 'Deleting…' : 'Delete older data'}
                </button>
              </fieldset>
            </section>
            <section
              className="collector-usage"
              aria-labelledby="collector-usage-title"
            >
              <h3 id="collector-usage-title">Data usage</h3>
              {usageError ? (
                <p role="alert">Data usage unavailable: {usageError}</p>
              ) : usage ? (
                <p>
                  {usage.samples.toLocaleString()} stored sample
                  {usage.samples === 1 ? '' : 's'} ·{' '}
                  {formatBytes(usage.allocatedBytes)} allocated to history
                </p>
              ) : (
                <p>Loading data usage…</p>
              )}
            </section>
            <footer className="modal-actions">
              <button
                type="button"
                disabled={saving || deleting}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={saving || deleting}
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </Modal>
  );
}
