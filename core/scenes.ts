/**
 * Scenes of a Campaign: storage and validation. No Electron dependency.
 *
 * On disk, in the Campaign's folder: `scenes.json` ({ scenes: Scene[] }, versioned document),
 * Scenes stored without their Campaign id (the folder gives it), in running order
 * (core/runningOrder.ts).
 * Errors meant for the Game Master are SceneError with a French message.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  Background,
  BackgroundFit,
  CampaignId,
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
import { emptyNotes, notesFromPlainText, parseNotes } from './notes.js';
import { moveInRunningOrder } from './runningOrder.js';
import { cleanSceneName, SceneError } from './sceneEdits.js';

// Defined with the Scene edit commands, which the windows may run (no Node there).
export { SceneError };

export interface SceneLibrary {
  /** The Campaign's Scenes, in running order. */
  list(campaignId: CampaignId): Promise<Scene[]>;
  /** The Scene, or undefined if it does not exist. */
  get(campaignId: CampaignId, sceneId: SceneId): Promise<Scene | undefined>;
  /**
   * Removes every placement of a Media (Backgrounds, Overlays, music, Ambiences) from the
   * Campaign's Scenes and returns the Scenes that changed, as saved.
   */
  removeMediaPlacements(campaignId: CampaignId, mediaId: MediaId): Promise<Scene[]>;
  /** A new, empty Scene, last in the running order. */
  create(campaignId: CampaignId, name: string): Promise<Scene>;
  /** Deletes a Scene; throws a SceneError when it does not exist. */
  delete(campaignId: CampaignId, sceneId: SceneId): Promise<void>;
  /** Replaces a stored Scene (found by Campaign and id) and returns what was saved. */
  save(scene: Scene): Promise<Scene>;
  /**
   * Moves a Scene to `toIndex` in the running order (past the end means last) and returns the
   * Campaign's Scenes in their new order. Changes no Scene. Throws a SceneError when the Scene
   * does not exist.
   */
  move(campaignId: CampaignId, sceneId: SceneId, toIndex: number): Promise<Scene[]>;
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
  const { id, name, title, volumes } = value;
  const notes = parseNotes(value.notes);
  if (!isId(id) || typeof name !== 'string' || !notes) return undefined;
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

function withoutMedia(scene: Scene, mediaId: MediaId): Scene {
  return {
    ...scene,
    backgrounds: scene.backgrounds.filter((item) => item.mediaId !== mediaId),
    overlays: scene.overlays.filter((item) => item.mediaId !== mediaId),
    music: scene.music.filter((item) => item !== mediaId),
    ambiences: scene.ambiences.filter((item) => item.mediaId !== mediaId),
  };
}

// Storage ------------------------------------------------------------------

type StoredScene = Omit<Scene, 'campaignId'>;

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

function zIndexOf(item: unknown): number {
  return isRecord(item) && typeof item.zIndex === 'number' ? item.zIndex : 0;
}

const scenesDocument: DocumentType<{ scenes: StoredScene[] }> = {
  name: 'scenes',
  version: 3,
  migrations: { 1: migrateScenesV1, 2: migrateScenesV2 },
  parse({ scenes }) {
    const parsed = parseList(scenes, (item) => parseScene(item, ''));
    return parsed && { scenes: parsed.map(stored) };
  },
};

export function createSceneLibrary(storage: Storage): SceneLibrary {
  /** Serializes the read-modify-write of each Campaign's Scenes document. */
  const serialized = createKeyedSerialQueue<CampaignId>();

  async function fileOf(campaignId: CampaignId): Promise<string> {
    if (!(await storage.campaigns.get(campaignId))) {
      throw new CampaignError('Cette campagne n’existe plus.');
    }
    return path.join(storage.campaignFolder(campaignId), SCENES_FILE);
  }

  async function read(file: string, campaignId: CampaignId): Promise<Scene[]> {
    const document = await storage.documents.read(file, scenesDocument);
    return (document?.scenes ?? []).map((scene) => ({ ...scene, campaignId }));
  }

  async function write(file: string, scenes: Scene[]): Promise<void> {
    await storage.documents.write(file, scenesDocument, { scenes: scenes.map(stored) });
  }

  return {
    async list(campaignId) {
      return read(await fileOf(campaignId), campaignId);
    },

    async get(campaignId, sceneId) {
      return (await this.list(campaignId)).find((scene) => scene.id === sceneId);
    },

    create(campaignId, name) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const scenes = await read(file, campaignId);
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
        };
        await write(file, [...scenes, scene]);
        return scene;
      });
    },

    removeMediaPlacements(campaignId, mediaId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const scenes = await read(file, campaignId);
        const affected: Scene[] = [];
        const updated = scenes.map((scene) => {
          if (!sceneUsesMedia(scene, mediaId)) return scene;
          const cleaned = withoutMedia(scene, mediaId);
          affected.push(cleaned);
          return cleaned;
        });
        if (affected.length > 0) await write(file, updated);
        return affected;
      });
    },

    delete(campaignId, sceneId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const scenes = await read(file, campaignId);
        const kept = scenes.filter((scene) => scene.id !== sceneId);
        if (kept.length === scenes.length) throw new SceneError('Cette scène n’existe plus.');
        await write(file, kept);
      });
    },

    save(scene) {
      return serialized(scene.campaignId, async () => {
        const file = await fileOf(scene.campaignId);
        const scenes = await read(file, scene.campaignId);
        const index = scenes.findIndex((existing) => existing.id === scene.id);
        if (index < 0) throw new SceneError('Cette scène n’existe plus.');
        const saved: Scene = { ...scene, name: cleanSceneName(scene.name) };
        scenes[index] = saved;
        await write(file, scenes);
        return saved;
      });
    },

    move(campaignId, sceneId, toIndex) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const scenes = await read(file, campaignId);
        if (!scenes.some((scene) => scene.id === sceneId)) {
          throw new SceneError('Cette scène n’existe plus.');
        }
        const moved = moveInRunningOrder(scenes, sceneId, toIndex);
        await write(file, moved);
        return moved;
      });
    },
  };
}
