import { newId } from '../shared/id.js';
import { useState, type ReactNode, type CSSProperties } from 'react';
import {
  textTileSchema,
  type TextTile,
  type DateTimeTile,
  type DashboardGroup,
} from '../shared/model';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';

export function TextTileEditor({
  initial,
  groups,
  onSave,
  onClose,
}: {
  initial?: TextTile;
  groups: DashboardGroup[];
  onSave: (tile: TextTile) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [text, setText] = useState(initial?.text ?? '');
  const [fontSize, setFontSize] = useState(String(initial?.fontSize ?? 24));
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const candidate = {
    ...initial,
    id: initial?.id ?? newId(),
    kind: 'text',
    label,
    text,
    fontSize: Number(fontSize),
    groupId: groupId || undefined,
    backgroundColor,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 3,
    h: initial?.h ?? 3,
  };
  const parsed = textTileSchema.safeParse(candidate);
  return (
    <Modal onClose={onClose} labelledBy="text-tile-title">
      <section className="modal">
        <h2 id="text-tile-title">
          {initial ? 'Edit text tile' : 'Add text tile'}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success) onSave(parsed.data);
          }}
        >
          <label>
            Title
            <input
              autoFocus
              placeholder="Optional — leave blank for text only"
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Text
            <textarea
              required
              maxLength={5000}
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Text size (px)
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
            Plain text with line breaks. Text size scales with the dashboard
            resolution. No API connection is used.
          </p>
          <TileBackgroundColor
            value={backgroundColor}
            onChange={setBackgroundColor}
          />
          <label>
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!parsed.success}
            >
              {initial ? 'Apply text changes' : 'Add text tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}

export function TextTileView({
  widget,
  content,
  editing,
  onEdit,
  onRemove,
}: {
  widget: TextTile | DateTimeTile;
  content?: ReactNode;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const displayName =
    widget.label ||
    ('text' in widget
      ? `Text tile: ${widget.text.slice(0, 60)}`
      : 'Date/time tile');
  return (
    <article
      className={`metric-tile text-tile ${widget.kind === 'text' ? 'note-tile' : 'datetime-tile'} ${widget.w < 3 || widget.h < 3 ? 'compact-tile' : ''}`}
      style={{ backgroundColor: widget.backgroundColor }}
    >
      {widget.label && (
        <h2 className={editing ? 'drag-handle' : undefined}>{widget.label}</h2>
      )}
      <div
        className={`text-tile-body ${editing && !widget.label ? 'drag-handle' : ''}`}
        title={
          editing && !widget.label ? 'Drag text to move this tile' : undefined
        }
        style={{ '--text-tile-size': `${widget.fontSize}px` } as CSSProperties}
      >
        {content ?? ('text' in widget ? widget.text : '')}
      </div>
      {editing && (
        <div className="tile-controls">
          <button aria-label={`Edit ${displayName}`} onClick={onEdit}>
            Configure
          </button>
          <button aria-label={`Remove ${displayName}`} onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </article>
  );
}
