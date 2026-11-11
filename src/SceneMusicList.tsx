import { Music2 } from 'lucide-react';
import type { DragEvent } from 'react';
import type { AudioMedia, MediaId, Scene } from '../shared/domain';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { useDropTarget } from './PlacementLists';

/**
 * The Selected Scene's Music list, in order: the first plays when the Scene is Activated.
 * Dropping Music from the library adds it at the end (one Scene edit, so one undo step).
 * Music controls (reorder, remove, pick a track, play/pause) come with #36; the Ambience list
 * (#37) sits beside it.
 */
export function SceneMusicList(props: {
  scene: Scene;
  sounds: readonly AudioMedia[];
  /** Music was dropped here: add it to the Scene. */
  onAdd: (mediaId: MediaId) => void;
}) {
  const { scene, sounds, onAdd } = props;
  const drop = useDropTarget(
    (event: DragEvent<HTMLElement>) => {
      const mediaId = droppedAudioId(event, 'music');
      if (mediaId !== undefined) onAdd(mediaId);
    },
    (event) => carriesAudio(event, 'music'),
  );
  const nameOf = (mediaId: MediaId) =>
    sounds.find((sound) => sound.id === mediaId)?.name ?? 'Média inconnu';
  return (
    <div className={`placement-list scene-music${drop.over ? ' drop-ready' : ''}`} {...drop.props}>
      <h4>Musiques</h4>
      <ul aria-label="Musiques">
        {scene.music.map((mediaId, index) => (
          <li key={mediaId}>
            <Music2 size={14} aria-hidden />
            <span className="placement-name">{nameOf(mediaId)}</span>
            {index === 0 && <small> · jouée à l’activation</small>}
          </li>
        ))}
      </ul>
      {scene.music.length === 0 && (
        <p className="placement-empty">Déposez une musique ici pour l’ajouter à la scène.</p>
      )}
    </div>
  );
}
