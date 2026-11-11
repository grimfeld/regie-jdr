/**
 * Scenes of a Campaign: storage and validation. No Electron dependency.
 *
 * On disk, in the Campaign's folder: `scenes.json` ({ scenes: Scene[], chapters: Chapter[] },
 * versioned document), Scenes stored without their Campaign id (the folder gives it), in running
 * order, beside the Chapters grouping them (core/runningOrder.ts).
 * Errors meant for the Game Master are SceneError with a French message.
 *
 * A Scene whose stored Notes cannot be read keeps its other fields with empty Notes; the rest of
 * the document loads as usual. The unreadable Notes are kept as they were in a file of the
 * Campaign folder, `notes-illisibles-<Scene id>-<time>.json`, and the Game Master is told where.
 */
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunningOrder, RunningOrderEdit } from '../shared/contract.js';
import type {
  Background,
  BackgroundFit,
  CampaignId,
  Chapter,
  Label,
  MediaId,
  NormalizedPoint,
  Overlay,
  Scene,
  SceneAmbience,
  SceneId,
} from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { createKeyedSerialQueue } from './serialQueue.js';
import type { DocumentType, Storage } from './storage/index.js';
import { isRecord } from './guards.js';
import {
  emptyNotes,
  mediaOfNotes,
  notesFromPlainText,
  notesKeepingImages,
  parseNotes,
} from './notes.js';
import {
  applyRunningOrderEdit,
  inRunningOrder,
  parseChapter,
  runningOrderOf,
  withCopy,
  withNewScene,
  type ScenesInOrder,
} from './runningOrder.js';
import {
  cleanSceneName,
  isTransitionKind,
  MAX_SCENE_NAME_LENGTH,
  SceneError,
} from './sceneEdits.js';

// Defined with the Scene edit commands, which the windows may run (no Node there).
export { SceneError };

export interface SceneLibrary {
  /** The Campaign's Scenes, in running order. */
  list(campaignId: CampaignId): Promise<Scene[]>;
  /** The Scene, or undefined if it does not exist. */
  get(campaignId: CampaignId, sceneId: SceneId): Promise<Scene | undefined>;
  /**
   * Removes every use of a Media from the Campaign's Scenes, its placements (Backgrounds,
   * Overlays, music, Ambiences) and its images in the Notes, and returns the Scenes that changed,
   * as saved.
   */
  removeMediaUses(campaignId: CampaignId, mediaId: MediaId): Promise<Scene[]>;
  /**
   * A new, empty Scene: last in the Chapter of the Selected Scene `selectedSceneId`, or last in
   * no Chapter when it has none (core/runningOrder.ts `withNewScene`).
   */
  create(campaignId: CampaignId, name: string, selectedSceneId?: SceneId): Promise<Scene>;
  /** Deletes a Scene; throws a SceneError when it does not exist. */
  delete(campaignId: CampaignId, sceneId: SceneId): Promise<void>;
  /** Replaces a stored Scene (found by Campaign and id) and returns what was saved. */
  save(scene: Scene): Promise<Scene>;
  /** The Campaign's running order: its Scene ids in order and its Chapters. */
  runningOrder(campaignId: CampaignId): Promise<RunningOrder>;
  /**
   * Applies one running order command (Chapters, a Scene's place) and returns the running order
   * as saved. Changes no Scene. Throws a SceneError for an unknown Scene or Chapter.
   */
  editRunningOrder(campaignId: CampaignId, edit: RunningOrderEdit): Promise<RunningOrder>;
  /**
   * Saves a copy of a Scene (`copyOfScene`) right after it in the running order, in its
   * Chapter, and returns the copy. Throws a SceneError when the Scene does not exist.
   */
  duplicate(campaignId: CampaignId, sceneId: SceneId): Promise<Scene>;
}

const SCENES_FILE = 'scenes.json';
const BACKGROUND_FITS: readonly BackgroundFit[] = ['cover', 'contain'];

