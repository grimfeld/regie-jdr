import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  History,
  Pencil,
  Radio,
  Trash2,
} from 'lucide-react';
import type { RunningOrderEdit } from '../shared/contract';
import type { Chapter, ChapterId, Scene, SceneId } from '../shared/domain';
import { inRunningOrder, looseOf, sceneStep, type ScenesInOrder } from '../core/runningOrder';
import { keyLabelOf, shortcutOf } from './keyboard';

/** A Scene dragged within the list carries only its id, under a type of its own. */
const SCENE_DRAG_TYPE = 'application/x-regie-scene';
/** So does a Chapter, by its heading. */
const CHAPTER_DRAG_TYPE = 'application/x-regie-chapter';

function carries(event: DragEvent, type: string): boolean {
  return event.dataTransfer.types.includes(type);
}

/** The running order shortcut (Alt+Up, Alt+Down) a key press on a row means, if any. */
function stepOf(event: KeyboardEvent): 'up' | 'down' | undefined {
  const shortcut = shortcutOf(event.nativeEvent);
  if (shortcut === 'move-scene-up') return 'up';
  if (shortcut === 'move-scene-down') return 'down';
  return undefined;
}

/** What the list is dragged over, shown as the drop place. */
type DropPlace = `scene:${SceneId}` | `chapter:${ChapterId}` | 'loose';

interface Props {
  /** The Campaign's Scenes, in running order, and its Chapters. */
  order: ScenesInOrder<Scene>;
  /** The Scene open in the editor. */
  openedId: SceneId | undefined;
  isActive: (scene: Scene) => boolean;
  isLastActive: (scene: Scene) => boolean;
  onOpen: (scene: Scene) => void;
  /**
   * A running order command: a Scene dropped on another (it takes that place, in that group), on
   * a Chapter heading (last in it) or moved from the keyboard; a Chapter collapsed, renamed,
   * moved or deleted.
   */
  onEdit: (edit: RunningOrderEdit) => void;
}

/**
 * The Campaign's Scenes in running order, grouped into Chapters, then the Scenes in no Chapter.
 * Clicking a Scene opens it; dragging one onto another puts it in that place (and that Chapter),
 * dragging it onto a Chapter heading puts it last there, and the running order shortcuts
 * (Alt+Up, Alt+Down) move a focused row one place, stepping over collapsed Chapters. A Chapter
 * heading collapses or expands its Chapter, renames or deletes it (its Scenes stay, in no
 * Chapter), and moves it by drag or with the same shortcuts.
 */
