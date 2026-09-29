import { useState } from 'react';
import { bindingKey, type GraphTile, type Reading } from '../shared/model';
import type { GraphHistory } from './graphHistory';
import { GRAPH_COLORS, LineGraph } from './LineGraph';
import { graphPhaseGroup } from './graphPhaseGroup';

export function GraphTileView({
  widget,
  history,
  readings,
  error,
  staleMs,
  now,
  editing,
  onEdit,
  onRemove,
}: {
  widget: GraphTile;
  history: GraphHistory;
  readings: Reading[];
  error: string;
  staleMs: number;
  now: number;
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [controlsTarget, setControlsTarget] = useState<HTMLElement | null>(
    null,
  );
  const seriesLabels = widget.sources.map((source) => {
    const deviceName = source.deviceName.trim() || source.label;
    const sameDevice = widget.sources.filter(
      (other) => (other.deviceName.trim() || other.label) === deviceName,
    );
    if (sameDevice.length === 1) return deviceName;
    const channel = source.binding.channel;
    if (
      sameDevice.filter((other) => other.binding.channel === channel).length ===
      1
    )
      return `${deviceName} · ${channel}`;
    return `${deviceName} · ${source.label}`;
  });
  return (
    <article
      className={`metric-tile graph-tile ${widget.w < 3 || widget.h < 3 ? 'compact-tile' : ''}`}
      style={{ backgroundColor: widget.backgroundColor }}
    >
      <header className="graph-tile-header">
        <h2 className={editing ? 'drag-handle' : undefined}>
          {editing && <span aria-hidden="true">⠿ </span>}
          {widget.label}
        </h2>
        <div ref={setControlsTarget} className="graph-header-controls" />
      </header>
      <div className="tile-value-area">
        <LineGraph
          series={widget.sources.map((source, index) => {
            const key = bindingKey(source.binding);
            const phaseGroup = graphPhaseGroup(source);
            const reading = readings.find((item) => item.key === key);
            const stale =
              reading?.status === 'stale' ||
              (reading?.status === 'ok' &&
                now - Date.parse(reading.sourceTime ?? reading.retrievedAt) >
                  staleMs);
            return {
              key,
              label: seriesLabels[index],
              groupKey: phaseGroup?.key,
              groupLabel: phaseGroup?.label,
              shortLabel: phaseGroup?.phase,
              samples: history[key] ?? [],
              color: GRAPH_COLORS[index % GRAPH_COLORS.length],
              status:
                error || reading?.status === 'error'
                  ? 'Error'
                  : stale
                    ? 'Stale'
                    : reading && reading.status !== 'ok'
                      ? 'No data'
                      : reading
                        ? undefined
                        : 'Waiting',
            };
          })}
          minutes={widget.graphMinutes}
          now={now}
          unit={widget.unit}
          decimals={widget.decimals}
          controlsTarget={controlsTarget}
        />
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
