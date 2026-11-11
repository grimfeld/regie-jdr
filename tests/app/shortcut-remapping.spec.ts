import type { Page } from '@playwright/test';
import type { OnAirState } from '../../shared/domain';
import { createCampaign, expect, launchApp, openBroadcastWindow, test } from './harness';

/** The on-air state, as the Control window's bridge gives it. */
function onAir(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { regie: { getOnAir(): Promise<OnAirState> } }).regie.getOnAir(),
  );
}

function shortcutsPage(page: Page) {
  return page.getByRole('dialog', { name: 'Raccourcis clavier' });
}

async function openShortcutsPage(page: Page) {
  await page.getByRole('button', { name: 'Raccourcis', exact: true }).click();
  await expect(shortcutsPage(page)).toBeVisible();
}

/** The keys a shortcut has, as its row on the shortcuts page shows them. */
function keysOf(page: Page, name: string) {
  return shortcutsPage(page).getByRole('row', { name, exact: false }).locator('kbd');
}

/** Presses `key` as the new key of the shortcut `name`; the page says what came of it. */
async function remap(page: Page, name: string, key: string) {
  const change = shortcutsPage(page).getByRole('button', { name: `Changer la touche : ${name}` });
  await change.click();
  await expect(change).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(key);
}

function status(page: Page) {
  return shortcutsPage(page).getByRole('status');
}

function blackoutButton(page: Page) {
  return page.getByRole('region', { name: 'À l’antenne' }).getByRole('button', { name: 'Noir' });
}

function silenceButton(page: Page) {
  return page.getByRole('region', { name: 'En cours' }).getByRole('button', { name: 'Silence' });
}

/** Focus on the page itself, as after clicking an empty spot. */
async function focusPage(page: Page) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
}

test('a remapped shortcut works at once and after a restart; conflicts and reserved keys are refused', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await openShortcutsPage(page);
  await expect(keysOf(page, 'Noir')).toHaveText('B');

  // Reserved keys are refused, with the reason.
  await remap(page, 'Noir', 'F11');
  await expect(status(page)).toContainText('F11 est réservée');
  await remap(page, 'Noir', 'Control+z');
  await expect(status(page)).toContainText('Ctrl+Z est réservée');
  // Escape gives up waiting for a key, and leaves the page open.
  await remap(page, 'Noir', 'Escape');
  await expect(shortcutsPage(page)).toBeVisible();
  await expect(keysOf(page, 'Noir')).toHaveText('B');

  // A key another shortcut holds names it; "Annuler" keeps both as they were.
  await remap(page, 'Noir', 's');
  await expect(status(page)).toContainText('« S » sert déjà à : Silence.');
  await status(page).getByRole('button', { name: 'Annuler' }).click();
  await expect(keysOf(page, 'Silence')).toHaveText('S');

  await remap(page, 'Noir', 'n');
  await expect(keysOf(page, 'Noir')).toHaveText('N');

  // "Remplacer" leaves the key to one shortcut only.
  await remap(page, 'Silence', 'n');
  await expect(status(page)).toContainText('« N » sert déjà à : Noir.');
  await status(page).getByRole('button', { name: 'Remplacer' }).click();
  await expect(keysOf(page, 'Silence')).toHaveText('N');
  await expect(keysOf(page, 'Noir')).toHaveText('Aucune touche');
  await remap(page, 'Noir', 'Shift+B');
  await expect(keysOf(page, 'Noir')).toHaveText('Maj+B');
  await shortcutsPage(page).getByRole('button', { name: 'Fermer' }).click();
  await expect(shortcutsPage(page)).toBeHidden();

  // Shown on the buttons, in force at once; the old keys do nothing.
  await expect(silenceButton(page).locator('kbd')).toHaveText('N');
  await expect(silenceButton(page)).toHaveAttribute('aria-keyshortcuts', 'N');
  await expect(blackoutButton(page)).toHaveAttribute('aria-keyshortcuts', 'Shift+B');
  await focusPage(page);
  await page.keyboard.press('s');
  await page.keyboard.press('b');
  await page.keyboard.press('n');
  await expect(silenceButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(blackoutButton(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Shift+B');
  await expect(blackoutButton(page)).toHaveAttribute('aria-pressed', 'true');

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const again = restarted.controlWindow;
    await expect(silenceButton(again).locator('kbd')).toHaveText('N');

    // Typing in a field, the remapped key is text.
    const sceneName = again.getByRole('region', { name: 'Scènes' }).getByLabel('Nom de la scène');
    await sceneName.click();
    await again.keyboard.press('n');
    await expect(sceneName).toHaveValue('n');
    await expect(silenceButton(again)).toHaveAttribute('aria-pressed', 'false');
    // Pressed in the Broadcast window, it reaches nothing.
    const broadcast = await openBroadcastWindow(restarted.app, again);
    await broadcast.keyboard.press('n');
    await again.waitForTimeout(300);
    await expect(silenceButton(again)).toHaveAttribute('aria-pressed', 'false');
    await broadcast.close();

    await focusPage(again);
    await again.keyboard.press('n');
    await expect(silenceButton(again)).toHaveAttribute('aria-pressed', 'true');
    await again.keyboard.press('n');
    await expect(silenceButton(again)).toHaveAttribute('aria-pressed', 'false');

    // Reset brings every default back.
    await openShortcutsPage(again);
    await shortcutsPage(again)
      .getByRole('button', { name: 'Rétablir les raccourcis par défaut' })
      .click();
    await expect(keysOf(again, 'Silence')).toHaveText('S');
    await expect(keysOf(again, 'Noir')).toHaveText('B');
    await again.keyboard.press('Escape');
    await expect(shortcutsPage(again)).toBeHidden();
    await expect(silenceButton(again).locator('kbd')).toHaveText('S');
  } finally {
    await restarted.app.close();
  }
});

test('the Cut modifier can be remapped, and a modifier taken by the Activate keys is refused', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill('Cantina');
  await panel.getByRole('button', { name: 'Créer la scène' }).click();

  await openShortcutsPage(page);
  const cut = shortcutsPage(page).getByLabel('Forcer le Cut (avec une touche d’activation)');
  // Ctrl is part of the Activate keys: refused.
  await cut.selectOption('ctrl');
  await expect(status(page)).toContainText('Ctrl fait déjà partie');
  await expect(cut).toHaveValue('shift');
  await cut.selectOption('alt');
  await expect(cut).toHaveValue('alt');
  await shortcutsPage(page).getByRole('button', { name: 'Fermer' }).click();

  const activate = page
    .getByRole('region', { name: 'Scène ouverte' })
    .getByRole('button', { name: 'Activer', exact: true });
  await expect(activate).toHaveAttribute('title', /Avec Alt : en Cut/);
  await focusPage(page);
  await page.keyboard.press('Control+Alt+Enter');
  await expect.poll(async () => (await onAir(page)).activeSceneId).not.toBeNull();
  expect((await onAir(page)).transition?.kind).toBe('cut');
});
