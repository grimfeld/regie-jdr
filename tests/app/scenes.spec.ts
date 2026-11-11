import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  dropAndWait,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

/** The Scenes panel of the open Campaign. */
function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

/** The editor of the Selected Scene. */
function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

async function importImage({ app, controlWindow }: RunningApp) {
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    controlWindow.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
}

/** Creates a Scene from the Scenes panel; it becomes the Selected Scene. */
async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

async function selectScene(page: Page, name: string) {
  await scenesPanel(page)
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Places the imported image as a Background of the Selected Scene (it starts Hidden). */
async function addBackground(page: Page) {
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en arrière-plan' }).click();
  await expect(backgroundToggle(page)).toBeVisible();
}

function backgroundToggle(page: Page) {
  return editor(page)
    .getByRole('list', { name: 'Arrière-plans' })
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` });
}

/** Background images the Broadcast window shows (loaded, so not hidden). */
function shownBackgrounds(broadcastWindow: Page) {
  return broadcastWindow.locator('main.broadcast-screen .canvas-background img:not([hidden])');
}

function broadcastScreen(broadcastWindow: Page) {
  return broadcastWindow.locator('main.broadcast-screen');
}

test('Activate puts the Scene on air, and editing it updates the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow, cspViolations, failedRequests } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  // The new Background is Hidden: it never reaches the Broadcast window.
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);

  await backgroundToggle(controlWindow).check();
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  expect(
    await shownBackgrounds(broadcastWindow).evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(16);

  await backgroundToggle(controlWindow).uncheck();
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await backgroundToggle(controlWindow).check();
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);

  expect(cspViolations).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('a Scene with a Background, edited while active, is kept after a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await backgroundToggle(controlWindow).check();
  // The main process saves the edit before it puts it on air.
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    // The only Campaign opens directly; nothing is on air after a restart.
    const page = restarted.controlWindow;
    await selectScene(page, 'Cantina');
    await expect(backgroundToggle(page)).toBeChecked();
    await expect(editor(page)).not.toContainText('EN DIRECT');
    const broadcastWindow = await openBroadcastWindow(restarted.app, page);
    await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
    await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  } finally {
    await restarted.app.close();
  }
});

test('editing a Scene that is not active never changes the Broadcast window', async ({ regie }) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  const version = await broadcastScreen(broadcastWindow).getAttribute('data-version');

  await createScene(controlWindow, 'Hangar');
  await expect(editor(controlWindow)).not.toContainText('EN DIRECT');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await expect(backgroundToggle(controlWindow)).toBeChecked();
  // The edit is saved (read back through the Control bridge).
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        const { regie } = window as unknown as {
          regie: {
            listScenes(
              id: string,
            ): Promise<{ name: string; backgrounds: { visible: boolean }[] }[]>;
          };
        };
        const onAir = await (
          window as unknown as { regie: { getOnAir(): Promise<{ campaignId: string }> } }
        ).regie.getOnAir();
        const scenes = await regie.listScenes(onAir.campaignId);
        return scenes.find((scene) => scene.name === 'Hangar')?.backgrounds[0]?.visible;
      }),
    )
    .toBe(true);

  // A round trip through the Broadcast bridge, then two frames: any change has arrived.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-version', version ?? '');
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
});

test('opening a Campaign puts nothing on air; switching Campaign clears the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);

  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  // Audio stops too: tests/app/audio.spec.ts.

  // Back into Star Wars: nothing goes on air until a Scene is Activated.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await controlWindow
    .getByRole('list', { name: 'Campagnes' })
    .getByRole('button', { name: 'Star Wars', exact: true })
    .click();
  await selectScene(controlWindow, 'Cantina');
  await expect(editor(controlWindow)).not.toContainText('EN DIRECT');
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
});

test('a Background whose file was deleted shows nothing broken in the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, cspViolations } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');

  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  const mediaFolder = path.join(dataDir, 'campaigns', campaignId, 'media');
  for (const file of await fs.readdir(mediaFolder)) await fs.rm(path.join(mediaFolder, file));

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(1);
  // The 404 leaves no <img> to show a broken-image icon.
  await expect(broadcastWindow.locator('.canvas-background img')).toHaveCount(0);
  expect(cspViolations).toEqual([]);
});

/** The Scene list's entry for `name`. */
function sceneEntry(page: Page, name: string) {
  return scenesPanel(page)
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true });
}

async function renameSelectedScene(page: Page, name: string) {
  await editor(page).getByRole('button', { name: 'Renommer' }).click();
  await editor(page).getByLabel('Nouveau nom de la scène').fill(name);
  await editor(page).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Deletes the Selected Scene, confirming when asked. */
async function deleteSelectedScene(page: Page) {
  await editor(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
  await editor(page)
    .getByRole('alertdialog', { name: 'Supprimer la scène' })
    .getByRole('button', { name: 'Supprimer la scène' })
    .click();
}

test('Scenes are created, renamed and deleted, and the changes survive a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await createScene(controlWindow, 'Hangar');
  await createScene(controlWindow, 'Brouillon');

  await selectScene(controlWindow, 'Cantina');
  await renameSelectedScene(controlWindow, 'Cantina de Mos Eisley');
  await expect(sceneEntry(controlWindow, 'Cantina')).toHaveCount(0);

  // Cancelling the confirmation keeps the Scene.
  await selectScene(controlWindow, 'Brouillon');
  await editor(controlWindow).getByRole('button', { name: 'Supprimer', exact: true }).click();
  await editor(controlWindow).getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(sceneEntry(controlWindow, 'Brouillon')).toBeVisible();
  await deleteSelectedScene(controlWindow);
  await expect(sceneEntry(controlWindow, 'Brouillon')).toHaveCount(0);

  // An empty name is refused, in French, and the Scene keeps its name.
  await selectScene(controlWindow, 'Hangar');
  await editor(controlWindow).getByRole('button', { name: 'Renommer' }).click();
  await editor(controlWindow).getByLabel('Nouveau nom de la scène').fill('   ');
  await editor(controlWindow).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(editor(controlWindow).getByRole('alert')).toHaveText('Donnez un nom à la scène.');
  await editor(controlWindow).getByRole('button', { name: 'Annuler', exact: true }).click();
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    const names = scenesPanel(page)
      .getByRole('list', { name: 'Scènes de la campagne' })
      .getByRole('button');
    await expect(names).toHaveText(['Cantina de Mos Eisley', 'Hangar']);
  } finally {
    await restarted.app.close();
  }
});

test('Scenes are dragged into their running order, new ones go last, and the order survives a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await createScene(controlWindow, 'Hangar');
  await createScene(controlWindow, 'Désert');
  await renameSelectedScene(controlWindow, 'Dune');
  const row = (name: string) => sceneEntry(controlWindow, name).locator('xpath=..');
  const names = (page: Page) =>
    scenesPanel(page).getByRole('list', { name: 'Scènes de la campagne' }).getByRole('button');

  await dropAndWait(
    row('Dune'),
    row('Cantina'),
    names(controlWindow).first().and(sceneEntry(controlWindow, 'Dune')),
  );
  await expect(names(controlWindow)).toHaveText(['Dune', 'Cantina', 'Hangar']);
  await dropAndWait(
    row('Cantina'),
    row('Hangar'),
    names(controlWindow).last().and(sceneEntry(controlWindow, 'Cantina')),
  );
  await expect(names(controlWindow)).toHaveText(['Dune', 'Hangar', 'Cantina']);

  // Reordering is not a Scene edit: undo still undoes the rename, and the order stays.
  await editor(controlWindow)
    .getByRole('toolbar', { name: 'Historique de la scène' })
    .getByRole('button', { name: /^Annuler : / })
    .click();
  await expect(names(controlWindow)).toHaveText(['Désert', 'Hangar', 'Cantina']);

  await createScene(controlWindow, 'Épilogue');
  await expect(names(controlWindow)).toHaveText(['Désert', 'Hangar', 'Cantina', 'Épilogue']);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    await expect(names(restarted.controlWindow)).toHaveText([
      'Désert',
      'Hangar',
      'Cantina',
      'Épilogue',
    ]);
  } finally {
    await restarted.app.close();
  }
});

test('a focused Scene moves up with Alt+Up and down with Alt+Down, and keeps its place after a restart', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  await createScene(page, 'Hangar');
  await createScene(page, 'Dune');
  const names = (on: Page) =>
    scenesPanel(on).getByRole('list', { name: 'Scènes de la campagne' }).getByRole('button');

  await sceneEntry(page, 'Dune').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(names(page)).toHaveText(['Cantina', 'Dune', 'Hangar']);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(names(page)).toHaveText(['Dune', 'Cantina', 'Hangar']);
  // The moved Scene keeps the focus; the first one goes no higher.
  await expect(sceneEntry(page, 'Dune')).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(names(page)).toHaveText(['Dune', 'Cantina', 'Hangar']);

  await page.keyboard.press('Alt+ArrowDown');
  await expect(names(page)).toHaveText(['Cantina', 'Dune', 'Hangar']);
  await expect(sceneEntry(page, 'Dune')).toBeFocused();
  await sceneEntry(page, 'Cantina').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(names(page)).toHaveText(['Dune', 'Hangar', 'Cantina']);

  // Away from the list the keys move nothing.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Alt+ArrowUp');
  await expect(names(page)).toHaveText(['Dune', 'Hangar', 'Cantina']);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    await expect(names(restarted.controlWindow)).toHaveText(['Dune', 'Hangar', 'Cantina']);
  } finally {
    await restarted.app.close();
  }
});

test('a duplicated Scene is a private copy right after its source, edited on its own, and kept after a restart', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  const names = (window: Page) =>
    scenesPanel(window).getByRole('list', { name: 'Scènes de la campagne' }).getByRole('button');
  const title = (window: Page) => editor(window).getByLabel('Titre affiché');
  const notes = (window: Page) =>
    window
      .getByRole('region', { name: 'Notes', exact: true })
      .getByRole('textbox', { name: 'Notes de la scène' });
  const history = (window: Page) =>
    editor(window).getByRole('toolbar', { name: 'Historique de la scène' });
  await createCampaign(page, 'Star Wars');
  await importImage(regie);
  await createScene(page, 'Cantina');
  await addBackground(page);
  await title(page).fill('Le vieux moulin');
  await title(page).press('Enter');
  await createScene(page, 'Hangar');
  await selectScene(page, 'Cantina');
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, page);
  const activeId = await broadcastScreen(broadcastWindow).getAttribute('data-active-scene-id');
  expect(activeId).not.toBe('');
  // Notes typed just before duplicating are in the copy.
  await notes(page).click();
  await page.keyboard.type('Le traître');

  await editor(page).getByRole('button', { name: 'Dupliquer' }).click();

  await expect(editor(page).getByRole('heading', { name: 'Cantina (copie)' })).toBeVisible();
  await expect(names(page)).toHaveText(['Cantina', 'Cantina (copie)', 'Hangar']);
  await expect(editor(page)).not.toContainText('EN DIRECT');
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute(
    'data-active-scene-id',
    activeId ?? '',
  );
  await expect(backgroundToggle(page)).not.toBeChecked();
  await expect(title(page)).toHaveValue('Le vieux moulin');
  await expect(notes(page)).toHaveText('Le traître');
  // Not an undo step: the copy starts with nothing to undo.
  await expect(history(page).getByRole('button', { name: 'Rien à annuler' })).toBeDisabled();

  await backgroundToggle(page).check();
  await title(page).fill('Après le combat');
  await title(page).press('Enter');
  await expect(history(page).getByRole('button', { name: /^Annuler : / })).toBeVisible();

  // The source is unchanged, still on air, and its own history is untouched.
  await selectScene(page, 'Cantina');
  await expect(backgroundToggle(page)).not.toBeChecked();
  await expect(title(page)).toHaveValue('Le vieux moulin');
  await expect(history(page).getByRole('button', { name: /^Annuler : / })).toHaveText(
    'Annuler : modifier le titre affiché',
  );
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const window = restarted.controlWindow;
    await expect(names(window)).toHaveText(['Cantina', 'Cantina (copie)', 'Hangar']);
    await selectScene(window, 'Cantina (copie)');
    await expect(backgroundToggle(window)).toBeChecked();
    await expect(title(window)).toHaveValue('Après le combat');
    await expect(notes(window)).toHaveText('Le traître');
    await selectScene(window, 'Cantina');
    await expect(backgroundToggle(window)).not.toBeChecked();
    await expect(title(window)).toHaveValue('Le vieux moulin');
  } finally {
    await restarted.app.close();
  }
});

test('the editor draws the Selected Scene, Hidden placements included; "EN DIRECT" only when it is the Active Scene', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  const drawn = editor(controlWindow).locator('.editor-canvas .canvas-background');
  // A new Background starts Hidden: the Game Master sees it, in the GM-only style.
  await expect(drawn).toHaveCount(1);
  await expect(drawn).toHaveClass(/is-hidden/);
  await backgroundToggle(controlWindow).check();
  await expect(drawn).not.toHaveClass(/is-hidden/);
  await expect(editor(controlWindow)).not.toContainText('EN DIRECT');

  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');

  // Another Scene, empty, is drawn empty and is not live.
  await createScene(controlWindow, 'Hangar');
  await expect(editor(controlWindow).locator('.editor-canvas .canvas-background')).toHaveCount(0);
  await expect(editor(controlWindow)).not.toContainText('EN DIRECT');
  await selectScene(controlWindow, 'Cantina');
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  await expect(drawn).toHaveCount(1);
});

test('opening a Campaign selects its last Active Scene and puts nothing on air', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await createScene(controlWindow, 'Hangar');
  await selectScene(controlWindow, 'Cantina');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  await selectScene(controlWindow, 'Hangar');
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(editor(page).getByRole('heading', { name: 'Cantina', exact: true })).toBeVisible();
    await expect(sceneEntry(page, 'Cantina')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor(page)).not.toContainText('EN DIRECT');
    const broadcastWindow = await openBroadcastWindow(restarted.app, page);
    await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  } finally {
    await restarted.app.close();
  }
});

/** From a Campaign's screen, opens another Campaign through the Campaign list. */
async function switchCampaign(page: Page, name: string) {
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await page
    .getByRole('list', { name: 'Campagnes' })
    .getByRole('button', { name, exact: true })
    .click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}

/** Expects `name` to be the Selected Scene, open in the editor and not on air. */
async function expectSelectedOffAir(page: Page, name: string) {
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(sceneEntry(page, name)).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).not.toContainText('EN DIRECT');
}

test('switching Campaign and restarting select each Campaign’s last Active Scene, else the first Scene', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  // Star Wars: Hangar was Active, Cantina is left selected.
  await createCampaign(controlWindow, 'Star Wars');
  await createScene(controlWindow, 'Cantina');
  await createScene(controlWindow, 'Hangar');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  await selectScene(controlWindow, 'Cantina');
  // Warhammer: Crypte was Active, Cathédrale is left selected.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await createScene(controlWindow, 'Cathédrale');
  await createScene(controlWindow, 'Crypte');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  await selectScene(controlWindow, 'Cathédrale');
  // Dune: no Scene was ever Active.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Dune');
  await createScene(controlWindow, 'Arrakis');
  await createScene(controlWindow, 'Caladan');

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await switchCampaign(controlWindow, 'Star Wars');
  await expectSelectedOffAir(controlWindow, 'Hangar');
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await switchCampaign(controlWindow, 'Warhammer');
  await expectSelectedOffAir(controlWindow, 'Crypte');
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await switchCampaign(controlWindow, 'Dune');
  await expectSelectedOffAir(controlWindow, 'Arrakis');

  // The last Active Scene deleted: Warhammer falls back to its first Scene.
  await switchCampaign(controlWindow, 'Warhammer');
  await expectSelectedOffAir(controlWindow, 'Crypte');
  await deleteSelectedScene(controlWindow);
  await expect(sceneEntry(controlWindow, 'Crypte')).toHaveCount(0);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    const reopened = await openBroadcastWindow(restarted.app, page);
    await page
      .getByRole('list', { name: 'Campagnes' })
      .getByRole('button', { name: 'Star Wars', exact: true })
      .click();
    await expectSelectedOffAir(page, 'Hangar');
    await expect(broadcastScreen(reopened)).toHaveAttribute('data-active-scene-id', '');
    await switchCampaign(page, 'Warhammer');
    await expectSelectedOffAir(page, 'Cathédrale');
    await switchCampaign(page, 'Dune');
    await expectSelectedOffAir(page, 'Arrakis');
    await expect(broadcastScreen(reopened)).toHaveAttribute('data-active-scene-id', '');
  } finally {
    await restarted.app.close();
  }
});

test('a Campaign with no Scenes shows an empty editor inviting the Game Master to create one', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');

  await expect(editor(controlWindow)).toContainText('Aucune scène');
  await editor(controlWindow).getByRole('button', { name: 'Créer une scène' }).click();
  await expect(scenesPanel(controlWindow).getByLabel('Nom de la scène')).toBeFocused();
  await controlWindow.keyboard.type('Cantina');
  await controlWindow.keyboard.press('Enter');
  await expect(editor(controlWindow).getByRole('heading', { name: 'Cantina' })).toBeVisible();
});

test('deleting the Active Scene asks for confirmation, then the broadcast shows nothing on air', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);

  await editor(controlWindow).getByRole('button', { name: 'Supprimer', exact: true }).click();
  const confirmation = editor(controlWindow).getByRole('alertdialog', {
    name: 'Supprimer la scène',
  });
  await expect(confirmation).toContainText('à l’antenne');
  // Nothing changes until the Game Master confirms.
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  await confirmation.getByRole('button', { name: 'Supprimer la scène' }).click();

  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await expect(sceneEntry(controlWindow, 'Cantina')).toHaveCount(0);
  await expect(editor(controlWindow)).toContainText('Aucune scène');
});
