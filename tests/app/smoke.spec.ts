import { expect, test } from './harness';

test('built app renders the Control window and opens the Broadcast window with no failed requests', async ({
  regie,
}) => {
  const { app, controlWindow, failedRequests } = regie;

  await expect(controlWindow.getByText('POSTE DU MAÎTRE DU JEU')).toBeVisible();

  const broadcastOpened = app.waitForEvent('window');
  await controlWindow.getByRole('button', { name: 'Ouvrir la diffusion' }).click();
  const broadcastWindow = await broadcastOpened;
  await broadcastWindow.waitForLoadState('domcontentloaded');

  await expect(broadcastWindow.getByText('SCÈNE EN COURS')).toBeVisible();
  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText(
    'Le sanctuaire oublié',
  );

  expect(failedRequests).toEqual([]);
});

test('each test runs the app on its own temporary data folder', async ({ regie }) => {
  const userData = await regie.app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData).toBe(regie.dataDir);
});
