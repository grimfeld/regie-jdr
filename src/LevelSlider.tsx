import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createTransientSender, type TransientSender } from './transientUpdates';

/** A level being chosen: the level shown, the saved level it was chosen from, whether sent. */
interface Draft {
  shown: number;
  from: number;
  sent: boolean;
}

/**
 * The one level slider (0..1, shown in percent) of the Control window: a Scene's Music or
 * Ambience level, an Ambience's volume, the Soundboard level, a pad's volume. Each move is
 * reported live (`onLive`: heard at once, unsaved); once released (the input's `change`, a
 * pointer or key up, or leaving it) the value is committed (`onCommit`), so a whole drag is one
 * edit (one undo step on a Scene). Until that commit is saved it keeps showing the value it
 * committed; once saved, or once the saved value changes (an undo while dragging), its own value
 * is dropped for good, so an undo back to the level a drag started from never brings it back.
 */
export function LevelSlider(props: {
  label: string;
  /** The slider's accessible name when `label` alone is not enough. */
  accessibleName?: string;
  /** Only the accessible name, no visible label (a pad's row names the pad already). */
  hideLabel?: boolean;
  /** The saved level, 0..1. */
  value: number;
  disabled?: boolean;
  onLive: (level: number) => void;
  /** Saves `level`: settles once saved (or once a failure is shown); never rejects. */
  onCommit: (level: number) => Promise<void>;
}) {
  const { label, accessibleName = label, hideLabel = false, value, disabled, onLive } = props;
  const [draft, setDraft] = useState<Draft>();
  if (draft && draft.from !== value) setDraft(undefined);
  const current = draft?.from === value ? draft : undefined;

  // A `change` comes right after the `input` it ends, before React renders it: the commit reads
  // the draft and the saved level from refs, not from the render it was created in.
  const latest = useRef<Draft | undefined>(undefined);
  const saved = useRef(value);
  const onCommit = useRef(props.onCommit);
  useLayoutEffect(() => {
    saved.current = value;
    onCommit.current = props.onCommit;
  });
  const choose = (next: Draft | undefined) => {
    latest.current = next;
    setDraft(next);
  };
  const commit = useCallback(() => {
    const pending = latest.current;
    if (!pending || pending.sent || pending.from !== saved.current) return;
    if (pending.shown === saved.current) {
      latest.current = undefined;
      setDraft(undefined);
      return;
    }
    const sent = { ...pending, sent: true };
    latest.current = sent;
    setDraft(sent);
    // Ended by the save itself, not by a render seeing the saved level: an undo answered before
    // the window renders again restores the starting level, which would bring the draft back.
    const end = () => {
      if (latest.current !== sent) return;
      latest.current = undefined;
      setDraft(undefined);
    };
    onCommit.current(pending.shown).then(end, end);
  }, []);

  // The native `change` fires once the Game Master lets go (React's onChange is every move).
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.addEventListener('change', commit);
    return () => element.removeEventListener('change', commit);
  }, [commit]);

  const percent = Math.round((current ? current.shown : value) * 100);
  return (
    <label className="level-slider">
      {!hideLabel && <span>{label}</span>}
      <input
        ref={input}
        type="range"
        aria-label={accessibleName}
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={disabled}
        onChange={(event) => {
          const level = Number(event.currentTarget.value) / 100;
          choose({ shown: level, from: value, sent: false });
          onLive(level);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{percent} %</output>
    </label>
  );
}

/**
 * The sender of a list's live slider updates (at most one per frame, the latest only), created
 * on first use and always sending through the latest `send`.
 */
export function useTransientSender<T>(
  send: (update: T) => Promise<void>,
): () => TransientSender<T> {
  const latestSend = useRef(send);
  useEffect(() => {
    latestSend.current = send;
  });
  const sender = useRef<TransientSender<T> | undefined>(undefined);
  return () => {
    sender.current ??= createTransientSender((update) => latestSend.current(update));
    return sender.current;
  };
}
