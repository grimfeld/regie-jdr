import { createCampaign, expect, test } from './harness';

/*
 * The finished Imperium Theme (#67): its display font comes from the app itself, its heraldic
 * diapering stays on the window frame, and it has no animation (spec #58, stories 37, 42-44
 * and 48). Imperium is the home page's theme on a fresh install.
 */

test('Imperium shows its bundled display font, loaded without the network', async ({ regie }) => {
  const { controlWindow, failedRequests, cspViolations } = regie;
  await expect(controlWindow.locator('html')).toHaveAttribute('data-theme', 'imperium');

  const title = controlWindow.getByRole('heading', { name: 'Vos campagnes' });
  await expect(title).toHaveCSS('font-family', /^Cinzel/);
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (font) => font.family.includes('Cinzel') && font.status === 'loaded',
        );
      }),
    )
    .toBe(true);
  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('Imperium diapering dresses the window frame; panels and lists stay solid and still', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'La Croisade de Varn');

  await expect(controlWindow.locator('.app-shell')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  // The panels, here the Scenes panel, sit on a solid colour; only their top border is dressed.
  const scenes = controlWindow.locator('.panel').first();
  await expect(scenes).toHaveCSS('background-image', 'none');
  await expect(scenes).toHaveCSS('border-top-width', '3px');

  // No animation anywhere in the window, whatever the motion preference.
  const animated = await controlWindow.evaluate(() =>
    [...document.querySelectorAll('*')].flatMap((element) =>
      [null, '::before', '::after']
        .map((pseudo) => getComputedStyle(element, pseudo).animationName)
        .filter((name) => name !== 'none'),
    ),
  );
  expect(animated).toEqual([]);
});
