import { app, BrowserWindow, dialog, protocol, screen, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppPage } from './navigation.js';
import { registerHandlers, sendEvent } from './ipc.js';
import { installErrorLogging, log } from './logging.js';
import type { WindowRole } from '../core/ipc.js';
import { createCampaign, updateCampaign } from '../core/campaigns.js';
import { createMediaLibrary, type MediaLibrary } from '../core/media.js';
import { extensionsOf, MEDIA_SCHEME } from '../core/mediaAddress.js';
import { createOnAir } from '../core/onAir.js';
import { createOnAirCommands } from '../core/onAirCommands.js';
import { createSceneLibrary } from '../core/scenes.js';
import { createSettingsStore, type SettingsStore, type SettingsWindow } from '../core/settings.js';
import { openStorage } from '../core/storage/index.js';
import { placeWindow } from '../core/windowPlacement.js';
import type { MediaImportKind } from '../shared/contract.js';

let controlWindow: BrowserWindow | null = null;
let broadcastWindow: BrowserWindow | null = null;
// Global Settings (home theme, window bounds, last Active Scenes); set when the app starts.
let settings: SettingsStore | null = null;
// Settings writes still running: the app waits for them before it quits.
const pendingWrites = new Set<Promise<unknown>>();
// What is on air: in memory only, so nothing is on air after a restart.
const onAir = createOnAir();

// Whole-app tests point the app at a temporary data folder.
// Must stay before the single-instance lock, which is scoped to the data folder.
if (process.env.REGIE_USER_DATA_DIR) app.setPath('userData', process.env.REGIE_USER_DATA_DIR);

// Failures are logged to <userData>/logs/regie.log and no longer kill the app (electron/logging.ts).
installErrorLogging();

// Media are served via a custom scheme (core/mediaAddress.ts): file:// URLs are blocked
// when the renderer is loaded from the Vite dev server (http origin).
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
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
    webviewTag: false
  };
}

// Every window: no pop-ups, no webviews, no navigation away from the app's own pages.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-frame-navigate', (event) => { if (!isAppPage(event.url, appEntry)) event.preventDefault(); });
  contents.on('will-redirect', (event) => { if (!isAppPage(event.url, appEntry)) event.preventDefault(); });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

/**
 * Serves Media files from the open Campaign's media folder only, with an explicit content type.
 * Anything else (another Campaign, malformed address, missing file, disallowed type, outside
 * the folder) is a 404.
 * Whole files only: range requests (audio seeking) come with the audio engine.
 */
function registerMediaProtocol(library: MediaLibrary) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const notFound = () => new Response(null, { status: 404 });
    try {
      const resolved = await library.resolveAddress(request.url, onAir.current().campaignId);
      if (!resolved) return notFound();
      const content = await fs.readFile(resolved.file);
      return new Response(content, {
        headers: { 'content-type': resolved.mimeType, 'cache-control': 'no-cache' },
      });
    } catch (error) {
      log.warn(`Media request failed: ${request.url}`, error);
      return notFound();
    }
  });
}

/** Which of the app's windows sent a message; undefined for anything else. */
function roleOf(sender: WebContents): WindowRole | undefined {
  if (controlWindow && !controlWindow.isDestroyed() && sender === controlWindow.webContents) return 'control';
  if (broadcastWindow && !broadcastWindow.isDestroyed() && sender === broadcastWindow.webContents) return 'broadcast';
  return undefined;
}

/** Runs a Settings write; failures are logged, and the app waits for it before quitting. */
function saveSetting(write: (store: SettingsStore) => Promise<unknown>) {
  if (!settings) return;
  const pending = write(settings).catch((error) => log.error('Saving the settings failed', error));
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
    return placeWindow(saved, [primary, ...others].map((display) => display.workArea));
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

async function createControlWindow() {
  const placement = await savedPlacement('control');
  controlWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
    ...placement,
    title: 'Régie JDR — Poste du MJ', backgroundColor: '#101217',
    webPreferences: secureWebPreferences('control')
  });
  rememberBounds(controlWindow, 'control');
  if (process.env.VITE_DEV_SERVER_URL) {
    controlWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    controlWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    controlWindow.loadFile(appIndexFile);
  }
}

