import { expect, fixture, openBroadcastWindow, test } from './harness';

type Rogue = { rogue: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } };
type Recorder = { calls: unknown[][]; unsubscribe(): void };

test('the Control window gets the full bridge, the Broadcast window only reads and subscribes', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  const keysOf = () => Object.keys((window as unknown as { regie: object }).regie).sort();
  expect(await controlWindow.evaluate(keysOf)).toEqual([
    'getDisplay',
    'importImages',
    'onDisplayChanged',
    'openBroadcast',
    'setDisplay',
  ]);
  expect(await broadcastWindow.evaluate(keysOf)).toEqual(['getDisplay', 'onDisplayChanged']);
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
    const display = { title: 'Piraté', background: '', description: '' };
    try {
      await rogue.invoke('display:set', display);
      return 'accepted';
    } catch (error) {
      return String(error);
    }
  });

  expect(outcome).toContain('rejected');
  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText(
    'Le sanctuaire oublié',
  );
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
    return rogue.invoke('display:set', { title: 42 }).then(
      () => 'accepted',
      (error) => String(error),
    );
  });

  expect(outcome).toContain('rejected');
  await expect
    .poll(() =>
      mainLog.filter(
        (line) =>
          line.startsWith('warning: IPC message rejected: malformed') &&
          line.includes('display:set'),
      ),
    )
    .toHaveLength(1);
});

test('subscriptions pass only the payload and stop after unsubscribing', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await broadcastWindow.evaluate(() => {
    const calls: unknown[][] = [];
    const bridge = (window as unknown as { regie: { onDisplayChanged(l: unknown): () => void } })
      .regie;
    const unsubscribe = bridge.onDisplayChanged((...args: unknown[]) => calls.push(args));
    (window as unknown as { recorder: Recorder }).recorder = { calls, unsubscribe };
  });
  const calls = () =>
    broadcastWindow.evaluate(() => (window as unknown as { recorder: Recorder }).recorder.calls);

  const title = controlWindow.getByLabel('TITRE DE LA SCÈNE');
  await title.fill('La taverne');
  await expect.poll(calls).toEqual([
    [
      {
        title: 'La taverne',
        background: '',
        description: 'Choisissez un décor pour commencer la scène.',
      },
    ],
  ]);

  await broadcastWindow.evaluate(() =>
    (window as unknown as { recorder: Recorder }).recorder.unsubscribe(),
  );
  await title.fill('La forêt');
  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText('La forêt');
  expect(await calls()).toHaveLength(1);
});

test('the Broadcast window shows the current display when it opens and after a reload', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await controlWindow.getByLabel('TITRE DE LA SCÈNE').fill('La taverne');

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const heading = broadcastWindow.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('La taverne');

  await broadcastWindow.reload();
  await expect(heading).toHaveText('La taverne');
});

test('the Broadcast window fullscreen button toggles fullscreen without its bridge', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const isFullscreen = () => broadcastWindow.evaluate(() => document.fullscreenElement !== null);

  await broadcastWindow.getByTitle('Plein écran').click();
  await expect.poll(isFullscreen).toBe(true);
  await broadcastWindow.getByTitle('Plein écran').click();
  await expect.poll(isFullscreen).toBe(false);
});
