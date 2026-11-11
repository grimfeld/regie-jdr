import type { Page } from '@playwright/test';
import { createCampaign, expect, fixture, stubFilePicker, test } from './harness';

/*
 * Every field the Game Master types in or picks from (text fields, lists) is dressed by the
 * Theme: its text in a text token, its background a surface token (its own, or the panel's it
 * sits on when it is transparent). A field without a style of its own falls back to the
 * system's light or grey box, as the three Fondus durations did after M3's closeout.
 */

const THEMES = [
  { id: 'retro', card: 'Rétro SF' },
  { id: 'imperium', card: 'Imperium' },
  { id: 'fantasy', card: 'Fantasy' },
] as const;

interface FieldReport {
  /** Each visible field checked, by its accessible label. */
  checked: string[];
  /** Each field whose text or background is not a Theme token, with the colour found. */
  unthemed: string[];
}

/** Checks every visible field of the Control window against the current Theme's tokens. */
function themedFields(page: Page): Promise<FieldReport> {
  return page.evaluate(() => {
    const tokenValues = (property: 'color' | 'background-color', tokens: string[]) =>
      new Set(
        tokens.map((token) => {
          const probe = document.createElement('div');
          probe.style.setProperty(property, `var(${token})`);
          document.body.append(probe);
          const value = getComputedStyle(probe).getPropertyValue(property);
          probe.remove();
          return value;
        }),
      );
    const texts = tokenValues('color', ['--text', '--text-secondary']);
    const surfaces = tokenValues('background-color', [
      '--page',
      '--title-bar',
      '--surface',
      '--surface-raised',
      '--surface-sunken',
    ]);
    const clear = getComputedStyle(document.createElement('i')).backgroundColor;
    /** The background shown behind `element`: its own, or the nearest ancestor's. */
    const backgroundOf = (element: Element) => {
      for (let at: Element | null = element; at; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor;
        if (colour !== clear && colour !== 'rgba(0, 0, 0, 0)') return colour;
      }
      return 'none';
    };
    const notTyped = new Set(['checkbox', 'radio', 'range', 'file', 'hidden', 'color']);
    const fields = [...document.querySelectorAll('input, select, textarea')].filter(
      (field) =>
        !(field instanceof HTMLInputElement && notTyped.has(field.type)) && field.checkVisibility(),
    );
    const nameOf = (field: Element) =>
      field.getAttribute('aria-label') ??
      field.closest('label')?.firstChild?.textContent?.trim() ??
      field.outerHTML.slice(0, 80);
    return {
      checked: fields.map(nameOf),
      unthemed: fields.flatMap((field) => {
        const style = getComputedStyle(field);
        const background = backgroundOf(field);
        return [
          ...(texts.has(style.color) ? [] : [`${nameOf(field)}: text ${style.color}`]),
          ...(surfaces.has(background) ? [] : [`${nameOf(field)}: background ${background}`]),
        ];
      }),
    };
  });
}

for (const theme of THEMES) {
  test(`every field of the Control window is dressed by the ${theme.card} Theme`, async ({
    regie,
  }) => {
    const { app, controlWindow: page } = regie;
    await page
      .getByRole('group', { name: 'Thème de l’accueil' })
      .getByRole('button', { name: new RegExp(`^${theme.card}`) })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);

    // The home page, its new Campaign form open.
    await page.getByRole('button', { name: 'Créer une campagne' }).click();
    const home = await themedFields(page);
    expect(home.checked).toContain('Nom de la campagne');
    expect(home.unthemed).toEqual([]);
    await page.getByRole('button', { name: 'Annuler' }).click();

    // A Campaign whose open Scene holds an Overlay: the Scene editor's fields, the library's,
    // the Fondus durations.
    await createCampaign(page, 'Campagne thématique');
    await stubFilePicker(app, [fixture('red-16x9.png')]);
    await page.getByRole('button', { name: 'Importer des images' }).click();
    await expect(
      page.getByRole('list', { name: 'Images' }).getByRole('img', { name: 'red-16x9' }),
    ).toBeVisible();
    const scenes = page.getByRole('region', { name: 'Scènes' });
    await scenes.getByLabel('Nom de la scène').fill('Taverne');
    await scenes.getByRole('button', { name: 'Créer la scène' }).click();
    const editor = page.getByRole('region', { name: 'Scène ouverte' });
    await editor.getByLabel('Image à placer').selectOption({ label: 'red-16x9' });
    await editor.getByRole('button', { name: 'Ajouter en superposition' }).click();
    await expect(editor.getByRole('textbox', { name: 'Étiquette de red-16x9' })).toBeVisible();

    const campaign = await themedFields(page);
    expect(campaign.checked).toEqual(
      expect.arrayContaining([
        'Durée des fondus',
        'Durée d’activation',
        'Fondu entre musiques',
        'Étiquette de red-16x9',
      ]),
    );
    expect(campaign.unthemed).toEqual([]);
  });
}
