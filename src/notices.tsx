// Short notices for the Game Master, shown at the bottom of the Control window.
//
// Failed window messages need no code at the call site: a bridge call whose promise is left
// unhandled and rejects with an IpcFailure is turned into a notice here. Code that catches a
// failure itself can still show one with `showNotice(noticeFor(failure))`, or any French text.
import { useEffect, useState } from 'react';
import type { IpcFailure } from '../shared/contract';

/** How long a notice stays up unless closed. */
const NOTICE_MS = 8000;

export function isIpcFailure(value: unknown): value is IpcFailure {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'ipc-failure'
  );
}

/** The Game Master's wording for a failed window message. */
export function noticeFor(failure: IpcFailure): string {
  const details = "Les détails sont dans le journal de l'application.";
  return failure.code === 'rejected'
    ? `L'application a refusé cette demande. ${details}`
    : `L'action n'a pas pu aboutir. ${details}`;
}

interface Notice {
  id: number;
  text: string;
}
const listeners = new Set<(text: string) => void>();

/** Shows a short notice in the Control window. */
export function showNotice(text: string): void {
  listeners.forEach((listener) => listener(text));
}

/** Renders the notices; mount once, in the Control window. */
export function Notices() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let nextId = 0;
    const timers = new Set<number>();
    const dismiss = (id: number) => setNotices((current) => current.filter((n) => n.id !== id));
    const add = (text: string) => {
      const id = nextId++;
      setNotices((current) => [...current, { id, text }]);
      timers.add(window.setTimeout(() => dismiss(id), NOTICE_MS));
    };
    // The main process has already logged these; showing them is enough.
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isIpcFailure(event.reason)) return;
      event.preventDefault();
      add(noticeFor(event.reason));
    };
    listeners.add(add);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      listeners.delete(add);
      window.removeEventListener('unhandledrejection', onRejection);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((notice) => (
        <div className="notice" role="alert" key={notice.id}>
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
          >
            Fermer
          </button>
        </div>
      ))}
    </div>
  );
}
