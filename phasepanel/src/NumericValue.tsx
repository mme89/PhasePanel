import { useLayoutEffect, useRef } from 'react';

// Fit the measured text and unit to the available tile body, including long values.
export function NumericValue({
  value,
  unit,
  minimumIntegerDigits = 0,
}: {
  value: string;
  unit: string;
  minimumIntegerDigits?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reference = useRef<HTMLDivElement>(null);
  const sizingValue = minimumIntegerDigits
    ? value.replace(
        /^(-?)([\d,]+)/,
        (_, sign: string, integer: string) =>
          sign +
          integer
            .replaceAll(',', '')
            .padStart(minimumIntegerDigits, '0')
            .replace(/\B(?=(\d{3})+(?!\d))/g, ','),
      )
    : value;
  useLayoutEffect(() => {
    const outer = container.current!;
    const inner = content.current!;
    const fit = () => {
      const scale = Math.max(
        0,
        Math.min(
          outer.clientWidth /
            Math.max(inner.offsetWidth, reference.current?.offsetWidth ?? 0, 1),
          outer.clientHeight / Math.max(inner.offsetHeight, 1),
        ),
      );
      inner.style.setProperty('--value-scale', String(scale));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    fit();
    return () => observer.disconnect();
  }, [value, unit, minimumIntegerDigits]);
  return (
    <div className="measurement" ref={container}>
      <div className="measurement-content" ref={content}>
        <span className="numeric">{value}</span>
        <span className="unit">{unit}</span>
      </div>
      {minimumIntegerDigits > 0 && (
        <div
          className="measurement-content measurement-reference"
          ref={reference}
          aria-hidden="true"
        >
          <span className="numeric-reference">
            {sizingValue === '—'
              ? '0'.repeat(minimumIntegerDigits)
              : sizingValue}
          </span>
          <span className="unit-reference">{unit}</span>
        </div>
      )}
    </div>
  );
}
