import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, expect, openBroadcastWindow, test } from './harness';

/** The app's log file, as the Game Master would find it in the data folder. */
async function logFile(dataDir: string): Promise<string> {
  return fs.readFile(path.join(dataDir, 'logs', 'regie.log'), 'utf8').catch(() => '');
}

/** The Control window still carries out a command end to end: a new Scene is created. */
async function stillWorks(controlWindow: Page) {
  const scenes = controlWindow.getByRole('region', { name: 'Scènes' });
  await scenes.getByLabel('Nom de la scène').fill('Toujours là');
  await scenes.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(
    scenes
      .getByRole('list', { name: 'Scènes de la campagne' })
      .getByRole('button', { name: 'Toujours là' }),
  ).toBeVisible();
}

test('an uncaught exception in the main process is logged and the app keeps working', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);

  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('panne simulée du processus principal');
    });
  });

  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/ERROR Uncaught exception[^\n]*\n {2}Error: panne simulée du processus principal/);
  await stillWorks(controlWindow);
});

test('a window message the main process fails to carry out shows a notice and is logged', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
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
      /ERROR IPC call failed: "media:import"\n {2}Error: sélecteur de fichiers indisponible/,
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
    const bridge = (window as unknown as { regie: { openCampaign(id: unknown): Promise<unknown> } })
      .regie;
    // Once fire-and-forget, as a careless caller would; once observed, to see what comes back.
    void bridge.openCampaign(42);
    return bridge.openCampaign(42).then(
      () => 'accepted',
      (reason: unknown) => reason,
    );
  });

  expect(failure).toMatchObject({
    kind: 'ipc-failure',
    code: 'rejected',
    channel: 'onAir:open-campaign',
  });
  await expect(controlWindow.getByRole('alert')).toContainText(
    "L'application a refusé cette demande.",
  );
  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/WARN IPC message rejected: malformed payload for "onAir:open-campaign"/);
});

test('an unhandled rejection in the main process is logged and the app keeps working', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);

  await app.evaluate(() => {
    void Promise.reject(new Error('promesse oubliée'));
  });

  await expect
    .poll(() => logFile(dataDir))
    .toMatch(/ERROR Unhandled rejection[^\n]*\n {2}Error: promesse oubliée/);
  await stillWorks(controlWindow);
});

test('an interface error shows a recoverable message instead of a blank window', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const screen = broadcastWindow.locator('main.broadcast-screen');
  await expect(screen).toHaveAttribute('data-version', '0');

  // Stand for a bug: the main process sends the Broadcast window something it cannot render.
  await app.evaluate(({ BrowserWindow }) => {
    const broadcast = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('view=broadcast'),
    );
    broadcast?.webContents.send('onAir:changed', null);
  });

  const message = broadcastWindow.getByRole('alert');
  await expect(message).toContainText('Un problème est survenu dans cette fenêtre.');
  await expect(screen).toBeHidden();
  await expect.poll(() => logFile(dataDir)).toMatch(/ERROR Window error: Interface error: /);

  await message.getByRole('button', { name: 'Réessayer' }).click();
  await expect(screen).toHaveAttribute('data-version', '0');
  await expect(message).toBeHidden();
});
