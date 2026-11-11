import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  openBroadcastWindow,
  stubFilePicker,
  test,
  writeToneWav,
  type RunningApp,
} from './harness';

function soundboard(page: Page) {
  return page.getByRole('region', { name: 'Table de bruitages' });
}

function pad(page: Page, name: string) {
  return soundboard(page).getByRole('button', { name: `Jouer ${name}` });
}

function silenceButton(page: Page) {
  return page.getByRole('region', { name: 'En cours' }).getByRole('button', { name: 'Silence' });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

/** Imports 1.5 s tones as Sound effects named `names`, and makes a pad of each, in order. */
async function padsOf(regie: RunningApp, ...names: string[]) {
  const { app, controlWindow: page, dataDir } = regie;
  const folder = path.join(dataDir, 'bruitages');
  await fs.mkdir(folder, { recursive: true });
  const files = await Promise.all(
    names.map((name, index) => writeToneWav(folder, name, 440 + 110 * index, 1.5)),
  );
  await stubFilePicker(app, files);
  await page.getByRole('button', { name: 'Importer des sons' }).click();
  await page
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: 'Bruitage' })
    .click();
  for (const name of names) {
    // Over the panel's heading: a drop over a pad's field or slider never reaches the page.
    await soundInLibrary(page, name)
      .locator('.media-audio-icon')
      .dragTo(soundboard(page), { targetPosition: { x: 40, y: 20 } });
    await expect(pad(page, name)).toBeVisible();
  }
}

test('number keys play pads in Soundboard order and S toggles Silence, keys shown', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await padsOf(regie, 'Épée', 'Cri');

  // The keys are shown on the pads and the Silence button.
  await expect(pad(page, 'Épée').locator('kbd')).toHaveText('1');
  await expect(pad(page, 'Cri').locator('kbd')).toHaveText('2');
  await expect(pad(page, 'Cri')).toHaveAttribute('aria-keyshortcuts', '2');
  await expect(silenceButton(page)).toHaveAttribute('aria-keyshortcuts', 'S');
  await expect(silenceButton(page).locator('kbd')).toHaveText('S');

  // Focus on the page itself, as after clicking an empty spot.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Numpad2');
  await expect(pad(page, 'Cri')).toHaveAttribute('aria-pressed', 'true');
  await expect(pad(page, 'Épée')).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Digit1');
  await expect(pad(page, 'Épée')).toHaveAttribute('aria-pressed', 'true');

  // A number with no pad does nothing.
  await page.keyboard.press('Digit9');

  await page.keyboard.press('s');
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  // Silence cuts the sounding pads.
  await expect(pad(page, 'Épée')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('s');
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('shortcut keys do nothing while typing in a field or in another window', async ({ regie }) => {
  const { app, controlWindow: page } = regie;
  await createCampaign(page, 'Star Wars');
  await padsOf(regie, 'Épée');

  // Typing a pad's new name: the "1" and the "s" are text.
  const name = soundboard(page).getByRole('textbox', { name: 'Nom de Épée' });
  await name.click();
  await page.keyboard.type('s1');
  await expect(name).toHaveValue('s1');
  await name.fill('');
  // Same in the Scene name field.
  const sceneName = page.getByRole('region', { name: 'Scènes' }).getByLabel('Nom de la scène');
  await sceneName.click();
  await page.keyboard.press('Digit1');
  await page.keyboard.press('s');
  await expect(sceneName).toHaveValue('1s');

  // Keys pressed in the Broadcast window reach nothing in the Control window.
  const broadcast = await openBroadcastWindow(app, page);
  await broadcast.keyboard.press('Digit1');
  await broadcast.keyboard.press('s');

  await page.waitForTimeout(500);
  await expect(pad(page, 'Épée')).toHaveAttribute('aria-pressed', 'false');
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'En cours' })).toContainText('Aucun son.');
});
