import { newId } from '../shared/id.js';
import { useState } from 'react';
import type {
  DashboardGroup,
  DashboardTile as Widget,
  MinimumTileSize,
} from '../shared/model';
import { Modal } from './Modal';
import { groupTextColor } from './groupColor';
export function GroupEditor({
  initial,
  widgets,
  onSave,
  onRemove,
  onClose,
}: {
  initial?: DashboardGroup;
  widgets: Widget[];
  onSave: (group: DashboardGroup, tileSize?: MinimumTileSize) => void;
  onRemove: (group: DashboardGroup) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [showTitle, setShowTitle] = useState(initial?.showTitle ?? true);
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const [fontSize, setFontSize] = useState(String(initial?.fontSize ?? 20));
  const validSize =
    fontSize.trim() !== '' &&
    Number.isInteger(Number(fontSize)) &&
    Number(fontSize) >= 10 &&
    Number(fontSize) <= 96;
  const members = initial
    ? widgets.filter((widget) => widget.groupId === initial.id)
    : [];
  const firstTile = members[0];
  const [resizeGroupTiles, setResizeGroupTiles] = useState(false);
  const [tileWidth, setTileWidth] = useState(firstTile?.w ?? 4);
  const [tileHeight, setTileHeight] = useState(firstTile?.h ?? 3);
  return (
    <Modal onClose={onClose} labelledBy="group-dialog-title">
      <section className="modal content-editor-modal group-editor-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">DASHBOARD GROUP</span>
            <h2 id="group-dialog-title">
              {initial ? 'Edit group' : 'Create a group'}
            </h2>
          </div>
          <button aria-label="Close group editor" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              title.trim() &&
              validSize &&
              (!resizeGroupTiles ||
                (tileWidth > 0 && tileWidth <= 12 && tileHeight > 0))
            )
              onSave(
                {
                  ...initial,
                  id: initial?.id ?? newId(),
                  title: title.trim(),
                  fontSize: Number(fontSize),
                  backgroundColor,
                  showTitle,
                },
                resizeGroupTiles && members.length
                  ? { w: tileWidth, h: tileHeight }
                  : undefined,
              );
          }}
        >
          <div className="editor-content">
            <section
              className="editor-section"
              aria-labelledby="group-appearance-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="group-appearance-title">Headline & appearance</h3>
                </div>
              </div>
              <div className="editor-fields">
                <label>
                  Group headline
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={title}
                    placeholder="e.g. Main supply · Voltage"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showTitle}
                    onChange={(e) => setShowTitle(e.target.checked)}
                  />
                  Show group title
                </label>
                <label>
                  Headline size (px)
                  <input
                    type="number"
                    min={10}
                    max={96}
                    step={1}
                    required
                    value={fontSize}
                    onChange={(e) => setFontSize(e.target.value)}
                  />
                </label>
                {!validSize && (
                  <p className="field-error" role="alert">
                    Choose a whole number from 10 to 96 px.
                  </p>
                )}
                <div
                  className="group-text-preview"
                  aria-label="Headline preview"
                  style={{
                    fontSize: showTitle && validSize ? Number(fontSize) : 20,
                    backgroundColor,
                    color: groupTextColor(backgroundColor),
                  }}
                >
                  {showTitle ? title || 'Group headline' : 'Group title hidden'}
                </div>
                <div className="editor-color-control">
                  <label>
                    Background color
                    <input
                      type="color"
                      value={backgroundColor ?? '#f6f8f3'}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!backgroundColor}
                    onClick={() => setBackgroundColor(undefined)}
                  >
                    Reset background
                  </button>
                </div>
              </div>
            </section>
            <section
              className="editor-section"
              aria-labelledby="group-layout-title"
            >
              <div className="editor-section-heading">
                <div>
                  <h3 id="group-layout-title">Tile layout</h3>
                </div>
              </div>
              <fieldset className="display-settings editor-inner-fieldset">
                <legend>Tile size in this group</legend>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={resizeGroupTiles}
                    disabled={members.length === 0}
                    onChange={(e) => setResizeGroupTiles(e.target.checked)}
                  />
                  Set a common tile size
                </label>
                {resizeGroupTiles && members.length > 0 && (
                  <div className="form-row">
                    <label>
                      Tile width (columns)
                      <input
                        type="number"
                        max="12"
                        step="any"
                        value={tileWidth}
                        onChange={(e) => setTileWidth(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Tile height (rows)
                      <input
                        type="number"
                        step="any"
                        value={tileHeight}
                        onChange={(e) => setTileHeight(Number(e.target.value))}
                      />
                    </label>
                  </div>
                )}
              </fieldset>
            </section>
            {initial && (
              <div className="group-removal">
                <p className="muted">
                  Removing the group keeps all its values on the dashboard.
                </p>
                <button type="button" onClick={() => onRemove(initial)}>
                  Remove group
                </button>
              </div>
            )}
          </div>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={
                !title.trim() ||
                !validSize ||
                (resizeGroupTiles &&
                  (!tileWidth || tileWidth > 12 || !tileHeight))
              }
            >
              {initial ? 'Apply group changes' : 'Create group'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
