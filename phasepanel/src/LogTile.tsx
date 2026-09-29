import { newId } from '../shared/id.js';
import { useState } from 'react';
import {
  logTileSchema,
  type LogTile,
  type DashboardGroup,
} from '../shared/model';
import type { LogEntry } from '../shared/dashboardLog';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';

export function LogTileEditor({
  initial,
  groups,
  onSave,
  onClose,
}: {
  initial?: LogTile;
  groups: DashboardGroup[];
  onSave: (tile: LogTile) => void;
  onClose: () => void;
}) {
  const [id] = useState(initial?.id ?? newId());
  const [label, setLabel] = useState(initial?.label ?? 'Dashboard log');
  const [fontSize, setFontSize] = useState(String(initial?.fontSize ?? 13));
  const [maxEntries, setMaxEntries] = useState(
    String(initial?.maxEntries ?? 100),
  );
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const parsed = logTileSchema.safeParse({
    ...initial,
    id,
    kind: 'log',
    label,
    fontSize: Number(fontSize),
    maxEntries: Number(maxEntries),
    groupId: groupId || undefined,
    backgroundColor,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 6,
    h: initial?.h ?? 4,
  });
  return (
    <Modal onClose={onClose} labelledBy="log-tile-title">
      <section className="modal">
        <h2 id="log-tile-title">
          {initial ? 'Edit log window' : 'Add log window'}
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed.success) onSave(parsed.data);
          }}
        >
          <TileBackgroundColor
            value={backgroundColor}
            onChange={setBackgroundColor}
          />
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Headline size (px)
            <input
              type="number"
              required
              min={10}
              max={96}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
            />
          </label>
          <p className="muted">
            Base size at Full HD (1920 px wide). Higher-resolution dashboards
            scale the headline automatically.
          </p>
          <label>
            Maximum entries
            <input
              type="number"
              required
              min={10}
              max={500}
              step={1}
              value={maxEntries}
              onChange={(e) => setMaxEntries(e.target.value)}
            />
          </label>
          <label>
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Logs when a device has no fresh configured readings and when fresh
            readings return. Repeated states are not logged. Newest entries
            first; history resets on reload, dashboard switching, or saving.
          </p>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!parsed.success}
            >
              {initial ? 'Apply log changes' : 'Add log window'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}

export function LogTileView({
  widget,
  events,
  editing,
  onEdit,
  onRemove,
}: {
  widget: LogTile;
  events: LogEntry[];
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className={`metric-tile log-tile ${widget.w < 3 || widget.h < 3 ? 'compact-tile' : ''}`}
      style={{ backgroundColor: widget.backgroundColor }}
    >
      <h2
        className={editing ? 'drag-handle' : undefined}
        style={{
          fontSize: `calc(${widget.fontSize ?? 13}px * var(--canvas-text-scale, 1))`,
          flexShrink: 0,
        }}
      >
        {widget.label}
      </h2>
      <div
        className="log-tile-body"
        role="region"
        aria-label={`${widget.label} entries`}
        tabIndex={0}
      >
        {events.length ? (
          <ol>
            {events
              .slice(-widget.maxEntries)
              .reverse()
              .map((entry) => (
                <li key={entry.id} className={`log-level-${entry.level}`}>
                  <time dateTime={entry.time}>
                    {new Date(entry.time).toLocaleString()}
                  </time>
                  <strong>{entry.level}</strong>
                  <span>{entry.message}</span>
                </li>
              ))}
          </ol>
        ) : (
          <p className="muted">No events yet.</p>
        )}
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
