import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchApp, test } from './harness';

/**
 * Replaces the Windows Recycle Bin in the main process (`shell.trashItem`), so a test never
 * reaches the real one: `move` moves the folder into `<dataDir>/fake-recycle-bin`, `refuse`
 * fails like a network drive. Must run before any delete.
 */
async function stubRecycleBin(app: ElectronApplication, dataDir: string, mode: 'move' | 'refuse') {
  const bin = path.join(dataDir, 'fake-recycle-bin');
  await app.evaluate(
    ({ shell }, { bin, mode }) => {
      shell.trashItem = (folder: string) => {
        if (mode === 'refuse') return Promise.reject(new Error('Network drive: no Recycle Bin'));
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(folder, path.join(bin, path.basename(folder)));
        return Promise.resolve();
      };
    },
    { bin, mode },
  );
  return bin;
}

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Calls the Control window's bridge, as the page would. */
function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, params]) => (window as unknown as { regie: Bridge }).regie[name](...params) as T,
    [method, args] as const,
  );
}

/**
 * Two Campaigns, "Star Wars" with two Scenes, one of them its last Active Scene, and
 * "Warhammer"; the Control window then shows the Campaign list. Returns Star Wars' id.
 */
async function twoCampaigns(page: Page): Promise<string> {
  const { id } = await call<{ id: string }>(page, 'createCampaign', 'Star Wars');
  const { id: sceneId } = await call<{ id: string }>(page, 'createScene', id, 'Cantina');
  await call(page, 'createScene', id, 'Hangar');
  await call(page, 'openCampaign', id);
  await call(page, 'activateScene', sceneId);
  await call(page, 'closeCampaign');
  await call(page, 'createCampaign', 'Warhammer');
  await page.reload();
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(2);
  return id;
}

function campaignList(page: Page) {
  return page.getByRole('list', { name: 'Campagnes' });
}

async function lastActiveScenes(dataDir: string): Promise<Record<string, string>> {
  const settings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8')) as {
    lastActiveSceneByCampaign: Record<string, string>;
  };
  return settings.lastActiveSceneByCampaign;
}

test('a Campaign deleted from the list goes to the Recycle Bin, for good across a restart', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  const bin = await stubRecycleBin(app, dataDir, 'move');
  const id = await twoCampaigns(page);
  await expect.poll(() => lastActiveScenes(dataDir)).toHaveProperty(id);

  await page.getByRole('button', { name: 'Supprimer Star Wars' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Supprimer la campagne' });
  await expect(dialog).toContainText('« Star Wars »');
  await expect(dialog).toContainText(/2 scènes et 0 média, [\d,]+ Ko/);
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();

  // Cancelling deletes nothing.
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Supprimer Star Wars' }).click();
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();

  // The Game Master stays on the list, even with one Campaign left.
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(1);
  await expect(campaignList(page)).toContainText('Warhammer');
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
  await expect(fs.stat(path.join(dataDir, 'campaigns', id))).rejects.toThrow();
  await expect(fs.stat(path.join(bin, id, 'campaign.json'))).resolves.toBeTruthy();
  expect(await lastActiveScenes(dataDir)).toEqual({});

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    // One Campaign left: the app opens straight into it, and Star Wars is gone from the list.
    await expect(restarted.controlWindow.getByRole('heading', { name: 'Warhammer' })).toBeVisible();
    await restarted.controlWindow.getByRole('button', { name: 'Campagnes' }).click();
    await expect(campaignList(restarted.controlWindow).getByRole('listitem')).toHaveCount(1);
    await expect(campaignList(restarted.controlWindow)).not.toContainText('Star Wars');
  } finally {
    await restarted.app.close();
  }
});

test('when the Recycle Bin refuses, nothing is deleted until a second confirmation', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  const bin = await stubRecycleBin(app, dataDir, 'refuse');
  const id = await twoCampaigns(page);
  const folder = path.join(dataDir, 'campaigns', id, 'campaign.json');

  await page.getByRole('button', { name: 'Supprimer Star Wars' }).click();
  await page
    .getByRole('alertdialog', { name: 'Supprimer la campagne' })
    .getByRole('button', { name: 'Supprimer', exact: true })
    .click();

  const permanent = page.getByRole('alertdialog', {
    name: 'Supprimer définitivement la campagne',
  });
  await expect(permanent).toContainText('corbeille de Windows n’a pas accepté');
  await expect(permanent).toContainText('ne pourra pas être récupérée');
  await expect(fs.stat(folder)).resolves.toBeTruthy();
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(2);

  // Declining the permanent delete keeps the Campaign.
  await permanent.getByRole('button', { name: 'Annuler' }).click();
  await expect(permanent).toBeHidden();
  await expect(fs.stat(folder)).resolves.toBeTruthy();

  await page.getByRole('button', { name: 'Supprimer Star Wars' }).click();
  await page
    .getByRole('alertdialog', { name: 'Supprimer la campagne' })
    .getByRole('button', { name: 'Supprimer', exact: true })
    .click();
  await permanent.getByRole('button', { name: 'Supprimer définitivement' }).click();

  await expect(campaignList(page).getByRole('listitem')).toHaveCount(1);
  await expect(fs.stat(path.join(dataDir, 'campaigns', id))).rejects.toThrow();
  await expect(fs.stat(bin)).rejects.toThrow();
  expect(await lastActiveScenes(dataDir)).toEqual({});
});

test('delete is never offered inside a Campaign, and the open Campaign cannot be deleted', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await stubRecycleBin(app, dataDir, 'move');
  const id = await twoCampaigns(page);

  await campaignList(page).getByRole('button', { name: 'Star Wars', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Star Wars', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Supprimer Star Wars/ })).toHaveCount(0);

  // Even asked directly through the bridge, the main process refuses.
  const outcome = await page.evaluate(
    (campaignId) =>
      (window as unknown as { regie: Bridge }).regie.moveCampaignToTrash(campaignId).then(
        () => 'deleted',
        () => 'refused',
      ),
    id,
  );
  expect(outcome).toBe('refused');
  await expect(fs.stat(path.join(dataDir, 'campaigns', id, 'campaign.json'))).resolves.toBeTruthy();

  // Named with other letter cases, it is the same folder on Windows: refused too, for delete
  // and Export alike (a cancelled save dialog would answer instead of a refusal).
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
  });
  for (const method of ['moveCampaignToTrash', 'exportCampaign']) {
    const shouted = await page.evaluate(
      ([name, campaignId]) =>
        (window as unknown as { regie: Bridge }).regie[name](campaignId).then(
          () => 'done',
          () => 'refused',
        ),
      [method, id.toUpperCase()] as const,
    );
    expect(shouted, method).toBe('refused');
  }
  await expect(fs.stat(path.join(dataDir, 'campaigns', id, 'campaign.json'))).resolves.toBeTruthy();
});
