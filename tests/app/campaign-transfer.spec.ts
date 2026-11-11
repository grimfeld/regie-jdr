import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { createCampaign, expect, fixture, stubFilePicker, test, type RunningApp } from './harness';

const IMAGE = 'red-16x9';
/** Large enough that an Export or Import of it runs for a while, small enough for a test disk. */
const BIG_MEDIA_BYTES = 1024 * 1024 * 1024;

test.setTimeout(180_000);

/** Replaces the native save dialog in the main process: the next ones save to `filePath`. */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, filePath);
}

async function backToCampaignList(page: Page) {
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
}

/** SHA-256 of `size` zero bytes, without holding them in memory. */
function zerosHash(size: number): string {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(16 * 1024 * 1024);
  for (let left = size; left > 0; left -= chunk.byteLength) {
    hash.update(left >= chunk.byteLength ? chunk : chunk.subarray(0, left));
  }
  return hash.digest('hex');
}

/**
 * A closed Campaign named `name` whose one image Media is a file of BIG_MEDIA_BYTES zero bytes,
 * stored under its real hash, as an import of such a file would leave it.
 */
async function bigCampaign({ app, controlWindow: page, dataDir }: RunningApp, name: string) {
  await createCampaign(page, name);
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await backToCampaignList(page);

  const [id] = await fs.readdir(path.join(dataDir, 'campaigns'));
  const folder = path.join(dataDir, 'campaigns', id);
  const [small] = await fs.readdir(path.join(folder, 'media'));
  const oldHash = path.parse(small).name;
  const newHash = zerosHash(BIG_MEDIA_BYTES);
  await fs.rm(path.join(folder, 'media', small));
  const big = await fs.open(path.join(folder, 'media', `${newHash}.png`), 'w');
  await big.truncate(BIG_MEDIA_BYTES);
  await big.close();
  const index = path.join(folder, 'media.json');
  await fs.writeFile(index, (await fs.readFile(index, 'utf8')).replaceAll(oldHash, newHash));
  return { id };
}

test('a large Export shows its progress, and Cancel leaves no file at the chosen place', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await bigCampaign(regie, 'Les Ombres');
  const out = path.join(dataDir, 'out');
  await fs.mkdir(out);
  await stubSaveDialog(app, path.join(out, 'Les Ombres.zip'));

  await page.getByRole('button', { name: 'Exporter Les Ombres' }).click();

  const transfer = page.getByRole('group', { name: 'Export de la campagne' });
  await expect(transfer.getByRole('progressbar')).toBeVisible();
  await expect(transfer).toContainText(/sur 1 Go/);
  // One Export or Import at a time.
  await expect(page.getByRole('button', { name: 'Importer une campagne' })).toBeDisabled();
  await transfer.getByRole('button', { name: 'Annuler l’export' }).click();

  await expect(
    page.getByText('Export annulé : aucun fichier n’a été enregistré.', { exact: true }),
  ).toBeVisible();
  await expect(transfer).toBeHidden();
  expect(await fs.readdir(out)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Exporter Les Ombres' })).toBeEnabled();
});

test('a large Import shows its progress, and Cancel leaves no folder and no Campaign', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  const { id } = await bigCampaign(regie, 'Les Ombres');
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await stubSaveDialog(app, zip);
  await page.getByRole('button', { name: 'Exporter Les Ombres' }).click();
  await expect(page.getByText('Campagne exportée.', { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  await stubFilePicker(app, [zip]);
  await page.getByRole('button', { name: 'Importer une campagne' }).click();

  const transfer = page.getByRole('group', { name: 'Import de la campagne' });
  await expect(transfer.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exporter Les Ombres' })).toBeDisabled();
  await transfer.getByRole('button', { name: 'Annuler l’import' }).click();

  await expect(
    page.getByText('Import annulé : aucune campagne n’a été ajoutée.', { exact: true }),
  ).toBeVisible();
  await expect(transfer).toBeHidden();
  await expect(page.getByRole('list', { name: 'Campagnes' }).getByRole('listitem')).toHaveCount(1);
  expect(await fs.readdir(path.join(dataDir, 'campaigns'))).toEqual([id]);
  expect(await fs.readdir(path.join(dataDir, 'imports'))).toEqual([]);
});
