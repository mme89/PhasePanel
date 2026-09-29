import { useState } from 'react';
import type { Dashboard } from '../shared/model';
import { message } from './api';
import { Modal } from './Modal';

export function ExportDashboardsDialog({
  dashboards,
  activeId,
  onClose,
  onExport,
}: {
  dashboards: Dashboard[];
  activeId: string;
  onClose: () => void;
  onExport: (selected: Dashboard[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    dashboards.some((dashboard) => dashboard.id === activeId) ? [activeId] : [],
  );
  const [error, setError] = useState('');
  const selected = dashboards.filter((dashboard) =>
    selectedIds.includes(dashboard.id),
  );

  function exportSelected() {
    try {
      onExport(selected);
      onClose();
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <Modal labelledBy="export-dashboards-title" onClose={onClose}>
      <section className="modal export-dashboards-modal">
        <span className="eyebrow">DASHBOARD TOOLS</span>
        <h2 id="export-dashboards-title">Export dashboards</h2>
        <p className="muted">
          Choose one or more dashboards. Multiple dashboards download as one
          file that can be imported here.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="export-selection-actions">
          <button
            type="button"
            onClick={() =>
              setSelectedIds(dashboards.map((dashboard) => dashboard.id))
            }
          >
            Select all
          </button>
          <button type="button" onClick={() => setSelectedIds([])}>
            Clear selection
          </button>
        </div>
        <div
          className="export-dashboard-list"
          role="group"
          aria-label="Dashboards to export"
        >
          {dashboards.map((dashboard) => (
            <label className="export-dashboard-choice" key={dashboard.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(dashboard.id)}
                onChange={(event) =>
                  setSelectedIds((current) =>
                    event.target.checked
                      ? [...current, dashboard.id]
                      : current.filter((id) => id !== dashboard.id),
                  )
                }
              />
              <span className="export-dashboard-choice-text">
                <span>{dashboard.name}</span>
                <small>
                  Updated {new Date(dashboard.updatedAt).toLocaleString()} · ID{' '}
                  {dashboard.id.slice(0, 8)}
                </small>
              </span>
            </label>
          ))}
        </div>
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            disabled={selected.length === 0}
            onClick={exportSelected}
          >
            {selected.length
              ? `Export ${selected.length} dashboard${selected.length === 1 ? '' : 's'}`
              : 'Export dashboards'}
          </button>
        </footer>
      </section>
    </Modal>
  );
}
