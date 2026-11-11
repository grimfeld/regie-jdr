/**
 * Global Settings (one document, `<root>/settings.json`): the home page theme, the Control and
 * Broadcast window bounds, the last Active Scene of each Campaign (for highlighting only:
 * nothing goes on air after a restart), the fade duration and the Master volume. No Electron
 * dependency.
 */
import type { CampaignId, SceneId, Settings, ThemeId, WindowBounds } from '../shared/domain.js';
import { isThemeId } from './storage/campaigns.js';
import type { DocumentType, Storage } from './storage/index.js';
import { FADE_DURATION_MS, parseFadeDuration } from './fades.js';
import { isRecord } from './guards.js';
import { createSerialQueue } from './serialQueue.js';

/** A Settings change refused, with a message the Game Master can read. */
export class SettingsError extends Error {}

export type SettingsWindow = keyof Settings['windowBounds'];

export interface SettingsStore {
  /** The stored Settings, or the defaults for anything never saved. */
  get(): Promise<Settings>;
  /** Theme of the Campaign list home page. */
  setTheme(theme: ThemeId): Promise<Settings>;
  setWindowBounds(window: SettingsWindow, bounds: WindowBounds): Promise<Settings>;
  setLastActiveScene(campaignId: CampaignId, sceneId: SceneId): Promise<Settings>;
  /** Throws a SettingsError for a duration outside FADE_DURATION_MS. */
  setFadeDuration(fadeDurationMs: number): Promise<Settings>;
}

/** Master volume until the Game Master changes it: full. */
export const DEFAULT_MASTER_VOLUME = 1;

/** A volume, 0..1, or undefined for anything else. */
export function parseVolume(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/** Theme of the home page until the Game Master picks one. */
export const DEFAULT_HOME_THEME: ThemeId = 'imperium';

function defaults(): Settings {
  return {
    theme: DEFAULT_HOME_THEME,
    windowBounds: {},
    lastActiveSceneByCampaign: {},
    fadeDurationMs: FADE_DURATION_MS.default,
    masterVolume: DEFAULT_MASTER_VOLUME,
  };
}

/** Whole pixels, a size of at least 1: anything else is not a usable window rectangle. */
export function parseWindowBounds(value: unknown): WindowBounds | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isInteger(n))) {
    return undefined;
  }
  if ((width as number) < 1 || (height as number) < 1) return undefined;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

const settingsDocument: DocumentType<Settings> = {
  name: 'settings',
  version: 3,
  migrations: {
    // Version 2 adds the fade duration, at its default.
    1: (fields) => ({ ...fields, fadeDurationMs: FADE_DURATION_MS.default }),
    // Version 3 (Milestone 2) adds the Master volume, at its default.
    2: (fields) => ({ ...fields, masterVolume: DEFAULT_MASTER_VOLUME }),
  },
  parse({ theme, windowBounds, lastActiveSceneByCampaign, fadeDurationMs, masterVolume }) {
    if (!isThemeId(theme) || !isRecord(windowBounds) || !isRecord(lastActiveSceneByCampaign)) {
      return undefined;
    }
    const bounds: Settings['windowBounds'] = {};
    for (const window of ['control', 'broadcast'] as const) {
      const parsed = parseWindowBounds(windowBounds[window]);
      if (parsed) bounds[window] = parsed;
    }
    const lastActive: Record<CampaignId, SceneId> = {};
    for (const [campaignId, sceneId] of Object.entries(lastActiveSceneByCampaign)) {
      if (typeof sceneId === 'string' && sceneId !== '') lastActive[campaignId] = sceneId;
    }
    return {
      theme,
      windowBounds: bounds,
      lastActiveSceneByCampaign: lastActive,
      fadeDurationMs: parseFadeDuration(fadeDurationMs) ?? FADE_DURATION_MS.default,
      masterVolume: parseVolume(masterVolume) ?? DEFAULT_MASTER_VOLUME,
    };
  },
};

export function createSettingsStore(storage: Storage): SettingsStore {
  const file = storage.settingsFile;
  const read = async () => (await storage.documents.read(file, settingsDocument)) ?? defaults();

  // Read-modify-writes one after the other, so no change is lost.
  const serialized = createSerialQueue();
  function change(edit: (settings: Settings) => Settings): Promise<Settings> {
    return serialized(async () => {
      const next = edit(await read());
      await storage.documents.write(file, settingsDocument, next);
      return next;
    });
  }

  return {
    get: read,
    setTheme: (theme) => change((settings) => ({ ...settings, theme })),
    setWindowBounds: (window, bounds) =>
      change((settings) => ({
        ...settings,
        windowBounds: { ...settings.windowBounds, [window]: bounds },
      })),
    setLastActiveScene: (campaignId, sceneId) =>
      change((settings) => ({
        ...settings,
        lastActiveSceneByCampaign: { ...settings.lastActiveSceneByCampaign, [campaignId]: sceneId },
      })),
    setFadeDuration: (fadeDurationMs) => {
      if (parseFadeDuration(fadeDurationMs) === undefined) {
        const { min, max } = FADE_DURATION_MS;
        return Promise.reject(
          new SettingsError(
            `La durée des fondus doit être comprise entre ${min / 1000} et ${max / 1000} secondes.`,
          ),
        );
      }
      return change((settings) => ({ ...settings, fadeDurationMs }));
    },
  };
}
