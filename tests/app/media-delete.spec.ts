import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

function library(page: Page) {
  return page.getByRole('list', { name: 'Médias' });
}

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function confirmation(page: Page) {
  return page.getByRole('alertdialog', { name: 'Supprimer le média' });
}

async function storedMediaFiles(dataDir: string): Promise<string[]> {
  const campaigns = await fs.readdir(path.join(dataDir, 'campaigns'));
  const files = await Promise.all(
    campaigns.map((id) =>
      fs.readdir(path.join(dataDir, 'campaigns', id, 'media')).catch(() => [] as string[]),
    ),
  );
  return files.flat();
}

async function importImage({ app, controlWindow }: RunningApp) {
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(library(controlWindow).getByRole('img', { name: IMAGE })).toBeVisible();
}

async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Places the imported image as a visible Background of the Selected Scene. */
async function showImageAsBackground(page: Page) {
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en arrière-plan' }).click();
  await editor(page)
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` })
    .check();
}

function deleteButton(page: Page) {
  return library(page).getByRole('button', { name: `Supprimer ${IMAGE}` });
}

test('deleting unused Media removes it and its file at once', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Hangar');
  expect(await storedMediaFiles(dataDir)).toHaveLength(1);

  await deleteButton(controlWindow).click();

  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(0);
  await expect(confirmation(controlWindow)).toHaveCount(0);
  await expect.poll(() => storedMediaFiles(dataDir)).toEqual([]);
});

test('deleting Media used by Scenes lists them; confirming removes their placements and updates the broadcast', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, failedRequests } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Hangar');
  await createScene(controlWindow, 'Cantina');
  await showImageAsBackground(controlWindow);
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const shown = broadcastWindow.locator(
    'main.broadcast-screen .canvas-background img:not([hidden])',
  );
  await expect(shown).toHaveCount(1);

  // Cancelling changes nothing.
  await deleteButton(controlWindow).click();
  const dialog = confirmation(controlWindow);
  await expect(dialog.getByRole('listitem')).toHaveText(['Cantina']);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(library(controlWindow).getByRole('img', { name: IMAGE })).toBeVisible();
  await expect(shown).toHaveCount(1);
  expect(await storedMediaFiles(dataDir)).toHaveLength(1);

  // Confirming removes the Media, its file, its placement; the broadcast drops it.
  await deleteButton(controlWindow).click();
  await confirmation(controlWindow).getByRole('button', { name: 'Supprimer quand même' }).click();
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(0);
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await expect(
    editor(controlWindow).getByRole('list', { name: 'Arrière-plans' }).getByRole('listitem'),
  ).toHaveCount(0);
  await expect.poll(() => storedMediaFiles(dataDir)).toEqual([]);
  expect(failedRequests).toEqual([]);
});
