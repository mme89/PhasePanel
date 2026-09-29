import { useState } from 'react';
import type { Dashboard, DashboardTile } from '../shared/model';
import { Modal } from './Modal';
import {
  alignTiles,
  joinTiles,
  placementError,
  type Alignment,
} from './tilePlacement';
import {
  linkTiles,
  snapLinkedWidgets,
  unlinkTiles,
  validTileLinks,
} from './tileLinks';

export function TilePositionEditor({
  dashboard,
  root,
  width,
  onSave,
  onClose,
}: {
  dashboard: Dashboard;
  root: HTMLElement;
  width: number;
  onSave: (widgets: DashboardTile[], links: string[][]) => void;
  onClose: () => void;
}) {
  const [widgets, setWidgets] = useState(() =>
    snapLinkedWidgets(
      dashboard.widgets,
      dashboard.tileLinks,
      width,
      (dashboard.groupLayoutWidth ?? width) - 40,
    ),
  );
  const [links, setLinks] = useState(() =>
    validTileLinks(dashboard.tileLinks, dashboard.widgets),
  );
  const [section, setSection] = useState(dashboard.widgets[0]?.groupId ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [coordinates, setCoordinates] = useState<{ x: string; y: string }>();
  const [error, setError] = useState('');
  const members = widgets.filter((tile) => (tile.groupId ?? '') === section);
  const first = root.querySelector<HTMLElement>(
    `[data-testid="tile-${members[0]?.id}"]`,
  );
  const grid = first?.closest<HTMLElement>('.react-grid-layout');
  const canvas = root.querySelector<HTMLElement>('.fixed-canvas') ?? root;
  const canvasScale = Number(canvas.dataset.scale ?? 1);
  const gridBox = grid?.getBoundingClientRect();
  const canvasBox = canvas.getBoundingClientRect();
  // Group sections shrink to their visible content, but tile coordinates still
  // use the full grid allocation passed to GridLayout.
  const gridWidth = section
    ? (dashboard.groupLayoutWidth ?? width) - 40
    : width;
  const scaledContent = grid?.closest<HTMLElement>('.scaled-group-content');
  const scale = scaledContent
    ? scaledContent.getBoundingClientRect().width /
      parseFloat(getComputedStyle(scaledContent).width) /
      canvasScale
    : 1;
  const origin = {
    x: gridBox
      ? (gridBox.left - canvasBox.left) / canvasScale + canvas.scrollLeft
      : 0,
    y: gridBox
      ? (gridBox.top - canvasBox.top) / canvasScale + canvas.scrollTop
      : 0,
  };
  const pitchX = ((gridWidth + 20) / 12) * scale;
  const pitchY = 92 * scale;
  const tiles = members.map((tile) => ({
    ...tile,
    x: origin.x + tile.x * pitchX,
    y: origin.y + tile.y * pitchY,
    w: tile.w * pitchX - 20 * scale,
    h: tile.h * pitchY - 20 * scale,
  }));
  const ids = new Set(selected);
  const single =
    selected.length === 1
      ? tiles.find((tile) => tile.id === selected[0])
      : undefined;
  const format = (value: number) => String(Math.round(value * 1000) / 1000);
  const x = coordinates?.x ?? (single ? format(single.x) : '');
  const y = coordinates?.y ?? (single ? format(single.y) : '');
  const bounds = {
    ...origin,
    width:
      section && dashboard.groupLayoutWidth
        ? Math.min(gridWidth * scale, width - origin.x - 20 * scale)
        : gridWidth * scale,
    maxY: origin.y + 10000 * pitchY,
  };
  function withPositions(
    next: typeof tiles,
    changed: Set<string>,
  ): DashboardTile[] {
    return widgets.map((tile) => {
      const placed = changed.has(tile.id)
        ? next.find((item) => item.id === tile.id)
        : undefined;
      return placed
        ? {
            ...tile,
            x: Math.max(
              0,
              Math.min(12 - tile.w, (placed.x - origin.x) / pitchX),
            ),
            y: Math.max(0, Math.min(10000, (placed.y - origin.y) / pitchY)),
          }
        : tile;
    });
  }
  function placedWidgets(alignment?: Alignment): DashboardTile[] | undefined {
    if (!grid || !gridBox) return;
    const linked = single && links.find((link) => link.includes(single.id));
    const changed = linked && !alignment ? new Set(linked) : ids;
    const moved = alignment
      ? alignTiles(tiles, ids, alignment)
      : tiles.map((tile) =>
          ids.has(tile.id)
            ? {
                ...tile,
                x: x === format(tile.x) ? tile.x : x.trim() ? Number(x) : NaN,
                y: y === format(tile.y) ? tile.y : y.trim() ? Number(y) : NaN,
              }
            : tile,
        );
    const dx =
      linked && single
        ? moved.find((tile) => tile.id === single.id)!.x - single.x
        : 0;
    const dy =
      linked && single
        ? moved.find((tile) => tile.id === single.id)!.y - single.y
        : 0;
    const next =
      linked && !alignment
        ? moved.map((tile) =>
            linked.includes(tile.id) && tile.id !== single.id
              ? { ...tile, x: tile.x + dx, y: tile.y + dy }
              : tile,
          )
        : moved;
    const error = placementError(next, changed, bounds);
    if (error) {
      setError(error);
      return;
    }
    return withPositions(next, changed);
  }
  function apply(alignment?: Alignment) {
    const next = placedWidgets(alignment);
    if (!next) return;
    setWidgets(next);
    setCoordinates(undefined);
    setError('');
  }
  function save() {
    const next = single && coordinates ? placedWidgets() : widgets;
    if (next) onSave(next, links);
  }
  function connectSelected() {
    if (!grid || !gridBox) return;
    const joined = joinTiles(tiles, ids, bounds);
    if ('error' in joined) {
      setError(joined.error);
      return;
    }
    setWidgets(withPositions(joined.tiles, ids));
    setLinks(linkTiles(links, joined.order));
    setCoordinates(undefined);
    setError('');
  }
  const sections = [
    ...(dashboard.groups ?? [])
      .filter((group) => widgets.some((tile) => tile.groupId === group.id))
      .map((group) => ({ id: group.id, title: group.title })),
    ...(widgets.some((tile) => !tile.groupId)
      ? [{ id: '', title: 'Ungrouped tiles' }]
      : []),
  ];
  return (
    <Modal onClose={onClose} labelledBy="tile-position-title">
      <section className="modal">
        <h2 id="tile-position-title">Position tiles</h2>
        <label>
          Tile section
          <select
            value={section}
            onChange={(event) => {
              setSection(event.target.value);
              setSelected([]);
              setCoordinates(undefined);
              setError('');
            }}
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="position-tile-list">
          <legend>Select tiles</legend>
          {tiles.map((tile) => (
            <label className="checkbox-label" key={tile.id}>
              <input
                type="checkbox"
                checked={ids.has(tile.id)}
                onChange={(event) => {
                  setSelected(
                    event.target.checked
                      ? [...selected, tile.id]
                      : selected.filter((id) => id !== tile.id),
                  );
                  setCoordinates(undefined);
                  setError('');
                }}
              />
              {tile.label}{' '}
              {links.some((link) => link.includes(tile.id)) && (
                <span className="muted">(linked)</span>
              )}{' '}
              <span className="muted">
                X {format(tile.x)} · Y {format(tile.y)}
              </span>
            </label>
          ))}
        </fieldset>
        {selected.length > 0 && (
          <div
            className="position-alignment"
            role="group"
            aria-label="Link selected tiles"
          >
            <button
              type="button"
              disabled={selected.length < 2}
              onClick={connectSelected}
            >
              Link selected tiles
            </button>
            <button
              type="button"
              disabled={
                !selected.some((id) => links.some((link) => link.includes(id)))
              }
              onClick={() => setLinks(unlinkTiles(links, selected))}
            >
              Unlink selected tiles
            </button>
          </div>
        )}
        {single && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="form-row">
              <label>
                X (canvas px)
                <input
                  type="number"
                  step="any"
                  required
                  value={x}
                  onChange={(event) => {
                    setCoordinates({ x: event.target.value, y });
                    setError('');
                  }}
                />
              </label>
              <label>
                Y (canvas px)
                <input
                  type="number"
                  step="any"
                  required
                  value={y}
                  onChange={(event) => {
                    setCoordinates({ x, y: event.target.value });
                    setError('');
                  }}
                />
              </label>
            </div>
            <button className="primary" type="submit">
              Apply position
            </button>
          </form>
        )}
        {selected.length > 1 &&
          !selected.some((id) => links.some((link) => link.includes(id))) && (
            <div
              className="position-alignment"
              role="group"
              aria-label="Align selected tiles"
            >
              {(
                ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
              ).map((alignment) => (
                <button key={alignment} onClick={() => apply(alignment)}>
                  Align {alignment}
                </button>
              ))}
            </div>
          )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!grid && (
          <p className="field-error" role="alert">
            This tile section is unavailable. Close this dialog and try again.
          </p>
        )}
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
            Save changes
          </button>
        </footer>
      </section>
    </Modal>
  );
}