// Parsing ------------------------------------------------------------------

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parsePoint(value: unknown): NormalizedPoint | undefined {
  if (!isRecord(value) || !isUnit(value.x) || !isUnit(value.y)) return undefined;
  return { x: value.x, y: value.y };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseBackground(value: unknown): Background | undefined {
  if (!isRecord(value)) return undefined;
  const { id, mediaId, fit, zoom, visible } = value;
  const focus = parsePoint(value.focus);
  if (!isId(id) || !isId(mediaId) || !focus || typeof visible !== 'boolean') return undefined;
  if (typeof fit !== 'string' || !(BACKGROUND_FITS as readonly string[]).includes(fit)) {
    return undefined;
  }
  if (!isPositive(zoom)) return undefined;
  return { id, mediaId, fit: fit as BackgroundFit, zoom, focus, visible };
}

function parseLabel(value: unknown): Label | undefined {
  if (!isRecord(value)) return undefined;
  const { text, visible } = value;
  if (typeof text !== 'string' || typeof visible !== 'boolean') return undefined;
  return { text, visible };
}

function parseOverlay(value: unknown): Overlay | undefined {
  if (!isRecord(value)) return undefined;
  const { id, mediaId, height, visible } = value;
  const position = parsePoint(value.position);
  if (!isId(id) || !isId(mediaId) || !position || typeof visible !== 'boolean') return undefined;
  if (!isPositive(height)) return undefined;
  const label = value.label === undefined ? undefined : parseLabel(value.label);
  if (value.label !== undefined && !label) return undefined;
  return { id, mediaId, position, height, visible, ...(label && { label }) };
}

function parseAmbience(value: unknown): SceneAmbience | undefined {
  if (!isRecord(value)) return undefined;
  const { mediaId, on, volume } = value;
  if (!isId(mediaId) || typeof on !== 'boolean' || !isUnit(volume)) return undefined;
  return { mediaId, on, volume };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map(parse);
  return parsed.some((item) => item === undefined) ? undefined : (parsed as T[]);
}

/**
 * A Scene from untrusted data (a stored document or a window message), keeping only Scene
 * fields, or undefined if anything is malformed. `campaignId` is attached, not read.
 */
export function parseScene(value: unknown, campaignId: CampaignId): Scene | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, title, volumes, transition } = value;
  const notes = parseNotes(value.notes);
  if (!isId(id) || typeof name !== 'string' || !notes) return undefined;
  if (!isTransitionKind(transition)) return undefined;
  if (typeof title !== 'string') return undefined;
  if (!isRecord(volumes) || !isUnit(volumes.music) || !isUnit(volumes.ambience)) return undefined;
  const backgrounds = parseList(value.backgrounds, parseBackground);
  const overlays = parseList(value.overlays, parseOverlay);
  const music = parseList(value.music, (item) => (isId(item) ? item : undefined));
  const ambiences = parseList(value.ambiences, parseAmbience);
  if (!backgrounds || !overlays || !music || !ambiences) return undefined;
  return {
    id,
    campaignId,
    name,
    title,
    backgrounds,
    overlays,
    music,
    ambiences,
    volumes: { music: volumes.music, ambience: volumes.ambience },
    notes,
    transition,
  };
}

// Media placements -----------------------------------------------------------

/** Every Media a Scene places (Backgrounds, Overlays, music, Ambiences). */
export function mediaOfScene(scene: Scene): MediaId[] {
  return [
    ...scene.backgrounds.map((item) => item.mediaId),
    ...scene.overlays.map((item) => item.mediaId),
    ...scene.music,
    ...scene.ambiences.map((item) => item.mediaId),
  ];
}

/** Whether a Scene places a Media anywhere (Background, Overlay, music, Ambience). */
export function sceneUsesMedia(scene: Scene, mediaId: MediaId): boolean {
  return mediaOfScene(scene).includes(mediaId);
}

