/**
 * Scene edit commands: each edit of a Scene's composition is a plain-data SceneEdit, applied
 * by the app core (core/onAirCommands.ts `editScene`), never by a window. Applying one is pure
 * and returns a new Scene, leaving the old one untouched, so an undo history can keep the
 * Scene before each edit (spec #21, "Scene editing commands and undo").
 *
 * Adding an edit: a variant of SceneEdit (shared/contract.ts), its case in `applySceneEdit`
 * and in `parseSceneEdit`.
 */
import type { OverlayTransform, SceneEdit, TransientEdit } from '../shared/contract.js';
import type {
  Background,
  ImageMedia,
  MediaId,
  NormalizedPoint,
  Overlay,
  Scene,
  SceneAmbience,
} from '../shared/domain.js';
import { CANVAS, clampZoom } from './canvas.js';
import { isRecord } from './guards.js';
import { parseNotes } from './notes.js';

/** A Scene error the Game Master can read (French message). */
export class SceneError extends Error {}

export type { OverlayTransform, SceneEdit, TransientEdit };

export const MAX_SCENE_NAME_LENGTH = 100;

/** Texts longer than this are malformed messages; the MAX_*_LENGTH constants are the real limits. */
const MAX_TEXT_PAYLOAD = 1000;

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

export const MAX_SCENE_TITLE_LENGTH = 100;

