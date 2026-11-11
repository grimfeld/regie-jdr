import { app, BrowserWindow, dialog, protocol, screen, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppPage } from './navigation.js';
import { registerHandlers, sendEvent } from './ipc.js';
import { installErrorLogging, log } from './logging.js';
import type { WindowRole } from '../core/ipc.js';
import { createCampaign, updateCampaign } from '../core/campaigns.js';
import { electronImageResizer } from './imageResizer.js';
import { createMediaLibrary, MEDIA_KINDS, type MediaLibrary } from '../core/media.js';
import { MEDIA_SCHEME } from '../core/mediaAddress.js';
import { mediaFileResponse } from '../core/mediaResponse.js';
import { createAudioOnAir } from '../core/audioOnAir.js';
import { createEngineLink } from '../core/engineLink.js';
import { createOnAir } from '../core/onAir.js';
import { createOnAirCommands } from '../core/onAirCommands.js';
import { createPadVoices } from '../core/padVoices.js';
import { createSoundboardStore, SoundboardError } from '../core/soundboard.js';
import { createSceneLibrary } from '../core/scenes.js';
import { createSettingsStore, type SettingsStore, type SettingsWindow } from '../core/settings.js';
import { openStorage } from '../core/storage/index.js';
import { placeWindow } from '../core/windowPlacement.js';
import type { MediaImportKind, SoundboardEdit } from '../shared/contract.js';
import type { PadCommand } from '../shared/domain.js';

let controlWindow: BrowserWindow | null = null;
let broadcastWindow: BrowserWindow | null = null;
// Global Settings (home theme, window bounds, last Active Scenes); set when the app starts.
let settings: SettingsStore | null = null;
// Settings writes still running: the app waits for them before it quits.
const pendingWrites = new Set<Promise<unknown>>();
// What is on air: in memory only, so nothing is on air after a restart.
const onAir = createOnAir();
// What plays (the audio part of the on-air state): in memory only, so nothing plays after a restart.
const audio = createAudioOnAir();
// What the Soundboard's pads play: in memory only, like the mix.
const padVoices = createPadVoices();
// What the audio engine (in the Control window, ADR-0002) last reported sounding.
const engine = createEngineLink(audio, padVoices);

// Whole-app tests point the app at a temporary data folder.
// Must stay before the single-instance lock, which is scoped to the data folder.
if (process.env.REGIE_USER_DATA_DIR) app.setPath('userData', process.env.REGIE_USER_DATA_DIR);

// Failures are logged to <userData>/logs/regie.log and no longer kill the app (electron/logging.ts).
installErrorLogging();

// Media are served via a custom scheme (core/mediaAddress.ts): file:// URLs are blocked
// when the renderer is loaded from the Vite dev server (http origin).
// `stream` lets audio stream from it; `corsEnabled` lets the audio engine route it through Web
// Audio (a media element from another origin without CORS would play silence there).
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// The page every window loads: the dev server, or the built index.html on disk.
// This file runs from dist-electron/electron/.
const appIndexFile = path.join(__dirname, '../../dist/index.html');
const appEntry = process.env.VITE_DEV_SERVER_URL ?? pathToFileURL(appIndexFile).href;

/** Each window gets its own bridge: the Control window the full one, the Broadcast window a read-only one. */
function secureWebPreferences(role: WindowRole): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, `preload-${role}.js`),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
  };
}

// Every window: no pop-ups, no webviews, no navigation away from the app's own pages.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-frame-navigate', (event) => {
    if (!isAppPage(event.url, appEntry)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (!isAppPage(event.url, appEntry)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

/**
 * Serves Media files from the open Campaign's media folder only, with an explicit content type.
 * Anything else (another Campaign, malformed address, missing file, disallowed type, outside
 * the folder) is a 404. Byte ranges are served, so audio streams, seeks and loops; bodies stream
 * from disk (core/mediaResponse.ts). Any app page may read the files (CORS), so the audio engine
 * can route them through Web Audio.
 */
function registerMediaProtocol(library: MediaLibrary) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const notFound = () => new Response(null, { status: 404 });
    try {
      const resolved = await library.resolveAddress(request.url, onAir.current().campaignId);
      if (!resolved) return notFound();
      return await mediaFileResponse(
        resolved.file,
        {
          'content-type': resolved.mimeType,
          'cache-control': 'no-cache',
          'access-control-allow-origin': '*',
        },
        request.headers.get('range'),
      );
    } catch (error) {
      log.warn(`Media request failed: ${request.url}`, error);
      return notFound();
    }
  });
}

