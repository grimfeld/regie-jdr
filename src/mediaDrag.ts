/**
 * What a drop target in the Scene editor, the Notes or the library takes. A library image dragged inside
 * the Control window carries only its Media id, under a type of its own, so a drop target can
 * tell it from anything else dragged over it (text, links). Files dragged in from Windows
 * Explorer are the other thing a drop target takes: they are imported first.
 */
import type { DragEvent } from 'react';
import type { AudioMedia, AudioRole, ImageMedia, MediaId } from '../shared/domain';

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
  return libraryImageOf(event.dataTransfer);
}

/**
 * The library image's Media id a drop's data carries, or undefined: for drop targets that get the
 * browser's own drop event (the Notes editor).
 */
export function libraryImageOf(data: DataTransfer): MediaId | undefined {
  return data.getData(MEDIA_DRAG_TYPE) || undefined;
}

/**
 * The files dropped from outside the app, on `drop`; empty when there are none. Read them before
 * awaiting anything: the drop's data is gone once its handler returns.
 */
export function droppedFiles(event: DragEvent): File[] {
  return [...event.dataTransfer.files];
}

/**
 * The drag type of a library audio Media of `role`: the role is in the type, so a list (the
 * Scene's Music list) can tell during `dragover` whether it takes what is dragged over it.
 */
function audioDragType(role: AudioRole): string {
  return `application/x-regie-audio-${role.toLowerCase()}`;
}

/** Starts dragging `audio` from the library. */
export function startAudioDrag(event: DragEvent, audio: AudioMedia): void {
  event.dataTransfer.setData(audioDragType(audio.role), audio.id);
  event.dataTransfer.effectAllowed = 'copy';
}

/** Whether a drag carries a library audio Media of `role`. Usable during `dragover`. */
export function carriesAudio(event: DragEvent, role: AudioRole): boolean {
  return event.dataTransfer.types.includes(audioDragType(role));
}

/** The dragged library audio Media of `role`, on `drop`; undefined when the drag carries none. */
export function droppedAudioId(event: DragEvent, role: AudioRole): MediaId | undefined {
  return event.dataTransfer.getData(audioDragType(role)) || undefined;
}
