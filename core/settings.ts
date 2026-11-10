/**
 * Global Settings (one document, `<root>/settings.json`): the home page theme, the Control and
 * Broadcast window bounds, and the last Active Scene of each Campaign (for highlighting only:
 * nothing goes on air after a restart). No Electron dependency.
 */
import type { CampaignId, SceneId, Settings, ThemeId, WindowBounds } from '../shared/domain.js';
import { isThemeId } from './storage/campaigns.js';
import type { DocumentType, Storage } from './storage/index.js';

export type SettingsWindow = keyof Settings['windowBounds'];

export interface SettingsStore {
  /** The stored Settings, or the defaults for anything never saved. */
  get(): Promise<Settings>;
  /** Theme of the Campaign list home page. */
  setTheme(theme: ThemeId): Promise<Settings>;
  setWindowBounds(window: SettingsWindow, bounds: WindowBounds): Promise<Settings>;
  setLastActiveScene(campaignId: CampaignId, sceneId: SceneId): Promise<Settings>;
}

/** Theme of the home page until the Game Master picks one. */
export const DEFAULT_HOME_THEME: ThemeId = 'imperium';

function defaults(): Settings {
  return { theme: DEFAULT_HOME_THEME, windowBounds: {}, lastActiveSceneByCampaign: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  version: 1,
  migrations: {},
  parse({ theme, windowBounds, lastActiveSceneByCampaign }) {
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
    return { theme, windowBounds: bounds, lastActiveSceneByCampaign: lastActive };
  },
};

export function createSettingsStore(storage: Storage): SettingsStore {
  const file = storage.settingsFile;
  const read = async () => (await storage.documents.read(file, settingsDocument)) ?? defaults();

  // Read-modify-writes one after the other, so no change is lost.
  let queue: Promise<unknown> = Promise.resolve();
  function change(edit: (settings: Settings) => Settings): Promise<Settings> {
    const task = async () => {
      const next = edit(await read());
      await storage.documents.write(file, settingsDocument, next);
      return next;
    };
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
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
  };
}
