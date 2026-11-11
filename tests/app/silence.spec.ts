import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { ControlBridge } from '../../shared/contract';
import {
  createCampaign,
  expect,
  launchApp,
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

/** The "En cours" strip: what the audio engine reports sounding, and the Silence toggle. */
function nowPlaying(page: Page) {
  return page.getByRole('region', { name: 'En cours' });
}

function silenceButton(page: Page) {
  return nowPlaying(page).getByRole('button', { name: 'Silence' });
}

/** A sound of the "En cours" strip, by its name. */
function sounding(page: Page, name: string) {
  return nowPlaying(page).getByRole('listitem').filter({ hasText: name });
}

function monitor(page: Page) {
  return page.getByRole('region', { name: 'À l’antenne' });
}

function soundboard(page: Page) {
  return page.getByRole('region', { name: 'Table de bruitages' });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

/** Imports tone files of `seconds` as `role` ("Musique", "Bruitage"), named after `names`. */
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

/**
 * A Campaign "Star Wars" with a Scene "Taverne" playing Music "Auberge" (`seconds` long),
 * Activated.
 */
async function taverneOnAir(regie: RunningApp, seconds = 2) {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await importSounds(regie, 'Musique', seconds, 'Auberge');
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill('Taverne');
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name: 'Taverne', exact: true })).toBeVisible();
  await soundInLibrary(page, 'Auberge')
    .locator('.media-audio-icon')
    .dragTo(musicList(page).locator('xpath=..'));
  await expect(musicList(page).getByRole('listitem')).toHaveText([/Auberge/]);
  await editor(page).getByRole('button', { name: 'Activer', exact: true }).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
}

interface EngineWindow {
  regieAudio: { getMix(): Promise<{ voices: { name: string; gain: number }[] }> };
}

/** The target gain of the voice named `name` in the mix the audio engine reads. */
async function gainOf(page: Page, name: string) {
  const mix = await page.evaluate(() => (window as unknown as EngineWindow).regieAudio.getMix());
  return mix.voices.find((voice) => voice.name === name)?.gain;
}

test('Silence fades the Music out and back, apart from Blackout; Activate lifts it', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await taverneOnAir(regie);
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
  const screen = monitor(page).locator('.on-air-screen');
  const pictureVersion = await screen.getAttribute('data-version');

  await silenceButton(page).click();

  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  // Faded out and paused, so it resumes where it was; still listed, marked silent.
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await expect(sounding(page, 'Auberge')).toContainText('silence');
  expect(await gainOf(page, 'Auberge')).toBe(0);
  // The Music's own pause and stop buttons wait for Silence to lift.
  await expect(sounding(page, 'Auberge').getByRole('button')).toHaveCount(0);
  // The picture is untouched: no new on-air snapshot.
  await expect(screen).toHaveAttribute('data-version', pictureVersion ?? '');

  await silenceButton(page).click();

  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(page, 'Auberge')).toContainText('en lecture');
  expect(await gainOf(page, 'Auberge')).toBe(1);

  // Blackout is picture only: the Music plays on.
  await monitor(page).getByRole('button', { name: 'Noir' }).click();
  await expect(monitor(page).getByRole('button', { name: 'Noir' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(800);
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await monitor(page).getByRole('button', { name: 'Noir' }).click();

  // Activating a Scene lifts Silence.
  await silenceButton(page).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await editor(page).getByRole('button', { name: 'Activer', exact: true }).click();
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
});

test('a pad pressed during Silence sounds and Silence stays; switching Campaign and restarting clear it', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await taverneOnAir(regie);
  await importSounds(regie, 'Bruitage', 1, 'Épée');
  await soundInLibrary(page, 'Épée')
    .locator('.media-audio-icon')
    .dragTo(soundboard(page), { targetPosition: { x: 40, y: 20 } });
  const pad = soundboard(page).getByRole('button', { name: 'Jouer Épée' });
  await expect(pad).toBeVisible();

  await silenceButton(page).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await pad.click();

  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  await expect(sounding(page, 'Épée')).toBeVisible();
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');

  // Another Campaign starts without Silence.
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(page, 'Warhammer');
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');

  // Never saved: after a restart, Silence is off.
  await silenceButton(page).click();
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const again = restarted.controlWindow;
    await again
      .getByRole('list', { name: 'Campagnes' })
      .getByRole('button', { name: 'Warhammer', exact: true })
      .click();
    await expect(silenceButton(again)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await restarted.app.close();
  }
});

interface ControlWindow {
  regie: ControlBridge;
}

test('Silence pressed while an Activate is still running stays on', async ({ regie }) => {
  const page = regie.controlWindow;
  await taverneOnAir(regie);

  // Activate, then Silence at once, as fast as the Game Master's hands: Silence comes after.
  const silence = await page.evaluate(async () => {
    const bridge = (window as unknown as ControlWindow).regie;
    const { activeSceneId } = await bridge.getOnAir();
    if (activeSceneId === null) throw new Error('No Active Scene');
    const activated = bridge.activateScene(activeSceneId);
    const silenced = bridge.setSilence(true);
    await Promise.all([activated, silenced]);
    return (await bridge.getSounding()).silence;
  });

  expect(silence).toBe(true);
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('the Silence key pressed twice quickly starts Silence and lifts it', async ({ regie }) => {
  const page = regie.controlWindow;
  await taverneOnAir(regie);
  // Every Silence state the strip learns of, in order.
  await page.evaluate(() => {
    const watching = window as unknown as ControlWindow & { silences: boolean[] };
    watching.silences = [];
    watching.regie.onSoundingChanged(({ silence }) => {
      if (watching.silences.at(-1) !== silence) watching.silences.push(silence);
    });
  });
  await page.locator('body').click({ position: { x: 1, y: 1 } });

  await page.keyboard.press('s');
  await page.keyboard.press('s');

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { silences: boolean[] }).silences))
    .toEqual([true, false]);
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('a Music longer than a minute streams through Silence and back', async ({ regie }) => {
  const page = regie.controlWindow;
  // Over a minute, it streams from a media element, by byte ranges, instead of being decoded.
  await taverneOnAir(regie, 90);

  await silenceButton(page).click();
  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'paused');
  await silenceButton(page).click();

  await expect(sounding(page, 'Auberge')).toHaveAttribute('data-state', 'playing');
});
