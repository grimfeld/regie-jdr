import { useMemo, useState } from 'react';
import { Trash2, Waves } from 'lucide-react';
import type { DragEvent } from 'react';
import type { SceneEdit } from '../shared/contract';
import type { AudioMedia, MediaId, Scene } from '../shared/domain';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { MissingMediaBadge, useMissingMedia } from './MissingMedia';
import { useDropTarget } from './PlacementLists';

/**
 * The Selected Scene's Ambiences and its Ambience level. Dropping an Ambience from the library
 * adds it, switched off; each can be switched on or off, given its own volume, or removed. On
 * the Active Scene every change is heard at once; on any other Scene it is only saved. Each
 * change is one Scene edit (a slider sends it once released), so undo takes it back in one step.
 */
export function SceneAmbienceList(props: {
  scene: Scene;
  sounds: readonly AudioMedia[];
  /** An Ambience was dropped here: add it to the Scene. */
  onAdd: (mediaId: MediaId) => void;
  /** Sends an edit; a failure is shown as a notice. */
  onEdit: (command: SceneEdit) => void;
}) {
  const { scene, sounds, onAdd, onEdit } = props;
  const drop = useDropTarget(
    (event: DragEvent<HTMLElement>) => {
      const mediaId = droppedAudioId(event, 'ambience');
      if (mediaId !== undefined) onAdd(mediaId);
    },
    (event) => carriesAudio(event, 'ambience'),
  );
  const nameOf = (mediaId: MediaId) =>
    sounds.find((sound) => sound.id === mediaId)?.name ?? 'Média inconnu';
  const listed = useMemo(
    () => sounds.filter((sound) => scene.ambiences.some((item) => item.mediaId === sound.id)),
    [sounds, scene.ambiences],
  );
  const missing = useMissingMedia(listed);
  return (
    <div
      className={`placement-list scene-ambiences${drop.over ? ' drop-ready' : ''}`}
      {...drop.props}
    >
      <div className="scene-ambiences-heading">
        <h4>Ambiances</h4>
        <VolumeSlider
          label="Niveau"
          accessibleName="Niveau des ambiances"
          value={scene.volumes.ambience}
          onCommit={(level) => onEdit({ kind: 'set-ambience-level', level })}
        />
      </div>
      <ul aria-label="Ambiances">
        {scene.ambiences.map(({ mediaId, on, volume }) => {
          const name = nameOf(mediaId);
          return (
            <li key={mediaId} className={on ? undefined : 'is-hidden'}>
              <label className="placement-visible">
                <input
                  type="checkbox"
                  aria-label={`Jouer ${name}`}
                  checked={on}
                  onChange={(e) =>
                    onEdit({ kind: 'set-ambience-on', mediaId, on: e.target.checked })
                  }
                />
                <Waves size={14} aria-hidden />
                <span className="placement-name">{name}</span>
                {missing.has(mediaId) && <MissingMediaBadge name={name} />}
                {!on && <small> · Éteinte</small>}
              </label>
              <button
                className="placement-remove"
                aria-label={`Retirer ${name}`}
                title={`Retirer ${name} de la scène`}
                onClick={() => onEdit({ kind: 'remove-ambience', mediaId })}
              >
                <Trash2 size={13} aria-hidden />
              </button>
              <VolumeSlider
                label="Volume"
                accessibleName={`Volume de ${name}`}
                value={volume}
                onCommit={(next) => onEdit({ kind: 'set-ambience-volume', mediaId, volume: next })}
              />
            </li>
          );
        })}
      </ul>
      {scene.ambiences.length === 0 && (
        <p className="placement-empty">Déposez une ambiance ici pour l’ajouter à la scène.</p>
      )}
    </div>
  );
}

/**
 * A volume slider in percent that follows the pointer or the arrow keys and commits its value
 * (0..1) once released (pointer up, key up, or leaving it), so a whole drag is one edit. Until
 * the saved value changes, it keeps showing the value it committed.
 */
function VolumeSlider(props: {
  label: string;
  /** The slider's accessible name when `label` alone is not enough. */
  accessibleName?: string;
  /** The saved volume, 0..1. */
  value: number;
  onCommit: (value: number) => void;
}) {
  const { label, accessibleName = label, value, onCommit } = props;
  const saved = Math.round(value * 100);
  // The percent being chosen and whether it was sent; dropped once the saved value changes
  // (the committed value saved, an undo), so a later return to an old value never revives it.
  const [draft, setDraft] = useState<{ shown: number; sent: boolean }>();
  const [savedSeen, setSavedSeen] = useState(saved);
  if (savedSeen !== saved) {
    setSavedSeen(saved);
    setDraft(undefined);
  }
  const current = savedSeen === saved ? draft : undefined;
  const shown = current ? current.shown : saved;
  const commit = () => {
    if (!current || current.sent) return;
    if (current.shown === saved) {
      setDraft(undefined);
      return;
    }
    setDraft({ ...current, sent: true });
    onCommit(current.shown / 100);
  };
  return (
    <label className="ambience-volume">
      <span>{label}</span>
      <input
        type="range"
        aria-label={accessibleName}
        min={0}
        max={100}
        step={1}
        value={shown}
        onChange={(e) => setDraft({ shown: Number(e.target.value), sent: false })}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{shown} %</output>
    </label>
  );
}