/** Whether a Scene's Notes show a Media as an image: a use, though never on air. */
export function notesUseMedia(scene: Scene, mediaId: MediaId): boolean {
  return mediaOfNotes(scene.notes).includes(mediaId);
}

/** A Scene without any use of a Media: its placements and its images in the Notes. */
function withoutMedia(scene: Scene, mediaId: MediaId): Scene {
  return {
    ...scene,
    notes: notesKeepingImages(scene.notes, (id) => id !== mediaId),
    backgrounds: scene.backgrounds.filter((item) => item.mediaId !== mediaId),
    overlays: scene.overlays.filter((item) => item.mediaId !== mediaId),
    music: scene.music.filter((item) => item !== mediaId),
    ambiences: scene.ambiences.filter((item) => item.mediaId !== mediaId),
  };
}

// Copies -------------------------------------------------------------------

const COPY_SUFFIX = ' (copie)';

/**
 * An independent copy of a Scene: every field deep-copied, so editing the copy never changes
 * the source; a new Scene id and new placement ids (from `newId`); the same Media references,
 * so no Media file is copied; named "<name> (copie)", the name shortened to fit the limit.
 * tests/unit/scenes.test.ts lists every Scene field, so a new one is a decision there.
 */
export function copyOfScene(source: Scene, newId: () => string): Scene {
  const copy = structuredClone(source);
  const base = copy.name.slice(0, MAX_SCENE_NAME_LENGTH - COPY_SUFFIX.length).trimEnd();
  return {
    ...copy,
    id: newId(),
    name: `${base}${COPY_SUFFIX}`,
    backgrounds: copy.backgrounds.map((item) => ({ ...item, id: newId() })),
    overlays: copy.overlays.map((item) => ({ ...item, id: newId() })),
  };
}

// Storage ------------------------------------------------------------------

type StoredScene = Omit<Scene, 'campaignId'>;

/** Notes of a stored Scene that could not be read, as they were stored. Never written back. */
interface UnreadableNotes {
  sceneId: SceneId;
  sceneName: string;
  notes: unknown;
}

/**
 * The Scenes of a document; `unreadableNotes` (read only, never written) lists the Scenes kept
 * with empty Notes because theirs could not be read.
 */
interface ScenesFields {
  scenes: StoredScene[];
  chapters: Chapter[];
  unreadableNotes?: UnreadableNotes[];
}

function stored({ campaignId: _campaignId, ...scene }: Scene): StoredScene {
  return scene;
}

/**
 * Version 1 (Milestone 0) to 2 (Milestone 1): Scenes gain an empty Scene title; Backgrounds
 * gain a zoom of 1, their position becomes the focal point, and Stretch becomes Cover;
 * Overlays are stacked by array order instead of `zIndex`, `scale` becomes `height`, and a
 * Label becomes a Hidden Label (none was ever shown to players).
 */
function migrateScenesV1(fields: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(fields.scenes)) return fields;
  const scenes = fields.scenes.map((scene: unknown) => {
    if (!isRecord(scene)) return scene;
    const backgrounds = Array.isArray(scene.backgrounds)
      ? scene.backgrounds.map((item: unknown) => {
          if (!isRecord(item)) return item;
          const { position, fit, ...rest } = item;
          return { ...rest, fit: fit === 'stretch' ? 'cover' : fit, zoom: 1, focus: position };
        })
      : scene.backgrounds;
    const overlays = Array.isArray(scene.overlays)
      ? [...(scene.overlays as unknown[])]
          .sort((a: unknown, b: unknown) => zIndexOf(a) - zIndexOf(b))
          .map((item: unknown) => {
            if (!isRecord(item)) return item;
            const { scale, zIndex: _zIndex, label, ...rest } = item;
            return {
              ...rest,
              height: scale,
              ...(typeof label === 'string' && { label: { text: label, visible: false } }),
            };
          })
      : scene.overlays;
    return { ...scene, title: '', backgrounds, overlays };
  });
  return { ...fields, scenes };
}

