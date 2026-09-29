import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({
  children,
  onClose,
  labelledBy,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={`modal-shell ${className ?? ''}`}
      aria-labelledby={labelledBy}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
