import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  stubFilePicker,
  test,
  writeToneWav,
  type RunningApp,
} from './harness';

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function musicList(page: Page) {
  return editor(page).getByRole('list', { name: 'Musiques' });
}

function ambienceList(page: Page) {
  return editor(page).getByRole('list', { name: 'Ambiances' });
}

/** An Ambience row of the open Scene, by its Media name. */
function ambience(page: Page, name: string) {
  return ambienceList(page).getByRole('listitem').filter({ hasText: name });
}

function ambienceSwitch(page: Page, name: string) {
  return ambienceList(page).getByRole('checkbox', { name: `Jouer ${name}` });
}

/** The "En cours" strip: what the audio engine reports sounding. */
function nowPlaying(page: Page) {
  return page.getByRole('region', { name: 'En cours' });
}

/** A sound of the "En cours" strip, by its Media name. */
function sounding(page: Page, name: string) {
  return nowPlaying(page).getByRole('listitem').filter({ hasText: name });
}

function undoButton(page: Page) {
  return editor(page)
    .getByRole('toolbar', { name: 'Historique de la scène' })
    .getByRole('button', { name: /annuler/i });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

/** Imports tone files under `role` ("Musique", "Ambiance"), named after `names`. */
async function importSounds(
  { app, controlWindow, dataDir }: RunningApp,
  role: 'Musique' | 'Ambiance',
  names: string[],
  firstHz: number,
  seconds?: number,
) {
  const folder = path.join(dataDir, `sons-${role}`);
  await fs.mkdir(folder, { recursive: true });
  const files = await Promise.all(
    names.map((name, index) => writeToneWav(folder, name, firstHz + 110 * index, seconds)),
  );
  await stubFilePicker(app, files);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await controlWindow
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: role, exact: true })
    .click();
  for (const name of names) await expect(soundInLibrary(controlWindow, name)).toBeVisible();
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Drags a library sound onto the open Scene's Ambiences, and waits for it to be listed. */
async function dropAmbience(page: Page, name: string) {
  await soundInLibrary(page, name)
    .locator('.media-audio-icon')
    .dragTo(ambienceList(page).locator('xpath=..'));
  // A drop made while the list re-renders can be lost: wait for this one to land.
  await expect(ambience(page, name)).toBeVisible();
}

/**
 * A Campaign with Music "Auberge" and Ambiences "Pluie" and "Feu" in its library, each
 * `seconds` long (2 by default).
 */
async function campaignWithSounds(regie: RunningApp, seconds?: number) {
  await createCampaign(regie.controlWindow, 'Star Wars');
  await importSounds(regie, 'Musique', ['Auberge'], 330, seconds);
  await importSounds(regie, 'Ambiance', ['Pluie', 'Feu'], 660, seconds);
}

async function activate(page: Page) {
  await editor(page).getByRole('button', { name: 'Activer', exact: true }).click();
}

interface EngineWindow {
  regieAudio: { getMix(): Promise<{ voices: { mediaId: string; name: string; gain: number }[] }> };
}

/** The target gain of the voice named `name` in the mix the audio engine reads. */
async function gainOf(page: Page, name: string) {
  const mix = await page.evaluate(() => (window as unknown as EngineWindow).regieAudio.getMix());
  return mix.voices.find((voice) => voice.name === name)?.gain;
}

