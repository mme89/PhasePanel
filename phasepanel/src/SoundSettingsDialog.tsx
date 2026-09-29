import { Modal } from './Modal';
import { alarmTones, type AlarmTone } from './useAlarmSound';

export function SoundSettingsDialog({
  tone,
  volume,
  error,
  onToneChange,
  onVolumeChange,
  onPreview,
  onClose,
}: {
  tone: AlarmTone;
  volume: number;
  error: string;
  onToneChange: (tone: AlarmTone) => void;
  onVolumeChange: (volume: number) => void;
  onPreview: () => void;
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="sound-settings-title" onClose={onClose}>
      <section className="modal compact sound-settings-modal">
        <div className="modal-heading">
          <h2 id="sound-settings-title">Alarm sound</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          Sound
          <select
            value={tone}
            onChange={(event) => onToneChange(event.target.value as AlarmTone)}
          >
            {alarmTones.map((option) => (
              <option key={option} value={option}>
                {option[0].toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Volume: {volume}%
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <footer className="modal-actions">
          <button type="button" onClick={onPreview}>
            Preview sound
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </Modal>
  );
}
