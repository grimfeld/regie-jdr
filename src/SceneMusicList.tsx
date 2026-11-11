import { useEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Music2, Trash2 } from 'lucide-react';
import type { DragEvent } from 'react';
import type { MusicLevel, SceneEdit } from '../shared/contract';
import type { AudioMedia, MediaId, Scene } from '../shared/domain';
import { LevelSlider } from './LevelSlider';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { MissingMediaBadge, useMissingMedia } from './MissingMedia';
import { useDropTarget } from './PlacementLists';
import { createTransientSender, type TransientSender } from './transientUpdates';

/**
 * The Selected Scene's Music list, in order: the first plays when the Scene is Activated.
 * Dropping Music from the library adds it at the end; each Music can be moved up or down and
 * removed; the Scene's Music level is set beside its heading. Each of these is one Scene edit, one undo
 * step. On the Active Scene, clicking a track crossfades to it: live playback, never saved.
 * The Ambience list (#37) sits beside it.
 */
export function SceneMusicList(props: {
  scene: Scene;
  sounds: readonly AudioMedia[];
  /** Whether the Scene is the Active Scene: its tracks can be picked, its level is heard. */
  active: boolean;
  /** Music was dropped here: add it to the Scene. */
  onAdd: (mediaId: MediaId) => void;
  /** Sends a Scene edit; a failure is shown as a notice. */
  onEdit: (command: SceneEdit) => void;
  /** Crossfades to this track (Active Scene only). */
  onPick: (mediaId: MediaId) => void;
  /** Makes a Music level being dragged heard on air (Active Scene only), unsaved. */
  onTransient: (edit: MusicLevel) => Promise<void>;
}) {
  const { scene, sounds, active, onAdd, onEdit, onPick, onTransient } = props;
  const drop = useDropTarget(
    (event: DragEvent<HTMLElement>) => {
      const mediaId = droppedAudioId(event, 'music');
      if (mediaId !== undefined) onAdd(mediaId);
    },
    (event) => carriesAudio(event, 'music'),
  );
  // The latest callback, for the sender of a drag under way.
  const latestTransient = useRef(onTransient);
  useEffect(() => {
    latestTransient.current = onTransient;
  });
  const senderRef = useRef<TransientSender<MusicLevel> | undefined>(undefined);
  /** The sender of the level's transient updates, created on first use (in an event). */
  function level() {
    senderRef.current ??= createTransientSender((edit) => latestTransient.current(edit));
    return senderRef.current;
  }
  const nameOf = (mediaId: MediaId) =>
    sounds.find((sound) => sound.id === mediaId)?.name ?? 'Média inconnu';
  const count = scene.music.length;
  const listed = useMemo(
    () => sounds.filter((sound) => scene.music.includes(sound.id)),
    [sounds, scene.music],
  );
  const missing = useMissingMedia(listed);
  return (
    <div className={`placement-list scene-music${drop.over ? ' drop-ready' : ''}`} {...drop.props}>
      <div className="scene-music-heading">
        <h4>Musiques</h4>
        <LevelSlider
          label="Niveau"
          accessibleName="Niveau des musiques"
          value={scene.volumes.music}
          onLive={(next) => {
            if (active) level().push({ kind: 'set-music-level', level: next });
          }}
          onCommit={(next) => {
            level().drop();
            onEdit({ kind: 'set-music-level', level: next });
          }}
        />
      </div>
      <ul aria-label="Musiques">
        {scene.music.map((mediaId, index) => {
          const name = nameOf(mediaId);
          const moveTo = (toIndex: number) => onEdit({ kind: 'move-music', mediaId, toIndex });
          return (
            <li key={mediaId}>
              <Music2 size={14} aria-hidden />
              {active ? (
                <button
                  className="music-pick"
                  aria-label={`Jouer ${name}`}
                  title={`Passer à ${name} en fondu enchaîné`}
                  onClick={() => onPick(mediaId)}
                >
                  {name}
                </button>
              ) : (
                <span className="placement-name">{name}</span>
              )}
              {missing.has(mediaId) && <MissingMediaBadge name={name} />}
              {index === 0 && <small> · jouée à l’activation</small>}
              <button
                className="placement-move"
                aria-label={`Monter ${name}`}
                title={`Placer ${name} avant la musique précédente`}
                disabled={index <= 0}
                onClick={() => moveTo(index - 1)}
              >
                <ArrowUp size={13} aria-hidden />
              </button>
              <button
                className="placement-move"
                aria-label={`Descendre ${name}`}
                title={`Placer ${name} après la musique suivante`}
                disabled={index >= count - 1}
                onClick={() => moveTo(index + 1)}
              >
                <ArrowDown size={13} aria-hidden />
              </button>
              <button
                className="placement-remove"
                aria-label={`Retirer ${name}`}
                title={`Retirer ${name} de la scène`}
                onClick={() => onEdit({ kind: 'remove-music', mediaId })}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {count === 0 && (
        <p className="placement-empty">Déposez une musique ici pour l’ajouter à la scène.</p>
      )}
    </div>
  );
}
