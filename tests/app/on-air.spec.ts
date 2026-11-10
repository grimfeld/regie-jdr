import type { ElectronApplication, Page } from '@playwright/test';
import type { ControlBridge } from '../../shared/contract';
import type { OnAirState } from '../../shared/domain';
import { expect, openBroadcastWindow, test } from './harness';

/** Drives the on-air state the way the Control window does: through its bridge. */
function control(controlWindow: Page) {
  const call = <K extends 'openCampaign' | 'closeCampaign' | 'activateScene'>(
    method: K,
    ...args: Parameters<ControlBridge[K]>
  ) =>
    controlWindow.evaluate(
      ([name, params]) => {
        const bridge = (
          window as unknown as { regie: Record<string, (...a: unknown[]) => unknown> }
        ).regie;
        return bridge[name](...params) as Promise<OnAirState>;
      },
      [method, args] as const,
    );
  return {
    openCampaign: (campaignId: string) => call('openCampaign', campaignId),
    closeCampaign: () => call('closeCampaign'),
    activateScene: (sceneId: string) => call('activateScene', sceneId),
  };
}

/** What the Broadcast window shows (until Scenes render in Milestone 1: which Scene is on air). */
async function expectOnAir(
  broadcastWindow: Page,
  expected: { campaignId: string | null; activeSceneId: string | null; version: number },
) {
  const stage = broadcastWindow.locator('main.stage-screen');
  await expect(stage).toHaveAttribute('data-version', String(expected.version));
  await expect(stage).toHaveAttribute('data-campaign-id', expected.campaignId ?? '');
  await expect(stage).toHaveAttribute('data-active-scene-id', expected.activeSceneId ?? '');
}

async function closeBroadcastWindow(app: ElectronApplication, broadcastWindow: Page) {
  const closed = broadcastWindow.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('view=stage'))
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
  await gm.openCampaign('star-wars');
  expect(await gm.activateScene('cantina')).toEqual({
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(broadcastWindow, {
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });
});

test('the Broadcast window follows every change while open', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  await gm.openCampaign('star-wars');
  await gm.activateScene('cantina');
  await expectOnAir(broadcastWindow, {
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });

  // Switching Campaign clears the broadcast.
  await gm.openCampaign('warhammer');
  await expectOnAir(broadcastWindow, { campaignId: 'warhammer', activeSceneId: null, version: 3 });

  await gm.closeCampaign();
  await expectOnAir(broadcastWindow, { campaignId: null, activeSceneId: null, version: 4 });
});

test('closing and reopening the Broadcast window shows the current on-air state', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  await gm.openCampaign('star-wars');
  await gm.activateScene('cantina');
  const first = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(first, { campaignId: 'star-wars', activeSceneId: 'cantina', version: 2 });

  await closeBroadcastWindow(app, first);
  await gm.activateScene('hangar');

  const reopened = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(reopened, { campaignId: 'star-wars', activeSceneId: 'hangar', version: 3 });
});

test('reloading the Broadcast window restores the current on-air state', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await gm.openCampaign('star-wars');
  await gm.activateScene('cantina');
  await expectOnAir(broadcastWindow, {
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });

  await broadcastWindow.reload();
  await expectOnAir(broadcastWindow, {
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });
});

test('the Broadcast window ignores a snapshot older than the one it shows', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const gm = control(controlWindow);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await gm.openCampaign('star-wars');
  await gm.activateScene('cantina');
  await expectOnAir(broadcastWindow, {
    campaignId: 'star-wars',
    activeSceneId: 'cantina',
    version: 2,
  });

  // A late, stale snapshot (version 1) arrives after version 2.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('view=stage'))
      ?.webContents.send('onAir:changed', {
        campaignId: 'star-wars',
        activeSceneId: null,
        version: 1,
      });
  });
  // A round trip through the same IPC pipe, then two frames: the stale event has been handled.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  const stage = broadcastWindow.locator('main.stage-screen');
  expect(await stage.getAttribute('data-version')).toBe('2');
  expect(await stage.getAttribute('data-active-scene-id')).toBe('cantina');
});

test('Activating a Scene with no Campaign open is refused and changes nothing', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  // A failed call rejects with a typed IpcFailure (shared/contract.ts), caught in the page.
  const outcome = await controlWindow.evaluate(() =>
    (window as unknown as { regie: ControlBridge }).regie.activateScene('cantina').then(
      () => 'accepted',
      (failure: unknown) => failure,
    ),
  );
  expect(outcome).toMatchObject({
    kind: 'ipc-failure',
    code: 'failed',
    channel: 'onAir:activate-scene',
    message: expect.stringContaining('no Campaign is open'),
  });

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expectOnAir(broadcastWindow, { campaignId: null, activeSceneId: null, version: 0 });
});