/** Which of the app's windows sent a message; undefined for anything else. */
function roleOf(sender: WebContents): WindowRole | undefined {
  if (controlWindow && !controlWindow.isDestroyed() && sender === controlWindow.webContents)
    return 'control';
  if (broadcastWindow && !broadcastWindow.isDestroyed() && sender === broadcastWindow.webContents)
    return 'broadcast';
  return undefined;
}

/** Runs a Settings write; failures are logged, and the app waits for it before quitting. */
function saveSetting(write: (store: SettingsStore) => Promise<unknown>) {
  if (!settings) return;
  const pending = write(settings).catch((error: unknown) => {
    log.error('Saving the settings failed', error);
  });
  pendingWrites.add(pending);
  void pending.finally(() => pendingWrites.delete(pending));
}

/**
 * Where a window reopens: its saved bounds, brought back onto the screen when the display it
 * was on is gone (primary display first). Nothing saved: the window's default size.
 */
async function savedPlacement(window: SettingsWindow): Promise<Electron.Rectangle | undefined> {
  if (!settings) return undefined;
  try {
    const saved = (await settings.get()).windowBounds[window];
    const primary = screen.getPrimaryDisplay();
    const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
    return placeWindow(
      saved,
      [primary, ...others].map((display) => display.workArea),
    );
  } catch (error) {
    log.warn('Reading the saved window bounds failed', error);
    return undefined;
  }
}

/** Saves a window's bounds (not maximized or minimized ones) when it closes. */
function rememberBounds(window: BrowserWindow, name: SettingsWindow) {
  window.on('close', () => {
    const bounds = window.getNormalBounds();
    saveSetting((store) => store.setWindowBounds(name, bounds));
  });
}

/** Loads a window's page; a page that fails to load is logged (the window stays blank). */
function loadPage(window: SettingsWindow, loading: Promise<void>) {
  loading.catch((error: unknown) => {
    log.error(`Loading the ${window} window failed`, error);
  });
}

async function createControlWindow() {
  const placement = await savedPlacement('control');
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    ...placement,
    title: 'Régie JDR — Poste du MJ',
    backgroundColor: '#101217',
    webPreferences: secureWebPreferences('control'),
  });
  rememberBounds(controlWindow, 'control');
  // Each load of the page starts a new audio engine (ADR-0002), holding nothing yet: what the
  // old one reported is stale.
  controlWindow.webContents.on('did-navigate', () => {
    engine.engineStarted();
    sendEvent(controlWindow?.webContents, 'audio:sounding-changed', engine.sounding());
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    loadPage('control', controlWindow.loadURL(process.env.VITE_DEV_SERVER_URL));
    controlWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    loadPage('control', controlWindow.loadFile(appIndexFile));
  }
}