async function createBroadcastWindow() {
  if (broadcastWindow && !broadcastWindow.isDestroyed()) { broadcastWindow.focus(); return; }
  const placement = await savedPlacement('broadcast');
  // A second click while the bounds were being read: the first one opened it.
  if (broadcastWindow && !broadcastWindow.isDestroyed()) { broadcastWindow.focus(); return; }
  broadcastWindow = new BrowserWindow({
    width: 1280, height: 720, ...placement, title: 'Régie JDR — Diffusion',
    backgroundColor: '#08090c', autoHideMenuBar: true,
    webPreferences: secureWebPreferences('broadcast')
  });
  rememberBounds(broadcastWindow, 'broadcast');
  broadcastWindow.setMenuBarVisibility(false);
  // The page reads the on-air state itself (onAir:get) once subscribed, on every load.
  if (process.env.VITE_DEV_SERVER_URL) broadcastWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=broadcast`);
  else broadcastWindow.loadFile(appIndexFile, { query: { view: 'broadcast' } });
  broadcastWindow.on('closed', () => { broadcastWindow = null; });
}

/** Files the Game Master picks for an import, from the native file picker; [] if cancelled. */
async function pickMediaFiles(kind: MediaImportKind): Promise<string[]> {
  const options: Electron.OpenDialogOptions = kind.accept === 'image'
    ? {
        title: 'Importer des images', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: extensionsOf('image') }]
      }
    : {
        title: 'Importer des sons', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Sons', extensions: extensionsOf('audio') }]
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
    notify: (message) => { notices.push(message); log.warn(message); }
  });
  const settingsStore = createSettingsStore(storage);
  settings = settingsStore;
  const library = createMediaLibrary(storage);
  const scenes = createSceneLibrary(storage);
  registerMediaProtocol(library);
  // No audio engine yet: both windows are told to stop every sound (ADR-0002 decides where it lives).
  const commands = createOnAirCommands({
    campaigns: storage.campaigns, library, scenes, onAir,
    audio: {
      stopAll: () => {
        sendEvent(broadcastWindow?.webContents, 'audio:stop-all', null);
        sendEvent(controlWindow?.webContents, 'audio:stop-all', null);
      }
    }
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
      'onAir:open-campaign': ({ campaignId }) => commands.openCampaign(campaignId),
      'onAir:close-campaign': () => commands.closeCampaign(),
      'onAir:activate-scene': async ({ sceneId }) => {
        const state = await commands.activateScene(sceneId);
        // Remembered for highlighting only: nothing goes on air after a restart.
        const { campaignId } = state;
        if (campaignId) saveSetting((store) => store.setLastActiveScene(campaignId, sceneId));
        return state;
      },
      'scenes:list': ({ campaignId }) => scenes.list(campaignId),
      'scenes:create': ({ campaignId, name }) => scenes.create(campaignId, name),
      'scenes:update': (scene) => commands.updateScene(scene),
      'broadcast:open': () => createBroadcastWindow(),
      'media:list': ({ campaignId }) => library.list(campaignId),
      'media:import': async ({ campaignId, ...kind }) => {
        const files = await pickMediaFiles(kind);
        const result = await library.import(campaignId, files, kind);
        result.refused.forEach((message) => log.info(`Media refused: ${message}`));
        return result;
      },
      'media:set-category': ({ campaignId, mediaId, category }) =>
        library.setImageCategory(campaignId, mediaId, category),
      'media:delete': ({ campaignId, mediaId, confirmed }) =>
        commands.deleteMedia(campaignId, mediaId, confirmed),
      'campaigns:list': () => storage.campaigns.list(),
      'campaigns:create': ({ name }) => createCampaign(storage.campaigns, name),
      'campaigns:update': ({ id, changes }) => updateCampaign(storage.campaigns, id, changes),
      'notices:take': () => notices.splice(0),
      'settings:get': () => settingsStore.get(),
      'settings:set-theme': ({ theme }) => settingsStore.setTheme(theme)
    },
    roleOf,
    log
  );
  void createControlWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createControlWindow(); });
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
  app.whenReady().then(startApp);
} else {
  app.quit();
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
