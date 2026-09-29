import type { DeviceRecordingProfile } from './deviceHistory.js';

export function recordingFieldLabel(name: string) {
  if (name === '_FREQ') return 'Frequency';
  if (name === '_SYM') return 'Voltage symmetry';
  const match = /^_(ULN|ULL|ILN|PLN|SLN|WH|QH|WH_V)\[(\d+)\]$/.exec(name);
  if (!match) return name.replace(/^_/, '').replaceAll('_', ' ');
  const index = Number(match[2]);
  const phase = `L${index + 1}`;
  switch (match[1]) {
    case 'ULN':
      return `Voltage ${phase}–N`;
    case 'ULL':
      return `Line voltage ${index + 1}`;
    case 'ILN':
      return `Current ${phase}`;
    case 'PLN':
      return `Active power ${phase}`;
    case 'SLN':
      return `Apparent power ${phase}`;
    case 'WH':
      return `Active energy · channel ${index}`;
    case 'QH':
      return `Reactive energy · channel ${index}`;
    default:
      return `Active energy (${name})`;
  }
}

export function recordingTitle(
  profile: Pick<DeviceRecordingProfile, 'fields'>,
) {
  const names = profile.fields.map((field) => field.name);
  if (names.length === 1 && names[0] === '_FREQ') return 'Frequency';
  if (names.some((name) => /^_(WH|QH)/.test(name))) return 'Energy counters';
  if (names.some((name) => /^_(ULN|ULL|ILN|PLN|SLN)\[/.test(name)))
    return 'Electrical measurements';
  if (names.length === 1) return recordingFieldLabel(names[0]);
  return 'Recorded measurements';
}
