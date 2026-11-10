import { createCampaign, expect, test } from './harness';

test('built app renders the Control window and opens the Broadcast window with no failed requests', async ({
  regie,
}) => {
  const { app, controlWindow, failedRequests, cspViolations } = regie;

  await expect(controlWindow.getByText('POSTE DU MAÎTRE DU JEU')).toBeVisible();

  const broadcastOpened = app.waitForEvent('window');
  await controlWindow.getByRole('button', { name: 'Ouvrir la diffusion' }).click();
  const broadcastWindow = await broadcastOpened;
  await broadcastWindow.waitForLoadState('domcontentloaded');

  await expect(broadcastWindow.locator('main.broadcast-screen')).toHaveAttribute(
    'data-version',
    '0',
  );

  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('the Campaign screen has no placeholder preview or audio controls that do nothing', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow);

  await expect(controlWindow.getByRole('region', { name: 'Scènes' })).toBeVisible();
  await expect(controlWindow.getByRole('button', { name: 'Importer des images' })).toBeVisible();
  await expect(controlWindow.getByRole('slider')).toHaveCount(0);
  await expect(controlWindow.getByText('APERÇU JOUEURS')).toHaveCount(0);
  await expect(controlWindow.getByLabel('TITRE DE LA SCÈNE')).toHaveCount(0);
});

test('each test runs the app on its own temporary data folder', async ({ regie }) => {
  const userData = await regie.app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData).toBe(regie.dataDir);
});
