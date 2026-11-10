import { expect, test } from './harness';

test('built app renders the Control window and opens the Broadcast window with no failed requests', async ({
  regie,
}) => {
  const { app, controlWindow, failedRequests, cspViolations } = regie;

  await expect(controlWindow.getByText('POSTE DU MAÎTRE DU JEU')).toBeVisible();

  const broadcastOpened = app.waitForEvent('window');
  await controlWindow.getByRole('button', { name: 'Ouvrir la diffusion' }).click();
  const broadcastWindow = await broadcastOpened;
  await broadcastWindow.waitForLoadState('domcontentloaded');

  await expect(broadcastWindow.locator('main.stage-screen')).toHaveAttribute('data-version', '0');

  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('each test runs the app on its own temporary data folder', async ({ regie }) => {
  const userData = await regie.app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData).toBe(regie.dataDir);
});
