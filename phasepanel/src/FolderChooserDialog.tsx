import { useEffect, useState } from 'react';
import { api, message } from './api';
import { Modal } from './Modal';

type FolderListing = {
  directory: string;
  parent: string | null;
  homeDirectory: string;
  roots: string[];
  entries: { name: string; path: string }[];
};

export function FolderChooserDialog({
  initialDirectory,
  defaultDirectory,
  onChoose,
  onClose,
}: {
  initialDirectory: string;
  defaultDirectory: string;
  onChoose: (directory: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<FolderListing>();
  const [path, setPath] = useState(initialDirectory);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function openFolder(directory?: string) {
    setBusy(true);
    setError('');
    try {
      const next = await api<FolderListing>(
        directory
          ? `/settings/storage/folders?path=${encodeURIComponent(directory)}`
          : '/settings/storage/folders',
      );
      setListing(next);
      setPath(next.directory);
      setNewName('');
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void openFolder(
      initialDirectory === defaultDirectory ? undefined : initialDirectory,
    );
  }, []);

  async function createFolder() {
    if (!listing || !newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<{ directory: string }>(
        '/settings/storage/folders',
        {
          method: 'POST',
          body: JSON.stringify({ parent: listing.directory, name: newName }),
        },
      );
      await openFolder(created.directory);
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="folder-chooser-title" onClose={onClose}>
      <section className="modal folder-chooser-modal">
        <h2 id="folder-chooser-title">Choose data folder</h2>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <form
          className="folder-chooser-path"
          onSubmit={(event) => {
            event.preventDefault();
            void openFolder(path);
          }}
        >
          <label htmlFor="folder-chooser-path">Folder path</label>
          <div>
            <input
              id="folder-chooser-path"
              type="text"
              value={path}
              spellCheck={false}
              onChange={(event) => setPath(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              Go
            </button>
          </div>
        </form>
        <nav className="folder-chooser-shortcuts" aria-label="Folder shortcuts">
          <button
            type="button"
            disabled={busy || !listing?.parent}
            onClick={() => listing?.parent && void openFolder(listing.parent)}
          >
            Up
          </button>
          <button
            type="button"
            disabled={busy || !listing}
            onClick={() => listing && void openFolder(listing.homeDirectory)}
          >
            Home
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void openFolder(defaultDirectory)}
          >
            Default
          </button>
          {listing?.roots.map((root) => (
            <button
              key={root}
              type="button"
              disabled={busy}
              onClick={() => void openFolder(root)}
            >
              {root}
            </button>
          ))}
        </nav>
        <div className="folder-chooser-list" role="group" aria-label="Folders">
          {listing?.entries.length ? (
            listing.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                disabled={busy}
                onClick={() => void openFolder(entry.path)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7h7l2 2h9v10H3zM3 7V5h8l2 2" />
                </svg>
                <span>{entry.name}</span>
              </button>
            ))
          ) : (
            <p>{busy ? 'Loading folders…' : 'No folders here.'}</p>
          )}
        </div>
        <form
          className="folder-chooser-create"
          onSubmit={(event) => {
            event.preventDefault();
            void createFolder();
          }}
        >
          <label htmlFor="folder-chooser-new">New folder</label>
          <div>
            <input
              id="folder-chooser-new"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Folder name"
            />
            <button
              type="submit"
              disabled={busy || !listing || !newName.trim()}
            >
              Create
            </button>
          </div>
        </form>
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || !listing}
            onClick={() => listing && onChoose(listing.directory)}
          >
            Choose this folder
          </button>
        </footer>
      </section>
    </Modal>
  );
}
