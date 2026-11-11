import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  launchApp,
  stubFilePicker,
  test,
  writeToneWav,
  type RunningApp,
} from './harness';

function soundboard(page: Page) {
  return page.getByRole('region', { name: 'Table de bruitages' });
}

function pads(page: Page) {
  return soundboard(page).getByRole('list', { name: 'Bruitages' }).getByRole('listitem');
}

function pad(page: Page, name: string) {
  return soundboard(page).getByRole('button', { name: `Jouer ${name}` });
}

function nowPlaying(page: Page) {
  return page.getByRole('region', { name: 'En cours' });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

/** Imports tone files of `seconds` as `role` ("Musique", "Bruitage"), named after `names`. */
async function importSounds(
  { app, controlWindow, dataDir }: RunningApp,
  role: string,
  seconds: number,
  ...names: string[]
) {
  const folder = path.join(dataDir, `sons-${role}`);
  await fs.mkdir(folder, { recursive: true });
  const files = await Promise.all(
    names.map((name, index) => writeToneWav(folder, name, 440 + 110 * index, seconds)),
  );
  await stubFilePicker(app, files);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await controlWindow
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: role })
    .click();
  for (const name of names) await expect(soundInLibrary(controlWindow, name)).toBeVisible();
}

/**
 * Drags a library sound onto the Soundboard, over its heading: a synthetic drag ending over a
 * pad's name field or slider never reaches the page (no dragenter), so the panel's centre is
 * not a safe target once it has a pad.
 */
async function dropOnSoundboard(page: Page, name: string) {
  await soundInLibrary(page, name)
    .locator('.media-audio-icon')
    .dragTo(soundboard(page), { targetPosition: { x: 40, y: 20 } });
}

test('a pad lights while its Sound effect sounds and goes out after, with nothing on air', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importSounds(regie, 'Bruitage', 1, 'Épée');
  await importSounds(regie, 'Musique', 2, 'Auberge');
  await expect(soundboard(controlWindow)).toContainText('Déposez un bruitage');

  // Only Sound effects make pads.
  await dropOnSoundboard(controlWindow, 'Auberge');
  await dropOnSoundboard(controlWindow, 'Épée');
  await expect(pads(controlWindow)).toHaveCount(1);
  await expect(pad(controlWindow, 'Épée')).toHaveAttribute('aria-pressed', 'false');

  // No Scene was ever Activated.
  await pad(controlWindow, 'Épée').click();

  await expect(pad(controlWindow, 'Épée')).toHaveAttribute('aria-pressed', 'true');
  await expect(nowPlaying(controlWindow).getByRole('listitem')).toHaveText([/Épée/]);
  // The tone lasts 1 s: played once, the pad goes out.
  await expect(pad(controlWindow, 'Épée')).toHaveAttribute('aria-pressed', 'false', {
    timeout: 5000,
  });
  await expect(nowPlaying(controlWindow)).toContainText('Aucun son.');
});

test('pads are renamed, reordered, given a volume and removed, saved per Campaign', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importSounds(regie, 'Bruitage', 1, 'Épée', 'Cri');
  await dropOnSoundboard(controlWindow, 'Épée');
  await expect(pads(controlWindow)).toHaveCount(1);
  await dropOnSoundboard(controlWindow, 'Cri');
  await expect(pads(controlWindow)).toHaveCount(2);

  const board = soundboard(controlWindow);
  await board.getByRole('textbox', { name: 'Nom de Épée' }).fill('Lame');
  await board.getByRole('textbox', { name: 'Nom de Épée' }).press('Enter');
  await expect(pad(controlWindow, 'Lame')).toBeVisible();
  await board.getByRole('button', { name: 'Avancer Cri' }).click();
  await expect(pads(controlWindow).getByRole('button', { name: /^Jouer/ })).toHaveText([
    /Cri/,
    /Lame/,
  ]);
  await board.getByRole('slider', { name: 'Volume de Cri' }).fill('30');
  await board.getByRole('slider', { name: 'Niveau de la table' }).fill('50');
  await expect(board.getByRole('slider', { name: 'Niveau de la table' })).toHaveValue('50');
  // Wait for the last value to be saved before the restart.
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        const { regie } = window as unknown as {
          regie: {
            listCampaigns(): Promise<{ id: string }[]>;
            getSoundboard(id: string): Promise<{ volume: number; pads: { volume: number }[] }>;
          };
        };
        const [campaign] = await regie.listCampaigns();
        const saved = await regie.getSoundboard(campaign.id);
        return [saved.volume, saved.pads[0]?.volume];
      }),
    )
    .toEqual([0.5, 0.3]);

  // Another Campaign has its own, empty Soundboard.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await expect(pads(controlWindow)).toHaveCount(0);

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const page = restarted.controlWindow;
    await page
      .getByRole('list', { name: 'Campagnes' })
      .getByRole('button', { name: 'Star Wars', exact: true })
      .click();
    await expect(pads(page).getByRole('button', { name: /^Jouer/ })).toHaveText([/Cri/, /Lame/]);
    await expect(soundboard(page).getByRole('slider', { name: 'Volume de Cri' })).toHaveValue('30');
    await expect(soundboard(page).getByRole('slider', { name: 'Niveau de la table' })).toHaveValue(
      '50',
    );

    await soundboard(page).getByRole('button', { name: 'Retirer Lame' }).click();
    await expect(pads(page)).toHaveCount(1);
    await expect(pad(page, 'Cri')).toBeVisible();
  } finally {
    await restarted.app.close();
  }
});

test('deleting a Sound effect used by pads warns, listing them, then removes them', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importSounds(regie, 'Bruitage', 1, 'Épée');
  await dropOnSoundboard(controlWindow, 'Épée');
  await expect(pads(controlWindow)).toHaveCount(1);
  await dropOnSoundboard(controlWindow, 'Épée');
  await expect(pads(controlWindow)).toHaveCount(2);
  const board = soundboard(controlWindow);
  await board.getByRole('textbox', { name: 'Nom de Épée' }).last().fill('Parade');
  await board.getByRole('textbox', { name: 'Nom de Épée' }).last().press('Enter');
  await expect(pad(controlWindow, 'Parade')).toBeVisible();

  const remove = soundInLibrary(controlWindow, 'Épée').getByRole('button', {
    name: 'Supprimer Épée',
  });
  await remove.click();
  const confirmation = controlWindow.getByRole('alertdialog', { name: 'Supprimer le média' });
  await expect(confirmation).toContainText('table de bruitages');
  await expect(
    confirmation.getByRole('list', { name: 'Pads concernés' }).getByRole('listitem'),
  ).toHaveText([/Épée/, /Parade/]);
  await confirmation.getByRole('button', { name: 'Annuler' }).click();
  await expect(pads(controlWindow)).toHaveCount(2);

  await remove.click();
  await confirmation.getByRole('button', { name: 'Supprimer quand même' }).click();

  await expect(soundInLibrary(controlWindow, 'Épée')).toHaveCount(0);
  await expect(pads(controlWindow)).toHaveCount(0);
});
