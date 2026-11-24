// Retired tiles are omitted when reading saved configurations or old exports.
// Keep API input validation strict so clients cannot create new retired tiles.
export function omitRetiredTiles(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('widgets' in value))
    return value;
  if (!Array.isArray(value.widgets)) return value;
  const widgets = value.widgets.filter(
    (tile: unknown) =>
      !tile ||
      typeof tile !== 'object' ||
      !('kind' in tile) ||
      !['availability', 'device-status'].includes(String(tile.kind)),
  );
  const keptIds = new Set(
    widgets
      .map((tile: unknown) =>
        tile && typeof tile === 'object' && 'id' in tile ? String(tile.id) : '',
      )
      .filter(Boolean),
  );
  const tileLinks =
    'tileLinks' in value && Array.isArray(value.tileLinks)
      ? value.tileLinks
          .map((link: unknown) =>
            Array.isArray(link)
              ? link.filter((id) => keptIds.has(String(id)))
              : link,
          )
          .filter((link: unknown) => !Array.isArray(link) || link.length >= 2)
      : undefined;
  return {
    ...value,
    widgets,
    ...(tileLinks !== undefined ? { tileLinks } : {}),
  };
}
