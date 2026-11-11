import type { SceneEdit } from '../shared/contract';
import type { TransitionKind } from '../shared/domain';
import { isTransitionKind } from '../core/sceneEdits';

/** Each Transition, in menu order, as the Game Master reads it. */
const TRANSITIONS: readonly { kind: TransitionKind; name: string }[] = [
  { kind: 'crossfade', name: 'Fondu enchaîné' },
  { kind: 'cut', name: 'Cut' },
];

/**
 * The Scene's entry Transition: how its picture comes in when it is Activated. Each change is
 * one Scene edit, so one undo step.
 */
export function SceneTransitionField(props: {
  transition: TransitionKind;
  onEdit: (command: SceneEdit) => void;
}) {
  const { transition, onEdit } = props;
  return (
    <label className="scene-title-field">
      TRANSITION
      <select
        aria-label="Transition"
        value={transition}
        onChange={(event) => {
          const chosen = event.target.value;
          if (isTransitionKind(chosen)) onEdit({ kind: 'set-transition', transition: chosen });
        }}
      >
        {TRANSITIONS.map(({ kind, name }) => (
          <option key={kind} value={kind}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
