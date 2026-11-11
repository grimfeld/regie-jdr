import type { Page } from '@playwright/test';
import { createCampaign, expect, test } from './harness';

/*
 * The finished Rétro SF Theme (#66): its display font comes from the app itself, its
 * scanlines stay on the window frame, and its one animation, the title bar cursor, stops under
 * the reduced-motion system preference (spec #58, stories 43, 44 and 48).
 */

async function chooseRetroOnHome(page: Page) {
  await page
    .getByRole('group', { name: 'Thème de l’accueil' })
    .getByRole('button', { name: /^Rétro SF/ })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
}

/** The animation running on the cursor after the title bar's title. */
function cursorAnimation(page: Page): Promise<string> {
  return page
    .locator('.brand strong')
    .evaluate((title) => getComputedStyle(title, '::after').animationName);
}

test('Rétro SF shows its bundled display font, loaded without the network', async ({ regie }) => {
  const { controlWindow, failedRequests, cspViolations } = regie;
  await chooseRetroOnHome(controlWindow);

  const title = controlWindow.getByRole('heading', { name: 'Vos campagnes' });
  await expect(title).toHaveCSS('font-family', /^"Share Tech Mono"/);
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (font) => font.family.includes('Share Tech Mono') && font.status === 'loaded',
        );
      }),
    )
    .toBe(true);
  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('Rétro SF scanlines dress the window frame, not the panels', async ({ regie }) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Les Ombres de Tarsis');
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await chooseRetroOnHome(controlWindow);

  await expect(controlWindow.locator('.app-shell')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  // The title bar and the panels, here the Campaign in the list, stay on solid colours.
  await expect(controlWindow.locator('.topbar')).toHaveCSS('background-image', 'none');
  await expect(
    controlWindow.getByRole('list', { name: 'Campagnes' }).getByRole('listitem'),
  ).toHaveCSS('background-image', 'none');
});

test('the Rétro SF cursor blinks, and stops under reduced motion', async ({ regie }) => {
  const { controlWindow } = regie;
  await chooseRetroOnHome(controlWindow);
  await expect.poll(() => cursorAnimation(controlWindow)).toBe('retro-cursor');

  await controlWindow.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => cursorAnimation(controlWindow)).toBe('none');
});
