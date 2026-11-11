import type { Locator, Page } from '@playwright/test';
import type { ControlBridge } from '../../shared/contract';
import {
  createCampaign,
  dropAndWait,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function monitor(page: Page) {
  return page.getByRole('region', { name: 'À l’antenne' });
}

function fadeField(page: Page) {
  return page.getByRole('textbox', { name: 'Durée des fondus' });
}

function overlayList(page: Page) {
  return editor(page).getByRole('list', { name: 'Superpositions' });
}

function overlayToggle(page: Page) {
  return overlayList(page).getByRole('checkbox', { name: `Afficher ${IMAGE}` });
}

/** The fade duration a renderer inside `root` uses. */
function fadeDurationOf(root: Locator) {
  return root
    .locator('.scene-canvas-stage')
    .evaluate((stage) => getComputedStyle(stage).getPropertyValue('--fade-duration'));
}

/**
 * Types the fade duration in seconds and leaves the field, which then shows the saved one, with
 * a decimal comma (`shown`, the typed text by default).
 */
async function setFadeDuration(page: Page, seconds: string, shown = seconds) {
  await fadeField(page).fill(seconds);
  await fadeField(page).blur();
  await expect(fadeField(page)).toHaveValue(shown);
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** A Campaign with an Active Scene holding one Hidden Overlay, and the Broadcast window. */
async function activeSceneWithOverlay({ app, controlWindow }: RunningApp) {
  await createCampaign(controlWindow, 'Star Wars');
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  const thumbnail = controlWindow
    .getByRole('list', { name: 'Images' })
    .getByRole('img', { name: IMAGE });
  await expect(thumbnail).toBeVisible();
  await createScene(controlWindow, 'Cantina');
  await dropAndWait(
    thumbnail,
    overlayList(controlWindow).locator('xpath=..'),
    overlayList(controlWindow).getByRole('listitem').first(),
  );
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  return openBroadcastWindow(app, controlWindow);
}

test('the fade duration is one setting for every renderer, kept across a restart', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await expect(fadeField(controlWindow)).toHaveValue('0,6');

  // A decimal dot is read as well as a French comma.
  await setFadeDuration(controlWindow, '1.5', '1,5');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect.poll(() => fadeDurationOf(broadcastWindow.locator('main'))).toBe('1500ms');
  await expect.poll(() => fadeDurationOf(monitor(controlWindow))).toBe('1500ms');
  await expect.poll(() => fadeDurationOf(editor(controlWindow))).toBe('1500ms');

  await app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    // The only Campaign opens directly.
    const page = restarted.controlWindow;
    await expect(fadeField(page)).toHaveValue('1,5');
    const reopened = await openBroadcastWindow(restarted.app, page);
    await expect.poll(() => fadeDurationOf(reopened.locator('main'))).toBe('1500ms');
  } finally {
    await restarted.app.close();
  }
});

test('showing and hiding fade on the broadcast; a hidden Overlay fades out from its last picture', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const broadcastWindow = await activeSceneWithOverlay(regie);
  // Long enough to see each fade under way.
  await setFadeDuration(controlWindow, '3');
  await expect.poll(() => fadeDurationOf(broadcastWindow.locator('main'))).toBe('3000ms');
  const drawnOverlay = broadcastWindow.locator('.canvas-overlay');

  await overlayToggle(controlWindow).check();
  // Drawn once its image is decoded, then faded in.
  await expect(drawnOverlay).toHaveAttribute('data-fade', 'shown');
  await expect(drawnOverlay.locator('img')).not.toHaveAttribute('hidden');
  expect(
    await drawnOverlay.evaluate((element) => getComputedStyle(element).animationDuration),
  ).toBe('3s');

  // The Overlay is no longer sent to the Broadcast window: it fades out from what was drawn.
  await overlayToggle(controlWindow).uncheck();
  await expect(drawnOverlay).toHaveAttribute('data-fade', 'leaving');
  await expect(drawnOverlay.locator('img')).toHaveCount(1);
  await expect
    .poll(() => drawnOverlay.evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeLessThan(1);
  await expect(drawnOverlay).toHaveCount(0, { timeout: 10_000 });

  // In the editor, the Overlay fades to the Hidden style instead.
  const editorOverlay = editor(controlWindow).locator('.canvas-overlay');
  await expect(editorOverlay).toHaveClass(/is-hidden/);
  expect(
    await editorOverlay.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('3s');
});

test('Blackout fades in and out with the fade duration', async ({ regie }) => {
  const { controlWindow } = regie;
  const broadcastWindow = await activeSceneWithOverlay(regie);
  await setFadeDuration(controlWindow, '3');
  await expect.poll(() => fadeDurationOf(broadcastWindow.locator('main'))).toBe('3000ms');
  const blackout = monitor(controlWindow).getByRole('button', { name: 'Noir' });
  const cover = broadcastWindow.locator('.canvas-blackout');

  await blackout.click();
  await expect(cover).toHaveAttribute('data-fade', 'shown');
  expect(await cover.evaluate((element) => getComputedStyle(element).animationDuration)).toBe('3s');

  await blackout.click();
  await expect(cover).toHaveAttribute('data-fade', 'leaving');
  await expect(cover).toHaveCount(0, { timeout: 10_000 });
});

test('the Activate and Music crossfade durations are Control settings, kept across a restart; Activate dissolves over the Activate duration', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const activateField = (page: Page) => page.getByRole('textbox', { name: 'Durée d’activation' });
  const crossfadeField = (page: Page) =>
    page.getByRole('textbox', { name: 'Fondu entre musiques' });
  /** Activates the open Campaign's only Scene, as its Activate button does; its Transition. */
  const activateOnlyScene = (page: Page) =>
    page.evaluate(async () => {
      const { regie } = window as unknown as { regie: ControlBridge };
      const { campaignId } = await regie.getOnAir();
      const [scene] = await regie.listScenes(campaignId ?? '');
      return (await regie.activateScene(scene.id)).transition;
    });
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await expect(activateField(controlWindow)).toHaveValue('1,5');
  await expect(crossfadeField(controlWindow)).toHaveValue('2');

  await activateField(controlWindow).fill('3');
  await activateField(controlWindow).blur();
  await crossfadeField(controlWindow).fill('4,5');
  await crossfadeField(controlWindow).blur();
  await expect(activateField(controlWindow)).toHaveValue('3');
  await expect(crossfadeField(controlWindow)).toHaveValue('4,5');
  // The fade duration is a setting of its own: unchanged.
  await expect(fadeField(controlWindow)).toHaveValue('0,6');

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(activateField(page)).toHaveValue('3');
    await expect(crossfadeField(page)).toHaveValue('4,5');
    expect(await activateOnlyScene(page)).toMatchObject({ kind: 'crossfade', durationMs: 3000 });
    // "4,5" was read as 4.5 seconds.
    expect(
      await page.evaluate(() =>
        (window as unknown as { regie: ControlBridge }).regie.getSettings(),
      ),
    ).toMatchObject({ musicCrossfadeMs: 4500 });
  } finally {
    await restarted.app.close();
  }
});
