import type { BrowserWindow } from 'electron';
import { createCampaign, expect, test } from './harness';

/*
 * The top bar at the Control window's minimum width (1080 px, electron/main.ts): every button
 * on one line, "Toujours au premier plan" (#72) included, none cut off or wrapped, nothing
 * pushed past the window's edge, in every Theme (their display fonts differ in width).
 */

const MINIMUM_WIDTH = 1080;

const THEMES = [
  { id: 'retro', card: 'Rétro SF' },
  { id: 'imperium', card: 'Imperium' },
  { id: 'fantasy', card: 'Fantasy' },
] as const;

for (const theme of THEMES) {
  test(`the ${theme.card} top bar fits on one line at the minimum window width`, async ({
    regie,
  }) => {
    const { app, controlWindow: page } = regie;
    await page
      .getByRole('group', { name: 'Thème de l’accueil' })
      .getByRole('button', { name: new RegExp(`^${theme.card}`) })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    // Inside a Campaign the top bar has its most buttons ("Campagnes" too).
    await createCampaign(page, 'Campagne étroite');
    await page.getByRole('button', { name: 'Toujours au premier plan' }).click();
    await expect(page.getByRole('button', { name: 'Toujours au premier plan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((w: BrowserWindow, width) => {
      w.unmaximize();
      w.setSize(width, 800);
    }, MINIMUM_WIDTH);
    await expect
      .poll(() => browserWindow.evaluate((w: BrowserWindow) => w.getSize()[0]))
      .toBe(MINIMUM_WIDTH);
    await page.evaluate(() => document.fonts.ready);

    const layout = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar');
      const brand = document.querySelector('.topbar .brand');
      if (!topbar || !brand) throw new Error('No top bar.');
      const buttons = [...topbar.querySelectorAll('button')];
      const lineHeight = (button: Element) => parseFloat(getComputedStyle(button).lineHeight);
      return {
        pageWidth: document.documentElement.clientWidth,
        topbarOverflow: topbar.scrollWidth - topbar.clientWidth,
        topbarRight: topbar.getBoundingClientRect().right,
        brandRight: brand.getBoundingClientRect().right,
        buttons: buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            name: button.textContent.trim(),
            middle: box.top + box.height / 2,
            left: box.left,
            right: box.right,
            // A label on one line: the button's content is at most one line tall.
            oneLine:
              button.clientHeight -
                parseFloat(getComputedStyle(button).paddingTop) -
                parseFloat(getComputedStyle(button).paddingBottom) <
              1.5 * (Number.isNaN(lineHeight(button)) ? 16 : lineHeight(button)),
            clipped: button.scrollWidth > button.clientWidth,
          };
        }),
      };
    });

    expect(layout.buttons.map((button) => button.name)).toEqual([
      'Campagnes',
      'Ouvrir la diffusion',
      'Plein écran',
      'Toujours au premier plan',
    ]);
    expect(layout.topbarOverflow).toBeLessThanOrEqual(0);
    expect(layout.topbarRight).toBeLessThanOrEqual(layout.pageWidth);
    for (const button of layout.buttons) {
      expect.soft(button, `${button.name} on one line`).toMatchObject({
        oneLine: true,
        clipped: false,
      });
      // In one row: the buttons' middles line up (icons of different sizes move them a pixel).
      expect
        .soft(
          Math.abs(button.middle - (layout.buttons[0]?.middle ?? 0)),
          `${button.name} in the row`,
        )
        .toBeLessThan(2);
      expect
        .soft(button.right, `${button.name} inside the window`)
        .toBeLessThanOrEqual(layout.topbarRight);
    }
    expect(layout.brandRight).toBeLessThan(layout.buttons[0]?.left ?? 0);
  });
}
