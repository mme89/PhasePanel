import { useState } from 'react';
import type { UpdateCheck } from '../shared/updates';
import { api } from './api';
import { Modal } from './Modal';

export function UpdatesDialog({
  currentVersion,
  onClose,
}: {
  currentVersion?: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<UpdateCheck>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function check() {
    setChecking(true);
    setError('');
    setResult(undefined);
    try {
      setResult(
        await api<UpdateCheck>('/updates/check', { method: 'POST' }, 15_000),
      );
    } catch {
      setError(
        'Unable to check for updates. Check your internet connection and try again later.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal labelledBy="updates-title" onClose={onClose}>
      <section className="modal server-settings-modal">
        <h2 id="updates-title">Updates</h2>
        <p>
          Installed version:{' '}
          <strong>
            {currentVersion ? `v${currentVersion}` : 'Unavailable'}
          </strong>
        </p>
        <p>Check GitHub for the latest PhasePanel release.</p>
        <p>
          <a
            href="https://github.com/mme89/PhasePanel"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub repository
          </a>
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="notice" role="status">
            <p>
              {!result.latestVersion
                ? 'No published release is available yet.'
                : result.updateAvailable
                  ? `Update available: v${result.latestVersion}`
                  : 'You are up to date.'}
            </p>
            {result.latestVersion && (
              <p>Latest release: v{result.latestVersion}</p>
            )}
            {result.releaseUrl && (
              <p>
                <a
                  href={result.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View release and downloads
                </a>
              </p>
            )}
            <p>Last checked: {new Date(result.checkedAt).toLocaleString()}</p>
          </div>
        )}
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </footer>
      </section>
    </Modal>
  );
}