/**
 * Version 2 (Milestones 1 and 2) to 3 (Milestone 3): plain-text Notes become rich text, one
 * paragraph per line (ADR-0004).
 */
function migrateScenesV2(fields: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(fields.scenes)) return fields;
  const scenes = fields.scenes.map((scene: unknown) =>
    isRecord(scene) && typeof scene.notes === 'string'
      ? { ...scene, notes: notesFromPlainText(scene.notes) }
      : scene,
  );
  return { ...fields, scenes };
}

/** Version 3 to 4 (Milestone 3): every Scene gets its entry Transition, Crossfade. */
function migrateScenesV3(fields: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(fields.scenes)) return fields;
  const scenes = fields.scenes.map((scene: unknown) =>
    isRecord(scene) ? { ...scene, transition: 'crossfade' } : scene,
  );
  return { ...fields, scenes };
}

/** Version 4 to 5 (Milestone 4): the running order gains Chapters, none to start with. */
function migrateScenesV4(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields, chapters: [] };
}

function zIndexOf(item: unknown): number {
  return isRecord(item) && typeof item.zIndex === 'number' ? item.zIndex : 0;
}

export const scenesDocument: DocumentType<ScenesFields> = {
  name: 'scenes',
  version: 5,
  migrations: { 1: migrateScenesV1, 2: migrateScenesV2, 3: migrateScenesV3, 4: migrateScenesV4 },
  parse({ scenes, chapters }) {
    const unreadableNotes: UnreadableNotes[] = [];
    const parsed = parseList(scenes, (item) => {
      const scene = parseScene(item, '');
      if (scene || !isRecord(item)) return scene;
      // Only its Notes unreadable: the Scene stays, with empty Notes.
      const kept = parseScene({ ...item, notes: emptyNotes() }, '');
      if (kept) unreadableNotes.push({ sceneId: kept.id, sceneName: kept.name, notes: item.notes });
      return kept;
    });
    const parsedChapters = parseList(chapters, parseChapter);
    if (!parsed || !parsedChapters) return undefined;
    const order = inRunningOrder(parsed.map(stored), parsedChapters);
    return unreadableNotes.length > 0 ? { ...order, unreadableNotes } : order;
  },
};

export interface SceneLibraryOptions {
  /** Tells the Game Master something went wrong with stored Scenes (plain French sentence). */
  notify?: (message: string) => void;
  /** The clock naming the files unreadable Notes are kept in (Date.now). */
  now?: () => number;
}

