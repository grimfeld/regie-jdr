import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export interface RunningApp {
  app: ElectronApplication;
  /** Temporary data folder the app uses as its userData for this test. */
  dataDir: string;
  /** Requests that failed in any window, as "url (error)". */
  failedRequests: string[];
  /** Content security policy violations reported in any window's console. */
  cspViolations: string[];
  /** Main-process console messages, as "<type>: <text>". */
  mainLog: string[];
  /** The Control window (the first window the app opens). */
  controlWindow: Page;
}

/** Launches the built app on `dataDir` and records failed requests in every window. */
export async function launchApp(dataDir: string): Promise<RunningApp> {
  const failedRequests: string[] = [];
  const cspViolations: string[] = [];
  const mainLog: string[] = [];
  const app = await electron.launch({ args: [repoRoot], env: appEnv(dataDir) });
  app.on('console', (message) => mainLog.push(`${message.type()}: ${message.text()}`));
  const watch = (page: Page) => {
    page.on('requestfailed', (request) =>
      failedRequests.push(`${request.url()} (${request.failure()?.errorText})`),
    );
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
    });
  };
  app.windows().forEach(watch);
  app.on('window', watch);
  const controlWindow = await app.firstWindow();
  await controlWindow.waitForLoadState('domcontentloaded');
  return { app, dataDir, failedRequests, cspViolations, mainLog, controlWindow };
}

/** Environment for a built-app process running on `dataDir`. */
export function appEnv(dataDir: string): Record<string, string> {
  const env = { ...process.env, REGIE_USER_DATA_DIR: dataDir } as Record<string, string>;
  delete env.VITE_DEV_SERVER_URL;
  return env;
}

/** Path of the built app, as passed to the Electron executable. */
export const appPath = repoRoot;

/** Replaces the native file picker in the main process: the next pickers return `filePaths`. */
export async function stubFilePicker(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: paths });
  }, filePaths);
}

/**
 * Drops files from disk on `target`, as from Windows Explorer: the files come from a file input
 * (so they carry their paths, as dropped files do), then dragenter, dragover and drop are sent
 * with them at `point` (page coordinates; the target's centre when absent). Returns whether the
 * dragover was cancelled: a drop target took it, or the page refused it (else a real drop would
 * open the file in the window).
 */
export async function dropFiles(
  target: Locator,
  filePaths: string[],
  point?: { x: number; y: number },
): Promise<boolean> {
  const page = target.page();
  const box = await target.boundingBox();
  if (!box) throw new Error('The drop target is not shown.');
  const at = point ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'test-dropped-files';
    input.hidden = true;
    document.body.append(input);
  });
  const input = page.locator('#test-dropped-files');
  await input.setInputFiles(filePaths);
  const dataTransfer = await input.evaluateHandle((element: HTMLInputElement) => {
    const transfer = new DataTransfer();
    for (const file of element.files ?? []) transfer.items.add(file);
    element.remove();
    return transfer;
  });
  const init = { dataTransfer, clientX: at.x, clientY: at.y };
  await target.dispatchEvent('dragenter', init);
  const over = await target.evaluate(
    (element, { clientX, clientY, transfer }) => {
      const event = new DragEvent('dragover', {
        dataTransfer: transfer,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { clientX: at.x, clientY: at.y, transfer: dataTransfer },
  );
  await target.dispatchEvent('drop', init);
  return over;
}

/** Clicks "Ouvrir la diffusion" in the Control window and returns the Broadcast window. */
export async function openBroadcastWindow(
  app: ElectronApplication,
  controlWindow: Page,
): Promise<Page> {
  const broadcastOpened = app.waitForEvent('window');
  await controlWindow.getByRole('button', { name: 'Ouvrir la diffusion' }).click();
  const broadcastWindow = await broadcastOpened;
  await broadcastWindow.waitForLoadState('domcontentloaded');
  return broadcastWindow;
}

/**
 * From the Campaign list home page, creates a Campaign named `name`; the Control window then
 * shows that Campaign's screen.
 */
export async function createCampaign(
  controlWindow: Page,
  name = 'Campagne de test',
): Promise<void> {
  await controlWindow.getByRole('button', { name: 'Créer une campagne' }).click();
  await controlWindow.getByLabel('Nom de la campagne').fill(name);
  await controlWindow.getByRole('button', { name: 'Créer', exact: true }).click();
  await controlWindow.getByRole('heading', { name, exact: true }).waitFor();
}

/** Path of a file in tests/app/fixtures. */
export function fixture(name: string): string {
  return path.join(__dirname, 'fixtures', name);
}

/** A colour as red, green and blue from 0 to 255. */
export interface Colour {
  red: number;
  green: number;
  blue: number;
}

/**
 * Writes a plain-colour PNG of `width` × `height` named `name` in the data folder, to pick,
 * made by the app's own image facilities. Different colours give different content, so
 * different Media.
 */
export async function picturePng(
  { app, dataDir }: RunningApp,
  name: string,
  size: { width: number; height: number },
  colour: Colour = { red: 200, green: 40, blue: 0 },
): Promise<string> {
  const base64 = await app.evaluate(
    ({ nativeImage }, { width, height, red, green, blue }) => {
      const bitmap = Buffer.alloc(width * height * 4);
      for (let i = 0; i < bitmap.length; i += 4) {
        // BGRA
        bitmap[i] = blue;
        bitmap[i + 1] = green;
        bitmap[i + 2] = red;
        bitmap[i + 3] = 255;
      }
      return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG().toString('base64');
    },
    { ...size, ...colour },
  );
  const folder = path.join(dataDir, 'picked');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
  return file;
}

/** `test` with a `regie` fixture: the built app running on a fresh temporary data folder. */
export const test = base.extend<{ regie: RunningApp }>({
  regie: async ({}, use) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'regie-test-'));
    const running = await launchApp(dataDir);
    try {
      await use(running);
    } finally {
      await running.app.close().catch(() => undefined);
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';
