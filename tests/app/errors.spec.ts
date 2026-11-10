import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, openBroadcastWindow, test } from './harness';

/** The app's log file, as the Game Master would find it in the data folder. */
async function logFile(dataDir: string): Promise<string> {
  return fs.readFile(path.join(dataDir, 'logs', 'regie.log'), 'utf8').catch(() => '');
}

test('an uncaught exception in the main process is logged and the app keeps working', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;

  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('panne simulée du processus principal');
    });
  });

  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/ERROR Uncaught exception[^\n]*\n {2}Error: panne simulée du processus principal/);
  await controlWindow.getByLabel('TITRE DE LA SCÈNE').fill('Toujours là');
  await expect(controlWindow.getByRole('heading', { level: 2, name: 'Toujours là' })).toBeVisible();
});

test('a window message the main process fails to carry out shows a notice and is logged', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => {
      throw new Error('sélecteur de fichiers indisponible');
    }) as typeof dialog.showOpenDialog;
  });

  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();

  const notice = controlWindow.getByRole('alert');
  await expect(notice).toContainText("L'action n'a pas pu aboutir.");
  await expect
    .poll(() => logFile(dataDir))
    .toMatch(
      /ERROR IPC call failed: "media:import-images"\n {2}Error: sélecteur de fichiers indisponible/,
    );

  await notice.getByRole('button', { name: 'Fermer' }).click();
  await expect(notice).toBeHidden();
});

test('a window message refused by the main process comes back typed and shows a notice', async ({
  regie,
}) => {
  const { controlWindow, dataDir } = regie;

  // Stand for a bug in the interface: a malformed call through the Control window's own bridge.
  const failure = await controlWindow.evaluate(() => {
    const bridge = (window as unknown as { regie: { setDisplay(display: unknown): Promise<void> } })
      .regie;
    // Once fire-and-forget, as a careless caller would; once observed, to see what comes back.
    void bridge.setDisplay({ title: 42 });
    return bridge.setDisplay({ title: 42 }).then(
      () => 'accepted',
      (reason: unknown) => reason,
    );
  });

  expect(failure).toMatchObject({ kind: 'ipc-failure', code: 'rejected', channel: 'display:set' });
  await expect(controlWindow.getByRole('alert')).toContainText(
    "L'application a refusé cette demande.",
  );
  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/WARN IPC message rejected: malformed payload for "display:set"/);
});

test('an unhandled rejection in the main process is logged and the app keeps working', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;

  await app.evaluate(() => {
    void Promise.reject(new Error('promesse oubliée'));
  });

  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/ERROR Unhandled rejection[^\n]*\n {2}Error: promesse oubliée/);
  await controlWindow.getByLabel('TITRE DE LA SCÈNE').fill('Toujours là');
  await expect(controlWindow.getByRole('heading', { level: 2, name: 'Toujours là' })).toBeVisible();
});

test('an interface error shows a recoverable message instead of a blank window', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await controlWindow.getByLabel('TITRE DE LA SCÈNE').fill('La taverne');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText('La taverne');

  // Stand for a bug: the main process sends the Broadcast window something it cannot render.
  await app.evaluate(({ BrowserWindow }) => {
    const stage = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('view=stage'),
    );
    stage?.webContents.send('display:changed', null);
  });

  const message = broadcastWindow.getByRole('alert');
  await expect(message).toContainText('Un problème est survenu dans cette fenêtre.');
  await expect.poll(() => logFile(dataDir)).toMatch(/ERROR Window error: Interface error: /);

  await message.getByRole('button', { name: 'Réessayer' }).click();
  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText('La taverne');
});
