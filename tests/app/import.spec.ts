import { expect, fixture, stubFilePicker, test } from './harness';

// Importing does not put anything on air: the Broadcast window shows the Active Scene only.
test('an imported image is displayed in the Control window', async ({ regie }) => {
  const { app, controlWindow, failedRequests, cspViolations } = regie;

  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();

  const thumbnail = controlWindow.getByRole('img', { name: 'red-16x9' });
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(16);

  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});
