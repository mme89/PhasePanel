import { useRef, useState } from 'react';
import type { Dashboard } from '../shared/model';

type Background = Pick<Dashboard, 'backgroundColor' | 'backgroundImage'>;

export function DashboardBackgroundEditor({
  dashboard,
  disabled,
  onChange,
}: {
  dashboard: Dashboard;
  disabled: boolean;
  onChange: (background: Background) => void;
}) {
  const [error, setError] = useState('');
  const request = useRef(0);
  return (
    <fieldset className="display-settings" disabled={disabled}>
      <legend>Dashboard background</legend>
      <label>
        Background color
        <input
          type="color"
          value={dashboard.backgroundColor ?? '#f7f8f5'}
          onChange={(e) => onChange({ backgroundColor: e.target.value })}
        />
      </label>
      <label>
        Background picture
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const current = ++request.current;
            setError('');
            if (
              !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
                file.type,
              ) ||
              file.size > 2 * 1024 * 1024
            ) {
              setError('Choose a PNG, JPEG, WebP or GIF picture up to 2 MB.');
              return;
            }
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error('Read failed'));
                reader.readAsDataURL(file);
              });
              const preview = new Image();
              preview.src = data;
              await preview.decode();
              if (current === request.current)
                onChange({ backgroundImage: data });
            } catch {
              if (current === request.current)
                setError(
                  'This picture could not be read. Choose another image.',
                );
            }
          }}
        />
      </label>
      <p className="muted">
        PNG, JPEG, WebP or GIF, up to 2 MB. Pictures fill the dashboard and are
        cropped to fit. Save dashboard to keep your background.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {dashboard.backgroundImage && (
        <button
          type="button"
          onClick={() => {
            request.current++;
            setError('');
            onChange({ backgroundImage: undefined });
          }}
        >
          Remove background picture
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          request.current++;
          setError('');
          onChange({ backgroundColor: undefined, backgroundImage: undefined });
        }}
      >
        Reset background
      </button>
    </fieldset>
  );
}
