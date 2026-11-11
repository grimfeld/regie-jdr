import type { ElectronApplication, Page } from '@playwright/test';
import type { ControlBridge } from '../../shared/contract';
import type { OnAirState } from '../../shared/domain';
import { expect, openBroadcastWindow, test } from './harness';

/** Drives the on-air state the way the Control window does: through its bridge. */
function control(controlWindow: Page) {
  const call = <T>(method: keyof ControlBridge, ...args: unknown[]) =>
    controlWindow.evaluate(
      ([name, params]) => {
        const bridge = (
          window as unknown as { regie: Record<string, (...a: unknown[]) => unknown> }
        ).regie;
        return bridge[name](...params) as Promise<T>;
      },
      [method, args] as const,
    );
  /** Like `call`, but a failed call resolves with its IpcFailure (caught in the page). */
  const attempt = (method: keyof ControlBridge, ...args: unknown[]) =>
    controlWindow.evaluate(
      ([name, params]) => {
        const bridge = (
          window as unknown as { regie: Record<string, (...a: unknown[]) => Promise<unknown>> }
        ).regie;
        return bridge[name](...params).then(
          () => 'accepted',
          (failure: unknown) => failure,
        );
      },
      [method, args] as const,
    );
  return {
    attempt,
    openCampaign: (campaignId: string) => call<OnAirState>('openCampaign', campaignId),
    closeCampaign: () => call<OnAirState>('closeCampaign'),
    activateScene: (sceneId: string) => call<OnAirState>('activateScene', sceneId),
    /** Creates a Campaign with Scenes named `sceneNames`; returns their ids. */
    async campaignWith(name: string, ...sceneNames: string[]) {
      const { id } = await call<{ id: string }>('createCampaign', name);
      const scenes: Record<string, string> = {};
      for (const sceneName of sceneNames) {
        scenes[sceneName] = (await call<{ id: string }>('createScene', id, sceneName)).id;
      }
      return { id, scenes };
    },
  };
}

/** What the Broadcast window shows (until Scenes render in Milestone 1: which Scene is on air). */
async function expectOnAir(
  broadcastWindow: Page,
  expected: { campaignId: string | null; activeSceneId: string | null; version: number },
) {
  const screen = broadcastWindow.locator('main.broadcast-screen');
  await expect(screen).toHaveAttribute('data-version', String(expected.version));
  await expect(screen).toHaveAttribute('data-campaign-id', expected.campaignId ?? '');
  await expect(screen).toHaveAttribute('data-active-scene-id', expected.activeSceneId ?? '');
}

async function closeBroadcastWindow(app: ElectronApplication, broadcastWindow: Page) {
  const closed = broadcastWindow.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('view=broadcast'))
      ?.close();
  });
  await closed;
}

test('the Broadcast window shows nothing on air at first launch', async ({ regie }) => {
  const broadcastWindow = await openBroadcastWindow(regie.app, regie.controlWindow);
  await expectOnAir(broadcastWindow, { campaignId: null, activeSceneId: null, version: 0 });
});

test('opening the Broadcast window shows the current on-air state', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const starWars = await gm.campaignWith('Star Wars', 'Cantina');
  await gm.openCampaign(starWars.id);
  expect(await gm.activateScene(starWars.scenes.Cantina)).toEqual({
    campaignId: starWars.id,
    activeSceneId: starWars.scenes.Cantina,
    scene: { backgrounds: [], overlays: [] },
    blackout: false,
    fadeDurationMs: 600,
    transition: expect.objectContaining({
      kind: 'crossfade',
      from: null,
      to: starWars.scenes.Cantina,
      durationMs: 1500,
    }),
    version: 2,
  });

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(broadcastWindow, {
    campaignId: starWars.id,
    activeSceneId: starWars.scenes.Cantina,
    version: 2,
  });
});

