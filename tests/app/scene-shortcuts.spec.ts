import type { Page } from '@playwright/test';
import type { OnAirState } from '../../shared/domain';
import { createCampaign, expect, openBroadcastWindow, test } from './harness';

/** The on-air state, as the Control window's bridge gives it. */
function onAir(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { regie: { getOnAir(): Promise<OnAirState> } }).regie.getOnAir(),
  );
}

/** The name of the Active Scene, or null when nothing is on air. */
async function activeName(page: Page) {
  const state = await onAir(page);
  return state.scene ? (await sceneNames(page))[state.activeSceneId ?? ''] : null;
}

/** Each Scene's name by its id. */
function sceneNames(page: Page) {
  return page.evaluate(async () => {
    const regie = (
      window as unknown as {
        regie: {
          getOnAir(): Promise<OnAirState>;
          listScenes(id: string): Promise<{ id: string; name: string }[]>;
        };
      }
    ).regie;
    const { campaignId } = await regie.getOnAir();
    const scenes = await regie.listScenes(campaignId ?? '');
    return Object.fromEntries(scenes.map((scene) => [scene.id, scene.name]));
  });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

/** Creates the Scenes `names`, in running order, through the Scenes panel. */
async function createScenes(page: Page, ...names: string[]) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  for (const name of names) {
    await panel.getByLabel('Nom de la scène').fill(name);
    await panel.getByRole('button', { name: 'Créer la scène' }).click();
    await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
  }
}

async function openScene(page: Page, name: string) {
  await page
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Focus on the page itself, as after clicking an empty spot. */
async function focusPage(page: Page) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
}

function blackoutButton(page: Page) {
  return page.getByRole('region', { name: 'À l’antenne' }).getByRole('button', { name: 'Noir' });
}

test('Ctrl+Enter, Ctrl+Down and Ctrl+Up Activate Scenes in running order, keys shown', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, 'Cantina', 'Hangar', 'Trône');

  const activate = editor(page).getByRole('button', { name: 'Activer', exact: true });
  await expect(activate.locator('kbd')).toHaveText('Ctrl+Entrée');
  await expect(activate).toHaveAttribute('aria-keyshortcuts', 'Ctrl+Entrée');
  await expect(activate).toHaveAttribute('title', /Ctrl\+↓ \/ Ctrl\+↑/);

  // Nothing on air: Ctrl+Up goes to the first Scene, whichever is Selected (Trône).
  await focusPage(page);
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => activeName(page)).toBe('Cantina');

  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Hangar');
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Trône');
  // The last Scene: no wrap.
  await page.keyboard.press('Control+ArrowDown');
  await page.waitForTimeout(300);
  expect(await activeName(page)).toBe('Trône');

  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => activeName(page)).toBe('Hangar');
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => activeName(page)).toBe('Cantina');
  // The first Scene: no wrap.
  await page.keyboard.press('Control+ArrowUp');
  await page.waitForTimeout(300);
  expect(await activeName(page)).toBe('Cantina');
  // Stepping never changed the Selected Scene.
  await expect(editor(page).getByRole('heading', { name: 'Trône', exact: true })).toBeVisible();

  // Ctrl+Enter Activates the Selected Scene, with its own Transition.
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => activeName(page)).toBe('Trône');
  expect((await onAir(page)).transition?.kind).toBe('crossfade');
});

test('Shift with an Activate shortcut forces a Cut and leaves the Transition as it is', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, 'Cantina', 'Hangar');
  await openScene(page, 'Cantina');
  await focusPage(page);

  await page.keyboard.press('Control+Shift+Enter');
  await expect.poll(() => activeName(page)).toBe('Cantina');
  expect((await onAir(page)).transition?.kind).toBe('cut');

  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Hangar');
  expect((await onAir(page)).transition?.kind).toBe('cut');

  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => activeName(page)).toBe('Cantina');
  expect((await onAir(page)).transition?.kind).toBe('crossfade');
  await expect(editor(page).getByRole('combobox', { name: 'Transition' })).toHaveValue('crossfade');
});

test('B toggles Blackout, key shown', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, 'Cantina');
  await expect(blackoutButton(page).locator('kbd')).toHaveText('B');
  await expect(blackoutButton(page)).toHaveAttribute('aria-keyshortcuts', 'B');

  await focusPage(page);
  await page.keyboard.press('b');
  await expect(blackoutButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('b');
  await expect(blackoutButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('quick presses each act on the state the press before left', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, 'Cantina', 'Hangar', 'Trône');
  await focusPage(page);
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Cantina');

  // Two presses before the window sees the first one go on air: two Scenes further.
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Trône');

  // Blackout pressed twice at once: on, then off again.
  const before = (await onAir(page)).version;
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect.poll(async () => (await onAir(page)).version).toBe(before + 2);
  expect((await onAir(page)).blackout).toBe(false);
  await expect(blackoutButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('Scene shortcuts do nothing while typing, in the Notes or in another window', async ({
  regie,
}) => {
  const { app, controlWindow: page } = regie;
  await createCampaign(page, 'Star Wars');
  await createScenes(page, 'Cantina', 'Hangar');

  // In a text field.
  const sceneName = page.getByRole('region', { name: 'Scènes' }).getByLabel('Nom de la scène');
  await sceneName.click();
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('b');
  await expect(sceneName).toHaveValue('b');

  // In the Notes editor: B is text, Ctrl+Enter and Ctrl+Up stay with the editor.
  const notes = page.getByRole('textbox', { name: 'Notes de la scène' });
  await notes.click();
  await page.keyboard.press('b');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+ArrowUp');
  await expect(notes).toContainText('b');

  // In the Broadcast window.
  const broadcast = await openBroadcastWindow(app, page);
  await broadcast.keyboard.press('Control+Enter');
  await broadcast.keyboard.press('Control+ArrowDown');
  await broadcast.keyboard.press('b');

  await page.waitForTimeout(500);
  const state = await onAir(page);
  expect(state.activeSceneId).toBeNull();
  expect(state.blackout).toBe(false);
});
