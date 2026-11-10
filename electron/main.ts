import { app, BrowserWindow, dialog, net, protocol, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isAppPage } from './navigation.js';
import { registerHandlers, sendEvent } from './ipc.js';
import { installErrorLogging, log } from './logging.js';
import type { WindowRole } from '../core/ipc.js';
import { createCampaign, updateCampaign } from '../core/campaigns.js';
import { createOnAir } from '../core/onAir.js';
import { openStorage } from '../core/storage/index.js';
import type { ImportedImage } from '../shared/contract.js';

let controlWindow: BrowserWindow | null = null;
let broadcastWindow: BrowserWindow | null = null;
// What is on air: in memory only, so nothing is on air after a restart.
const onAir = createOnAir();

// Whole-app tests point the app at a temporary data folder.
// Must stay before the single-instance lock, which is scoped to the data folder.
if (process.env.REGIE_USER_DATA_DIR) app.setPath('userData', process.env.REGIE_USER_DATA_DIR);

// Failures are logged to <userData>/logs/regie.log and no longer kill the app (electron/logging.ts).
installErrorLogging();

// Imported images are served via a custom scheme: file:// URLs are blocked
// when the renderer is loaded from the Vite dev server (http origin).
const ASSET_SCHEME = 'regie-asset';
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
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

function getAssetDirectory() {
  return path.join(app.getPath('userData'), 'assets');
}

function registerAssetProtocol() {
  protocol.handle(ASSET_SCHEME, (request) => {
    const fileName = path.basename(decodeURIComponent(new URL(request.url).pathname));
    const filePath = path.join(getAssetDirectory(), fileName);
    return net.fetch(pathToFileURL(filePath).href);
  });
}

/** Which of the app's windows sent a message; undefined for anything else. */
function roleOf(sender: WebContents): WindowRole | undefined {
  if (controlWindow && !controlWindow.isDestroyed() && sender === controlWindow.webContents) return 'control';
  if (broadcastWindow && !broadcastWindow.isDestroyed() && sender === broadcastWindow.webContents) return 'broadcast';
  return undefined;
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
    title: 'Régie JDR — Poste du MJ', backgroundColor: '#101217',
    webPreferences: secureWebPreferences('control')
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    controlWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    controlWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    controlWindow.loadFile(appIndexFile);
  }
}

function createBroadcastWindow() {
  if (broadcastWindow && !broadcastWindow.isDestroyed()) { broadcastWindow.focus(); return; }
  broadcastWindow = new BrowserWindow({
    width: 1280, height: 720, title: 'Régie JDR — Diffusion',
    backgroundColor: '#08090c', autoHideMenuBar: true,
    webPreferences: secureWebPreferences('broadcast')
  });
  broadcastWindow.setMenuBarVisibility(false);
  // The page reads the on-air state itself (onAir:get) once subscribed, on every load.
  if (process.env.VITE_DEV_SERVER_URL) broadcastWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=stage`);
  else broadcastWindow.loadFile(appIndexFile, { query: { view: 'stage' } });
  broadcastWindow.on('closed', () => { broadcastWindow = null; });
}

async function importImages(): Promise<ImportedImage[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Importer des visuels', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  };
  const result = controlWindow
    ? await dialog.showOpenDialog(controlWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return [];
  const assetDirectory = getAssetDirectory();
  await fs.mkdir(assetDirectory, { recursive: true });
  const imported: ImportedImage[] = [];
  for (const source of result.filePaths) {
    const extension = path.extname(source).toLowerCase();
    const fileName = `${randomUUID()}${extension}`;
    await fs.copyFile(source, path.join(assetDirectory, fileName));
    imported.push({ name: path.basename(source, extension), url: `${ASSET_SCHEME}://assets/${fileName}` });
  }
  return imported;
}

/** A second launch of the app brings the existing Control window forward. */
function focusControlWindow() {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
}

function startApp() {
  registerAssetProtocol();
  // Messages for the Game Master (e.g. a corrupt file recovered), shown by the Control window.
  const notices: string[] = [];
  const storage = openStorage(app.getPath('userData'), {
    notify: (message) => { notices.push(message); log.warn(message); }
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
      'onAir:open-campaign': ({ campaignId }) => onAir.openCampaign(campaignId),
      'onAir:close-campaign': () => onAir.closeCampaign(),
      'onAir:activate-scene': ({ sceneId }) => onAir.activateScene(sceneId),
      'broadcast:open': () => createBroadcastWindow(),
      'media:import-images': importImages,
      'campaigns:list': () => storage.campaigns.list(),
      'campaigns:create': ({ name }) => createCampaign(storage.campaigns, name),
      'campaigns:update': ({ id, changes }) => updateCampaign(storage.campaigns, id, changes),
      'notices:take': () => notices.splice(0)
    },
    roleOf,
    log
  );
  createControlWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createControlWindow(); });
}

// Only one app per data folder: a second launch hands over to the first and quits.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusControlWindow);
  app.whenReady().then(startApp);
} else {
  app.quit();
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
