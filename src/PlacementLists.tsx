import { useState, type DragEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { SceneEdit } from '../shared/contract';
import type { ImageMedia, MediaId, Scene } from '../shared/domain';
import { carriesMedia } from './mediaDrag';
import { LabelControls } from './PlayerTextFields';

/**
 * Props of a drop target: it accepts a dragged library image, shows it is ready while one is
 * over it, and hands the drop to `onDrop`.
 */
export function useDropTarget(onDrop: (event: DragEvent<HTMLElement>) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!carriesMedia(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        // Leaving for a child of the target is not leaving the target.
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setOver(false);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        setOver(false);
        if (!carriesMedia(event)) return;
        event.preventDefault();
        onDrop(event);
      },
    },
  };
}

interface ListProps {
  scene: Scene;
  images: readonly ImageMedia[];
  /** Sends an edit; a failure is shown as a notice. */
  onEdit: (command: SceneEdit) => void;
  /** An image was dropped on the list: place it as the list's type. */
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

function mediaName(images: readonly ImageMedia[], mediaId: MediaId): string {
  return images.find((image) => image.id === mediaId)?.name ?? 'Média inconnu';
}

/**
 * The Selected Scene's Backgrounds, bottom of the stack first, each with show/hide and remove.
 * Dropping a library image here places it as a Background, whatever its Image category.
 */
export function BackgroundList({ scene, images, onEdit, onDrop }: ListProps) {
  return (
    <PlacementList
      title="Arrière-plans"
      empty="Déposez une image ici pour l’ajouter en arrière-plan."
      onDrop={onDrop}
    >
      {scene.backgrounds.map((background) => (
        <PlacementRow
          key={background.id}
          name={mediaName(images, background.mediaId)}
          visible={background.visible}
          onEdit={onEdit}
          placementId={background.id}
        />
      ))}
    </PlacementList>
  );
}

/**
 * The Selected Scene's Overlays, back first (all above every Background), each with show/hide,
 * remove, and its Label. Dropping a library image here places it as an Overlay, whatever its Image category.
 */
export function OverlayList({ scene, images, onEdit, onDrop }: ListProps) {
  return (
    <PlacementList
      title="Superpositions"
      empty="Déposez une image ici pour l’ajouter en superposition."
      onDrop={onDrop}
    >
      {scene.overlays.map((overlay) => (
        <PlacementRow
          key={overlay.id}
          name={mediaName(images, overlay.mediaId)}
          visible={overlay.visible}
          onEdit={onEdit}
          placementId={overlay.id}
        >
          <LabelControls
            overlay={overlay}
            name={mediaName(images, overlay.mediaId)}
            onEdit={onEdit}
          />
        </PlacementRow>
      ))}
    </PlacementList>
  );
}

/** A titled list of placements that is also a drop target. */
function PlacementList(props: {
  title: string;
  empty: string;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode[];
}) {
  const { title, empty, onDrop, children } = props;
  const drop = useDropTarget(onDrop);
  return (
    <div className={`placement-list${drop.over ? ' drop-ready' : ''}`} {...drop.props}>
      <h4>{title}</h4>
      <ul aria-label={title}>{children}</ul>
      {children.length === 0 && <p className="placement-empty">{empty}</p>}
    </div>
  );
}

/**
 * One Background or Overlay: its Media name, whether it is Hidden, show/hide and remove.
 * `children` are further controls for this placement, shown on the row.
 */
function PlacementRow(props: {
  placementId: string;
  name: string;
  visible: boolean;
  onEdit: (command: SceneEdit) => void;
  children?: ReactNode;
}) {
  const { placementId, name, visible, onEdit, children } = props;
  return (
    <li className={visible ? undefined : 'is-hidden'}>
      <label className="placement-visible">
        <input
          type="checkbox"
          aria-label={`Afficher ${name}`}
          checked={visible}
          onChange={(e) => onEdit({ kind: 'set-visible', placementId, visible: e.target.checked })}
        />
        {visible ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
        <span className="placement-name">{name}</span>
        {!visible && <small> · Masqué</small>}
      </label>
      {children}
      <button
        className="placement-remove"
        aria-label={`Retirer ${name}`}
        title={`Retirer ${name} de la scène`}
        onClick={() => onEdit({ kind: 'remove-placement', placementId })}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </li>
  );
}
