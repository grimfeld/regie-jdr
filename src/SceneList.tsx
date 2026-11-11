import { useState, type DragEvent } from 'react';
import { GripVertical, History, Radio } from 'lucide-react';
import type { Scene, SceneId } from '../shared/domain';

/** A Scene dragged within the list carries only its id, under a type of its own. */
const SCENE_DRAG_TYPE = 'application/x-regie-scene';

function carriesScene(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(SCENE_DRAG_TYPE);
}

interface Props {
  /** The Campaign's Scenes, in running order. */
  scenes: readonly Scene[];
  /** The Scene open in the editor. */
  openedId: SceneId | undefined;
  isActive: (scene: Scene) => boolean;
  isLastActive: (scene: Scene) => boolean;
  onOpen: (scene: Scene) => void;
  /** A Scene was dropped on the one at `toIndex`: it takes that place in the running order. */
  onMove: (sceneId: SceneId, toIndex: number) => void;
}

/**
 * The Campaign's Scenes in running order. Clicking one opens it; dragging one onto another puts
 * it in that place.
 */
export function SceneList({ scenes, openedId, isActive, isLastActive, onOpen, onMove }: Props) {
  /** The row a Scene is dragged over, shown as the drop place. */
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined);

  return (
    <ul className="scene-list" aria-label="Scènes de la campagne">
      {scenes.map((scene, index) => (
        <li
          key={scene.id}
          draggable
          title="Glisser pour changer l’ordre des scènes"
          className={
            [
              scene.id === openedId && 'selected',
              isLastActive(scene) && 'last-active',
              overIndex === index && 'drop-ready',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onDragStart={(event) => {
            event.dataTransfer.setData(SCENE_DRAG_TYPE, scene.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (!carriesScene(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setOverIndex(index);
          }}
          onDragLeave={(event) => {
            // Leaving for a child of the row is not leaving the row.
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return;
            }
            setOverIndex((current) => (current === index ? undefined : current));
          }}
          onDragEnd={() => setOverIndex(undefined)}
          onDrop={(event) => {
            setOverIndex(undefined);
            if (!carriesScene(event)) return;
            event.preventDefault();
            const sceneId = event.dataTransfer.getData(SCENE_DRAG_TYPE);
            if (sceneId && sceneId !== scene.id) onMove(sceneId, index);
          }}
        >
          <GripVertical size={14} className="scene-grip" aria-hidden />
          <button
            className="scene-open"
            aria-pressed={scene.id === openedId}
            onClick={() => onOpen(scene)}
          >
            {scene.name}
          </button>
          {isActive(scene) && (
            <span className="scene-active-badge">
              <Radio size={12} /> Active
            </span>
          )}
          {isLastActive(scene) && (
            <span className="scene-last-badge">
              <History size={12} /> Dernière active
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
