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
import type { ImageMedia, MediaId, NormalizedPoint, Overlay, Scene } from '../shared/domain.js';
import { isRecord } from './guards.js';

/** A Scene error the Game Master can read (French message). */
export class SceneError extends Error {}

export type { SceneEdit };

export const MAX_SCENE_NAME_LENGTH = 100;

/** Names longer than this are malformed messages; MAX_SCENE_NAME_LENGTH is the real limit. */
const MAX_NAME_PAYLOAD = 1000;

/** A Scene name as saved: trimmed. Throws a SceneError (French) when empty or too long. */
export function cleanSceneName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new SceneError('Donnez un nom à la scène.');
  if (trimmed.length > MAX_SCENE_NAME_LENGTH) {
    throw new SceneError(
      `Le nom de la scène est trop long (${MAX_SCENE_NAME_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

/** Height of a new Overlay, as a fraction of the canvas height. */
export const NEW_OVERLAY_HEIGHT = 0.5;

/** Whether an edit places a Media (whose existence the caller checks). */
export function placedMedia(edit: SceneEdit): MediaId | undefined {
  return edit.kind === 'place-background' || edit.kind === 'place-overlay'
    ? edit.mediaId
    : undefined;
}

/**
 * Where an image is dropped in the editor: on the canvas (placed by its Image category), or on
 * the Background list or the Overlay list (placed as that type, whatever its category).
 */
export type PlacementTarget = 'canvas' | 'backgrounds' | 'overlays';

/**
 * The edit that places `image` dropped on `target`. On the canvas, Scenery becomes a Background
 * and a Character an Overlay centred on `dropPoint` (canvas fractions; a point on the black bars
 * is moved to the nearest canvas edge). On a list, it becomes that type; an Overlay then goes to
 * the canvas centre. Every drag-and-drop placement (library or Explorer) goes through here.
 */
export function placementEdit(
  image: ImageMedia,
  target: PlacementTarget,
  dropPoint?: NormalizedPoint,
): SceneEdit {
  switch (target) {
    case 'backgrounds':
      return { kind: 'place-background', mediaId: image.id };
    case 'overlays':
      return { kind: 'place-overlay', mediaId: image.id };
    case 'canvas':
      switch (image.category) {
        case 'scenery':
          return { kind: 'place-background', mediaId: image.id };
        case 'character':
          return dropPoint
            ? {
                kind: 'place-overlay',
                mediaId: image.id,
                position: { x: clampUnit(dropPoint.x), y: clampUnit(dropPoint.y) },
              }
            : { kind: 'place-overlay', mediaId: image.id };
      }
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isOnScene(scene: Scene, placementId: string): boolean {
  return (
    scene.backgrounds.some((item) => item.id === placementId) ||
    scene.overlays.some((item) => item.id === placementId)
  );
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
      if (!isOnScene(scene, placementId)) {
        throw new SceneError('Cet élément n’est plus sur la scène.');
      }
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
    case 'remove-placement': {
      const { placementId } = edit;
      if (!isOnScene(scene, placementId)) {
        throw new SceneError('Cet élément n’est plus sur la scène.');
      }
      return {
        ...scene,
        backgrounds: scene.backgrounds.filter((item) => item.id !== placementId),
        overlays: scene.overlays.filter((item) => item.id !== placementId),
      };
    }
    case 'rename':
      return { ...scene, name: cleanSceneName(edit.name) };
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
    case 'remove-placement':
      return isId(value.placementId)
        ? { kind: 'remove-placement', placementId: value.placementId }
        : undefined;
    case 'rename':
      if (typeof value.name !== 'string' || value.name.length > MAX_NAME_PAYLOAD) return undefined;
      return { kind: 'rename', name: value.name };
    default:
      return undefined;
  }
}
