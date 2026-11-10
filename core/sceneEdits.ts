/**
 * Edits of a Scene, as the Control window makes them. Pure (no Node or Electron import): the
 * interface imports these. Each returns a new Scene; saving it is the caller's business.
 */
import type { MediaId, Scene } from '../shared/domain.js';

/** Places an image as a new Background on top of the stack. New placements start Hidden. */
export function addBackground(scene: Scene, mediaId: MediaId, id: string): Scene {
  return {
    ...scene,
    backgrounds: [
      ...scene.backgrounds,
      { id, mediaId, fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: false },
    ],
  };
}

/** Shows or hides one Background. */
export function setBackgroundVisible(scene: Scene, backgroundId: string, visible: boolean): Scene {
  return {
    ...scene,
    backgrounds: scene.backgrounds.map((background) =>
      background.id === backgroundId ? { ...background, visible } : background,
    ),
  };
}
