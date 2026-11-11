import { expect, fixture, openBroadcastWindow, test } from './harness';

interface Rogue {
  rogue: { invoke(channel: string, ...args: unknown[]): Promise<unknown> };
}
interface Recorder {
  calls: unknown[][];
  unsubscribe(): void;
}
interface Bridge {
  regie: Record<string, (...args: unknown[]) => unknown>;
}

test('the Control window gets the full bridge, the Broadcast window only reads and subscribes', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  const keysOf = () => Object.keys((window as unknown as { regie: object }).regie).sort();
  expect(await controlWindow.evaluate(keysOf)).toEqual([
    'activateScene',
    'closeCampaign',
    'createCampaign',
    'createScene',
    'deleteMedia',
    'deleteScene',
    'duplicateScene',
    'editScene',
    'editSoundboard',
    'getOnAir',
    'getSettings',
    'getSoundboard',
    'getSounding',
    'getUndoState',
    'importDroppedMedia',
    'importMedia',
    'importPastedImage',
    'listCampaigns',
    'listMedia',
    'listScenes',
    'moveScene',
    'onOnAirChanged',
    'onSoundingChanged',
    'openBroadcast',
    'openCampaign',
    'pickMusic',
    'pressPad',
    'redoSceneEdit',
    'renameMedia',
    'setBlackout',
    'setFadeDuration',
    'setHomeTheme',
    'setImageCategory',
    'setMasterVolume',
    'setMusicPlayback',
    'setSilence',
    'showSoundboardTransient',
    'showTransientEdit',
    'takeNotices',
    'toggleBroadcastFullscreen',
    'toggleSilence',
    'undoSceneEdit',
    'updateCampaign',
  ]);
  expect(await broadcastWindow.evaluate(keysOf)).toEqual(['getOnAir', 'onOnAirChanged']);
});

test('a mutating message sent from the Broadcast window is rejected and logged', async ({
  regie,
}) => {
  const { app, controlWindow, mainLog } = regie;
  // Stand for a compromised Broadcast window: give it raw IPC access, bypassing its bridge.
  await app.evaluate(({ session }, filePath) => {
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath });
  }, fixture('rogue-preload.js'));
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  const outcome = await broadcastWindow.evaluate(async () => {
    const { rogue } = window as unknown as Rogue;
    try {
      await rogue.invoke('onAir:open-campaign', { campaignId: 'piraté' });
      return 'accepted';
    } catch (error) {
      return String(error);
    }
  });

  expect(outcome).toContain('rejected');
  expect(
    await controlWindow.evaluate(() => (window as unknown as Bridge).regie.getOnAir()),
  ).toEqual({
    campaignId: null,
    activeSceneId: null,
    scene: null,
    blackout: false,
    fadeDurationMs: 600,
    version: 0,
  });
  await expect
    .poll(() =>
      mainLog.filter(
        (line) =>
          line.startsWith('warning: IPC message rejected') && line.includes('broadcast window'),
      ),
    )
    .toHaveLength(1);
});

test('a malformed message from the Control window is rejected and logged', async ({ regie }) => {
  const { app, controlWindow, mainLog } = regie;
  await app.evaluate(({ session }, filePath) => {
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath });
  }, fixture('rogue-preload.js'));
  await controlWindow.reload();

  const outcome = await controlWindow.evaluate(async () => {
    const { rogue } = window as unknown as Rogue;
    return rogue.invoke('onAir:open-campaign', { campaignId: 42 }).then(
      () => 'accepted',
      (error: unknown) => String(error),
    );
  });

  expect(outcome).toContain('rejected');
  await expect
    .poll(() =>
      mainLog.filter(
        (line) =>
          line.startsWith('warning: IPC message rejected: malformed') &&
          line.includes('onAir:open-campaign'),
      ),
    )
    .toHaveLength(1);
});

test('subscriptions pass only the payload and stop after unsubscribing', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await broadcastWindow.evaluate(() => {
    const calls: unknown[][] = [];
    const bridge = (window as unknown as { regie: { onOnAirChanged(l: unknown): () => void } })
      .regie;
    const unsubscribe = bridge.onOnAirChanged((...args: unknown[]) => calls.push(args));
    (window as unknown as { recorder: Recorder }).recorder = { calls, unsubscribe };
  });
  const calls = () =>
    broadcastWindow.evaluate(() => (window as unknown as { recorder: Recorder }).recorder.calls);
  const gm = (method: string, ...args: unknown[]) =>
    controlWindow.evaluate(
      ([name, params]) => (window as unknown as Bridge).regie[name](...params),
      [method, args] as const,
    );

  const { id: campaignId } = (await gm('createCampaign', 'Star Wars')) as { id: string };
  const { id: sceneId } = (await gm('createScene', campaignId, 'Cantina')) as { id: string };
  await gm('openCampaign', campaignId);
  await expect.poll(calls).toEqual([
    [
      {
        campaignId,
        activeSceneId: null,
        scene: null,
        blackout: false,
        fadeDurationMs: 600,
        version: 1,
      },
    ],
  ]);

  await broadcastWindow.evaluate(() =>
    (window as unknown as { recorder: Recorder }).recorder.unsubscribe(),
  );
  await gm('activateScene', sceneId);
  await expect(broadcastWindow.locator('main.broadcast-screen')).toHaveAttribute(
    'data-version',
    '2',
  );
  expect(await calls()).toHaveLength(1);
});
