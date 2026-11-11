import type { Page } from '@playwright/test';
import { createCampaign, expect, test } from './harness';

/*
 * The finished Fantasy Theme (#68): its display font comes from the app itself, its wood,
 * leather and iron stay on the window frame while the panels keep solid surfaces, and it is
 * still: no animation at all (spec #58, stories 33, 43, 44 and 48).
 */

async function chooseFantasyOnHome(page: Page) {
  await page
    .getByRole('group', { name: 'Thème de l’accueil' })
    .getByRole('button', { name: /^Fantasy/ })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'fantasy');
}

test('Fantasy shows its bundled display font, loaded without the network', async ({ regie }) => {
  const { controlWindow, failedRequests, cspViolations } = regie;
  await chooseFantasyOnHome(controlWindow);

  const title = controlWindow.getByRole('heading', { name: 'Vos campagnes' });
  await expect(title).toHaveCSS('font-family', /^"IM Fell English SC"/);
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (font) => font.family.includes('IM Fell English SC') && font.status === 'loaded',
        );
      }),
    )
    .toBe(true);
  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('Fantasy dresses the window frame in wood, leather and iron, not the panels', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'La Crypte du Roi Déchu');
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await chooseFantasyOnHome(controlWindow);

  // Wood grain on the page, stitched leather on the title bar.
  await expect(controlWindow.locator('.app-shell')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  await expect(controlWindow.locator('.topbar')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  // The Campaign in the list: an iron band round its border, a solid surface inside.
  const campaign = controlWindow.getByRole('list', { name: 'Campagnes' }).getByRole('listitem');
  await expect(campaign).toHaveCSS('box-shadow', /inset/);
  await expect(campaign).toHaveCSS('background-image', 'none');
});

test('Fantasy is still: nothing in the window animates', async ({ regie }) => {
  const { controlWindow } = regie;
  await chooseFantasyOnHome(controlWindow);

  // Spec #58 allows one small animation per theme; Fantasy takes none, so it never flickers.
  expect(
    await controlWindow.evaluate(() =>
      document.getAnimations().map((animation) => (animation as CSSAnimation).animationName),
    ),
  ).toEqual([]);
});
