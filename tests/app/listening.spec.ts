import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  dragOnScreen,
  expect,
  stubFilePicker,
  test,
  writeToneWav,
  type RunningApp,
} from './harness';

// Listening to a library sound (#43). ADR-0002: Discord carries all app audio, so listening is
// allowed only during Silence once nothing else sounds, with an "audible by players" warning.

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function nowPlaying(page: Page) {
  return page.getByRole('region', { name: 'En cours' });
}

function silenceButton(page: Page) {
  return nowPlaying(page).getByRole('button', { name: 'Silence' });
}

function sounding(page: Page, name: string) {
  return nowPlaying(page).getByRole('listitem').filter({ hasText: name });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

function listenButton(page: Page, name: string) {
  return soundInLibrary(page, name).getByRole('button', { name: `Écouter ${name}` });
}

function warning(page: Page) {
  return page.getByRole('note', { name: 'Écoute audible par les joueurs' });
}

function soundboard(page: Page) {
  return page.getByRole('region', { name: 'Table de bruitages' });
}

/** Imports tone files of `seconds` as `role`, named after `names`. */
async function importSounds(
  { app, controlWindow, dataDir }: RunningApp,
  role: 'Musique' | 'Bruitage',
  seconds: number,
  ...names: string[]
) {
  const folder = path.join(dataDir, `sons-${role}`);
  await fs.mkdir(folder, { recursive: true });
  const files = await Promise.all(
    names.map((name, index) => writeToneWav(folder, name, 330 + 110 * index, seconds)),
  );
  await stubFilePicker(app, files);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await controlWindow
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: role, exact: true })
    .click();
  for (const name of names) await expect(soundInLibrary(controlWindow, name)).toBeVisible();
}

interface EngineWindow {
  regieAudio: { getMix(): Promise<{ voices: { name: string; gain: number }[] }> };
}

/** The mix the audio engine reads: voice names and target gains. */
async function mixOf(page: Page) {
  const mix = await page.evaluate(() => (window as unknown as EngineWindow).regieAudio.getMix());
  return mix.voices.map(({ name, gain }) => ({ name, gain }));
}

/** Whether the library's listening player is playing (not paused, time moving). */
async function playerPlaying(page: Page) {
  return page.evaluate(() => {
    const player = document.querySelector<HTMLAudioElement>('.listening-player');
    return player !== null && !player.paused && player.currentTime > 0;
  });
}

async function playerVolume(page: Page) {
  return page.evaluate(() => document.querySelector<HTMLAudioElement>('.listening-player')?.volume);
}

test('listening is allowed only during Silence and stops when Silence lifts', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await importSounds(regie, 'Musique', 30, 'Forêt');

  // Nothing sounds, but without Silence the players would hear it: refused.
  await expect(listenButton(page, 'Forêt')).toBeDisabled();
  await expect(warning(page)).toHaveCount(0);

  await silenceButton(page).click();
  await expect(listenButton(page, 'Forêt')).toBeEnabled();
  await expect(warning(page)).toBeVisible();
  await nowPlaying(page).getByRole('slider', { name: 'Volume général' }).fill('40');

  await listenButton(page, 'Forêt').click();
  await expect(listenButton(page, 'Forêt')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => playerPlaying(page)).toBe(true);
  // Apart from the mix: nothing on air, Silence still on; but the players hear it, so the
  // "En cours" strip lists it, and it plays at the Master volume, following it.
  expect(await mixOf(page)).toEqual([]);
  await expect(nowPlaying(page).getByRole('listitem')).toHaveText([/Forêt.*écoute/]);
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => playerVolume(page)).toBeCloseTo(0.4, 5);
  await nowPlaying(page).getByRole('slider', { name: 'Volume général' }).fill('20');
  await expect.poll(() => playerVolume(page)).toBeCloseTo(0.2, 5);

  // Pressed again: stops.
  await listenButton(page, 'Forêt').click();
  await expect(listenButton(page, 'Forêt')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => playerPlaying(page)).toBe(false);
  await expect(nowPlaying(page)).toContainText('Aucun son.');

  // Lifting Silence stops listening and turns the button off.
  await listenButton(page, 'Forêt').click();
  await expect.poll(() => playerPlaying(page)).toBe(true);
  await silenceButton(page).click();
  await expect(listenButton(page, 'Forêt')).toBeDisabled();
  await expect(listenButton(page, 'Forêt')).toHaveAttribute('aria-pressed', 'false');
  await expect(warning(page)).toHaveCount(0);
  await expect.poll(() => playerPlaying(page)).toBe(false);
});

test('listening during Silence leaves the Scene and its Music as they are; a pad stops it', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await importSounds(regie, 'Musique', 30, 'Auberge', 'Forêt');
  await importSounds(regie, 'Bruitage', 1, 'Épée');
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill('Taverne');
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  // The editor must be open before dragging: a drag onto a Scene still opening drops nothing.
  await expect(editor(page).getByRole('heading', { name: 'Taverne', exact: true })).toBeVisible();
  const musicList = editor(page).getByRole('list', { name: 'Musiques' });
  await soundInLibrary(page, 'Auberge')
    .locator('.media-audio-icon')
    .dragTo(musicList.locator('xpath=..'));
  await expect(musicList.getByRole('listitem')).toHaveText([/Auberge/]);
  await dragOnScreen(soundInLibrary(page, 'Épée').locator('.media-audio-icon'), soundboard(page), {
    targetPosition: { x: 40, y: 20 },
  });
  const pad = soundboard(page).getByRole('button', { name: 'Jouer Épée' });
  await expect(pad).toBeVisible();
  await editor(page).getByRole('button', { name: 'Activer', exact: true }).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');

  // The Music sounds: refused.
  await expect(listenButton(page, 'Forêt')).toBeDisabled();

  await silenceButton(page).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await expect(listenButton(page, 'Forêt')).toBeEnabled();
  const screen = page.getByRole('region', { name: 'À l’antenne' }).locator('.on-air-screen');
  const pictureVersion = await screen.getAttribute('data-version');
  const mixBefore = await mixOf(page);

  await listenButton(page, 'Forêt').click();
  await expect.poll(() => playerPlaying(page)).toBe(true);
  expect(await mixOf(page)).toEqual(mixBefore);
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await expect(sounding(page, 'Forêt')).toHaveAttribute('data-role', 'listening');
  await expect(screen).toHaveAttribute('data-version', pictureVersion ?? '');

  // A pad sounds: listening stops, and is refused until the pad has ended.
  await pad.click();
  await expect(listenButton(page, 'Forêt')).toBeDisabled();
  await expect.poll(() => playerPlaying(page)).toBe(false);
  await expect(listenButton(page, 'Forêt')).toBeEnabled({ timeout: 5000 });
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
});
