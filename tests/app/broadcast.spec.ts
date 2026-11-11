import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { BrowserWindow } from 'electron';
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
 * A Campaign with the 16x9 fixture image imported (Media name "red-16x9") and a Scene named
 * `sceneName`; the Campaign is open. Returns their ids and an `edit` for the Scene.
 */
async function campaignWithScene(running: RunningApp, sceneName: string) {
  const call = bridgeOf(running.controlWindow);
  const campaign = await call<{ id: string }>('createCampaign', 'Star Wars');
  await call('openCampaign', campaign.id);
  await stubFilePicker(running.app, [fixture('red-16x9.png')]);
  const { imported } = await call<{ imported: Media[] }>('importMedia', campaign.id, {
    accept: 'image',
  });
  const scene = await call<Scene>('createScene', campaign.id, sceneName);
  const edit = (command: SceneEdit) => call<Scene>('editScene', campaign.id, scene.id, command);
  return { call, campaignId: campaign.id, sceneId: scene.id, mediaId: imported[0].id, edit };
}

async function broadcastBrowserWindow(app: ElectronApplication, page: Page) {
  return app.browserWindow(page);
}

/** Resizes the Broadcast window's page area. */
async function resizeBroadcast(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
) {
  const browserWindow = await broadcastBrowserWindow(app, page);
  await browserWindow.evaluate(
    (w: BrowserWindow, size) => w.setContentSize(size.width, size.height),
    {
      width,
      height,
    },
  );
  await expect
    .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height]);
}

/** The canvas's box in the Broadcast window, in CSS pixels. */
function canvasBox(page: Page) {
  return page.locator('.scene-canvas-stage').evaluate((stage) => {
    const { x, y, width, height } = stage.getBoundingClientRect();
    return { x, y, width, height };
  });
}

const near = (value: number) => expect.closeTo(value, 0);

test('the Broadcast window shows the Active Scene letterboxed on a 16:9 canvas at any size', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { call, sceneId, mediaId, edit } = await campaignWithScene(regie, 'Cantina');
  const placed = await edit({ kind: 'place-background', mediaId });
  await edit({ kind: 'set-visible', placementId: placed.backgrounds[0].id, visible: true });
  await call('activateScene', sceneId);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const background = broadcastWindow.locator('.canvas-background img:not([hidden])');
  await expect(background).toHaveCount(1);

  for (const [width, height] of [
    [1280, 720], // 16:9: no bars
    [640, 1000], // a third of a screen: bars above and below
    [1600, 600], // wide: bars left and right
  ]) {
    await resizeBroadcast(app, broadcastWindow, width, height);
    const canvasWidth = Math.min(width, (height * 16) / 9);
    const canvasHeight = (canvasWidth * 9) / 16;
    const expected = {
      x: near((width - canvasWidth) / 2),
      y: near((height - canvasHeight) / 2),
      width: near(canvasWidth),
      height: near(canvasHeight),
    };
    await expect.poll(() => canvasBox(broadcastWindow)).toEqual(expected);
    // A 16:9 image in Cover fills the canvas exactly.
    const image = await background.evaluate((img) => {
      const { x, y, width, height } = img.getBoundingClientRect();
      return { x, y, width, height };
    });
    expect(image).toEqual(expected);
  }
});

test('the letterbox bars are black whatever the theme', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const { call, campaignId, sceneId } = await campaignWithScene(regie, 'Cantina');
  await call('activateScene', sceneId);
  for (const theme of ['retro', 'imperium', 'fantasy']) {
    await call('updateCampaign', campaignId, { theme });
    const broadcastWindow = await openBroadcastWindow(app, controlWindow);
    await resizeBroadcast(app, broadcastWindow, 600, 600);
    const backgrounds = await broadcastWindow.evaluate(() =>
      ['html', 'body', 'main.broadcast-screen', '.scene-canvas'].map((selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).backgroundColor : `missing ${selector}`;
      }),
    );
    expect(backgrounds).toEqual(Array(4).fill('rgb(0, 0, 0)'));
    await (
      await broadcastBrowserWindow(app, broadcastWindow)
    ).evaluate((w: BrowserWindow) => {
      w.close();
    });
  }
});