export function createSceneLibrary(
  storage: Storage,
  options: SceneLibraryOptions = {},
): SceneLibrary {
  const { notify = () => undefined, now = Date.now } = options;
  /** Serializes the reads and read-modify-writes of each Campaign's Scenes document. */
  const serialized = createKeyedSerialQueue<CampaignId>();

  async function fileOf(campaignId: CampaignId): Promise<string> {
    if (!(await storage.campaigns.get(campaignId))) {
      throw new CampaignError('Cette campagne n’existe plus.');
    }
    return path.join(storage.campaignFolder(campaignId), SCENES_FILE);
  }

  /**
   * The Campaign's Scenes in running order, and its Chapters. Run in the Campaign's queue: it
   * may save them (unreadable Notes).
   */
  async function readOrder(file: string, campaignId: CampaignId): Promise<ScenesInOrder<Scene>> {
    const document = await storage.documents.read(file, scenesDocument);
    const scenes = (document?.scenes ?? []).map((scene) => ({ ...scene, campaignId }));
    const order = { scenes, chapters: document?.chapters ?? [] };
    if (document?.unreadableNotes) {
      await keepUnreadable(path.dirname(file), document.unreadableNotes);
      // Saved with empty Notes, so they are reported once; the document as it was is now the
      // `.bak` too.
      await write(file, order);
    }
    return order;
  }

  /** The Campaign's Scenes in running order (see `readOrder`). */
  async function read(file: string, campaignId: CampaignId): Promise<Scene[]> {
    return (await readOrder(file, campaignId)).scenes;
  }

  /** Keeps each Scene's unreadable Notes in a file of its own, and tells the Game Master. */
  async function keepUnreadable(folder: string, unreadable: readonly UnreadableNotes[]) {
    for (const entry of unreadable) {
      const kept = path.join(folder, `notes-illisibles-${entry.sceneId}-${String(now())}.json`);
      await fsp.writeFile(
        kept,
        `${JSON.stringify(entry, null, 2)}
`,
        { flag: 'wx' },
      );
      notify(
        `Les notes de la scène « ${entry.sceneName} » étaient illisibles : elles sont vides. ` +
          `Leur contenu d’origine est gardé dans ${kept}.`,
      );
    }
  }

  /** Saves the Scenes and Chapters, made consistent (a deleted Scene leaves its Chapter). */
  async function write(file: string, order: ScenesInOrder<Scene>): Promise<void> {
    const { scenes, chapters } = inRunningOrder(order.scenes, order.chapters);
    await storage.documents.write(file, scenesDocument, { scenes: scenes.map(stored), chapters });
  }

  return {
    list(campaignId) {
      return serialized(campaignId, async () => read(await fileOf(campaignId), campaignId));
    },

    async get(campaignId, sceneId) {
      return (await this.list(campaignId)).find((scene) => scene.id === sceneId);
    },

    create(campaignId, name, selectedSceneId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const order = await readOrder(file, campaignId);
        const scene: Scene = {
          id: randomUUID(),
          campaignId,
          name: cleanSceneName(name),
          title: '',
          backgrounds: [],
          overlays: [],
          music: [],
          ambiences: [],
          volumes: { music: 1, ambience: 1 },
          notes: emptyNotes(),
          transition: 'crossfade',
        };
        await write(file, withNewScene(order, scene, selectedSceneId));
        return scene;
      });
    },

    removeMediaUses(campaignId, mediaId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const order = await readOrder(file, campaignId);
        const affected: Scene[] = [];
        const updated = order.scenes.map((scene) => {
          if (!sceneUsesMedia(scene, mediaId) && !notesUseMedia(scene, mediaId)) return scene;
          const cleaned = withoutMedia(scene, mediaId);
          affected.push(cleaned);
          return cleaned;
        });
        if (affected.length > 0) await write(file, { ...order, scenes: updated });
        return affected;
      });
    },

    delete(campaignId, sceneId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const order = await readOrder(file, campaignId);
        const kept = order.scenes.filter((scene) => scene.id !== sceneId);
        if (kept.length === order.scenes.length) {
          throw new SceneError('Cette scène n’existe plus.');
        }
        await write(file, { ...order, scenes: kept });
      });
    },

    save(scene) {
      return serialized(scene.campaignId, async () => {
        const file = await fileOf(scene.campaignId);
        const order = await readOrder(file, scene.campaignId);
        const index = order.scenes.findIndex((existing) => existing.id === scene.id);
        if (index < 0) throw new SceneError('Cette scène n’existe plus.');
        const saved: Scene = { ...scene, name: cleanSceneName(scene.name) };
        order.scenes[index] = saved;
        await write(file, order);
        return saved;
      });
    },

    runningOrder(campaignId) {
      return serialized(campaignId, async () =>
        runningOrderOf(await readOrder(await fileOf(campaignId), campaignId)),
      );
    },

    editRunningOrder(campaignId, edit) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const order = applyRunningOrderEdit(await readOrder(file, campaignId), edit, randomUUID);
        await write(file, order);
        return runningOrderOf(order);
      });
    },

    duplicate(campaignId, sceneId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const order = await readOrder(file, campaignId);
        const source = order.scenes.find((scene) => scene.id === sceneId);
        if (!source) throw new SceneError('Cette scène n’existe plus.');
        const copy = copyOfScene(source, randomUUID);
        await write(file, withCopy(order, copy, sceneId));
        return copy;
      });
    },
  };
}
