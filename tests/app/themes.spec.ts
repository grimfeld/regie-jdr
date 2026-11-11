import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, expect, launchApp, test } from './harness';

/*
 * The theme picker (spec #58, stories 49-51): cards with a sample panel in their Theme, on the
 * home page and inside a Campaign; a click applies at once; a new Campaign takes the home theme.
 */

function windowTheme(page: Page) {
  return page.locator('html');
}

function picker(page: Page, label: 'Thème de l’accueil' | 'Thème de la campagne') {
  return page.getByRole('group', { name: label });
}

function card(page: Page, label: 'Thème de l’accueil' | 'Thème de la campagne', theme: string) {
  return picker(page, label).getByRole('button', { name: new RegExp(`^${theme}`) });
}

async function storedTheme(dataDir: string, name: string): Promise<unknown> {
  for (const folder of await fs.readdir(path.join(dataDir, 'campaigns'))) {
    const file = path.join(dataDir, 'campaigns', folder, 'campaign.json');
    const campaign = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    if (campaign.name === name) return campaign.theme;
  }
  return undefined;
}

test('the home page picker shows each Theme in its own sample, applies on click and survives a restart', async ({
  regie,
}) => {
  const { app, controlWindow: home, dataDir } = regie;
  await expect(home.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
  await expect(windowTheme(home)).toHaveAttribute('data-theme', 'imperium');
  await expect(card(home, 'Thème de l’accueil', 'Imperium')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Each card's sample is dressed in its own Theme, whatever the window's.
  const samples = picker(home, 'Thème de l’accueil').locator('[data-theme]');
  await expect(samples).toHaveCount(3);
  expect(
    await samples.evaluateAll((all) => all.map((el) => el.getAttribute('data-theme'))),
  ).toEqual(['retro', 'imperium', 'fantasy']);

  await card(home, 'Thème de l’accueil', 'Fantasy').click();
  await expect(windowTheme(home)).toHaveAttribute('data-theme', 'fantasy');
  await expect(card(home, 'Thème de l’accueil', 'Fantasy')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(home, 'Thème de l’accueil', 'Imperium')).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
    await expect(windowTheme(page)).toHaveAttribute('data-theme', 'fantasy');
    await expect(card(page, 'Thème de l’accueil', 'Fantasy')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await restarted.app.close();
  }
});

test('a new Campaign takes the home theme; its own picker changes only it, and survives a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await card(controlWindow, 'Thème de l’accueil', 'Fantasy').click();
  await expect(windowTheme(controlWindow)).toHaveAttribute('data-theme', 'fantasy');

  await createCampaign(controlWindow, 'Warhammer');
  await expect(windowTheme(controlWindow)).toHaveAttribute('data-theme', 'fantasy');
  await expect(card(controlWindow, 'Thème de la campagne', 'Fantasy')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await storedTheme(dataDir, 'Warhammer')).toBe('fantasy');

  await card(controlWindow, 'Thème de la campagne', 'Rétro SF').click();
  await expect(windowTheme(controlWindow)).toHaveAttribute('data-theme', 'retro');
  await expect(controlWindow.locator('.theme-name')).toHaveText('Rétro SF');
  // The home page keeps its own theme.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await expect(windowTheme(controlWindow)).toHaveAttribute('data-theme', 'fantasy');

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    // The only Campaign opens directly.
    await expect(page.getByRole('heading', { name: 'Warhammer' })).toBeVisible();
    await expect(windowTheme(page)).toHaveAttribute('data-theme', 'retro');
    await expect(card(page, 'Thème de la campagne', 'Rétro SF')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await restarted.app.close();
  }
});
