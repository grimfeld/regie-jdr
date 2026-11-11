import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { ImageMedia } from '../shared/domain';
import { mediaAddress } from '../core/mediaAddress';
import {
  isNotesImageWidth,
  isNotesMediaId,
  MAX_NOTES_IMAGE_WIDTH,
  MIN_NOTES_IMAGE_WIDTH,
} from '../core/notes';
import { MediaImage, MissingImage } from './MediaImage';

/**
 * The library's images, for the images in the Notes to be drawn from; undefined until the library
 * has been read (nothing is drawn yet, rather than "Média manquant").
 */
export const NotesImagesContext = createContext<readonly ImageMedia[] | undefined>(undefined);

/**
 * An image in the Notes: a block on its own line, left-aligned, holding only a Media id and its
 * width (core/notes.ts), drawn from the library like any image Media, "Média manquant" when its
 * file or Media is gone.
 *
 * Its size: by default its own width, at most the panel's. Once resized, its `width` in % of the
 * width it stands in, so it follows the panel when the panel is resized. A click selects it and
 * shows its resize handle; a double click shows it enlarged, in the Control window only.
 *
 * Copied and pasted inside the Notes it is an `<img data-media-id data-width>` with no address;
 * any other pasted `<img>` is not an image node (its text alone is kept, as for other markup).
 * Node API: https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node
 * React node views: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react
 */
export const NotesImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: (attributes) => ({ 'data-media-id': attributes.mediaId as unknown }),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = Number(element.getAttribute('data-width'));
          return isNotesImageWidth(width) ? width : null;
        },
        renderHTML: (attributes) =>
          isNotesImageWidth(attributes.width) ? { 'data-width': attributes.width } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-media-id]',
        getAttrs: (element) =>
          isNotesMediaId(element.getAttribute('data-media-id')) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NotesImageView);
  },
});

/** How much one arrow key press on the resize handle widens or narrows an image, in %. */
const KEYBOARD_STEP = 5;
const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: KEYBOARD_STEP,
  ArrowLeft: -KEYBOARD_STEP,
};

function clampWidth(width: number): number {
  return Math.min(MAX_NOTES_IMAGE_WIDTH, Math.max(MIN_NOTES_IMAGE_WIDTH, Math.round(width)));
}

/** An element's width on screen, in pixels. */
function pixelWidth(element: Element): number {
  return element.getBoundingClientRect().width;
}

function NotesImageView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const images = useContext(NotesImagesContext);
  const mediaId: unknown = node.attrs.mediaId;
  const storedWidth: unknown = node.attrs.width;
  const image = images?.find((known) => known.id === mediaId);
  /** The width shown while the handle is dragged; saved on release, as one Notes undo step. */
  const [dragWidth, setDragWidth] = useState<number>();
  const [enlarged, setEnlarged] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const width = dragWidth ?? (isNotesImageWidth(storedWidth) ? storedWidth : undefined);

  /** Saves a new width: an editor change, so the Notes undo takes it back. */
  function resizeTo(next: number) {
    if (next !== storedWidth) updateAttributes({ width: next });
  }

  /**
   * Dragging the corner handle: the image's right edge follows the pointer, its height following
   * its width (aspect locked), from 10 to 100 % of the width it stands in.
   */
  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const shown = frame.current;
    const holder = shown?.parentElement;
    if (event.button !== 0 || !shown || !holder || pixelWidth(holder) <= 0) return;
    const handle = event.currentTarget;
    const [startX, startPixels, holderPixels] = [
      event.clientX,
      pixelWidth(shown),
      pixelWidth(holder),
    ];
    const widthAt = (clientX: number) =>
      clampWidth(((startPixels + clientX - startX) / holderPixels) * 100);
    let latest = widthAt(startX);
    handle.setPointerCapture(event.pointerId);
    setDragWidth(latest);
    const move = (moved: PointerEvent) => {
      latest = widthAt(moved.clientX);
      setDragWidth(latest);
    };
    const end = (ended: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setDragWidth(undefined);
      if (ended.type === 'pointerup') resizeTo(latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** The left and right arrows on the handle narrow and widen the image by KEYBOARD_STEP %. */
  function resizeByKey(event: KeyboardEvent<HTMLButtonElement>) {
    const step = Object.hasOwn(ARROW_STEPS, event.key) ? ARROW_STEPS[event.key] : undefined;
    const shown = frame.current;
    const holder = shown?.parentElement;
    if (step === undefined || !shown || !holder || pixelWidth(holder) <= 0) return;
    event.preventDefault();
    resizeTo(clampWidth((width ?? (pixelWidth(shown) / pixelWidth(holder)) * 100) + step));
  }

  return (
    <NodeViewWrapper className="notes-image" data-drag-handle="">
      <div
        ref={frame}
        className={width === undefined ? 'notes-image-frame' : 'notes-image-frame sized'}
        style={width === undefined ? undefined : { width: `${String(width)}%` }}
        onDoubleClick={image ? () => setEnlarged(true) : undefined}
      >
        {images === undefined ? null : image ? (
          <MediaImage address={mediaAddress(image)} alt={image.name} window="control" />
        ) : (
          <MissingImage alt="" />
        )}
        {image && selected ? (
          // No content: an event on the button itself is one the editor leaves alone (TipTap's
          // NodeView.stopEvent ignores events on buttons inside a node view).
          <button
            type="button"
            className="notes-image-handle"
            aria-label={`Redimensionner ${image.name}`}
            title="Glisser pour redimensionner (flèches gauche et droite)"
            // Keeps the focus in the Notes, and the image from being dragged away instead.
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={startResize}
            onKeyDown={resizeByKey}
          />
        ) : null}
      </div>
      {enlarged && image ? (
        <EnlargedImage image={image} onClose={() => setEnlarged(false)} />
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * A Notes image shown large over the Control window, for the Game Master to read a map or a
 * handout up close. It stays in the Control window: nothing of the Notes ever goes on air.
 * Closed with Escape, its button, or a click beside the image.
 * https://developer.mozilla.org/docs/Web/HTML/Element/dialog
 */
function EnlargedImage(props: { image: ImageMedia; onClose: () => void }) {
  const { image, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const shown = dialog.current;
    if (shown && !shown.open) shown.showModal();
  }, []);
  // Put outside the editor, so its clicks and keys are not taken as editing the Notes.
  return createPortal(
    <dialog
      ref={dialog}
      className="notes-image-enlarged"
      aria-label={`Agrandissement de ${image.name}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <MediaImage address={mediaAddress(image)} alt={image.name} window="control" />
      <button type="button" className="icon-button" onClick={() => dialog.current?.close()}>
        Fermer
      </button>
    </dialog>,
    document.body,
  );
}
