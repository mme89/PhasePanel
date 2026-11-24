import { useCallback, useEffect, useRef, useState } from 'react';

export const alarmTones = [
  'chime',
  'pulse',
  'siren',
  'triple',
  'klaxon',
  'bell',
  'radar',
] as const;
export type AlarmTone = (typeof alarmTones)[number];

export const alarmToneLabels: Record<AlarmTone, string> = {
  chime: 'Chime',
  pulse: 'Pulse',
  siren: 'Siren',
  triple: 'Triple beep',
  klaxon: 'Klaxon',
  bell: 'Bell',
  radar: 'Radar',
};

const storageKey = 'phasepanel.alarm-audio';

function savedAudioSettings(): { tone: AlarmTone; volume: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as {
      tone?: unknown;
      volume?: unknown;
    } | null;
    return {
      tone: alarmTones.find((tone) => tone === saved?.tone) ?? 'chime',
      volume:
        typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
          ? Math.max(0, Math.min(100, saved.volume))
          : 100,
    };
  } catch {
    return { tone: 'chime', volume: 100 };
  }
}

function playTone(context: AudioContext, tone: AlarmTone, volume: number) {
  if (!Number.isFinite(volume) || volume <= 0) return;
  const clamped = Math.min(100, volume);
  const start = context.currentTime;
  // Use a strong full-scale level through a limiter so 100% is genuinely loud
  // in a control room without harsh digital clipping.
  const peak = Math.pow(clamped / 100, 1.25) * 0.85;
  const master = context.createGain();
  master.gain.setValueAtTime(1, start);
  const limiter =
    typeof context.createDynamicsCompressor === 'function'
      ? context.createDynamicsCompressor()
      : null;
  if (limiter) {
    limiter.threshold.setValueAtTime(-3, start);
    limiter.knee.setValueAtTime(6, start);
    limiter.ratio.setValueAtTime(12, start);
    limiter.attack.setValueAtTime(0.002, start);
    limiter.release.setValueAtTime(0.08, start);
    master.connect(limiter).connect(context.destination);
  } else {
    master.connect(context.destination);
  }

  function note(
    type: OscillatorType,
    offset: number,
    duration: number,
    frequencies: [number, number][],
    options?: { ramp?: boolean; level?: number; sustainRatio?: number },
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + offset;
    const attack = Math.min(0.015, duration * 0.15);
    const sustainEnd =
      at + Math.max(attack, duration * (options?.sustainRatio ?? 0.65));
    const waveScale = type === 'square' || type === 'sawtooth' ? 0.72 : 1;
    const targetGain = Math.max(
      0.0002,
      peak * waveScale * (options?.level ?? 1),
    );
    oscillator.type = type;
    for (const [time, frequency] of frequencies) {
      if (options?.ramp && time > 0)
        oscillator.frequency.linearRampToValueAtTime(frequency, at + time);
      else oscillator.frequency.setValueAtTime(frequency, at + time);
    }
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(targetGain, at + attack);
    gain.gain.setValueAtTime(targetGain, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(master);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  if (tone === 'pulse') {
    note('square', 0, 0.16, [[0, 780]], { sustainRatio: 0.75 });
    note('square', 0.24, 0.16, [[0, 780]], { sustainRatio: 0.75 });
  } else if (tone === 'siren') {
    note(
      'sawtooth',
      0,
      0.85,
      [
        [0, 520],
        [0.28, 960],
        [0.56, 520],
        [0.84, 960],
      ],
      { ramp: true, sustainRatio: 0.85 },
    );
  } else if (tone === 'triple') {
    note('square', 0, 0.11, [[0, 1040]], { sustainRatio: 0.75 });
    note('square', 0.16, 0.11, [[0, 1040]], { sustainRatio: 0.75 });
    note('square', 0.32, 0.14, [[0, 1240]], { sustainRatio: 0.78 });
  } else if (tone === 'klaxon') {
    for (const offset of [0, 0.34]) {
      note('sawtooth', offset, 0.26, [[0, 320]], {
        level: 0.9,
        sustainRatio: 0.8,
      });
      note('sawtooth', offset, 0.26, [[0, 405]], {
        level: 0.7,
        sustainRatio: 0.8,
      });
    }
  } else if (tone === 'bell') {
    note('sine', 0, 0.75, [[0, 1180]], { level: 1, sustainRatio: 0.25 });
    note('triangle', 0, 0.55, [[0, 2360]], { level: 0.5, sustainRatio: 0.15 });
    note('sine', 0, 0.35, [[0, 3540]], { level: 0.3, sustainRatio: 0.1 });
  } else if (tone === 'radar') {
    note('triangle', 0, 0.14, [[0, 660]], { sustainRatio: 0.7 });
    note('triangle', 0.18, 0.14, [[0, 880]], { sustainRatio: 0.7 });
    note('triangle', 0.36, 0.26, [[0, 1320]], { sustainRatio: 0.75 });
  } else {
    note(
      'triangle',
      0,
      0.48,
      [
        [0, 880],
        [0.2, 660],
      ],
      { sustainRatio: 0.65 },
    );
  }
}

export function useAlarmSound() {
  const [settings, setSettings] = useState(savedAudioSettings);
  const [enabled, setEnabled] = useState(false);
  const [audioError, setAudioError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const toggling = useRef(false);
  const play = useCallback(() => {
    if (enabled && context.current?.state === 'running')
      playTone(context.current, settings.tone, settings.volume);
  }, [enabled, settings]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      // Audio controls still work if browser storage is unavailable.
    }
  }, [settings]);

  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );

  async function ensureRunningContext(): Promise<AudioContext> {
    const created = !context.current;
    context.current ??= new AudioContext();
    try {
      await context.current.resume();
      if (context.current.state !== 'running')
        throw new Error('Audio is blocked by this browser.');
      return context.current;
    } catch (error) {
      if (created && context.current) {
        void context.current.close().catch(() => {});
        context.current = null;
      }
      throw error;
    }
  }

  async function preview() {
    try {
      const running = await ensureRunningContext();
      playTone(running, settings.tone, settings.volume);
      setAudioError('');
    } catch {
      setAudioError(
        'Sound could not be played. Check this browser’s audio settings.',
      );
    }
  }

  async function toggle() {
    if (toggling.current) return;
    toggling.current = true;
    try {
      if (enabled) {
        setEnabled(false);
        setAudioError('');
        void context.current?.suspend();
        return;
      }
      const running = await ensureRunningContext();
      playTone(running, settings.tone, settings.volume);
      setEnabled(true);
      setAudioError('');
    } catch {
      setAudioError(
        'Sound could not be enabled. Check this browser’s audio settings.',
      );
    } finally {
      toggling.current = false;
    }
  }

  return {
    enabled,
    audioError,
    tone: settings.tone,
    volume: settings.volume,
    setTone: (tone: AlarmTone) =>
      setSettings((current) => ({ ...current, tone })),
    setVolume: (volume: number) =>
      setSettings((current) => ({
        ...current,
        volume: Number.isFinite(volume)
          ? Math.max(0, Math.min(100, volume))
          : current.volume,
      })),
    preview,
    toggle,
    play,
  };
}
