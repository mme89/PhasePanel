import { newId } from '../shared/id.js';
import { useState } from 'react';
import {
  dateTimeTileSchema,
  type DateTimeTile,
  type DashboardGroup,
} from '../shared/model';
import { Modal } from './Modal';
import { TileBackgroundColor } from './TileBackgroundColor';

const timeZoneOptions = [
  { value: '', label: 'Browser local time' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
];

export function dateTimeContent(tile: DateTimeTile, now: number) {
  const options = { timeZone: tile.timeZone || undefined };
  const date = new Intl.DateTimeFormat('en-GB', {
    ...options,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('en-GB', {
    ...options,
    weekday: 'long',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    ...options,
    hour: '2-digit',
    minute: '2-digit',
    ...(tile.showSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: tile.hour12 ? 'h12' : 'h23',
  }).formatToParts(now);
  const flip = tile.design === 'flip' && tile.mode !== 'date';
  const timeText = time.map((part) => part.value).join('');
  const timeGroups = [
    time.find((part) => part.type === 'hour')?.value ?? '',
    time.find((part) => part.type === 'minute')?.value ?? '',
    ...(tile.showSeconds
      ? [time.find((part) => part.type === 'second')?.value ?? '']
      : []),
  ];
  const period = time.find((part) => part.type === 'dayPeriod')?.value;
  return (
    <div
      className={`clock-face clock-face--${tile.mode} ${flip ? 'clock-face--flip' : ''} ${tile.showSeconds ? '' : 'clock-face--no-seconds'}`}
    >
      {tile.mode !== 'date' &&
        (flip ? (
          <time
            className="clock-time clock-flip-time"
            dateTime={new Date(now).toISOString()}
            aria-label={timeText}
          >
            {timeGroups.map((group, groupIndex) => (
              <span className="flip-group" key={groupIndex} aria-hidden="true">
                {groupIndex > 0 && <span className="flip-separator">:</span>}
                {[...group].map((digit, digitIndex) => (
                  <span
                    className="flip-digit"
                    key={`${groupIndex}-${digitIndex}-${digit}`}
                    data-digit={digit}
                  >
                    <span className="flip-half flip-half--top">
                      <span>{digit}</span>
                    </span>
                    <span className="flip-half flip-half--bottom">
                      <span>{digit}</span>
                    </span>
                  </span>
                ))}
              </span>
            ))}
            {period && (
              <span className="clock-period" aria-hidden="true">
                {period}
              </span>
            )}
          </time>
        ) : (
          <time className="clock-time" dateTime={new Date(now).toISOString()}>
            {time.map((part, index) => (
              <span
                key={index}
                className={
                  part.type === 'second' ||
                  (part.type === 'literal' &&
                    time[index + 1]?.type === 'second')
                    ? 'clock-seconds'
                    : part.type === 'dayPeriod'
                      ? 'clock-period'
                      : undefined
                }
              >
                {part.value}
              </span>
            ))}
          </time>
        ))}
      <div className="clock-details">
        {tile.mode !== 'time' && (
          <>
            <div className="clock-weekday">{weekday}</div>
            <div className="clock-date">{date}</div>
          </>
        )}
        <div
          className="clock-zone"
          title={tile.timeZone || 'Browser local time'}
        >
          {tile.timeZone || 'Local time'}
        </div>
      </div>
    </div>
  );
}

export function DateTimeTileEditor({
  initial,
  groups,
  onSave,
  onClose,
}: {
  initial?: DateTimeTile;
  groups: DashboardGroup[];
  onSave: (tile: DateTimeTile) => void;
  onClose: () => void;
}) {
  const [id] = useState(initial?.id ?? newId());
  const [label, setLabel] = useState(initial?.label ?? 'Date & time');
  const [mode, setMode] = useState(initial?.mode ?? 'datetime');
  const [design, setDesign] = useState(initial?.design ?? 'classic');
  const [fontSize, setFontSize] = useState(String(initial?.fontSize ?? 32));
  const [hour12, setHour12] = useState(initial?.hour12 ?? false);
  const [showSeconds, setShowSeconds] = useState(initial?.showSeconds ?? true);
  const initialTimeZone = initial?.timeZone ?? '';
  const [timeZoneChoice, setTimeZoneChoice] = useState(
    timeZoneOptions.some((option) => option.value === initialTimeZone)
      ? initialTimeZone
      : 'custom',
  );
  const [customTimeZone, setCustomTimeZone] = useState(
    initialTimeZone &&
      !timeZoneOptions.some((option) => option.value === initialTimeZone)
      ? initialTimeZone
      : '',
  );
  const timeZone =
    timeZoneChoice === 'custom' ? customTimeZone : timeZoneChoice;
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [backgroundColor, setBackgroundColor] = useState(
    initial?.backgroundColor,
  );
  const parsed = dateTimeTileSchema.safeParse({
    ...initial,
    id,
    kind: 'datetime',
    label,
    mode,
    design,
    fontSize: Number(fontSize),
    hour12,
    showSeconds,
    timeZone: timeZone.trim(),
    groupId: groupId || undefined,
    backgroundColor,
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    w: initial?.w ?? 3,
    h: initial?.h ?? 3,
  });
  return (
    <Modal onClose={onClose} labelledBy="datetime-title">
      <section className="modal">
        <h2 id="datetime-title">
          {initial ? 'Edit date/time tile' : 'Add date/time tile'}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              parsed.success &&
              (timeZoneChoice !== 'custom' || timeZone.trim())
            )
              onSave(parsed.data);
          }}
        >
          <TileBackgroundColor
            value={backgroundColor}
            onChange={setBackgroundColor}
          />
          <label>
            Title
            <input
              autoFocus
              placeholder="Optional — leave blank for date/time only"
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Display
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as DateTimeTile['mode'])}
            >
              <option value="datetime">Date and time</option>
              <option value="date">Date only</option>
              <option value="time">Time only</option>
            </select>
          </label>
          <label>
            Clock design
            <select
              value={design}
              onChange={(e) =>
                setDesign(e.target.value as NonNullable<DateTimeTile['design']>)
              }
            >
              <option value="classic">Classic (current)</option>
              <option value="flip">Flip clock</option>
            </select>
          </label>
          {mode === 'date' && (
            <p className="muted">Clock designs apply when time is shown.</p>
          )}
          <label>
            Text size (px)
            <input
              type="number"
              required
              min={10}
              max={96}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
            />
          </label>
          <label>
            Time zone
            <select
              value={timeZoneChoice}
              onChange={(e) => setTimeZoneChoice(e.target.value)}
            >
              {timeZoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {timeZoneChoice === 'custom' && (
            <label>
              Custom time zone
              <input
                required
                maxLength={100}
                placeholder="e.g. America/Argentina/Buenos_Aires"
                value={customTimeZone}
                onChange={(e) => setCustomTimeZone(e.target.value)}
              />
            </label>
          )}
          {!parsed.success &&
            timeZone.trim() &&
            parsed.error.issues.some((i) => i.path.includes('timeZone')) && (
              <p role="alert" className="field-error">
                Enter a valid time zone, for example Europe/Berlin or UTC.
              </p>
            )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hour12}
              onChange={(e) => setHour12(e.target.checked)}
            />
            Use 12-hour time
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showSeconds}
              onChange={(e) => setShowSeconds(e.target.checked)}
            />
            Show seconds
          </label>
          <label>
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <footer className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                !parsed.success ||
                (timeZoneChoice === 'custom' && !timeZone.trim())
              }
              type="submit"
            >
              {initial ? 'Apply date/time changes' : 'Add date/time tile'}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
