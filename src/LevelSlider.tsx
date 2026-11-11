import { useState } from 'react';

/**
 * A level slider (0..1, shown in percent) for a Scene level or an item's volume. Each change
 * is reported live (`onLive`: heard on the Active Scene, unsaved); once released (pointer up,
 * key up, or leaving it) the value is committed (`onCommit`), so a whole drag is one Scene
 * edit, one undo step. Until the saved value comes back, it keeps showing the value committed.
 */
export function LevelSlider(props: {
  label: string;
  /** The slider's accessible name when `label` alone is not enough. */
  accessibleName?: string;
  /** The saved level, 0..1. */
  value: number;
  onLive: (level: number) => void;
  onCommit: (level: number) => void;
}) {
  const { label, accessibleName = label, value, onLive, onCommit } = props;
  // The level being chosen, the saved level it was chosen from, and whether it was sent.
  const [draft, setDraft] = useState<{ shown: number; from: number; sent: boolean }>();
  // Once the saved level changes (the commit saved, an undo), the draft is over for good: an
  // undo back to the level it started from must not bring it back.
  if (draft && draft.from !== value) setDraft(undefined);
  const current = draft?.from === value ? draft : undefined;
  const commit = () => {
    if (!current || current.sent) return;
    if (current.shown === value) {
      setDraft(undefined);
      return;
    }
    setDraft({ ...current, sent: true });
    onCommit(current.shown);
  };
  const percent = Math.round((current ? current.shown : value) * 100);
  return (
    <label className="level-slider">
      <span>{label}</span>
      <input
        type="range"
        aria-label={accessibleName}
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => {
          const level = Number(event.currentTarget.value) / 100;
          setDraft({ shown: level, from: value, sent: false });
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
