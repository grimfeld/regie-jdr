import { createCampaign, expect, fixture, stubFilePicker, test } from './harness';

test('an imported image is displayed in the Control window and on the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow, failedRequests, cspViolations } = regie;
  await createCampaign(controlWindow);

  const broadcastOpened = app.waitForEvent('window');
  await controlWindow.getByRole('button', { name: 'Ouvrir la diffusion' }).click();
  const broadcastWindow = await broadcastOpened;
  await broadcastWindow.waitForLoadState('domcontentloaded');

  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();

  const thumbnail = controlWindow.getByRole('img', { name: 'red-16x9' });
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(16);

  await expect(broadcastWindow.getByRole('heading', { level: 1 })).toHaveText('red-16x9');
  const background = broadcastWindow.locator('img.stage-background');
  await expect
    .poll(() => background.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(16);

  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});
