import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, expect, test } from './harness';

/*
 * A running order move (#70) is shown at once, before it is saved. When the save fails, the
 * list goes back to the order as saved and a notice says so in French.
 */

const NOT_SAVED = 'L’ordre des scènes n’a pas pu être enregistré';

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function names(page: Page) {
  return scenesPanel(page).getByRole('list', { name: 'Scènes de la campagne' }).getByRole('button');
}

function sceneEntry(page: Page, name: string) {
  return scenesPanel(page)
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true });
}

async function createScenes(page: Page, sceneNames: string[]) {
  for (const name of sceneNames) {
    await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
    await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
    await expect(sceneEntry(page, name)).toBeVisible();
  }
}

/** The one Campaign's saved Scenes file. */
async function scenesFile(dataDir: string): Promise<string> {
  const folders = await fs.readdir(path.join(dataDir, 'campaigns'));
  expect(folders).toHaveLength(1);
  return path.join(dataDir, 'campaigns', folders[0], 'scenes.json');
}

test('a move that cannot be written to disk goes back, with a notice', async ({ regie }) => {
  const { controlWindow: page, dataDir } = regie;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, ['Cantina', 'Hangar', 'Dune']);

  // A folder where the save writes its temporary file: every write of the Scenes fails.
  const blocker = `${await scenesFile(dataDir)}.tmp`;
  await fs.mkdir(blocker);
  try {
    await sceneEntry(page, 'Dune').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.getByRole('alert')).toContainText(NOT_SAVED);
    await expect(names(page)).toHaveText(['Cantina', 'Hangar', 'Dune']);
  } finally {
    await fs.rm(blocker, { recursive: true, force: true });
  }

  // Once the disk is writable again, moves save as before.
  await sceneEntry(page, 'Dune').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(names(page)).toHaveText(['Cantina', 'Dune', 'Hangar']);
});

test('a move of a Scene deleted meanwhile goes back to the saved Scenes, with a notice', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, ['Cantina', 'Hangar', 'Dune']);

  // Hangar disappears from the saved Campaign behind the window's back.
  const file = await scenesFile(dataDir);
  const saved = JSON.parse(await fs.readFile(file, 'utf8')) as {
    scenes: { name: string }[];
  };
  saved.scenes = saved.scenes.filter((scene) => scene.name !== 'Hangar');
  await fs.writeFile(file, JSON.stringify(saved));

  await sceneEntry(page, 'Hangar').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByRole('alert')).toContainText(NOT_SAVED);
  await expect(names(page)).toHaveText(['Cantina', 'Dune']);
});
