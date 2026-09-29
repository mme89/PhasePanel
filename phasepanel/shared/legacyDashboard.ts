// Retired tiles are omitted when reading saved configurations or old exports.
// Keep API input validation strict so clients cannot create new retired tiles.
export function omitRetiredTiles(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('widgets' in value))
    return value;
  if (!Array.isArray(value.widgets)) return value;
  return {
    ...value,
    widgets: value.widgets.filter(
      (tile: unknown) =>
        !tile ||
        typeof tile !== 'object' ||
        !('kind' in tile) ||
        !['availability', 'device-status'].includes(String(tile.kind)),
    ),
  };
}
