/**
 * Scene edit commands: each edit of a Scene's composition is a plain-data SceneEdit, applied
 * by the app core (core/onAirCommands.ts `editScene`), never by a window. Applying one is pure
 * and returns a new Scene, leaving the old one untouched, so an undo history can keep the
 * Scene before each edit (spec #21, "Scene editing commands and undo").
 *
 * Adding an edit: a variant of SceneEdit (shared/contract.ts), its case in `applySceneEdit`
 * and in `parseSceneEdit`.
 */
import type { SceneEdit } from '../shared/contract.js';
import type { MediaId, Overlay, Scene } from '../shared/domain.js';
import { isRecord } from './guards.js';
import { SceneError } from './scenes.js';

export type { SceneEdit };

/** Height of a new Overlay, as a fraction of the canvas height. */
export const NEW_OVERLAY_HEIGHT = 0.5;

/** Whether an edit places a Media (whose existence the caller checks). */
export function placedMedia(edit: SceneEdit): MediaId | undefined {
  return edit.kind === 'place-background' || edit.kind === 'place-overlay'
    ? edit.mediaId
    : undefined;
}

/**
 * The Scene after `edit`. `newId` names new placements. Throws a SceneError when the edit
 * names a placement that is not on the Scene.
 */
export function applySceneEdit(scene: Scene, edit: SceneEdit, newId: () => string): Scene {
  switch (edit.kind) {
    case 'place-background':
      return {
        ...scene,
        backgrounds: [
          ...scene.backgrounds,
          {
            id: newId(),
            mediaId: edit.mediaId,
            fit: 'cover',
            zoom: 1,
            focus: { x: 0.5, y: 0.5 },
            visible: false,
          },
        ],
      };
    case 'place-overlay': {
      const overlay: Overlay = {
        id: newId(),
        mediaId: edit.mediaId,
        position: edit.position ? { ...edit.position } : { x: 0.5, y: 0.5 },
        height: NEW_OVERLAY_HEIGHT,
        visible: false,
      };
      return { ...scene, overlays: [...scene.overlays, overlay] };
    }
    case 'set-visible': {
      const { placementId, visible } = edit;
      const onScene =
        scene.backgrounds.some((item) => item.id === placementId) ||
        scene.overlays.some((item) => item.id === placementId);
      if (!onScene) throw new SceneError('Cet élément n’est plus sur la scène.');
      return {
        ...scene,
        backgrounds: scene.backgrounds.map((item) =>
          item.id === placementId ? { ...item, visible } : item,
        ),
        overlays: scene.overlays.map((item) =>
          item.id === placementId ? { ...item, visible } : item,
        ),
      };
    }
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A SceneEdit from untrusted data (a window message), keeping only its fields; or undefined. */
export function parseSceneEdit(value: unknown): SceneEdit | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'place-background':
      return isId(value.mediaId) ? { kind: 'place-background', mediaId: value.mediaId } : undefined;
    case 'place-overlay': {
      if (!isId(value.mediaId)) return undefined;
      if (value.position === undefined) return { kind: 'place-overlay', mediaId: value.mediaId };
      const { position } = value;
      if (!isRecord(position) || !isUnit(position.x) || !isUnit(position.y)) return undefined;
      return {
        kind: 'place-overlay',
        mediaId: value.mediaId,
        position: { x: position.x, y: position.y },
      };
    }
    case 'set-visible':
      if (!isId(value.placementId) || typeof value.visible !== 'boolean') return undefined;
      return { kind: 'set-visible', placementId: value.placementId, visible: value.visible };
    default:
      return undefined;
  }
}
