import { useState } from 'react';
import type { Dashboard, MinimumTileSize } from '../shared/model';

export function TileSizeEditor({
  dashboard,
  disabled,
  onApply,
}: {
  dashboard: Dashboard;
  disabled: boolean;
  onApply: (size: MinimumTileSize) => void;
}) {
  const [width, setWidth] = useState(dashboard.widgets[0]?.w ?? 4);
  const [height, setHeight] = useState(dashboard.widgets[0]?.h ?? 3);
  const [applied, setApplied] = useState('');
  const valid =
    width > 0 &&
    width <= 12 &&
    height > 0 &&
    Number.isFinite(width) &&
    Number.isFinite(height);
  return (
    <fieldset className="display-settings">
      <legend>Resize all tiles once</legend>
      <div className="form-row">
        <label>
          Tile width (columns)
          <input
            type="number"
            max="12"
            step="any"
            value={width}
            onChange={(e) => {
              setWidth(Number(e.target.value));
              setApplied('');
            }}
          />
        </label>
        <label>
          Tile height (rows)
          <input
            type="number"
            step="any"
            value={height}
            onChange={(e) => {
              setHeight(Number(e.target.value));
              setApplied('');
            }}
          />
        </label>
      </div>
      <p className="muted">
        Resizes all current tiles, including grouped and ungrouped values.
        Groups stay intact; tiles move only as needed to fit without overlap.
        This does not change the defaults for future tiles.
      </p>
      <button
        type="button"
        disabled={disabled || !valid || dashboard.widgets.length === 0}
        onClick={() => {
          onApply({ w: width, h: height });
          setApplied(
            `Applied ${width} × ${height} to ${dashboard.widgets.length} tiles. Save dashboard to keep these changes, or Cancel to discard them.`,
          );
        }}
      >
        Apply to all tiles
      </button>
      {applied && (
        <p role="status" className="muted">
          {applied}
        </p>
      )}
    </fieldset>
  );
}
