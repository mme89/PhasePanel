import { useEffect, useState } from 'react';

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const supported = Boolean(
    document.fullscreenEnabled && document.documentElement.requestFullscreen,
  );
  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError(
        'Fullscreen could not be opened or closed. You can use your browser’s fullscreen command instead.',
      );
    } finally {
      setFullscreen(Boolean(document.fullscreenElement));
      setPending(false);
    }
  }
  return {
    fullscreen,
    pending,
    error,
    supported,
    toggle,
    clearError: () => setError(''),
  };
}
