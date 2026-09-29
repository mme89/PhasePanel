export function TileBackgroundColor({
  value,
  onChange,
}: {
  value?: string;
  onChange: (color?: string) => void;
}) {
  return (
    <div className="editor-color-control">
      <label>
        Tile background color
        <input
          type="color"
          value={value ?? '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!value}
        onClick={() => onChange(undefined)}
      >
        Reset background
      </button>
    </div>
  );
}