test('Ambiences dragged onto a Scene start off; switched on, they play together under the Music', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await campaignWithSounds(regie);
  await createScene(page, 'Taverne');
  await soundInLibrary(page, 'Auberge')
    .locator('.media-audio-icon')
    .dragTo(musicList(page).locator('xpath=..'));
  await expect(musicList(page).getByRole('listitem')).toHaveText([/Auberge/]);
  await dropAmbience(page, 'Pluie');
  await dropAmbience(page, 'Feu');

  await expect(ambienceList(page).getByRole('listitem')).toHaveText([/Pluie/, /Feu/]);
  await expect(ambienceSwitch(page, 'Pluie')).not.toBeChecked();
  await expect(ambience(page, 'Feu')).toContainText('Éteinte');

  await activate(page);
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect(nowPlaying(page).getByRole('listitem')).toHaveCount(1);

  await ambienceSwitch(page, 'Pluie').check();
  await ambienceSwitch(page, 'Feu').check();
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Feu')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-role', 'ambience');

  await ambienceSwitch(page, 'Pluie').uncheck();
  await expect(sounding(page, 'Pluie')).toHaveCount(0);
  await expect(nowPlaying(page).getByRole('listitem')).toHaveCount(2);

  // On/off is saved in the Scene.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Star Wars' })).toBeVisible();
  await expect(ambienceSwitch(page, 'Feu')).toBeChecked();
  await expect(ambienceSwitch(page, 'Pluie')).not.toBeChecked();
});

test('Ambience edits on a Scene that is not active are silent; Activate starts those that are on', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await campaignWithSounds(regie);
  await createScene(page, 'Taverne');
  await activate(page);
  await createScene(page, 'Forêt');

  await dropAmbience(page, 'Pluie');
  await dropAmbience(page, 'Feu');
  await ambienceSwitch(page, 'Pluie').check();
  await expect(ambienceSwitch(page, 'Pluie')).toBeChecked();
  await expect(nowPlaying(page)).toContainText('Aucun son.');

  await activate(page);
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
  await expect(nowPlaying(page).getByRole('listitem')).toHaveCount(1);
});

test('Ambience volumes compose with Master; a slider drag is one undo step; removal undoes', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await campaignWithSounds(regie);
  await createScene(page, 'Taverne');
  await dropAmbience(page, 'Pluie');
  await ambienceSwitch(page, 'Pluie').check();
  await activate(page);
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
  await nowPlaying(page).getByRole('slider', { name: 'Volume général' }).fill('50');
  await expect.poll(() => gainOf(page, 'Pluie')).toBeCloseTo(0.5, 5);

  // The Scene Ambience level, committed when the slider is left.
  const level = editor(page).getByRole('slider', { name: 'Niveau des ambiances' });
  await level.fill('40');
  await level.blur();
  await expect(undoButton(page)).toHaveText('Annuler : régler le niveau des ambiances');
  await expect.poll(() => gainOf(page, 'Pluie')).toBeCloseTo(0.2, 5);

  // A mouse drag of the Ambience's own volume: one edit, on release.
  const volume = ambience(page, 'Pluie').getByRole('slider', { name: 'Volume de Pluie' });
  const box = await volume.boundingBox();
  if (!box) throw new Error('The volume slider is not shown.');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 8 });
  await page.mouse.up();
  await expect(undoButton(page)).toHaveText('Annuler : régler le volume de l’ambiance Pluie');
  const percent = Number(await volume.inputValue());
  expect(percent).toBeGreaterThan(20);
  expect(percent).toBeLessThan(80);
  await expect.poll(() => gainOf(page, 'Pluie')).toBeCloseTo((0.2 * percent) / 100, 5);

  // One undo takes the whole drag back.
  await undoButton(page).click();
  await expect(volume).toHaveValue('100');
  await expect(undoButton(page)).toHaveText('Annuler : régler le niveau des ambiances');
  await expect.poll(() => gainOf(page, 'Pluie')).toBeCloseTo(0.2, 5);

  // Removing the Ambience fades it out; undo brings it back, switched on.
  await ambience(page, 'Pluie').getByRole('button', { name: 'Retirer Pluie' }).click();
  await expect(ambience(page, 'Pluie')).toHaveCount(0);
  await expect(sounding(page, 'Pluie')).toHaveCount(0);
  await expect(undoButton(page)).toHaveText('Annuler : retirer l’ambiance Pluie');
  await undoButton(page).click();
  await expect(ambienceSwitch(page, 'Pluie')).toBeChecked();
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
});

