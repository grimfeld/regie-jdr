import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
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

/** The "En cours" strip: what the audio engine reports sounding. */
function nowPlaying(page: Page) {
  return page.getByRole('region', { name: 'En cours' });
}

/** A sound of the "En cours" strip, by its Media name. */
function sounding(page: Page, name: string) {
  return nowPlaying(page).getByRole('listitem').filter({ hasText: name });
}

/** Imports tone files as Music, named after `names`. */
async function importMusic({ app, controlWindow, dataDir }: RunningApp, ...names: string[]) {
  const folder = path.join(dataDir, 'sons-a-importer');
  await fs.mkdir(folder, { recursive: true });
  const files = await Promise.all(
    names.map((name, index) => writeToneWav(folder, name, 330 + 110 * index)),
  );
  await stubFilePicker(app, files);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await controlWindow
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: 'Musique' })
    .click();
  for (const name of names) {
    await expect(soundInLibrary(controlWindow, name)).toBeVisible();
  }
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Drags a library sound onto the open Scene's Music list. */
async function dropOnMusicList(page: Page, name: string) {
  await soundInLibrary(page, name)
    .locator('.media-audio-icon')
    .dragTo(musicList(page).locator('xpath=..'));
}

/** A Campaign with a Scene "Taverne" whose Music list is Auberge then Bagarre. */
async function sceneWithMusic(regie: RunningApp) {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importMusic(regie, 'Auberge', 'Bagarre');
  await createScene(controlWindow, 'Taverne');
  await dropOnMusicList(controlWindow, 'Auberge');
  await expect(musicList(controlWindow).getByRole('listitem')).toHaveText([/Auberge/]);
  await dropOnMusicList(controlWindow, 'Bagarre');
  await expect(musicList(controlWindow).getByRole('listitem')).toHaveText([/Auberge/, /Bagarre/]);
}

interface EngineWindow {
  regieAudio: { getMix(): Promise<{ voices: { gain: number }[] }> };
}

/** The mix the audio engine reads, through its own bridge. */
function currentMix(page: Page) {
  return page.evaluate(() => (window as unknown as EngineWindow).regieAudio.getMix());
}

async function activate(page: Page) {
  await editor(page).getByRole('button', { name: 'Activer' }).click();
}

test('Music dragged onto a Scene is saved; Activating it plays the first Music, looping', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const consoleMessages: string[] = [];
  controlWindow.on('console', (message) => consoleMessages.push(message.text()));
  await sceneWithMusic(regie);
  await expect(nowPlaying(controlWindow)).toContainText('Aucun son.');

  await activate(controlWindow);

  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(controlWindow, 'Auberge')).toContainText('en lecture');
  await expect(nowPlaying(controlWindow).getByRole('listitem')).toHaveCount(1);
  // The tone lasts 2 s: still playing after that, it loops.
  await controlWindow.waitForTimeout(3000);
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');
  // A file from the Media protocol routed through Web Audio without CORS would play silence.
  expect(consoleMessages.filter((text) => text.includes('CORS'))).toEqual([]);

  // Saved with the Scene: still listed once the Scenes are read again.
  await controlWindow.reload();
  await expect(controlWindow.getByRole('heading', { name: 'Star Wars' })).toBeVisible();
  await expect(musicList(controlWindow).getByRole('listitem')).toHaveText([/Auberge/, /Bagarre/]);
});

test('closing, reopening or reloading the Broadcast window leaves the audio untouched', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await sceneWithMusic(regie);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await activate(controlWindow);
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');

  await broadcastWindow.reload();
  await broadcastWindow.close();
  const reopened = await openBroadcastWindow(app, controlWindow);
  await expect(reopened.locator('main.broadcast-screen')).toBeVisible();

  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');
  // The Broadcast window gets no audio information.
  expect(await reopened.content()).not.toContain('Auberge');
  expect(
    await reopened.evaluate(() => ({
      engine: 'regieAudio' in window,
      bridge: Object.keys((window as unknown as { regie: object }).regie).sort(),
    })),
  ).toEqual({ engine: false, bridge: ['getOnAir', 'onOnAirChanged'] });
});

test('switching Campaign stops audio; nothing plays after a restart', async ({ regie }) => {
  const { controlWindow } = regie;
  await sceneWithMusic(regie);
  await activate(controlWindow);
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');

  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await expect(nowPlaying(controlWindow)).toContainText('Aucun son.');

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const page = restarted.controlWindow;
    await page
      .getByRole('list', { name: 'Campagnes' })
      .getByRole('button', { name: 'Star Wars', exact: true })
      .click();
    await expect(editor(page).getByRole('heading', { name: 'Taverne' })).toBeVisible();
    await expect(nowPlaying(page)).toContainText('Aucun son.');
    expect(await currentMix(page)).toMatchObject({ voices: [] });
  } finally {
    await restarted.app.close();
  }
});

test('the Master volume is kept across restarts', async ({ regie }) => {
  const { controlWindow } = regie;
  await sceneWithMusic(regie);
  await activate(controlWindow);
  const master = nowPlaying(controlWindow).getByRole('slider', { name: 'Volume général' });
  await expect(master).toHaveValue('100');

  await master.fill('40');
  await expect(nowPlaying(controlWindow)).toContainText('40 %');
  // Ramped, not restarted: the Music plays on.
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'playing');
  await expect.poll(() => currentMix(controlWindow)).toMatchObject({ voices: [{ gain: 0.4 }] });

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const page = restarted.controlWindow;
    // The only Campaign opens by itself.
    await expect(page.getByRole('heading', { name: 'Star Wars' })).toBeVisible();
    await expect(nowPlaying(page).getByRole('slider', { name: 'Volume général' })).toHaveValue(
      '40',
    );
  } finally {
    await restarted.app.close();
  }
});

test('the audio engine’s bridge can only read the mix and report; the Broadcast window cannot reach audio', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  expect(
    await controlWindow.evaluate(() =>
      Object.keys((window as unknown as { regieAudio: object }).regieAudio).sort(),
    ),
  ).toEqual(['getMix', 'onMixChanged', 'onPadCommand', 'report', 'reportPads']);

  await app.evaluate(({ session }, filePath) => {
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath });
  }, fixture('rogue-preload.js'));
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const outcomes = await broadcastWindow.evaluate(async () => {
    const { rogue } = window as unknown as {
      rogue: { invoke(channel: string, ...args: unknown[]): Promise<unknown> };
    };
    const tries: [string, unknown[]][] = [
      ['audio:get-mix', []],
      ['audio:get-sounding', []],
      ['audio:report', [{ voices: [] }]],
      ['settings:set-master-volume', [{ masterVolume: 0 }]],
    ];
    return Promise.all(
      tries.map(([channel, args]) =>
        rogue.invoke(channel, ...args).then(
          () => 'accepted',
          (error: unknown) => String(error),
        ),
      ),
    );
  });
  for (const outcome of outcomes) expect(outcome).toContain('rejected');
});
