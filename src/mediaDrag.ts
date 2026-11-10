/**
 * Dragging a library image onto the Scene editor, inside the Control window. The drag carries
 * only the Media id, under a type of its own, so a drop target can tell a library image from
 * anything else dragged over it (files from Explorer, text, links).
 */
import type { DragEvent } from 'react';
import type { ImageMedia, MediaId } from '../shared/domain';

const MEDIA_DRAG_TYPE = 'application/x-regie-media';

/** Starts dragging `image` from the library. */
export function startMediaDrag(event: DragEvent, image: ImageMedia): void {
  event.dataTransfer.setData(MEDIA_DRAG_TYPE, image.id);
  event.dataTransfer.effectAllowed = 'copy';
}

/**
 * Whether a drag carries a library image. Usable during `dragover`, when the browser hides the
 * dragged data but shows its types.
 */
export function carriesMedia(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(MEDIA_DRAG_TYPE);
}

/** The dragged library image's Media id, on `drop`; undefined when the drag carries none. */
export function droppedMediaId(event: DragEvent): MediaId | undefined {
  return event.dataTransfer.getData(MEDIA_DRAG_TYPE) || undefined;
}
