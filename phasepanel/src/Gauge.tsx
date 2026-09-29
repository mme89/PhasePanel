import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { ValueRange, GaugeScale } from '../shared/model';
import { evaluateRange } from '../shared/range';
export function Gauge({
  value,
  unit,
  decimals,
  range,
  scale,
  color,
  current,
}: {
  value: number | null | undefined;
  unit: string;
  decimals: number;
  range?: ValueRange;
  scale: GaugeScale;
  color: string;
  current: boolean;
}) {
  const { state, fraction } = evaluateRange(value, range, scale);
  const alarm = current && (state === 'low' || state === 'high');
  const valid = value != null && Number.isFinite(value);
  const format = (v: number) =>
    v.toLocaleString('en-GB', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  const valueText = valid ? format(value) : '—';
  const valueElement = useRef<SVGTextElement>(null);
  useLayoutEffect(() => {
    const text = valueElement.current!;
    text.removeAttribute('textLength');
    if (text.getComputedTextLength() > 175)
      text.setAttribute('textLength', '175');
  }, [valueText, unit]);
  const description = !current
    ? 'No current reading'
    : state === 'low'
      ? 'Below lower limit'
      : state === 'high'
        ? 'Above upper limit'
        : range
          ? 'Within limits'
          : 'Alarm limits disabled';
  return (
    <div
      className={`gauge ${alarm ? 'gauge-alarm' : ''} ${!current ? 'gauge-inactive' : ''}`}
      style={{ '--gauge-color': color } as CSSProperties}
    >
      <svg
        viewBox="0 0 280 166"
        role="img"
        aria-label={`${valid ? format(value) : 'Unavailable'} ${unit}. Scale minimum ${format(scale.min)}, scale maximum ${format(scale.max)}.${range ? ` Lower limit ${format(range.min)}, upper limit ${format(range.max)}.` : ''} ${description}.`}
      >
        <path
          className="gauge-track"
          d="M 25 128 A 115 115 0 0 1 255 128"
          fill="none"
          strokeWidth="28"
        />
        <path
          className="gauge-fill"
          d="M 25 128 A 115 115 0 0 1 255 128"
          fill="none"
          strokeWidth="28"
          pathLength="100"
          strokeDasharray={`${current ? fraction * 100 : 0} 100`}
        />
        <text
          ref={valueElement}
          className="gauge-value"
          x="140"
          y="122"
          textAnchor="middle"
          lengthAdjust="spacingAndGlyphs"
        >
          {valueText}
          <tspan className="gauge-unit"> {unit}</tspan>
        </text>
        <text className="gauge-bound" x="12" y="153" textAnchor="start">
          {format(scale.min)}
        </text>
        <text className="gauge-bound" x="268" y="153" textAnchor="end">
          {format(scale.max)}
        </text>
      </svg>
    </div>
  );
}
