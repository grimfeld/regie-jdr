import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

type ImportedAsset = { name: string; url: string };
let controlWindow: BrowserWindow | null = null;
let stageWindow: BrowserWindow | null = null;
let currentScene: unknown = { title: 'Le sanctuaire oublié', background: '', description: 'Choisissez un décor pour commencer la scène.' };

// Whole-app tests point the app at a temporary data folder.
if (process.env.REGIE_USER_DATA_DIR) app.setPath('userData', process.env.REGIE_USER_DATA_DIR);

// Imported images are served via a custom scheme: file:// URLs are blocked
// when the renderer is loaded from the Vite dev server (http origin).
const ASSET_SCHEME = 'regie-asset';
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

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

function sendToStage(channel: string, payload: unknown) {
  if (stageWindow && !stageWindow.isDestroyed()) stageWindow.webContents.send(channel, payload);
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
    title: 'Régie JDR — Poste du MJ', backgroundColor: '#101217',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    controlWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    controlWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    controlWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function createStageWindow() {
  if (stageWindow && !stageWindow.isDestroyed()) { stageWindow.focus(); return; }
  stageWindow = new BrowserWindow({
    width: 1280, height: 720, title: 'Régie JDR — Diffusion',
    backgroundColor: '#08090c', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  stageWindow.setMenuBarVisibility(false);
  stageWindow.webContents.on('did-finish-load', () => sendToStage('scene:updated', currentScene));
  if (process.env.VITE_DEV_SERVER_URL) stageWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=stage`);
  else stageWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { view: 'stage' } });
  stageWindow.on('closed', () => { stageWindow = null; });
}

app.whenReady().then(() => {
  registerAssetProtocol();
  ipcMain.handle('stage:open', () => { createStageWindow(); return true; });
  ipcMain.handle('media:import-images', async (): Promise<ImportedAsset[]> => {
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
    const imported: ImportedAsset[] = [];
    for (const source of result.filePaths) {
      const extension = path.extname(source).toLowerCase();
      const fileName = `${randomUUID()}${extension}`;
      await fs.copyFile(source, path.join(assetDirectory, fileName));
      imported.push({ name: path.basename(source, extension), url: `${ASSET_SCHEME}://assets/${fileName}` });
    }
    return imported;
  });
  ipcMain.on('scene:update', (_event, scene) => { currentScene = scene; sendToStage('scene:updated', scene); });
  ipcMain.on('stage:fullscreen', () => stageWindow?.setFullScreen(!stageWindow.isFullScreen()));
  createControlWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createControlWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
