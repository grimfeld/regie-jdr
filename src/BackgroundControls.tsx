import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { BackgroundFraming, SceneEdit } from '../shared/contract';
import type { Background, BackgroundFit } from '../shared/domain';
import { MAX_ZOOM, MIN_ZOOM } from '../core/canvas';
import type { FramingGesture } from './useBackgroundFraming';

interface Props {
  background: Background;
  /** Its place in the stack: 0 is the bottom. */
  index: number;
  /** How many Backgrounds the Scene has. */
  count: number;
  /** Its Media name, for the controls' accessible names. */
  name: string;
  /** Sends an edit; a failure is shown as a notice. */
  onEdit: (command: SceneEdit) => void;
  /** Where the framing sliders report their live values and their release. */
  framing: FramingGesture;
}

type Framing = Omit<BackgroundFraming, 'kind' | 'placementId'>;

/**
 * A Background's own controls on its row: move it up or down the stack, Cover or Contain, and
 * in Cover its zoom and focal point. Each change sends one Scene edit (a slider sends it once
 * released, its framing shown live meanwhile), so undo takes it back in one step.
 */
export function BackgroundControls({ background, index, count, name, onEdit, framing }: Props) {
  const placementId = background.id;
  const { zoom, focus } = background;
  // Only the value a slider changed is sent: the core keeps the others as saved.
  const slider = (framingOf: (value: number) => Framing) => {
    const edit = (value: number): BackgroundFraming => ({
      kind: 'frame-background',
      placementId,
      ...framingOf(value),
    });
    return {
      onLive: (value: number) => framing.onLive(edit(value)),
      onRelease: (value: number) => framing.onRelease(edit(value)),
      onUnchanged: () => framing.onRelease(undefined),
    };
  };

  return (
    <>
      <button
        className="placement-move"
        aria-label={`Monter ${name}`}
        title={`Placer ${name} au-dessus de l’arrière-plan suivant`}
        disabled={index >= count - 1}
        onClick={() => onEdit({ kind: 'move-background', placementId, toIndex: index + 1 })}
      >
        <ArrowUp size={13} aria-hidden />
      </button>
      <button
        className="placement-move"
        aria-label={`Descendre ${name}`}
        title={`Placer ${name} sous l’arrière-plan précédent`}
        disabled={index <= 0}
        onClick={() => onEdit({ kind: 'move-background', placementId, toIndex: index - 1 })}
      >
        <ArrowDown size={13} aria-hidden />
      </button>
      <select
        className="background-fit"
        aria-label={`Ajustement de ${name}`}
        value={background.fit}
        onChange={(e) =>
          onEdit({
            kind: 'set-background-fit',
            placementId,
            fit: e.target.value === 'contain' ? 'contain' : 'cover',
          })
        }
      >
        {FITS.map(({ fit, label }) => (
          <option key={fit} value={fit}>
            {label}
          </option>
        ))}
      </select>
      {background.fit === 'cover' && (
        <div className="background-framing">
          <FramingSlider
            label="Zoom"
            name={name}
            value={zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            {...slider((value) => ({ zoom: value }))}
          />
          <FramingSlider
            label="Horizontal"
            name={name}
            value={focus.x}
            min={0}
            max={1}
            step={0.01}
            {...slider((value) => ({ focus: { x: value } }))}
          />
          <FramingSlider
            label="Vertical"
            name={name}
            value={focus.y}
            min={0}
            max={1}
            step={0.01}
            {...slider((value) => ({ focus: { y: value } }))}
          />
        </div>
      )}
    </>
  );
}

const FITS: readonly { fit: BackgroundFit; label: string }[] = [
  { fit: 'cover', label: 'Couvrir' },
  { fit: 'contain', label: 'Contenir' },
];

/**
 * A slider that follows the pointer or the arrow keys, reporting each value live, and commits
 * its value once released (pointer up, key up, or leaving it), so a whole gesture is one edit.
 * Until that commit is saved, it keeps showing the value it committed.
 */
function FramingSlider(props: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The slider moved to `value`, not saved yet. */
  onLive: (value: number) => void;
  /** The slider was released on `value`: settles once it is saved (or failed and reloaded). */
  onRelease: (value: number) => Promise<void>;
  /** The slider was released back on the saved value. */
  onUnchanged: () => void;
}) {
  const { label, name, value, min, max, step, onLive, onRelease, onUnchanged } = props;
  // The value being chosen, the saved value it was chosen from, and whether it was sent.
  const [draft, setDraft] = useState<{ shown: number; from: number; sent: boolean }>();
  // Once the saved value changes (an undo while dragging) or the commit is saved, the draft is
  // over for good: an undo back to the value it started from must not bring it back.
  if (draft && draft.from !== value) setDraft(undefined);
  const current = draft?.from === value ? draft : undefined;
  const commit = () => {
    if (!current || current.sent) return;
    if (current.shown === value) {
      setDraft(undefined);
      onUnchanged();
      return;
    }
    const sent = { ...current, sent: true };
    setDraft(sent);
    // Ended by the save itself, not by a render seeing the saved value: an undo answered before
    // the window renders again restores the starting value, which would bring the draft back.
    const end = () => setDraft((shown) => (shown === sent ? undefined : shown));
    onRelease(current.shown).then(end, end);
  };
  return (
    <label className="framing-slider">
      <span>{label}</span>
      <input
        type="range"
        aria-label={`${label} de ${name}`}
        min={min}
        max={max}
        step={step}
        value={current ? current.shown : value}
        onChange={(e) => {
          const shown = Number(e.target.value);
          setDraft({ shown, from: value, sent: false });
          onLive(shown);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}