/** A Scene title as saved: trimmed, '' for none. Throws a SceneError (French) when too long. */
export function cleanSceneTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length > MAX_SCENE_TITLE_LENGTH) {
    throw new SceneError(
      `Le titre affiché est trop long (${MAX_SCENE_TITLE_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

export const MAX_LABEL_LENGTH = 60;

/** A Label text as saved: trimmed, '' for none. Throws a SceneError (French) when too long. */
export function cleanLabelText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new SceneError(`L’étiquette est trop longue (${MAX_LABEL_LENGTH} caractères au plus).`);
  }
  return trimmed;
}

/** Height of a new Overlay, as a fraction of the canvas height. */
export const NEW_OVERLAY_HEIGHT = 0.5;

/** Smallest and largest Overlay height, as fractions of the canvas height. */
export const MIN_OVERLAY_HEIGHT = 0.05;
export const MAX_OVERLAY_HEIGHT = 2;

/** One arrow-key nudge, in canvas units (Shift: the coarse step). */
const NUDGE_STEP = 10;
const COARSE_NUDGE_STEP = 50;

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Where an Overlay's centre goes when nudged with an arrow key: 10 canvas units that way, 50
 * with Shift (`coarse`), stopping at the canvas edge.
 */
export function nudgedPosition(
  position: NormalizedPoint,
  key: ArrowKey,
  coarse: boolean,
): NormalizedPoint {
  const step = coarse ? COARSE_NUDGE_STEP : NUDGE_STEP;
  const dx = step / CANVAS.width;
  const dy = step / CANVAS.height;
  switch (key) {
    case 'ArrowLeft':
      return { x: clampUnit(position.x - dx), y: position.y };
    case 'ArrowRight':
      return { x: clampUnit(position.x + dx), y: position.y };
    case 'ArrowUp':
      return { x: position.x, y: clampUnit(position.y - dy) };
    case 'ArrowDown':
      return { x: position.x, y: clampUnit(position.y + dy) };
  }
}

/** A height kept between the smallest and the largest Overlay height. */
export function clampOverlayHeight(height: number): number {
  return Math.min(MAX_OVERLAY_HEIGHT, Math.max(MIN_OVERLAY_HEIGHT, height));
}

/** Where an Overlay is and how high it is (canvas fractions). */
export type OverlayBox = Pick<Overlay, 'position' | 'height'>;

/**
 * An Overlay resized by dragging its bottom-right corner to `corner` (canvas fractions, may be
 * off the canvas): proportions kept (`aspect` is the image's width over its height), its
 * top-left corner staying put, as far as whichever of the pointer's two directions goes
 * further. The height stays between the smallest and the largest Overlay height.
 */
export function resizedOverlay(
  overlay: OverlayBox,
  aspect: number,
  corner: NormalizedPoint,
): OverlayBox {
  const height = overlay.height * CANVAS.height;
  const width = height * aspect;
  const left = overlay.position.x * CANVAS.width - width / 2;
  const top = overlay.position.y * CANVAS.height - height / 2;
  const wanted = Math.max(
    corner.y * CANVAS.height - top,
    (corner.x * CANVAS.width - left) / aspect,
  );
  const newHeight = clampOverlayHeight(wanted / CANVAS.height) * CANVAS.height;
  return {
    position: onCanvas({
      x: (left + (newHeight * aspect) / 2) / CANVAS.width,
      y: (top + newHeight / 2) / CANVAS.height,
    }),
    height: newHeight / CANVAS.height,
  };
}

/**
 * The Media an edit adds to the Scene and what that Media must be: an image for a placement,
 * Music for the Music list, an Ambience for the Ambiences. The caller checks the library
 * (core/onAirCommands.ts).
 */
export function addedMedia(
  edit: SceneEdit,
): { mediaId: MediaId; kind: 'image' | 'music' | 'ambience' } | undefined {
  if (edit.kind === 'place-background' || edit.kind === 'place-overlay') {
    return { mediaId: edit.mediaId, kind: 'image' };
  }
  if (edit.kind === 'add-ambience') return { mediaId: edit.mediaId, kind: 'ambience' };
  return edit.kind === 'add-music' ? { mediaId: edit.mediaId, kind: 'music' } : undefined;
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

/** The Scene with Overlay `overlayId` changed by `change`; a SceneError when it is not there. */
function withOverlay(
  scene: Scene,
  overlayId: string,
  change: (overlay: Overlay) => Overlay,
): Scene {
  if (!scene.overlays.some((item) => item.id === overlayId)) {
    throw new SceneError('Cet élément n’est plus sur la scène.');
  }
  return {
    ...scene,
    overlays: scene.overlays.map((item) => (item.id === overlayId ? change(item) : item)),
  };
}

/** The Scene with Background `placementId` changed by `change`; throws if it is not there. */
function withBackground(
  scene: Scene,
  placementId: string,
  change: (background: Background) => Background,
): Scene {
  if (!scene.backgrounds.some((item) => item.id === placementId)) {
    throw new SceneError('Cet arrière-plan n’est plus sur la scène.');
  }
  return {
    ...scene,
    backgrounds: scene.backgrounds.map((item) => (item.id === placementId ? change(item) : item)),
  };
}

function onCanvas({ x, y }: NormalizedPoint): NormalizedPoint {
  return { x: clampUnit(x), y: clampUnit(y) };
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
    case 'move-background': {
      const moving = scene.backgrounds.find((item) => item.id === edit.placementId);
      if (!moving) throw new SceneError('Cet arrière-plan n’est plus sur la scène.');
      const backgrounds = scene.backgrounds.filter((item) => item !== moving);
      backgrounds.splice(Math.min(edit.toIndex, backgrounds.length), 0, moving);
      return { ...scene, backgrounds };
    }
    case 'set-background-fit':
      return withBackground(scene, edit.placementId, (item) => ({ ...item, fit: edit.fit }));
    case 'frame-background':
      return withBackground(scene, edit.placementId, (item) => ({
        ...item,
        zoom: edit.zoom === undefined ? item.zoom : clampZoom(edit.zoom),
        focus: { x: edit.focus?.x ?? item.focus.x, y: edit.focus?.y ?? item.focus.y },
      }));
    case 'transform-overlay':
      return withOverlay(scene, edit.placementId, (item) => ({
        ...item,
        position: onCanvas({
          x: edit.position?.x ?? item.position.x,
          y: edit.position?.y ?? item.position.y,
        }),
        height: edit.height === undefined ? item.height : clampOverlayHeight(edit.height),
      }));
    case 'move-overlay': {
      const moving = scene.overlays.find((item) => item.id === edit.placementId);
      if (!moving) throw new SceneError('Cet élément n’est plus sur la scène.');
      const overlays = scene.overlays.filter((item) => item !== moving);
      overlays.splice(Math.min(edit.toIndex, overlays.length), 0, moving);
      return { ...scene, overlays };
    }
    case 'rename':
      return { ...scene, name: cleanSceneName(edit.name) };
    case 'set-title':
      return { ...scene, title: cleanSceneTitle(edit.title) };
    case 'set-label-text': {
      const text = cleanLabelText(edit.text);
      return withOverlay(scene, edit.overlayId, ({ label, ...overlay }) =>
        text ? { ...overlay, label: { text, visible: label?.visible ?? false } } : overlay,
      );
    }
    case 'set-label-visible': {
      const { visible } = edit;
      return withOverlay(scene, edit.overlayId, (overlay) => {
        if (!overlay.label) throw new SceneError('Donnez d’abord un texte à l’étiquette.');
        return { ...overlay, label: { ...overlay.label, visible } };
      });
    }
    case 'add-music':
      if (scene.music.includes(edit.mediaId)) {
        throw new SceneError('Cette musique est déjà dans la scène.');
      }
      return { ...scene, music: [...scene.music, edit.mediaId] };
    case 'move-music': {
      const music = withoutMusic(scene, edit.mediaId);
      music.splice(Math.min(edit.toIndex, music.length), 0, edit.mediaId);
      return { ...scene, music };
    }
    case 'remove-music':
      return { ...scene, music: withoutMusic(scene, edit.mediaId) };
    case 'set-music-level':
      return { ...scene, volumes: { ...scene.volumes, music: edit.level } };
    case 'add-ambience':
      if (scene.ambiences.some((item) => item.mediaId === edit.mediaId)) {
        throw new SceneError('Cette ambiance est déjà dans la scène.');
      }
      return {
        ...scene,
        ambiences: [...scene.ambiences, { mediaId: edit.mediaId, on: false, volume: 1 }],
      };
    case 'remove-ambience':
      checkAmbienceListed(scene, edit.mediaId);
      return {
        ...scene,
        ambiences: scene.ambiences.filter((item) => item.mediaId !== edit.mediaId),
      };
    case 'set-ambience-on':
      return withAmbience(scene, edit.mediaId, (item) => ({ ...item, on: edit.on }));
    case 'set-ambience-volume':
      return withAmbience(scene, edit.mediaId, (item) => ({ ...item, volume: edit.volume }));
    case 'set-ambience-level':
      return { ...scene, volumes: { ...scene.volumes, ambience: edit.level } };
    case 'set-notes':
      return { ...scene, notes: edit.notes };
  }
}

/** Throws a SceneError unless the Scene lists an Ambience of Media `mediaId`. */
function checkAmbienceListed(scene: Scene, mediaId: MediaId) {
  if (!scene.ambiences.some((item) => item.mediaId === mediaId)) {
    throw new SceneError('Cette ambiance n’est plus dans la scène.');
  }
}

/** The Scene with its Ambience of Media `mediaId` changed by `change`; throws if not listed. */
function withAmbience(
  scene: Scene,
  mediaId: MediaId,
  change: (item: SceneAmbience) => SceneAmbience,
): Scene {
  checkAmbienceListed(scene, mediaId);
  return {
    ...scene,
    ambiences: scene.ambiences.map((item) => (item.mediaId === mediaId ? change(item) : item)),
  };
}

/** The Scene's Music list without `mediaId`; a SceneError when it is not listed. */
function withoutMusic(scene: Scene, mediaId: MediaId): MediaId[] {
  if (!scene.music.includes(mediaId)) {
    throw new SceneError('Cette musique n’est plus dans la scène.');
  }
  return scene.music.filter((item) => item !== mediaId);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Text of a sane size for a message; the clean* functions apply the real limits. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_PAYLOAD;
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parsePoint(value: unknown): NormalizedPoint | undefined {
  return isRecord(value) && isUnit(value.x) && isUnit(value.y)
    ? { x: value.x, y: value.y }
    : undefined;
}

function isOverlayHeight(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_OVERLAY_HEIGHT && value <= MAX_OVERLAY_HEIGHT;
}

/**
 * A transient update of a live drag from untrusted data: a transform of an Overlay, a framing
 * of a Background or a Scene's Music level, keeping only its fields; or undefined.
 */
export function parseTransientEdit(value: unknown): TransientEdit | undefined {
  const edit = parseSceneEdit(value);
  const transient =
    edit?.kind === 'transform-overlay' ||
    edit?.kind === 'frame-background' ||
    edit?.kind === 'set-music-level';
  return transient ? edit : undefined;
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
      const position = parsePoint(value.position);
      return position && { kind: 'place-overlay', mediaId: value.mediaId, position };
    }
    case 'set-visible':
      if (!isId(value.placementId) || typeof value.visible !== 'boolean') return undefined;
      return { kind: 'set-visible', placementId: value.placementId, visible: value.visible };
    case 'remove-placement':
      return isId(value.placementId)
        ? { kind: 'remove-placement', placementId: value.placementId }
        : undefined;
    case 'move-background': {
      const { placementId, toIndex } = value;
      if (!isId(placementId) || typeof toIndex !== 'number') return undefined;
      if (!Number.isSafeInteger(toIndex) || toIndex < 0) return undefined;
      return { kind: 'move-background', placementId, toIndex };
    }
    case 'set-background-fit': {
      const { placementId, fit } = value;
      if (!isId(placementId) || (fit !== 'cover' && fit !== 'contain')) return undefined;
      return { kind: 'set-background-fit', placementId, fit };
    }
    case 'frame-background': {
      const { placementId, zoom, focus } = value;
      if (!isId(placementId)) return undefined;
      const edit: Extract<SceneEdit, { kind: 'frame-background' }> = {
        kind: 'frame-background',
        placementId,
      };
      if (zoom !== undefined) {
        if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return undefined;
        edit.zoom = zoom;
      }
      if (focus !== undefined) {
        if (!isRecord(focus)) return undefined;
        const { x, y } = focus;
        if ((x !== undefined && !isUnit(x)) || (y !== undefined && !isUnit(y))) return undefined;
        edit.focus = { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) };
      }
      return edit;
    }
    case 'transform-overlay': {
      const { placementId, position, height } = value;
      if (!isId(placementId)) return undefined;
      const edit: OverlayTransform = { kind: 'transform-overlay', placementId };
      if (position !== undefined) {
        if (!isRecord(position)) return undefined;
        const { x, y } = position;
        if ((x !== undefined && !isUnit(x)) || (y !== undefined && !isUnit(y))) return undefined;
        edit.position = { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) };
      }
      if (height !== undefined) {
        if (!isOverlayHeight(height)) return undefined;
        edit.height = height;
      }
      return edit;
    }
    case 'move-overlay': {
      const { placementId, toIndex } = value;
      if (!isId(placementId) || typeof toIndex !== 'number') return undefined;
      if (!Number.isSafeInteger(toIndex) || toIndex < 0) return undefined;
      return { kind: 'move-overlay', placementId, toIndex };
    }
    case 'rename':
      if (!isText(value.name)) return undefined;
      return { kind: 'rename', name: value.name };
    case 'set-title':
      if (!isText(value.title)) return undefined;
      return { kind: 'set-title', title: value.title };
    case 'set-label-text':
      if (!isId(value.overlayId) || !isText(value.text)) return undefined;
      return { kind: 'set-label-text', overlayId: value.overlayId, text: value.text };
    case 'set-label-visible':
      if (!isId(value.overlayId) || typeof value.visible !== 'boolean') return undefined;
      return { kind: 'set-label-visible', overlayId: value.overlayId, visible: value.visible };
    case 'add-music':
      return isId(value.mediaId) ? { kind: 'add-music', mediaId: value.mediaId } : undefined;
    case 'add-ambience':
    case 'remove-ambience':
      return isId(value.mediaId) ? { kind: value.kind, mediaId: value.mediaId } : undefined;
    case 'set-ambience-on':
      if (!isId(value.mediaId) || typeof value.on !== 'boolean') return undefined;
      return { kind: 'set-ambience-on', mediaId: value.mediaId, on: value.on };
    case 'set-ambience-volume':
      if (!isId(value.mediaId) || !isUnit(value.volume)) return undefined;
      return { kind: 'set-ambience-volume', mediaId: value.mediaId, volume: value.volume };
    case 'set-ambience-level':
      return isUnit(value.level) ? { kind: 'set-ambience-level', level: value.level } : undefined;
    case 'move-music': {
      const { mediaId, toIndex } = value;
      if (!isId(mediaId) || typeof toIndex !== 'number') return undefined;
      if (!Number.isSafeInteger(toIndex) || toIndex < 0) return undefined;
      return { kind: 'move-music', mediaId, toIndex };
    }
    case 'remove-music':
      return isId(value.mediaId) ? { kind: 'remove-music', mediaId: value.mediaId } : undefined;
    case 'set-music-level':
      return isUnit(value.level) ? { kind: 'set-music-level', level: value.level } : undefined;
    case 'set-notes': {
      const notes = parseNotes(value.notes);
      return notes && { kind: 'set-notes', notes };
    }
    default:
      return undefined;
  }
}
