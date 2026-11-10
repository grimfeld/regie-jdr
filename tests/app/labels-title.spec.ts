import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function overlayList(page: Page) {
  return editor(page).getByRole('list', { name: 'Superpositions' });
}

function overlayToggle(page: Page) {
  return overlayList(page).getByRole('checkbox', { name: `Afficher ${IMAGE}` });
}

function labelText(page: Page) {
  return overlayList(page).getByRole('textbox', { name: `Étiquette de ${IMAGE}` });
}

function labelToggle(page: Page) {
  return overlayList(page).getByRole('checkbox', { name: `Afficher l’étiquette de ${IMAGE}` });
}

function titleField(page: Page) {
  return editor(page).getByRole('textbox', { name: 'Titre affiché' });
}

async function importImage({ app, controlWindow }: RunningApp) {
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    controlWindow.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
}

/** A Campaign with one Scene holding one Hidden Overlay, Selected and Active. */
async function activeSceneWithOverlay(regie: RunningApp, sceneName: string) {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await importImage(regie);
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(sceneName);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en superposition' }).click();
  await expect(overlayToggle(page)).not.toBeChecked();
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
}

/** Overlay images the Broadcast window shows (loaded, so not hidden). */
function shownOverlays(broadcastWindow: Page) {
  return broadcastWindow.locator('.canvas-overlay img:not([hidden])');
}

test('a Label is on air only while both its Overlay and the Label are shown; new Labels start Hidden', async ({
  regie,
}) => {
  const { app, controlWindow: page } = regie;
  await activeSceneWithOverlay(regie, 'Cantina');
  const broadcastWindow = await openBroadcastWindow(app, page);
  const label = broadcastWindow.locator('.canvas-label');

  // A Label cannot be shown before it has text.
  await expect(labelToggle(page)).toBeDisabled();
  await labelText(page).fill('Garde');
  await labelText(page).press('Enter');
  await expect(labelToggle(page)).toBeEnabled();
  await expect(labelToggle(page)).not.toBeChecked();
  await expect(overlayList(page)).toContainText('Masquée');

  // Overlay shown, Label Hidden: the character without the name.
  await overlayToggle(page).check();
  await expect(shownOverlays(broadcastWindow)).toHaveCount(1);
  await expect(label).toHaveCount(0);

  await labelToggle(page).check();
  await expect(label).toHaveText('Garde');

  // Overlay Hidden: its Label goes with it, though still shown itself.
  await overlayToggle(page).uncheck();
  await expect(broadcastWindow.locator('.canvas-overlay')).toHaveCount(0);
  await expect(label).toHaveCount(0);

  await overlayToggle(page).check();
  await expect(label).toHaveText('Garde');
  await labelText(page).fill('Capitaine');
  await labelText(page).blur();
  await expect(label).toHaveText('Capitaine');
  await labelToggle(page).uncheck();
  await expect(label).toHaveCount(0);
  await expect(shownOverlays(broadcastWindow)).toHaveCount(1);
  // The editor still draws the Hidden Label, in the GM-only style.
  await expect(editor(page).locator('.canvas-label.is-hidden')).toHaveText('Capitaine');
});

test('the Scene title is on air only when set; the Scene name never is', async ({ regie }) => {
  const { app, controlWindow: page } = regie;
  await activeSceneWithOverlay(regie, 'Embuscade secrète');
  const broadcastWindow = await openBroadcastWindow(app, page);
  await expect(broadcastWindow.locator('main.broadcast-screen')).not.toHaveAttribute(
    'data-active-scene-id',
    '',
  );
  const title = broadcastWindow.locator('.canvas-title');

  await expect(titleField(page)).toHaveValue('');
  await expect(title).toHaveCount(0);

  await titleField(page).fill('Le vieux moulin');
  await titleField(page).press('Enter');
  await expect(title).toHaveText('Le vieux moulin');
  await expect(editor(page).getByRole('heading', { name: 'Embuscade secrète' })).toBeVisible();
  expect(await broadcastWindow.content()).not.toContain('Embuscade');

  await titleField(page).fill('');
  await titleField(page).blur();
  await expect(title).toHaveCount(0);
  expect(await broadcastWindow.content()).not.toContain('Embuscade');
});

test('Labels and the Scene title survive a restart', async ({ regie }) => {
  const { app, controlWindow: page, dataDir } = regie;
  await activeSceneWithOverlay(regie, 'Cantina');
  const broadcastWindow = await openBroadcastWindow(app, page);
  await overlayToggle(page).check();
  await labelText(page).fill('Garde');
  await labelText(page).press('Enter');
  await labelToggle(page).check();
  await titleField(page).fill('Le vieux moulin');
  await titleField(page).press('Enter');
  // The main process saves each edit before it puts it on air.
  await expect(broadcastWindow.locator('.canvas-label')).toHaveText('Garde');
  await expect(broadcastWindow.locator('.canvas-title')).toHaveText('Le vieux moulin');
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    // The only Campaign opens directly, its last Active Scene selected but not on air.
    await expect(labelText(page)).toHaveValue('Garde');
    await expect(labelToggle(page)).toBeChecked();
    await expect(titleField(page)).toHaveValue('Le vieux moulin');

    await editor(page).getByRole('button', { name: 'Activer' }).click();
    const broadcastWindow = await openBroadcastWindow(restarted.app, page);
    await expect(broadcastWindow.locator('.canvas-label')).toHaveText('Garde');
    await expect(broadcastWindow.locator('.canvas-title')).toHaveText('Le vieux moulin');
  } finally {
    await restarted.app.close();
  }
});