async function createBroadcastWindow() {
  if (broadcastWindow && !broadcastWindow.isDestroyed()) {
    broadcastWindow.focus();
    return;
  }
  const placement = await savedPlacement('broadcast');
  // A second click while the bounds were being read: the first one opened it.
  if (broadcastWindow && !broadcastWindow.isDestroyed()) {
    broadcastWindow.focus();
    return;
  }
  broadcastWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    ...placement,
    title: 'Régie JDR — Diffusion',
    // Black like the letterbox bars, whatever the theme. No minimum size: it may take a third
    // of the screen.
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences('broadcast'),
  });
  rememberBounds(broadcastWindow, 'broadcast');
  broadcastWindow.setMenuBarVisibility(false);
  leaveFullscreenOnEscape(broadcastWindow);
  // The page reads the on-air state itself (onAir:get) once subscribed, on every load.
  loadPage(
    'broadcast',
    process.env.VITE_DEV_SERVER_URL
      ? broadcastWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=broadcast`)
      : broadcastWindow.loadFile(appIndexFile, { query: { view: 'broadcast' } }),
  );
  broadcastWindow.on('closed', () => {
    broadcastWindow = null;
  });
}

/**
 * The Broadcast window has no controls of its own: its fullscreen is toggled from the Control
 * window. Returns whether it is now fullscreen (false when it is not open).
 */
function toggleBroadcastFullscreen(): boolean {
  if (!broadcastWindow || broadcastWindow.isDestroyed()) return false;
  const fullscreen = !broadcastWindow.isFullScreen();
  broadcastWindow.setFullScreen(fullscreen);
  return fullscreen;
}

/** Esc in a fullscreen window leaves fullscreen, so it can never trap the Game Master's screen. */
function leaveFullscreenOnEscape(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && window.isFullScreen()) {
      event.preventDefault();
      window.setFullScreen(false);
    }
  });
}

/** Files the Game Master picks for an import, from the native file picker; [] if cancelled. */
async function pickMediaFiles(kind: MediaImportKind): Promise<string[]> {
  const { picker, extensions } = MEDIA_KINDS[kind.accept];
  const options: Electron.OpenDialogOptions = {
    title: picker.title,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: picker.filterName, extensions }],
  };
  const result = controlWindow
    ? await dialog.showOpenDialog(controlWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

/** A second launch of the app brings the existing Control window forward. */
function focusControlWindow() {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
}

function startApp() {
  // Messages for the Game Master (e.g. a corrupt file recovered), shown by the Control window.
  const notices: string[] = [];
  const storage = openStorage(app.getPath('userData'), {
    notify: (message) => {
      notices.push(message);
      log.warn(message);
    },
  });
  const settingsStore = createSettingsStore(storage);
  settings = settingsStore;
  const library = createMediaLibrary(storage, electronImageResizer, { log });
  const scenes = createSceneLibrary(storage);
  const soundboards = createSoundboardStore({ storage, library });
  registerMediaProtocol(library);
  const commands = createOnAirCommands({
    campaigns: storage.campaigns,
    library,
    scenes,
    onAir,
    audio,
    soundboards,
  });
  // The renderers fade with the saved duration, carried by the on-air state; audio plays at
  // the saved Master volume.
  settingsStore
    .get()
    .then(({ fadeDurationMs, masterVolume }) => {
      onAir.setFadeDuration(fadeDurationMs);
      audio.setMasterVolume(masterVolume);
    })
    .catch((error: unknown) => {
      log.error('Reading the fade duration and the Master volume failed', error);
    });
  const currentSounding = () => engine.sounding();
  // Audio goes to the Control window only, where the audio engine plays it (ADR-0002): the
  // Broadcast window gets no audio data.
  const sendSounding = () =>
    sendEvent(controlWindow?.webContents, 'audio:sounding-changed', currentSounding());
  const sendPadCommands = (commands: readonly PadCommand[]) => {
    for (const command of commands) {
      sendEvent(controlWindow?.webContents, 'audio:pad-command', command);
    }
  };
  /**
   * The pad sounds still sounding take the pads' names and levels now (`unsaved`: a slider
   * being dragged), so a level, pad volume or Master volume change is heard at once. The change
   * itself is saved already: a failure here is only logged.
   */
  const retunePads = async (unsaved?: SoundboardEdit) => {
    const { campaignId } = onAir.current();
    if (!campaignId) return;
    try {
      const { masterVolume } = await settingsStore.get();
      const tuning = await soundboards.tuning(campaignId, masterVolume, unsaved);
      sendPadCommands(padVoices.retune(tuning));
      sendSounding();
    } catch (error) {
      log.warn('Retuning the pad sounds failed', error);
    }
  };
  /** A Campaign opened, switched or closed: its pad sounds stop with the rest of the audio. */
  const stopPads = () => {
    sendPadCommands(padVoices.clear());
    sendSounding();
  };
  /**
   * Tells the engine which Sound effects to keep decoded: those of the open Campaign's pads,
   * none when no Campaign is open. Sent on Campaign open and close, pad changes and engine
   * start; a failure only costs the decode on first press.
   */
  const preloadPads = () => {
    const { campaignId } = onAir.current();
    const sounds = campaignId === null ? Promise.resolve([]) : soundboards.sounds(campaignId);
    sounds
      .then((srcs) => sendPadCommands([{ kind: 'preload', srcs }]))
      .catch((error: unknown) => log.warn('Listing the Sound effects to preload failed', error));
  };
  /** Silence was set: when it `started`, the pads sounding fade out too. Returns what sounds. */
  const silenced = (started: boolean) => {
    if (started) {
      sendPadCommands(padVoices.clear('silence'));
      sendSounding();
    }
    return currentSounding();
  };
  audio.subscribe((mix) => {
    sendEvent(controlWindow?.webContents, 'audio:mix-changed', mix);
    sendSounding();
  });
  // Every new on-air snapshot goes to both windows, whole and with its version.
  onAir.subscribe((snapshot) => {
    sendEvent(broadcastWindow?.webContents, 'onAir:changed', snapshot);
    sendEvent(controlWindow?.webContents, 'onAir:changed', snapshot);
  });
  // One handler per channel of shared/contract.ts; payloads arrive validated (core/ipc.ts).
  registerHandlers(
    {
      'onAir:get': () => onAir.current(),
      'onAir:open-campaign': async ({ campaignId }) => {
        const state = await commands.openCampaign(campaignId);
        stopPads();
        preloadPads();
        return state;
      },
      'onAir:close-campaign': async () => {
        const state = await commands.closeCampaign();
        stopPads();
        preloadPads();
        return state;
      },
      'onAir:activate-scene': async ({ sceneId }) => {
        const state = await commands.activateScene(sceneId);
        // Remembered for highlighting only: nothing goes on air after a restart.
        const { campaignId } = state;
        if (campaignId) saveSetting((store) => store.setLastActiveScene(campaignId, sceneId));
        return state;
      },
      'onAir:set-blackout': ({ on }) => commands.setBlackout(on),
      'scenes:list': ({ campaignId }) => scenes.list(campaignId),
      'scenes:create': ({ campaignId, name }) => scenes.create(campaignId, name),
      'scenes:edit': ({ campaignId, sceneId, edit }) =>
        commands.editScene(campaignId, sceneId, edit),
      'scenes:show-transient': ({ campaignId, sceneId, edit }) =>
        commands.showTransientEdit(campaignId, sceneId, edit),
      'scenes:undo-state': ({ campaignId, sceneId }) => commands.undoState(campaignId, sceneId),
      'scenes:undo': ({ campaignId, sceneId }) => commands.undoSceneEdit(campaignId, sceneId),
      'scenes:redo': ({ campaignId, sceneId }) => commands.redoSceneEdit(campaignId, sceneId),
      'scenes:delete': async ({ campaignId, sceneId }) => {
        await commands.deleteScene(campaignId, sceneId);
        saveSetting((store) => store.forgetScene(campaignId, sceneId));
      },
      'broadcast:open': () => createBroadcastWindow(),
      'broadcast:toggle-fullscreen': () => toggleBroadcastFullscreen(),
      'media:list': ({ campaignId }) => library.list(campaignId),
      'media:import': async ({ campaignId, ...kind }) => {
        const files = await pickMediaFiles(kind);
        const result = await library.import(campaignId, files, kind);
        result.refused.forEach((message) => log.info(`Media refused: ${message}`));
        return result;
      },
      'media:import-dropped': async ({ campaignId, files, ...kind }) => {
        const result = await library.import(campaignId, files, kind);
        result.refused.forEach((message) => log.info(`Media refused: ${message}`));
        return result;
      },
      'media:set-category': ({ campaignId, mediaId, category }) =>
        library.setImageCategory(campaignId, mediaId, category),
      'media:rename': async ({ campaignId, mediaId, name }) => {
        const renamed = await commands.renameMedia(campaignId, mediaId, name);
        await retunePads();
        return renamed;
      },
      // The on-air commands remove its pads too (pads are uses): preload what is left.
      'media:delete': async ({ campaignId, mediaId, confirmed }) => {
        const deletion = await commands.deleteMedia(campaignId, mediaId, confirmed);
        if (deletion.deleted) preloadPads();
        return deletion;
      },
      'campaigns:list': () => storage.campaigns.list(),
      'campaigns:create': ({ name }) => createCampaign(storage.campaigns, name),
      'campaigns:update': ({ id, changes }) => updateCampaign(storage.campaigns, id, changes),
      'notices:take': () => notices.splice(0),
      'settings:get': () => settingsStore.get(),
      'settings:set-theme': ({ theme }) => settingsStore.setTheme(theme),
      'settings:set-fade-duration': async ({ fadeDurationMs }) => {
        const saved = await settingsStore.setFadeDuration(fadeDurationMs);
        onAir.setFadeDuration(saved.fadeDurationMs);
        return saved;
      },
      'settings:set-master-volume': async ({ masterVolume }) => {
        const saved = await settingsStore.setMasterVolume(masterVolume);
        audio.setMasterVolume(saved.masterVolume);
        await retunePads();
        return saved;
      },
      // The engine reads the mix as it starts (or restarts, with the Control window): it is
      // told which Sound effects to keep decoded (its last report is forgotten on did-navigate).
      'audio:get-mix': () => {
        preloadPads();
        return audio.mix();
      },
      'audio:report': (report) => {
        engine.engineReported(report);
        sendSounding();
      },
      'audio:get-sounding': () => currentSounding(),
      // Silence fades out the pads sounding too; pads pressed during it play as usual. It
      // goes through the on-air commands, in turn: an Activate just before cannot lift it.
      'audio:set-silence': async ({ on }) => silenced(await commands.setSilence(on)),
      'audio:toggle-silence': async () => silenced(await commands.toggleSilence()),
      'audio:report-pads': (report) => {
        if (padVoices.report(report)) sendSounding();
      },
      'soundboard:get': ({ campaignId }) => soundboards.get(campaignId),
      'soundboard:edit': async ({ campaignId, edit }) => {
        const saved = await soundboards.edit(campaignId, edit);
        if (edit.kind === 'add-pad' || edit.kind === 'remove-pad') preloadPads();
        await retunePads();
        return saved;
      },
      'soundboard:press': async ({ campaignId, padId }) => {
        if (onAir.current().campaignId !== campaignId) {
          throw new SoundboardError('Ouvrez cette campagne pour jouer ses bruitages.');
        }
        const { masterVolume } = await settingsStore.get();
        sendPadCommands(padVoices.press(await soundboards.press(campaignId, padId, masterVolume)));
      },
      // A level slider being dragged: heard on the pads sounding, never saved.
      'soundboard:show-transient': async ({ campaignId, edit }) => {
        if (onAir.current().campaignId === campaignId) await retunePads(edit);
      },
      'audio:pick-music': ({ mediaId }) => commands.pickMusic(mediaId),
      'audio:set-music-playback': ({ playback }) => commands.setMusicPlayback(playback),
    },
    roleOf,
    log,
  );
  void createControlWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createControlWindow();
  });
}

// Window bounds are saved as the windows close: finish those writes before quitting.
app.on('will-quit', (event) => {
  if (pendingWrites.size === 0) return;
  event.preventDefault();
  void Promise.allSettled([...pendingWrites]).then(() => app.quit());
});

// Only one app per data folder: a second launch hands over to the first and quits.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusControlWindow);
  app
    .whenReady()
    .then(startApp)
    .catch((error: unknown) => {
      log.error('Starting the app failed', error);
    });
} else {
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
