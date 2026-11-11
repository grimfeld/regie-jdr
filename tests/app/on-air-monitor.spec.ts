import type { Locator, Page } from '@playwright/test';
import type { ControlBridge, SceneEdit } from '../../shared/contract';
import type { Media, Scene } from '../../shared/domain';
import {
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

/** Calls the Control window's bridge, as its interface does. */
function bridgeOf(controlWindow: Page) {
  return <T>(method: keyof ControlBridge, ...args: unknown[]) =>
    controlWindow.evaluate(
      ([name, params]) => {
        const bridge = (
          window as unknown as { regie: Record<string, (...a: unknown[]) => unknown> }
        ).regie;
        return bridge[name](...params) as Promise<T>;
      },
      [method, args] as const,
    );
}

/**
 * The only Campaign, "Star Wars", with the 16x9 fixture image imported and the Scenes
 * "Cantina" (a visible Background) and "Hangar" (empty). The Control window is reloaded, so it
 * opens the Campaign and lists its Scenes; nothing is on air.
 */
async function starWars(running: RunningApp) {
  const { app, controlWindow } = running;
  const call = bridgeOf(controlWindow);
  const campaign = await call<{ id: string }>('createCampaign', 'Star Wars');
  await call('openCampaign', campaign.id);
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  const { imported } = await call<{ imported: Media[] }>('importMedia', campaign.id, {
    accept: 'image',
  });
  const cantina = await call<Scene>('createScene', campaign.id, 'Cantina');
  const hangar = await call<Scene>('createScene', campaign.id, 'Hangar');
  const edit = (scene: Scene, command: SceneEdit) =>
    call<Scene>('editScene', campaign.id, scene.id, command);
  const placed = await edit(cantina, { kind: 'place-background', mediaId: imported[0].id });
  const background = placed.backgrounds[0].id;
  await edit(cantina, { kind: 'set-visible', placementId: background, visible: true });
  await controlWindow.reload();
  await controlWindow.getByRole('heading', { name: 'Star Wars', exact: true }).waitFor();
  return { call, edit, campaignId: campaign.id, cantina, hangar, background, image: imported[0] };
}

function monitorOf(controlWindow: Page) {
  return controlWindow.getByRole('region', { name: 'À l’antenne' });
}

/** What a renderer draws inside `root`: placement ids and Blackout. */
function drawn(root: Locator) {
  return root.locator('.scene-canvas').evaluate((canvas) => ({
    backgrounds: [...canvas.querySelectorAll('[data-background-id]')].map((item) =>
      item.getAttribute('data-background-id'),
    ),
    overlays: [...canvas.querySelectorAll('[data-overlay-id]')].map((item) =>
      item.getAttribute('data-overlay-id'),
    ),
    blackout: canvas.getAttribute('data-blackout'),
    covered: canvas.querySelector('.canvas-blackout') !== null,
  }));
}

/** The On-air monitor draws exactly what the Broadcast window draws, and that is `expected`. */
async function expectSamePicture(
  controlWindow: Page,
  broadcastWindow: Page,
  expected: { backgrounds: string[]; blackout: boolean },
) {
  const picture = {
    backgrounds: expected.backgrounds,
    overlays: [],
    blackout: String(expected.blackout),
    covered: expected.blackout,
  };
  await expect.poll(() => drawn(broadcastWindow.locator('main.broadcast-screen'))).toEqual(picture);
  await expect.poll(() => drawn(monitorOf(controlWindow))).toEqual(picture);
}

function blackoutButton(controlWindow: Page) {
  return monitorOf(controlWindow).getByRole('button', { name: 'Noir' });
}

/** The Control-only badges never appear in the Broadcast window. */
async function expectNoBadges(broadcastWindow: Page) {
  await expect(broadcastWindow.getByText('Rien à l’antenne')).toHaveCount(0);
  await expect(broadcastWindow.getByText('NOIR')).toHaveCount(0);
  await expect(broadcastWindow.locator('.on-air-badge')).toHaveCount(0);
}

test('the On-air monitor matches the Broadcast window, whichever Scene is Selected', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { call, cantina, background } = await starWars(regie);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const monitor = monitorOf(controlWindow);

  await expect(monitor.getByText('Rien à l’antenne')).toBeVisible();
  await expectSamePicture(controlWindow, broadcastWindow, { backgrounds: [], blackout: false });
  await expectNoBadges(broadcastWindow);

  await call('activateScene', cantina.id);
  // The Game Master opens another Scene in the editor: the monitor still shows the broadcast.
  await controlWindow.getByRole('button', { name: 'Hangar', exact: true }).click();
  await expect(monitor.getByText('Rien à l’antenne')).toHaveCount(0);
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background],
    blackout: false,
  });
  await expect(monitor.locator('.canvas-background img:not([hidden])')).toHaveCount(1);
});

