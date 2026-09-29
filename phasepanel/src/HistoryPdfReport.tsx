import { createPortal } from 'react-dom';
import type { GraphSample } from './graphHistory';

type ReportSeries = {
  label: string;
  color: string;
  samples: GraphSample[];
};

export function HistoryPdfReport({
  title,
  series,
  start,
  end,
}: {
  title: string;
  series: ReportSeries[];
  start: number;
  end: number;
}) {
  const all = series.flatMap((item) => item.samples);
  const fresh = all.filter(
    (sample): sample is GraphSample & { value: number } =>
      sample.status === 'ok' && sample.value !== null,
  );
  const { min, max } = fresh.reduce(
    (range, sample) => ({
      min: Math.min(range.min, sample.value),
      max: Math.max(range.max, sample.value),
    }),
    { min: Infinity, max: -Infinity },
  );
  const padding = fresh.length
    ? Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 0.1)
    : 1;
  const low = fresh.length ? Math.floor(min - padding) : 0;
  const high = fresh.length ? Math.ceil(max + padding) : 1;
  const x = (time: number) => 42 + ((time - start) / (end - start)) * 718;
  const y = (value: number) => 230 - ((value - low) / (high - low)) * 212;
  const pathFor = (samples: GraphSample[]) => {
    let path = '';
    let gap = true;
    // Limit PDF size while keeping the first and last sample and every gap.
    const step = Math.max(1, Math.ceil(samples.length / 1200));
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      if (sample.status !== 'ok' || sample.value === null) {
        gap = true;
        continue;
      }
      if (index % step && index !== samples.length - 1 && !gap) continue;
      path += `${gap ? 'M' : 'L'}${x(sample.time).toFixed(1)} ${y(sample.value).toFixed(1)} `;
      gap = false;
    }
    return path;
  };
  const date = (time: number) => new Date(time).toLocaleString();

  return createPortal(
    <article
      className="history-pdf-report"
      aria-hidden="true"
      data-start={start}
      data-end={end}
    >
      <header>
        <p className="history-pdf-kicker">PHASEPANEL / VALUE HISTORY</p>
        <h1>Value history report</h1>
        <p className="history-pdf-title">{title}</p>
        <div className="history-pdf-meta">
          <span>
            Visible chart window: {date(start)} to {date(end)}
          </span>
        </div>
      </header>
      <section className="history-pdf-chart-section">
        <h2>Values over time</h2>
        {fresh.length ? (
          <svg
            viewBox="0 0 800 255"
            width="800"
            height="255"
            role="img"
            aria-label="History chart"
            fontFamily="Arial, sans-serif"
          >
            {[0, 1, 2, 3, 4].map((index) => {
              const value = high - ((high - low) * index) / 4;
              const at = y(value);
              return (
                <g key={index}>
                  <line x1="42" x2="760" y1={at} y2={at} stroke="#dce5dd" />
                  <text
                    x="37"
                    y={at + 3}
                    textAnchor="end"
                    fill="#52665a"
                    fontSize="10"
                  >
                    {value.toLocaleString('en-GB', {
                      maximumFractionDigits: 2,
                    })}
                  </text>
                </g>
              );
            })}
            {series.map((item) => {
              const points = item.samples.filter(
                (sample): sample is GraphSample & { value: number } =>
                  sample.status === 'ok' && sample.value !== null,
              );
              return (
                <g key={item.label}>
                  <path
                    d={pathFor(item.samples)}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="1.7"
                  />
                  {points.length === 1 && (
                    <circle
                      cx={x(points[0].time)}
                      cy={y(points[0].value)}
                      r="3"
                      fill={item.color}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <p>No fresh values in this chart window.</p>
        )}
        <div className="history-pdf-chart-times">
          <span>{date(start)}</span>
          <span>{date(end)}</span>
        </div>
        <div className="history-pdf-legend">
          {series.map((item) => (
            <span key={item.label}>
              <i style={{ background: item.color }} /> {item.label}
            </span>
          ))}
        </div>
      </section>
    </article>,
    document.body,
  );
}
