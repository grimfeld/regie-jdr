/**
 * Global Settings (one document, `<root>/settings.json`): the home page theme, the Control and
 * Broadcast window bounds, the last Active Scene of each Campaign (for highlighting only:
 * nothing goes on air after a restart), the fade duration, the Master volume, the Activate
 * duration, the Music crossfade duration, whether the Broadcast window stays on top and the
 * shortcut keys. No Electron dependency.
 */
import type {
  CampaignId,
  SceneId,
  Settings,
  ShortcutSettings,
  ThemeId,
  WindowBounds,
} from '../shared/domain.js';
import { isThemeId } from './storage/campaigns.js';
import { isSameCampaignId, type DocumentType, type Storage } from './storage/index.js';
import { MASTER_VOLUME } from './audioMix.js';
import {
  ACTIVATE_DURATION_MS,
  FADE_DURATION_MS,
  MUSIC_CROSSFADE_MS,
  parseActivateDuration,
  parseFadeDuration,
  parseMusicCrossfade,
} from './fades.js';
import { isRecord } from './guards.js';
import { DEFAULT_SHORTCUTS, isConsistent, parseShortcutSettings } from './keyMap.js';
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
  /** A deleted Scene: no longer its Campaign's last Active Scene, if it was. */
  forgetScene(campaignId: CampaignId, sceneId: SceneId): Promise<Settings>;
  /** A deleted Campaign: every entry kept for it (its last Active Scene) is removed. */
  forgetCampaign(campaignId: CampaignId): Promise<Settings>;
  /** Throws a SettingsError for a duration outside FADE_DURATION_MS. */
  setFadeDuration(fadeDurationMs: number): Promise<Settings>;
  /** Throws a SettingsError for a volume outside 0..1. */
  setMasterVolume(masterVolume: number): Promise<Settings>;
  /** Throws a SettingsError for a duration outside ACTIVATE_DURATION_MS. */
  setActivateDuration(activateDurationMs: number): Promise<Settings>;
  /** Throws a SettingsError for a duration outside MUSIC_CROSSFADE_MS. */
  setMusicCrossfade(musicCrossfadeMs: number): Promise<Settings>;
  setBroadcastAlwaysOnTop(on: boolean): Promise<Settings>;
  /** Throws a SettingsError for keys refused or taken twice (core/keyMap.ts). */
  setShortcuts(shortcuts: ShortcutSettings): Promise<Settings>;
}

/** Master volume until the Game Master changes it: full. */
export const DEFAULT_MASTER_VOLUME = MASTER_VOLUME.default;

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
    activateDurationMs: ACTIVATE_DURATION_MS.default,
    musicCrossfadeMs: MUSIC_CROSSFADE_MS.default,
    broadcastAlwaysOnTop: false,
    shortcuts: DEFAULT_SHORTCUTS,
  };
}

/** A SettingsError for a duration outside `bounds`, naming the setting (`what`, in French). */
function durationRefused(what: string, bounds: { min: number; max: number }): SettingsError {
  return new SettingsError(
    `${what} doit être comprise entre ${bounds.min / 1000} et ${bounds.max / 1000} secondes.`,
  );
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
  version: 6,
  migrations: {
    // Version 2 adds the fade duration, at its default.
    1: (fields) => ({ ...fields, fadeDurationMs: FADE_DURATION_MS.default }),
    // Version 3 (Milestone 2) adds the Master volume, at its default.
    2: (fields) => ({ ...fields, masterVolume: DEFAULT_MASTER_VOLUME }),
    // Version 4 (Milestone 3) adds the Activate and Music crossfade durations, at their defaults.
    3: (fields) => ({
      ...fields,
      activateDurationMs: ACTIVATE_DURATION_MS.default,
      musicCrossfadeMs: MUSIC_CROSSFADE_MS.default,
    }),
    // Version 5 (Milestone 4) adds the Broadcast window always on top, off. A version 4 file
    // written by an M4 build before the merge with M3 may hold it already: kept. Its missing
    // durations are filled with their defaults by parse.
    4: (fields) => ({ broadcastAlwaysOnTop: false, ...fields }),
    // Version 6 (Milestone 4) adds the shortcut keys, nothing remapped.
    5: (fields) => ({ ...fields, shortcuts: DEFAULT_SHORTCUTS }),
  },
  parse({
    theme,
    windowBounds,
    lastActiveSceneByCampaign,
    fadeDurationMs,
    masterVolume,
    activateDurationMs,
    musicCrossfadeMs,
    broadcastAlwaysOnTop,
    shortcuts,
  }) {
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
      activateDurationMs: parseActivateDuration(activateDurationMs) ?? ACTIVATE_DURATION_MS.default,
      musicCrossfadeMs: parseMusicCrossfade(musicCrossfadeMs) ?? MUSIC_CROSSFADE_MS.default,
      broadcastAlwaysOnTop: broadcastAlwaysOnTop === true,
      shortcuts: parseShortcutSettings(shortcuts),
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
    forgetScene: (campaignId, sceneId) =>
      change((settings) => {
        if (settings.lastActiveSceneByCampaign[campaignId] !== sceneId) return settings;
        const { [campaignId]: _forgotten, ...kept } = settings.lastActiveSceneByCampaign;
        return { ...settings, lastActiveSceneByCampaign: kept };
      }),
    // Every entry naming that Campaign's folder, whatever its letter case (isSameCampaignId).
    forgetCampaign: (campaignId) =>
      change((settings) => {
        const entries = Object.entries(settings.lastActiveSceneByCampaign);
        const kept = entries.filter(([id]) => !isSameCampaignId(id, campaignId));
        if (kept.length === entries.length) return settings;
        return { ...settings, lastActiveSceneByCampaign: Object.fromEntries(kept) };
      }),
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
    setMasterVolume: (masterVolume) => {
      if (parseVolume(masterVolume) === undefined) {
        return Promise.reject(
          new SettingsError('Le volume général doit être compris entre 0 et 100 %.'),
        );
      }
      return change((settings) => ({ ...settings, masterVolume }));
    },
    setActivateDuration: (activateDurationMs) => {
      if (parseActivateDuration(activateDurationMs) === undefined) {
        return Promise.reject(durationRefused('La durée d’activation', ACTIVATE_DURATION_MS));
      }
      return change((settings) => ({ ...settings, activateDurationMs }));
    },
    setMusicCrossfade: (musicCrossfadeMs) => {
      if (parseMusicCrossfade(musicCrossfadeMs) === undefined) {
        return Promise.reject(
          durationRefused('La durée du fondu entre musiques', MUSIC_CROSSFADE_MS),
        );
      }
      return change((settings) => ({ ...settings, musicCrossfadeMs }));
    },
    setBroadcastAlwaysOnTop: (on) =>
      change((settings) => ({ ...settings, broadcastAlwaysOnTop: on })),
    setShortcuts: (shortcuts) => {
      if (!isConsistent(shortcuts)) {
        return Promise.reject(
          new SettingsError(
            'Ces raccourcis ne peuvent pas être enregistrés : une touche est réservée ou sert deux fois.',
          ),
        );
      }
      return change((settings) => ({ ...settings, shortcuts }));
    },
  };
}