test('Hidden placements and Labels, notes, the Scene name and Media names never reach the Broadcast window', async ({
  regie,
}) => {
  const { campaignId, sceneId, mediaId, edit } = await campaignWithScene(
    regie,
    'Embuscade secrète',
  );
  await edit({ kind: 'place-background', mediaId });
  await edit({ kind: 'place-overlay', mediaId, position: { x: 0.3, y: 0.6 } });
  const scene = await edit({ kind: 'place-overlay', mediaId });
  const [background] = scene.backgrounds;
  const [shown, hidden] = scene.overlays;
  await edit({ kind: 'set-visible', placementId: shown.id, visible: true });

  // Notes have no editing command yet: written as stored, with Labels and the Scene title.
  const scenesFile = path.join(regie.dataDir, 'campaigns', campaignId, 'scenes.json');
  await regie.app.close();
  const stored = JSON.parse(await fs.readFile(scenesFile, 'utf8')) as { scenes: Scene[] };
  const [storedScene] = stored.scenes;
  storedScene.notes = 'Le traître est le capitaine';
  storedScene.title = 'Le vieux moulin';
  storedScene.overlays[0].label = { text: 'Garde du moulin', visible: true };
  storedScene.overlays[1].label = { text: 'Assassin', visible: true };
  await fs.writeFile(scenesFile, JSON.stringify(stored));
  const running = await launchApp(regie.dataDir);
  try {
    const { app, controlWindow } = running;
    // The only Campaign opens at launch.
    await expect(controlWindow.getByRole('heading', { name: 'Star Wars' })).toBeVisible();
    await bridgeOf(controlWindow)('activateScene', sceneId);
    const broadcastWindow = await openBroadcastWindow(app, controlWindow);

    await expect(broadcastWindow.locator('.canvas-overlay img:not([hidden])')).toHaveCount(1);
    await expect(broadcastWindow.locator(`[data-overlay-id="${shown.id}"]`)).toBeVisible();
    await expect(broadcastWindow.locator('.canvas-label')).toHaveText('Garde du moulin');
    await expect(broadcastWindow.locator('.canvas-title')).toHaveText('Le vieux moulin');
    const content = await broadcastWindow.content();
    for (const secret of [
      background.id,
      hidden.id,
      'Assassin',
      'Embuscade',
      'traître',
      'red-16x9',
      mediaId,
    ]) {
      expect(content).not.toContain(secret);
    }
  } finally {
    await running.app.close();
  }
});

test('the Broadcast window has no interactive elements and no visible cursor', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { call, sceneId, mediaId, edit } = await campaignWithScene(regie, 'Cantina');
  const placed = await edit({ kind: 'place-overlay', mediaId });
  await edit({ kind: 'set-visible', placementId: placed.overlays[0].id, visible: true });
  await call('activateScene', sceneId);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastWindow.locator('.canvas-overlay img:not([hidden])')).toHaveCount(1);

  const interactive = broadcastWindow.locator(
    'button, a, input, select, textarea, [tabindex], [contenteditable], [role="button"]',
  );
  await expect(interactive).toHaveCount(0);
  const cursors = await broadcastWindow.evaluate(() =>
    [...document.querySelectorAll('*')].map((element) => getComputedStyle(element).cursor),
  );
  expect(new Set(cursors)).toEqual(new Set(['none']));
});

test('the Broadcast window fullscreen toggles from the Control window; Esc leaves it', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const browserWindow = await broadcastBrowserWindow(app, broadcastWindow);
  const isFullscreen = () => browserWindow.evaluate((w: BrowserWindow) => w.isFullScreen());
  const toggle = controlWindow.getByRole('button', { name: 'Plein écran' });

  await toggle.click();
  await expect.poll(isFullscreen).toBe(true);
  await toggle.click();
  await expect.poll(isFullscreen).toBe(false);

  await toggle.click();
  await expect.poll(isFullscreen).toBe(true);
  // A key press as the window receives it from the system (Playwright's keyboard goes straight
  // to the page, past the main process).
  await browserWindow.evaluate((w: BrowserWindow) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await expect.poll(isFullscreen).toBe(false);
});
