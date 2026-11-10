import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, expect, launchApp, openBroadcastWindow, test } from './harness';

/** The Campaign list home page. */
function campaignList(page: Page) {
  return page.getByRole('list', { name: 'Campagnes' });
}

async function backToCampaignList(page: Page) {
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
}

async function renameCampaign(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `Renommer ${from}` }).click();
  await page.getByLabel('Nouveau nom').fill(to);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

test('first launch shows an empty Campaign list inviting to create one', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;

  await expect(controlWindow.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
  await expect(controlWindow.getByText('Aucune campagne pour l’instant.')).toBeVisible();
  await expect(controlWindow.getByRole('button', { name: 'Créer une campagne' })).toBeVisible();
  await expect(campaignList(controlWindow).getByRole('listitem')).toHaveCount(0);
  // No hidden default Campaign on disk either.
  await expect(fs.readdir(path.join(dataDir, 'campaigns'))).rejects.toThrow();
});

test('a created Campaign opens, and lives in its own folder with its theme', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;

  await createCampaign(controlWindow, 'Les Ombres de Tarsis');

  await expect(controlWindow.getByRole('heading', { name: 'Les Ombres de Tarsis' })).toBeVisible();
  const folders = await fs.readdir(path.join(dataDir, 'campaigns'));
  expect(folders).toHaveLength(1);
  const stored = JSON.parse(
    await fs.readFile(path.join(dataDir, 'campaigns', folders[0], 'campaign.json'), 'utf8'),
  );
  expect(stored).toMatchObject({ name: 'Les Ombres de Tarsis', theme: 'imperium' });
});

test('an empty name is refused with a message', async ({ regie }) => {
  const { controlWindow } = regie;
  await controlWindow.getByRole('button', { name: 'Créer une campagne' }).click();
  await controlWindow.getByLabel('Nom de la campagne').fill('   ');
  await controlWindow.getByRole('button', { name: 'Créer', exact: true }).click();

  await expect(controlWindow.getByRole('alert')).toHaveText('Donnez un nom à la campagne.');
  await expect(campaignList(controlWindow).getByRole('listitem')).toHaveCount(0);
});

test('created and renamed Campaigns survive a restart', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wras');
  await backToCampaignList(controlWindow);
  await renameCampaign(controlWindow, 'Star Wras', 'Star Wars');
  await controlWindow.getByRole('button', { name: 'Créer une campagne' }).click();
  await controlWindow.getByLabel('Nom de la campagne').fill('Warhammer');
  await controlWindow.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(controlWindow.getByRole('heading', { name: 'Warhammer' })).toBeVisible();

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const items = campaignList(restarted.controlWindow).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Star Wars');
    await expect(items.nth(1)).toContainText('Warhammer');
  } finally {
    await restarted.app.close();
  }
});

test('with exactly one Campaign, the app opens directly inside it', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  // Its theme is stored with it and comes back on restart.
  await controlWindow.getByRole('button', { name: /Rétro SF/ }).click();
  await expect(controlWindow.locator('html')).toHaveAttribute('data-theme', 'retro');

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(page.getByRole('heading', { name: 'Star Wars' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
    // The list stays reachable, for creating another Campaign.
    await backToCampaignList(page);
    await expect(campaignList(page).getByRole('listitem')).toHaveCount(1);
  } finally {
    await restarted.app.close();
  }
});

test('a corrupt Campaign is recovered from its backup and the Game Master is told', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await backToCampaignList(controlWindow);
  await renameCampaign(controlWindow, 'Star Wars', 'Star Wars : Rébellion');
  await expect(campaignList(controlWindow)).toContainText('Star Wars : Rébellion');
  await app.close();

  const [folder] = await fs.readdir(path.join(dataDir, 'campaigns'));
  await fs.writeFile(path.join(dataDir, 'campaigns', folder, 'campaign.json'), '{ "schemaVers');

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(page.getByRole('heading', { name: 'Star Wars', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Avertissements' })).toContainText(
      'restauré depuis sa dernière sauvegarde',
    );
  } finally {
    await restarted.app.close();
  }
});

test('opening a Campaign puts it on air, going back to the list closes it', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const stage = broadcastWindow.locator('main.stage-screen');

  await createCampaign(controlWindow, 'Star Wars');
  const [id] = await fs.readdir(path.join(dataDir, 'campaigns'));
  await expect(stage).toHaveAttribute('data-campaign-id', id);

  await backToCampaignList(controlWindow);
  await expect(stage).toHaveAttribute('data-campaign-id', '');

  await campaignList(controlWindow).getByRole('button', { name: 'Star Wars', exact: true }).click();
  await expect(stage).toHaveAttribute('data-campaign-id', id);
});
