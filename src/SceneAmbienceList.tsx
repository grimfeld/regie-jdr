import { useMemo } from 'react';
import { Trash2, Waves } from 'lucide-react';
import type { DragEvent } from 'react';
import type { AmbienceLevel, SceneEdit } from '../shared/contract';
import type { AudioMedia, MediaId, Scene } from '../shared/domain';
import { LevelSlider, useTransientSender } from './LevelSlider';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { MissingMediaBadge, useMissingMedia } from './MissingMedia';
import { useDropTarget } from './PlacementLists';

/**
 * The Selected Scene's Ambiences and its Ambience level. Dropping an Ambience from the library
 * adds it, switched off; each can be switched on or off, given its own volume, or removed. On
 * the Active Scene every change is heard at once, a slider while it is dragged; on any other
 * Scene it is only saved. Each change is one Scene edit (a slider sends it once released), so
 * undo takes it back in one step.
 */
export function SceneAmbienceList(props: {
  scene: Scene;
  sounds: readonly AudioMedia[];
  /** Whether the Scene is the Active Scene: its levels are heard while dragged. */
  active: boolean;
  /** An Ambience was dropped here: add it to the Scene. */
  onAdd: (mediaId: MediaId) => void;
  /** Sends an edit; a failure is shown as a notice. */
  onEdit: (command: SceneEdit) => void;
  /** Makes a level or volume being dragged heard on air (Active Scene only), unsaved. */
  onTransient: (edit: AmbienceLevel) => Promise<void>;
}) {
  const { scene, sounds, active, onAdd, onEdit, onTransient } = props;
  /** The sender of the sliders' transient updates, created on first use (in an event). */
  const live = useTransientSender(onTransient);
  /** A slider's value: heard while dragged on the Active Scene, saved once released. */
  const sliderOf = (edit: (level: number) => AmbienceLevel) => ({
    onLive: (level: number) => {
      if (active) live().push(edit(level));
    },
    onCommit: (level: number) => {
      live().drop();
      onEdit(edit(level));
    },
  });
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
        <LevelSlider
          label="Niveau"
          accessibleName="Niveau des ambiances"
          value={scene.volumes.ambience}
          {...sliderOf((level) => ({ kind: 'set-ambience-level', level }))}
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
              <LevelSlider
                label="Volume"
                accessibleName={`Volume de ${name}`}
                value={volume}
                {...sliderOf((level) => ({ kind: 'set-ambience-volume', mediaId, volume: level }))}
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
