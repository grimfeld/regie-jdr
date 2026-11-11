import { useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { SceneEdit } from '../shared/contract';
import type { ImageMedia, MediaId, Scene } from '../shared/domain';
import { BackgroundControls } from './BackgroundControls';
import { carriesMedia } from './mediaDrag';
import { LabelControls } from './PlayerTextFields';
import type { FramingGesture } from './useBackgroundFraming';

/**
 * Props of a drop target: it accepts what `accepts` says (by default a library image or files
 * from Explorer), shows it is ready while one is over it, and hands the drop to `onDrop`.
 */
export function useDropTarget(
  onDrop: (event: DragEvent<HTMLElement>) => void,
  accepts: (event: DragEvent<HTMLElement>) => boolean = carriesMedia,
) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!accepts(event)) return;
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
        if (!accepts(event)) return;
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
 * The Selected Scene's Backgrounds, top of the stack first (as in a layer panel: a row covers
 * the rows below it), each with show/hide, its place in the stack, its fit, and remove.
 * Dropping a library image here places it as a Background, whatever its Image category.
 */
export function BackgroundList({
  scene,
  images,
  onEdit,
  onDrop,
  framing,
}: ListProps & { framing: FramingGesture }) {
  const count = scene.backgrounds.length;
  const topFirst = scene.backgrounds.map((background, index) => ({ background, index })).reverse();
  return (
    <PlacementList
      title="Arrière-plans"
      empty="Déposez une image ici pour l’ajouter en arrière-plan."
      onDrop={onDrop}
    >
      {topFirst.map(({ background, index }) => {
        const name = mediaName(images, background.mediaId);
        return (
          <PlacementRow
            key={background.id}
            name={name}
            visible={background.visible}
            onEdit={onEdit}
            placementId={background.id}
          >
            <BackgroundControls
              background={background}
              index={index}
              count={count}
              name={name}
              onEdit={onEdit}
              framing={framing}
            />
          </PlacementRow>
        );
      })}
    </PlacementList>
  );
}

/**
 * The Selected Scene's Overlays, front first like the Backgrounds (all above every Background),
 * each with show/hide, bring forward / send back among the Overlays, remove, and its Label.
 * Dropping a library image here places it as an Overlay, whatever its Image category.
 */
export function OverlayList({ scene, images, onEdit, onDrop }: ListProps) {
  const count = scene.overlays.length;
  const frontFirst = scene.overlays.map((overlay, index) => ({ overlay, index })).reverse();
  return (
    <PlacementList
      title="Superpositions"
      empty="Déposez une image ici pour l’ajouter en superposition."
      onDrop={onDrop}
    >
      {frontFirst.map(({ overlay, index }) => {
        const name = mediaName(images, overlay.mediaId);
        const moveTo = (toIndex: number) =>
          onEdit({ kind: 'move-overlay', placementId: overlay.id, toIndex });
        return (
          <PlacementRow
            key={overlay.id}
            name={name}
            visible={overlay.visible}
            onEdit={onEdit}
            placementId={overlay.id}
          >
            <button
              className="placement-move"
              aria-label={`Avancer ${name}`}
              title={`Placer ${name} devant la superposition suivante`}
              disabled={index >= count - 1}
              onClick={() => moveTo(index + 1)}
            >
              <ArrowUp size={13} aria-hidden />
            </button>
            <button
              className="placement-move"
              aria-label={`Reculer ${name}`}
              title={`Placer ${name} derrière la superposition précédente`}
              disabled={index <= 0}
              onClick={() => moveTo(index - 1)}
            >
              <ArrowDown size={13} aria-hidden />
            </button>
            <LabelControls overlay={overlay} name={name} onEdit={onEdit} />
          </PlacementRow>
        );
      })}
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