export function SceneList({ order, openedId, isActive, isLastActive, onOpen, onEdit }: Props) {
  const { scenes, chapters } = inRunningOrder(order.scenes, order.chapters);
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const loose = looseOf({ scenes, chapters }).flatMap((id) => byId.get(id) ?? []);
  const [over, setOver] = useState<DropPlace | undefined>(undefined);
  const [renaming, setRenaming] = useState<{ chapterId: ChapterId; name: string } | undefined>();
  /** The row just moved from the keyboard: it keeps the focus in its new place. */
  const movedByKey = useRef<string | undefined>(undefined);
  /** Each row's focusable button (a Scene's open button, a Chapter's toggle), by Scene or Chapter id. */
  const focusables = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const id = movedByKey.current;
    if (id === undefined) return;
    movedByKey.current = undefined;
    const button = focusables.current.get(id);
    if (button && document.activeElement !== button) button.focus();
  });
  const keys = `${keyLabelOf('move-scene-up') ?? ''} et ${keyLabelOf('move-scene-down') ?? ''}`;
  const focusable = (id: string) => (button: HTMLButtonElement | null) => {
    if (button) focusables.current.set(id, button);
    else focusables.current.delete(id);
  };

  /** Drag-over handlers for a drop place taking `type`. */
  function dropTarget(place: DropPlace, type: string, onDrop: (id: string) => void) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!carries(event, type)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOver(place);
      },
      onDragLeave: (event: DragEvent) => {
        // Leaving for a child of the place is not leaving the place.
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setOver((current) => (current === place ? undefined : current));
      },
      onDrop: (event: DragEvent) => {
        setOver(undefined);
        if (!carries(event, type)) return;
        event.preventDefault();
        event.stopPropagation();
        const id = event.dataTransfer.getData(type);
        if (id) onDrop(id);
      },
    };
  }

  function sceneRow(scene: Scene, chapterId: ChapterId | null, index: number) {
    return (
      <li
        key={scene.id}
        draggable
        title={`Glisser, ou ${keys}, pour changer l’ordre des scènes`}
        onKeyDown={(event) => {
          const direction = stepOf(event);
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          const place = sceneStep({ scenes, chapters }, scene.id, direction);
          if (!place) return;
          movedByKey.current = scene.id;
          onEdit({ kind: 'move-scene', sceneId: scene.id, ...place });
        }}
        className={
          [
            scene.id === openedId && 'selected',
            isLastActive(scene) && 'last-active',
            over === `scene:${scene.id}` && 'drop-ready',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(SCENE_DRAG_TYPE, scene.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setOver(undefined)}
        {...dropTarget(`scene:${scene.id}`, SCENE_DRAG_TYPE, (sceneId) => {
          if (sceneId !== scene.id) {
            onEdit({ kind: 'move-scene', sceneId, chapterId, toIndex: index });
          }
        })}
      >
        <GripVertical size={14} className="scene-grip" aria-hidden />
        <button
          className="scene-open"
          ref={focusable(scene.id)}
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
    );
  }

  function chapterRow(chapter: Chapter, index: number) {
    const { id, name, collapsed } = chapter;
    const chapterScenes = chapter.sceneIds.flatMap((sceneId) => byId.get(sceneId) ?? []);
    const holdsActive = chapterScenes.some(isActive);
    const commitRename = () => {
      if (renaming?.chapterId !== id) return;
      setRenaming(undefined);
      if (renaming.name !== name)
        onEdit({ kind: 'rename-chapter', chapterId: id, name: renaming.name });
    };
    const sceneDrop = dropTarget(`chapter:${id}`, SCENE_DRAG_TYPE, (sceneId) =>
      onEdit({ kind: 'move-scene', sceneId, chapterId: id, toIndex: chapter.sceneIds.length }),
    );
    const chapterDrop = dropTarget(`chapter:${id}`, CHAPTER_DRAG_TYPE, (chapterId) => {
      if (chapterId !== id) onEdit({ kind: 'move-chapter', chapterId, toIndex: index });
    });
    return (
      <li key={id} className="scene-chapter">
        <div
          className={`scene-chapter-heading${over === `chapter:${id}` ? ' drop-ready' : ''}`}
          role="group"
          aria-label={`Chapitre ${name}`}
          draggable={renaming?.chapterId !== id}
          title={`Glisser, ou ${keys}, pour changer l’ordre des chapitres. Déposer une scène ici la range dans ce chapitre`}
          onKeyDown={(event) => {
            const direction = stepOf(event);
            if (!direction) return;
            event.preventDefault();
            const toIndex = direction === 'up' ? index - 1 : index + 1;
            if (toIndex < 0 || toIndex >= chapters.length) return;
            movedByKey.current = id;
            onEdit({ kind: 'move-chapter', chapterId: id, toIndex });
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData(CHAPTER_DRAG_TYPE, id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setOver(undefined)}
          onDragOver={(event) => {
            sceneDrop.onDragOver(event);
            chapterDrop.onDragOver(event);
          }}
          onDragLeave={sceneDrop.onDragLeave}
          onDrop={(event) => {
            if (carries(event, SCENE_DRAG_TYPE)) sceneDrop.onDrop(event);
            else chapterDrop.onDrop(event);
          }}
        >
          {renaming?.chapterId === id ? (
            <input
              autoFocus
              aria-label="Nouveau nom du chapitre"
              value={renaming.name}
              onChange={(event) => setRenaming({ chapterId: id, name: event.target.value })}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setRenaming(undefined);
              }}
            />
          ) : (
            <button
              className="scene-chapter-toggle"
              ref={focusable(id)}
              aria-expanded={!collapsed}
              title={collapsed ? 'Déplier le chapitre' : 'Replier le chapitre'}
              onClick={() =>
                onEdit({ kind: 'set-chapter-collapsed', chapterId: id, collapsed: !collapsed })
              }
            >
              {collapsed ? (
                <ChevronRight size={14} aria-hidden />
              ) : (
                <ChevronDown size={14} aria-hidden />
              )}
              {name}
              <span className="scene-chapter-count">({chapterScenes.length})</span>
            </button>
          )}
          {collapsed && holdsActive && (
            <span className="scene-active-badge">
              <Radio size={12} /> Active
            </span>
          )}
          <button
            className="icon-button"
            aria-label={`Renommer le chapitre ${name}`}
            title="Renommer le chapitre"
            onClick={() => setRenaming({ chapterId: id, name })}
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            className="icon-button"
            aria-label={`Supprimer le chapitre ${name}`}
            title="Supprimer le chapitre (ses scènes restent, hors chapitre)"
            onClick={() => onEdit({ kind: 'delete-chapter', chapterId: id })}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
        {!collapsed && chapterScenes.length > 0 && (
          <ul className="scene-chapter-scenes" aria-label={`Scènes du chapitre ${name}`}>
            {chapterScenes.map((scene, sceneIndex) => sceneRow(scene, id, sceneIndex))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul className="scene-list" aria-label="Scènes de la campagne">
      {chapters.map(chapterRow)}
      {chapters.length > 0 && (
        <li
          className={`scene-loose-heading${over === 'loose' ? ' drop-ready' : ''}`}
          {...dropTarget('loose', SCENE_DRAG_TYPE, (sceneId) =>
            onEdit({ kind: 'move-scene', sceneId, chapterId: null, toIndex: loose.length }),
          )}
        >
          Hors chapitre
        </li>
      )}
      {loose.map((scene, index) => sceneRow(scene, null, index))}
    </ul>
  );
}
