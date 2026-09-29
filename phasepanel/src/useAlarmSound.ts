import { useCallback, useEffect, useRef, useState } from 'react';

export const alarmTones = ['chime', 'pulse', 'siren'] as const;
export type AlarmTone = (typeof alarmTones)[number];
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
  if (volume <= 0) return;
  const start = context.currentTime;
  const peak = (volume / 100) * 0.16;
  function note(
    type: OscillatorType,
    offset: number,
    duration: number,
    frequencies: [number, number][],
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + offset;
    oscillator.type = type;
    for (const [time, frequency] of frequencies) {
      if (tone === 'siren' && time > 0)
        oscillator.frequency.linearRampToValueAtTime(frequency, at + time);
      else oscillator.frequency.setValueAtTime(frequency, at + time);
    }
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(
      type === 'square' ? peak * 0.6 : peak,
      at + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }
  if (tone === 'pulse') {
    note('square', 0, 0.14, [[0, 740]]);
    note('square', 0.25, 0.14, [[0, 740]]);
  } else if (tone === 'siren') {
    note('triangle', 0, 0.75, [
      [0, 480],
      [0.25, 840],
      [0.5, 480],
    ]);
  } else {
    note('sine', 0, 0.4, [
      [0, 880],
      [0.18, 660],
    ]);
  }
}

export function useAlarmSound() {
  const [settings, setSettings] = useState(savedAudioSettings);
  const [enabled, setEnabled] = useState(false);
  const [audioError, setAudioError] = useState('');
  const context = useRef<AudioContext | null>(null);
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

  async function preview() {
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      if (context.current.state !== 'running')
        throw new Error('Audio is blocked by this browser.');
      playTone(context.current, settings.tone, settings.volume);
      setAudioError('');
    } catch {
      setAudioError(
        'Sound could not be played. Check this browser’s audio settings.',
      );
    }
  }

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      setAudioError('');
      void context.current?.suspend();
      return;
    }
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      if (context.current.state !== 'running')
        throw new Error('Audio is blocked by this browser.');
      playTone(context.current, settings.tone, settings.volume);
      setEnabled(true);
      setAudioError('');
    } catch {
      setAudioError(
        'Sound could not be enabled. Check this browser’s audio settings.',
      );
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
        volume: Math.max(0, Math.min(100, volume)),
      })),
    preview,
    toggle,
    play,
  };
}