test('the Broadcast window follows every change while open', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const starWars = await gm.campaignWith('Star Wars', 'Cantina');
  const warhammer = await gm.campaignWith('Warhammer');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  await gm.openCampaign(starWars.id);
  await gm.activateScene(starWars.scenes.Cantina);
  await expectOnAir(broadcastWindow, {
    campaignId: starWars.id,
    activeSceneId: starWars.scenes.Cantina,
    version: 2,
  });

  // Switching Campaign clears the broadcast.
  await gm.openCampaign(warhammer.id);
  await expectOnAir(broadcastWindow, { campaignId: warhammer.id, activeSceneId: null, version: 3 });

  await gm.closeCampaign();
  await expectOnAir(broadcastWindow, { campaignId: null, activeSceneId: null, version: 4 });
});

test('closing and reopening the Broadcast window shows the current on-air state', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const { id, scenes } = await gm.campaignWith('Star Wars', 'Cantina', 'Hangar');
  await gm.openCampaign(id);
  await gm.activateScene(scenes.Cantina);
  const first = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(first, { campaignId: id, activeSceneId: scenes.Cantina, version: 2 });

  await closeBroadcastWindow(app, first);
  await gm.activateScene(scenes.Hangar);

  const reopened = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(reopened, { campaignId: id, activeSceneId: scenes.Hangar, version: 3 });
});

test('reloading the Broadcast window restores the current on-air state', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const { id, scenes } = await gm.campaignWith('Star Wars', 'Cantina');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await gm.openCampaign(id);
  await gm.activateScene(scenes.Cantina);
  await expectOnAir(broadcastWindow, { campaignId: id, activeSceneId: scenes.Cantina, version: 2 });

  await broadcastWindow.reload();
  await expectOnAir(broadcastWindow, { campaignId: id, activeSceneId: scenes.Cantina, version: 2 });
});

test('the Broadcast window ignores a snapshot older than the one it shows', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const { id, scenes } = await gm.campaignWith('Star Wars', 'Cantina');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await gm.openCampaign(id);
  await gm.activateScene(scenes.Cantina);
  await expectOnAir(broadcastWindow, { campaignId: id, activeSceneId: scenes.Cantina, version: 2 });

  // A late, stale snapshot (version 1) arrives after version 2.
  await app.evaluate(({ BrowserWindow }, campaignId) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('view=broadcast'))
      ?.webContents.send('onAir:changed', {
        campaignId,
        activeSceneId: null,
        scene: null,
        blackout: false,
        fadeDurationMs: 600,
        transition: null,
        version: 1,
      });
  }, id);
  // A round trip through the same IPC pipe, then two frames: the stale event has been handled.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  const screen = broadcastWindow.locator('main.broadcast-screen');
  expect(await screen.getAttribute('data-version')).toBe('2');
  expect(await screen.getAttribute('data-active-scene-id')).toBe(scenes.Cantina);
});

test('Activating a Scene with no Campaign open is refused and changes nothing', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const { scenes } = await control(controlWindow).campaignWith('Star Wars', 'Cantina');
  // A failed call rejects with a typed IpcFailure (shared/contract.ts), caught in the page.
  const outcome = await controlWindow.evaluate(
    (sceneId) =>
      (window as unknown as { regie: ControlBridge }).regie.activateScene(sceneId).then(
        () => 'accepted',
        (failure: unknown) => failure,
      ),
    scenes.Cantina,
  );
  expect(outcome).toMatchObject({
    kind: 'ipc-failure',
    code: 'failed',
    channel: 'onAir:activate-scene',
    message: expect.stringContaining('Ouvrez une campagne avant d’activer une scène.'),
  });

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(broadcastWindow, { campaignId: null, activeSceneId: null, version: 0 });
});

test('opening a Campaign or Activating a Scene that does not exist is refused', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const { id } = await gm.campaignWith('Star Wars');

  expect(await gm.attempt('openCampaign', 'inconnue')).toMatchObject({
    message: expect.stringContaining('Cette campagne n’existe plus.'),
  });
  await gm.openCampaign(id);
  expect(await gm.attempt('activateScene', 'inconnue')).toMatchObject({
    message: expect.stringContaining('Cette scène n’existe plus.'),
  });

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(broadcastWindow, { campaignId: id, activeSceneId: null, version: 1 });
});
