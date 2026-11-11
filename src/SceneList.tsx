import { useEffect, useRef, useState, type DragEvent } from 'react';
import { GripVertical, History, Radio } from 'lucide-react';
import type { Scene, SceneId } from '../shared/domain';
import { keyLabelOf, shortcutOf } from './keyboard';

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
  /**
   * A Scene was dropped on the one at `toIndex`, or moved there from the keyboard: it takes that
   * place in the running order.
   */
  onMove: (sceneId: SceneId, toIndex: number) => void;
}

/**
 * The Campaign's Scenes in running order. Clicking one opens it; dragging one onto another puts
 * it in that place, and so do the running order shortcuts (Alt+Up, Alt+Down) on a focused row.
 */
export function SceneList({ scenes, openedId, isActive, isLastActive, onOpen, onMove }: Props) {
  /** The row a Scene is dragged over, shown as the drop place. */
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined);
  /** The Scene just moved from the keyboard: it keeps the focus in its new place. */
  const movedByKey = useRef<SceneId | undefined>(undefined);
  /** Each Scene's open button, which has the focus when its row does. */
  const openers = useRef(new Map<SceneId, HTMLButtonElement>());
  useEffect(() => {
    const sceneId = movedByKey.current;
    if (sceneId === undefined) return;
    movedByKey.current = undefined;
    const opener = openers.current.get(sceneId);
    if (opener && document.activeElement !== opener) opener.focus();
  });
  const moveTitle = `Glisser, ou ${keyLabelOf('move-scene-up') ?? ''} et ${
    keyLabelOf('move-scene-down') ?? ''
  }, pour changer l’ordre des scènes`;

  return (
    <ul className="scene-list" aria-label="Scènes de la campagne">
      {scenes.map((scene, index) => (
        <li
          key={scene.id}
          draggable
          title={moveTitle}
          onKeyDown={(event) => {
            const shortcut = shortcutOf(event.nativeEvent);
            if (shortcut !== 'move-scene-up' && shortcut !== 'move-scene-down') return;
            event.preventDefault();
            const toIndex = shortcut === 'move-scene-up' ? index - 1 : index + 1;
            if (toIndex < 0 || toIndex >= scenes.length) return;
            movedByKey.current = scene.id;
            onMove(scene.id, toIndex);
          }}
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
            ref={(opener) => {
              if (opener) openers.current.set(scene.id, opener);
              else openers.current.delete(scene.id);
            }}
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
