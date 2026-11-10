/**
 * Scenes of a Campaign: storage and validation. No Electron dependency.
 *
 * On disk, in the Campaign's folder: `scenes.json` ({ scenes: Scene[] }, versioned document),
 * Scenes stored without their Campaign id (the folder gives it), in creation order.
 * Errors meant for the Game Master are SceneError with a French message.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  Background,
  BackgroundFit,
  CampaignId,
  NormalizedPoint,
  Overlay,
  Scene,
  SceneAmbience,
  SceneId,
} from '../shared/domain.js';
import type { DocumentType, Storage } from './storage/index.js';

export class SceneError extends Error {}

export interface SceneLibrary {
  /** The Campaign's Scenes, in creation order. */
  list(campaignId: CampaignId): Promise<Scene[]>;
  /** The Scene, or undefined if it does not exist. */
  get(campaignId: CampaignId, sceneId: SceneId): Promise<Scene | undefined>;
  /** A new, empty Scene. */
  create(campaignId: CampaignId, name: string): Promise<Scene>;
  /** Replaces a stored Scene (found by Campaign and id) and returns what was saved. */
  save(scene: Scene): Promise<Scene>;
}

export const MAX_SCENE_NAME_LENGTH = 100;
const SCENES_FILE = 'scenes.json';
const BACKGROUND_FITS: readonly BackgroundFit[] = ['cover', 'contain', 'stretch'];

// Parsing ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function parseBackground(value: unknown): Background | undefined {
  if (!isRecord(value)) return undefined;
  const { id, mediaId, fit, visible } = value;
  const position = parsePoint(value.position);
  if (!isId(id) || !isId(mediaId) || !position || typeof visible !== 'boolean') return undefined;
  if (typeof fit !== 'string' || !(BACKGROUND_FITS as readonly string[]).includes(fit)) {
    return undefined;
  }
  return { id, mediaId, fit: fit as BackgroundFit, position, visible };
}

function parseOverlay(value: unknown): Overlay | undefined {
  if (!isRecord(value)) return undefined;
  const { id, mediaId, scale, zIndex, visible, label } = value;
  const position = parsePoint(value.position);
  if (!isId(id) || !isId(mediaId) || !position || typeof visible !== 'boolean') return undefined;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return undefined;
  if (typeof zIndex !== 'number' || !Number.isFinite(zIndex)) return undefined;
  if (label !== undefined && typeof label !== 'string') return undefined;
  return { id, mediaId, position, scale, zIndex, visible, ...(label !== undefined && { label }) };
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
  const { id, name, notes, volumes } = value;
  if (!isId(id) || typeof name !== 'string' || typeof notes !== 'string') return undefined;
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
    backgrounds,
    overlays,
    music,
    ambiences,
    volumes: { music: volumes.music, ambience: volumes.ambience },
    notes,
  };
}

// Storage ------------------------------------------------------------------

type StoredScene = Omit<Scene, 'campaignId'>;

function stored({ campaignId: _campaignId, ...scene }: Scene): StoredScene {
  return scene;
}

const scenesDocument: DocumentType<{ scenes: StoredScene[] }> = {
  name: 'scenes',
  version: 1,
  migrations: {},
  parse({ scenes }) {
    const parsed = parseList(scenes, (item) => parseScene(item, ''));
    return parsed && { scenes: parsed.map(stored) };
  },
};

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new SceneError('Donnez un nom à la scène.');
  if (trimmed.length > MAX_SCENE_NAME_LENGTH) {
    throw new SceneError(
      `Le nom de la scène est trop long (${MAX_SCENE_NAME_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

export function createSceneLibrary(storage: Storage): SceneLibrary {
  /** Serializes the read-modify-write of each Campaign's Scenes document. */
  const queues = new Map<CampaignId, Promise<unknown>>();
  function serialized<T>(campaignId: CampaignId, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(campaignId) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(
      campaignId,
      next.catch(() => undefined),
    );
    return next;
  }

  async function fileOf(campaignId: CampaignId): Promise<string> {
    if (!(await storage.campaigns.get(campaignId))) {
      throw new SceneError('Cette campagne n’existe plus.');
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
          name: cleanName(name),
          backgrounds: [],
          overlays: [],
          music: [],
          ambiences: [],
          volumes: { music: 1, ambience: 1 },
          notes: '',
        };
        await write(file, [...scenes, scene]);
        return scene;
      });
    },

    save(scene) {
      return serialized(scene.campaignId, async () => {
        const file = await fileOf(scene.campaignId);
        const scenes = await read(file, scene.campaignId);
        const index = scenes.findIndex((existing) => existing.id === scene.id);
        if (index < 0) throw new SceneError('Cette scène n’existe plus.');
        const saved: Scene = { ...scene, name: cleanName(scene.name) };
        scenes[index] = saved;
        await write(file, scenes);
        return saved;
      });
    },
  };
}
