import type { TotalSource } from '../shared/model';

export function graphPhaseGroup(source: TotalSource) {
  const { binding } = source;
  if (
    !(
      /^(U_Effective|I_Effective)$/i.test(binding.measurement) ||
      /\b(voltage|current|spannung|strom)\b/i.test(source.label)
    ) ||
    !/^L\d+$/i.test(binding.channel)
  )
    return null;

  const measurementLabel = source.label
    .replace(/\s*·\s*L\d+\b.*$/i, '')
    .replace(/\s+L\d+\b.*$/i, '');
  return {
    key: `${binding.project}\u0000${binding.deviceId}\u0000${binding.measurement}\u0000${source.unit}`,
    label: `${source.deviceName.trim() || binding.deviceId} · ${measurementLabel}`,
    measurementLabel,
    phase: binding.channel,
  };
}