interface WatchWindow {
  soundStates?: Record<string, string[]>;
}

/**
 * Starts recording what the "En cours" strip shows for `name` after every change to the strip:
 * its state, or "absent" while it is not listed. Read back with `watchedStates`.
 */
async function watchSound(page: Page, name: string) {
  await page.evaluate((watched) => {
    const states: string[] = [];
    const watching = window as unknown as WatchWindow;
    watching.soundStates = { ...watching.soundStates, [watched]: states };
    const strip = document.querySelector('section[aria-label="En cours"]');
    if (!strip) throw new Error('The "En cours" strip is not shown.');
    const record = () => {
      const item = [...strip.querySelectorAll('li')].find((li) => li.textContent.includes(watched));
      states.push(item?.getAttribute('data-state') ?? 'absent');
    };
    record();
    new MutationObserver(record).observe(strip, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }, name);
}

async function watchedStates(page: Page, name: string) {
  return page.evaluate(
    (watched) => (window as unknown as WatchWindow).soundStates?.[watched] ?? [],
    name,
  );
}

test('Activating a Scene that shares an Ambience keeps it sounding throughout, at the new level', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await campaignWithSounds(regie);
  await createScene(page, 'Taverne, jour');
  await soundInLibrary(page, 'Auberge')
    .locator('.media-audio-icon')
    .dragTo(musicList(page).locator('xpath=..'));
  await expect(musicList(page).getByRole('listitem')).toHaveText([/Auberge/]);
  await dropAmbience(page, 'Pluie');
  await ambienceSwitch(page, 'Pluie').check();
  await activate(page);
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');

  // The next Scene shares the rain, quieter, and adds the fire; it has no Music.
  await createScene(page, 'Taverne, bagarre');
  await dropAmbience(page, 'Pluie');
  await dropAmbience(page, 'Feu');
  await ambienceSwitch(page, 'Pluie').check();
  await ambienceSwitch(page, 'Feu').check();
  const level = editor(page).getByRole('slider', { name: 'Niveau des ambiances' });
  await level.fill('50');
  await level.blur();
  await expect(undoButton(page)).toHaveText('Annuler : régler le niveau des ambiances');
  expect(await gainOf(page, 'Pluie')).toBe(1);

  await watchSound(page, 'Pluie');
  await activate(page);
  await expect(sounding(page, 'Feu')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Auberge')).toHaveCount(0);
  await expect.poll(() => gainOf(page, 'Pluie')).toBe(0.5);
  // Past the 1.5 s Activate fade.
  await page.waitForTimeout(2000);

  // The rain never left the strip nor reloaded: the same sound played on, only quieter.
  expect(new Set(await watchedStates(page, 'Pluie'))).toEqual(new Set(['playing']));
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');
});

test('Music and Ambiences loop seamlessly: the strip never shows them loading again', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  // 2 s tones: several loops while watched.
  await campaignWithSounds(regie);
  await createScene(page, 'Taverne');
  await soundInLibrary(page, 'Auberge')
    .locator('.media-audio-icon')
    .dragTo(musicList(page).locator('xpath=..'));
  await expect(musicList(page).getByRole('listitem')).toHaveText([/Auberge/]);
  await dropAmbience(page, 'Pluie');
  await ambienceSwitch(page, 'Pluie').check();
  await activate(page);
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Pluie')).toHaveAttribute('data-state', 'playing');

  await watchSound(page, 'Auberge');
  await watchSound(page, 'Pluie');
  await page.waitForTimeout(7000);

  // Three loops each, and neither ever went back to "chargement…" nor left the strip.
  expect(new Set(await watchedStates(page, 'Auberge'))).toEqual(new Set(['playing']));
  expect(new Set(await watchedStates(page, 'Pluie'))).toEqual(new Set(['playing']));
});
