/**
 * What a drop target in the Scene editor or the library takes. A library image dragged inside
 * the Control window carries only its Media id, under a type of its own, so a drop target can
 * tell it from anything else dragged over it (text, links). Files dragged in from Windows
 * Explorer are the other thing a drop target takes: they are imported first.
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
 * Whether a drag carries a library image or files from outside the app. Usable during
 * `dragover`, when the browser hides the dragged data but shows its types.
 */
export function carriesMedia(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(MEDIA_DRAG_TYPE) || carriesFiles(event);
}

/** Whether a drag carries files from outside the app (Windows Explorer). */
export function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

/** The dragged library image's Media id, on `drop`; undefined when the drag carries none. */
export function droppedMediaId(event: DragEvent): MediaId | undefined {
  return event.dataTransfer.getData(MEDIA_DRAG_TYPE) || undefined;
}

/**
 * The files dropped from outside the app, on `drop`; empty when there are none. Read them before
 * awaiting anything: the drop's data is gone once its handler returns.
 */
export function droppedFiles(event: DragEvent): File[] {
  return [...event.dataTransfer.files];
}
