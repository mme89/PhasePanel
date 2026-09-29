import type {
  DisplayDefaults,
  Widget,
  MeasurementDefaults,
} from '../shared/model';
import { measurementKey } from '../shared/range';
import { displayDefaultsSchema } from '../shared/model';

function MeasurementSettingsEditor({
  title,
  value,
  widgets,
  onChange,
}: {
  title: string;
  value?: DisplayDefaults;
  widgets: Widget[];
  onChange: (value?: DisplayDefaults) => void;
}) {
  const example = widgets.find((w) => w.display === 'gauge') ?? widgets[0];
  const valid = !value || displayDefaultsSchema.safeParse(value).success;
  function bounds(kind: 'scale' | 'limits') {
    const pair = value?.[kind];
    if (!value || !pair) return null;
    return (
      <div className="form-row">
        {(['min', 'max'] as const).map((key) => (
          <label key={key}>
            {kind === 'scale'
              ? `Dashboard scale ${key === 'min' ? 'minimum' : 'maximum'}`
              : `Dashboard alarm ${key === 'min' ? 'lower' : 'upper'} limit`}
            <input
              type="number"
              step="any"
              required
              value={Number.isFinite(pair[key]) ? pair[key] : ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  [kind]: {
                    ...pair,
                    [key]: e.target.value === '' ? NaN : Number(e.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </div>
    );
  }
  return (
    <details
      className="display-settings dashboard-defaults measurement-settings-disclosure"
      aria-label={title}
    >
      <summary>{title}</summary>
      <label className="checkbox-label measurement-enable">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    scale:
                      example?.scale ??
                      (example?.range
                        ? { min: example.range.min, max: example.range.max }
                        : { min: 0, max: 100 }),
                    ...(example?.range
                      ? {
                          limits: {
                            min: example.range.min,
                            max: example.range.max,
                          },
                        }
                      : {}),
                  }
                : undefined,
            )
          }
        />
        Use shared scale, alarm and decimal settings
      </label>
      <p className="muted">
        Applies to every phase and device with this measurement and unit. A tile
        can opt out in its own settings.
      </p>
      {value && (
        <div className="measurement-default-fields">
          <div className="measurement-default-group">
            <h4>Value display</h4>
            <label>
              Shared decimal places
              <select
                value={value.decimals ?? ''}
                onChange={(e) =>
                  onChange({
                    ...value,
                    decimals:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              >
                <option value="">Use individual tile settings</option>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={value.normalColor !== undefined}
                onChange={(e) =>
                  onChange({
                    ...value,
                    normalColor: e.target.checked
                      ? (example?.normalColor ??
                        example?.range?.color ??
                        '#32a852')
                      : undefined,
                  })
                }
              />
              Use shared normal color
            </label>
            {value.normalColor !== undefined && (
              <label>
                Shared normal color
                <input
                  type="color"
                  value={value.normalColor}
                  onChange={(e) =>
                    onChange({ ...value, normalColor: e.target.value })
                  }
                />
              </label>
            )}
          </div>
          <div className="measurement-default-group">
            <h4>Gauge scale</h4>
            {bounds('scale')}
            <p className="muted">
              Sets the gauge endpoints. It does not trigger an alarm.
            </p>
          </div>
          <div className="measurement-default-group">
            <h4>Alarms</h4>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(value.limits)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    limits: e.target.checked ? { ...value.scale } : undefined,
                  })
                }
              />
              Enable dashboard alarm limits
            </label>
            {bounds('limits')}
            <p className="muted">
              Values outside these limits turn red. Disabled shared alarms leave
              inheriting tiles without alarms.
            </p>
          </div>
          {!valid && (
            <p className="field-error" role="alert">
              Enter finite numbers with each minimum / lower limit below its
              maximum / upper limit.
            </p>
          )}
        </div>
      )}
    </details>
  );
}

export function DashboardDefaultsEditor({
  value,
  widgets,
  onChange,
}: {
  value: MeasurementDefaults[];
  widgets: Widget[];
  onChange: (value: MeasurementDefaults[]) => void;
}) {
  const types = new Map<
    string,
    { measurement: string; unit: string; label: string }
  >();
  for (const w of widgets)
    types.set(measurementKey(w.binding.measurement, w.unit), {
      measurement: w.binding.measurement,
      unit: w.unit,
      label: w.measurementLabel || w.binding.measurement,
    });
  for (const d of value) {
    const key = measurementKey(d.measurement, d.unit);
    if (!types.has(key)) types.set(key, { ...d, label: d.measurement });
  }
  return (
    <section aria-label="Shared value settings">
      {types.size === 0 && (
        <p className="muted">
          Add a value to configure shared settings for its measurement.
        </p>
      )}
      {[...types].map(([key, type]) => (
        <MeasurementSettingsEditor
          key={key}
          title={`${type.label} · ${type.unit || 'no unit'}${type.label !== type.measurement ? ` (${type.measurement})` : ''}`}
          value={
            value.find((d) => measurementKey(d.measurement, d.unit) === key)
              ?.settings
          }
          widgets={widgets.filter(
            (w) => measurementKey(w.binding.measurement, w.unit) === key,
          )}
          onChange={(settings) =>
            onChange([
              ...value.filter(
                (d) => measurementKey(d.measurement, d.unit) !== key,
              ),
              ...(settings
                ? [
                    {
                      measurement: type.measurement,
                      unit: type.unit,
                      settings,
                    },
                  ]
                : []),
            ])
          }
        />
      ))}
    </section>
  );
}