test('Blackout blacks out the broadcast, keeps the Active Scene, and keeps edits made during it', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { call, edit, cantina, background, image } = await starWars(regie);
  await call('activateScene', cantina.id);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const screen = broadcastWindow.locator('main.broadcast-screen');
  const monitor = monitorOf(controlWindow);

  await blackoutButton(controlWindow).click();
  await expect(blackoutButton(controlWindow)).toHaveAttribute('aria-pressed', 'true');
  await expect(monitor.getByText('NOIR', { exact: true })).toBeVisible();
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background],
    blackout: true,
  });
  await expect(screen).toHaveAttribute('data-active-scene-id', cantina.id);
  await expectNoBadges(broadcastWindow);
  // The Broadcast window is black where the canvas is.
  expect(
    await broadcastWindow
      .locator('.canvas-blackout')
      .evaluate((cover) => getComputedStyle(cover).backgroundColor),
  ).toBe('rgb(0, 0, 0)');

  // An edit during Blackout is saved, but stays behind the black screen.
  const placed = await edit(cantina, { kind: 'place-background', mediaId: image.id });
  const added = placed.backgrounds[1].id;
  await edit(cantina, { kind: 'set-visible', placementId: added, visible: true });
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background, added],
    blackout: true,
  });
  const saved = await call<Scene[]>('listScenes', cantina.campaignId);
  expect(saved.find((scene) => scene.id === cantina.id)?.backgrounds).toEqual([
    expect.objectContaining({ id: background, visible: true }),
    expect.objectContaining({ id: added, visible: true }),
  ]);

  await blackoutButton(controlWindow).click();
  await expect(blackoutButton(controlWindow)).toHaveAttribute('aria-pressed', 'false');
  await expect(monitor.getByText('NOIR', { exact: true })).toHaveCount(0);
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background, added],
    blackout: false,
  });
  await expect(screen).toHaveAttribute('data-active-scene-id', cantina.id);
});

test('Activating another Scene keeps Blackout; switching Campaign clears it', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const { call, cantina, hangar, background } = await starWars(regie);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const screen = broadcastWindow.locator('main.broadcast-screen');
  await call('activateScene', cantina.id);
  await blackoutButton(controlWindow).click();
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background],
    blackout: true,
  });

  await call('activateScene', hangar.id);
  await expect(screen).toHaveAttribute('data-active-scene-id', hangar.id);
  await expectSamePicture(controlWindow, broadcastWindow, { backgrounds: [], blackout: true });
  await expect(monitorOf(controlWindow).getByText('NOIR', { exact: true })).toBeVisible();

  // Back to the Campaign list, then into a Campaign again: Blackout is gone.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await expect(screen).toHaveAttribute('data-campaign-id', '');
  await controlWindow.locator('.campaign-open', { hasText: 'Star Wars' }).click();
  await expect(blackoutButton(controlWindow)).toHaveAttribute('aria-pressed', 'false');
  await expectSamePicture(controlWindow, broadcastWindow, { backgrounds: [], blackout: false });
  await expect(monitorOf(controlWindow).getByText('Rien à l’antenne')).toBeVisible();
});

test('reloading the Control window keeps the Active Scene, Blackout and the undo history', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { call, cantina, background } = await starWars(regie);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await call('activateScene', cantina.id);
  await blackoutButton(controlWindow).click();
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background],
    blackout: true,
  });
  const title = controlWindow.getByLabel('Titre affiché');
  await title.fill('La cantina');
  await title.press('Enter');
  const undo = controlWindow
    .getByRole('toolbar', { name: 'Historique de la scène' })
    .getByRole('button', { name: /annuler/i });
  await expect(undo).toHaveText('Annuler : modifier le titre affiché');

  await controlWindow.reload();
  await controlWindow.getByRole('heading', { name: 'Star Wars', exact: true }).waitFor();

  await expect(blackoutButton(controlWindow)).toHaveAttribute('aria-pressed', 'true');
  await expectSamePicture(controlWindow, broadcastWindow, {
    backgrounds: [background],
    blackout: true,
  });
  await expect(broadcastWindow.locator('main.broadcast-screen')).toHaveAttribute(
    'data-active-scene-id',
    cantina.id,
  );
  await expect(undo).toHaveText('Annuler : modifier le titre affiché');
});

test('a restart clears Blackout', async ({ regie }) => {
  const { call, cantina } = await starWars(regie);
  await call('activateScene', cantina.id);
  await blackoutButton(regie.controlWindow).click();
  await expect(blackoutButton(regie.controlWindow)).toHaveAttribute('aria-pressed', 'true');

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const { app, controlWindow } = restarted;
    await controlWindow.getByRole('heading', { name: 'Star Wars', exact: true }).waitFor();
    expect(await bridgeOf(controlWindow)('getOnAir')).toMatchObject({ blackout: false });
    await expect(blackoutButton(controlWindow)).toHaveAttribute('aria-pressed', 'false');
    await expect(monitorOf(controlWindow).getByText('Rien à l’antenne')).toBeVisible();
    const broadcastWindow = await openBroadcastWindow(app, controlWindow);
    await expectSamePicture(controlWindow, broadcastWindow, { backgrounds: [], blackout: false });
  } finally {
    await restarted.app.close();
  }
});
