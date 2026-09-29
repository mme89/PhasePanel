import type { GraphSample } from './graphHistory';
import type { GaugeScale, ValueRange } from '../shared/model';
import { evaluateRange } from '../shared/range';
import { NumericValue } from './NumericValue';

type ValueProps = {
  value: number | null | undefined;
  unit: string;
  decimals: number;
};

function Value({ value, unit, decimals }: ValueProps) {
  return (
    <NumericValue
      value={
        value != null && Number.isFinite(value)
          ? value.toLocaleString('en-GB', {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })
          : '—'
      }
      unit={unit}
    />
  );
}

export function BarDisplay({
  value,
  unit,
  decimals,
  scale,
  range,
  current,
}: ValueProps & {
  scale: GaugeScale;
  range?: ValueRange;
  current: boolean;
}) {
  const { fraction, state } = evaluateRange(value, range, scale);
  const active = current && value != null && Number.isFinite(value);
  return (
    <div className="bar-display">
      <Value value={value} unit={unit} decimals={decimals} />
      <div
        className="bar-track"
        role="img"
        aria-label={`${active ? `${value} ${unit}` : 'No current reading'}. Scale ${scale.min} to ${scale.max}${range ? `; limits ${range.min} to ${range.max}` : ''}.`}
      >
        {range && (
          <span
            className="bar-normal-band"
            style={{
              left: `${evaluateRange(range.min, undefined, scale).fraction * 100}%`,
              width: `${(evaluateRange(range.max, undefined, scale).fraction - evaluateRange(range.min, undefined, scale).fraction) * 100}%`,
            }}
          />
        )}
        <span
          className={`bar-fill ${active && state !== 'normal' ? 'bar-fill-alarm' : ''}`}
          style={{ width: `${active ? fraction * 100 : 0}%` }}
        />
      </div>
      <div className="bar-bounds">
        <span>{scale.min}</span>
        <span>{scale.max}</span>
      </div>
    </div>
  );
}

export function StatusDisplay({
  value,
  unit,
  decimals,
  range,
  status,
}: ValueProps & { range?: ValueRange; status: string }) {
  const state = evaluateRange(value, range).state;
  const label =
    status === 'error'
      ? 'Error'
      : status === 'stale'
        ? 'Stale reading'
        : status === 'loading'
          ? 'Waiting for reading'
          : status === 'partial'
            ? 'Partial reading'
            : status !== 'ok' || state === 'unknown'
              ? 'No data'
              : !range
                ? 'No limits configured'
                : state === 'low'
                  ? 'Below lower limit'
                  : state === 'high'
                    ? 'Above upper limit'
                    : 'Within limits';
  const light =
    status === 'ok' && range && state === 'normal'
      ? 'green'
      : status === 'ok' && range && (state === 'low' || state === 'high')
        ? 'red'
        : status === 'stale' ||
            status === 'partial' ||
            (status === 'ok' && !range && state !== 'unknown')
          ? 'amber'
          : 'off';
  return (
    <div className="status-display">
      <svg
        className="traffic-light"
        viewBox="0 0 40 94"
        role="img"
        aria-label={`Traffic light: ${label}`}
      >
        <rect x="0.5" y="0.5" width="39" height="93" rx="11" />
        {(['red', 'amber', 'green'] as const).map((color, index) => (
          <circle
            key={color}
            className={`traffic-light-lamp traffic-light-lamp-${color} ${light === color ? 'is-active' : ''}`}
            cx="20"
            cy={17 + index * 30}
            r="11"
            aria-hidden="true"
          />
        ))}
      </svg>
      <div>
        <Value value={value} unit={unit} decimals={decimals} />
        {light !== 'green' && <span className="status-label">{label}</span>}
      </div>
    </div>
  );
}

export function SparklineDisplay({
  value,
  unit,
  decimals,
  samples,
  now,
  current,
}: ValueProps & { samples: GraphSample[]; now: number; current: boolean }) {
  const windowMs = 15 * 60 * 1000;
  const recent = samples.filter(
    (sample) => sample.time >= now - windowMs && sample.time <= now,
  );
  const values = recent
    .map((sample) => sample.value)
    .filter(
      (sample): sample is number => sample != null && Number.isFinite(sample),
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const format = (number: number) =>
    number.toLocaleString('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  const scaleLabel = values.length
    ? `Min ${format(min)} · Max ${format(max)}${unit ? ` ${unit}` : ''}`
    : 'Scale pending';
  const point = (sample: GraphSample) =>
    `${((sample.time - (now - windowMs)) / windowMs) * 100},${max === min ? 16 : 28 - ((sample.value! - min) / spread) * 24}`;
  const segments: string[] = [];
  let segment: GraphSample[] = [];
  for (const sample of recent) {
    if (sample.value != null && Number.isFinite(sample.value))
      segment.push(sample);
    else if (segment.length) {
      segments.push(segment.map(point).join(' '));
      segment = [];
    }
  }
  if (segment.length) segments.push(segment.map(point).join(' '));
  return (
    <div className="sparkline-display">
      <Value value={value} unit={unit} decimals={decimals} />
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Recent 15-minute trend${values.length ? `, ${values.length} samples` : ', no samples yet'}`}
        className={current ? '' : 'sparkline-inactive'}
      >
        {segments.map((points, index) =>
          points.includes(' ') ? (
            <polyline
              key={index}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <circle
              key={index}
              cx={Number(points.split(',')[0])}
              cy={Number(points.split(',')[1])}
              r="1.5"
              fill="currentColor"
            />
          ),
        )}
      </svg>
      <div className="sparkline-caption">
        <span>Last 15 minutes</span>
        <span className="sparkline-scale" title={scaleLabel}>
          {scaleLabel}
        </span>
      </div>
    </div>
  );
}
