import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
} from './harness';

const IMAGE = 'red-16x9';

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function notesSection(page: Page) {
  return page.getByRole('region', { name: 'Notes', exact: true });
}

function notes(page: Page) {
  return notesSection(page).getByRole('textbox', { name: 'Notes de la scène' });
}

function format(page: Page, name: string) {
  return notesSection(page)
    .getByRole('toolbar', { name: 'Mise en forme des notes' })
    .getByRole('button', { name, exact: true });
}

function sceneUndo(page: Page) {
  return editor(page)
    .getByRole('toolbar', { name: 'Historique de la scène' })
    .getByRole('button', { name: /annuler/i });
}

async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** The only Campaign's scenes.json. */
async function scenesFile(dataDir: string): Promise<string> {
  const campaigns = path.join(dataDir, 'campaigns');
  const [campaignId] = await fs.readdir(campaigns);
  return path.join(campaigns, campaignId, 'scenes.json');
}

interface StoredScenes {
  schemaVersion: number;
  scenes: { name: string; notes: unknown }[];
}

async function storedScenes(dataDir: string): Promise<StoredScenes> {
  return JSON.parse(await fs.readFile(await scenesFile(dataDir), 'utf8')) as StoredScenes;
}

/** The stored Notes of the first Scene, as JSON text. */
async function storedNotes(dataDir: string): Promise<string> {
  return JSON.stringify((await storedScenes(dataDir)).scenes[0]?.notes);
}

test('every allowed formatting works and survives a restart', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Le moulin');
  const type = (text: string) => page.keyboard.type(text);
  const enter = () => page.keyboard.press('Enter');

  await notes(page).click();
  await format(page, 'Titre').click();
  await type('Le moulin');
  await enter();
  await format(page, 'Sous-titre').click();
  await type('Rez-de-chaussée');
  await enter();
  await format(page, 'Gras').click();
  await type('menteur');
  await format(page, 'Gras').click();
  await format(page, 'Italique').click();
  await type(' toujours');
  await format(page, 'Italique').click();
  await enter();
  await format(page, 'Liste à puces').click();
  await type('Farine');
  await enter();
  await enter();
  await format(page, 'Liste numérotée').click();
  await type('Entrer');
  await enter();
  await enter();
  await format(page, 'Liste de cases à cocher').click();
  await type('Indice trouvé');
  await enter();
  await enter();
  await format(page, 'Citation').click();
  await type('Qui va là ?');
  await notesSection(page)
    .getByRole('checkbox', { name: /Indice trouvé/ })
    .check();

  // Saved without leaving the editor.
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('Qui va là ?');
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('"checked":true');

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    const shown = notes(restarted.controlWindow);
    await expect(shown.locator('h1')).toHaveText('Le moulin');
    await expect(shown.locator('h2')).toHaveText('Rez-de-chaussée');
    await expect(shown.locator('strong')).toHaveText('menteur');
    await expect(shown.locator('em')).toHaveText(' toujours');
    await expect(shown.locator('ul:not([data-type]) li')).toHaveText('Farine');
    await expect(shown.locator('ol li')).toHaveText('Entrer');
    await expect(shown.locator('ul[data-type="taskList"] li')).toHaveAttribute(
      'data-checked',
      'true',
    );
    await expect(shown.locator('blockquote')).toHaveText('Qui va là ?');
  } finally {
    await restarted.app.close();
  }
});

test('pasted links, tables, colours, images and other markup are kept as allowed text only', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  await notes(page).click();

  await notes(page).evaluate((target) => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p>Voir <a href="https://exemple.fr/secret">le lien</a></p>' +
        '<table><tr><td>Case du tableau</td></tr></table>' +
        '<p><span style="color: red">Texte rouge</span> <u>souligné</u> <s>barré</s></p>' +
        '<h3>Titre trois</h3><pre><code>du code</code></pre><hr>' +
        '<img src="https://exemple.fr/image.png" alt="image">',
    );
    data.setData('text/plain', 'Voir le lien');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });

  const shown = notes(page);
  for (const text of ['le lien', 'Case du tableau', 'Texte rouge', 'souligné', 'Titre trois']) {
    await expect(shown).toContainText(text);
  }
  await expect(shown.locator('a, table, img, h3, pre, code, hr, u, s, [style]')).toHaveCount(0);
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('Case du tableau');
  const stored = await storedNotes(regie.dataDir);
  const types = [...stored.matchAll(/"type":"([^"]+)"/g)].map(([, type]) => type);
  expect(new Set(types)).toEqual(new Set(['doc', 'paragraph', 'text']));
  for (const markup of ['exemple.fr', 'href', 'color', 'style', 'src']) {
    expect(stored).not.toContain(markup);
  }
});

test('Notes undo is separate from the Scene undo history, both ways', async ({ regie }) => {
  const { app, controlWindow: page } = regie;
  await createCampaign(page, 'Star Wars');
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await createScene(page, 'Cantina');
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en superposition' }).click();
  const placed = `Annuler : placer ${IMAGE} en superposition`;
  await expect(sceneUndo(page)).toHaveText(placed);
  const overlays = editor(page).getByRole('list', { name: 'Superpositions' }).getByRole('listitem');
  await expect(overlays).toHaveCount(1);

  // Typing Notes adds no Scene undo step.
  await notes(page).click();
  await page.keyboard.type('Le traître');
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('Le traître');
  await expect(sceneUndo(page)).toHaveText(placed);

  // Ctrl+Z in the Notes undoes the typing, not the Scene edit.
  await page.keyboard.press('Control+z');
  await expect(notes(page)).not.toContainText('Le traître');
  await expect(overlays).toHaveCount(1);
  await expect.poll(() => storedNotes(regie.dataDir)).not.toContain('Le traître');
  await page.keyboard.press('Control+y');
  await expect(notes(page)).toContainText('Le traître');

  // The Scene undo removes the Overlay and keeps the Notes as typed.
  await sceneUndo(page).click();
  await expect(overlays).toHaveCount(0);
  await expect(notes(page)).toContainText('Le traître');
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('Le traître');
});

test('Notes of the Active Scene are shown while it is on air and never reach the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow: page } = regie;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, page);

  await notes(page).click();
  await page.keyboard.type('Le traître est le capitaine');
  await expect.poll(() => storedNotes(regie.dataDir)).toContain('capitaine');
  await expect(notes(page)).toContainText('Le traître est le capitaine');

  expect(await broadcastWindow.content()).not.toContain('traître');
  expect(await broadcastWindow.content()).not.toContain('capitaine');
});

test('plain-text Notes from an older data folder become one paragraph per line', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Le moulin');
  await regie.app.close();

  // Rewrite the stored Scenes as version 2 (Milestones 1 and 2) did, Notes as plain text.
  const file = await scenesFile(regie.dataDir);
  const stored = await storedScenes(regie.dataDir);
  await fs.writeFile(
    file,
    JSON.stringify({
      schemaVersion: 2,
      scenes: stored.scenes.map((scene) => ({
        ...scene,
        notes: 'Le meunier ment.\n\n  Il cache la farine.',
      })),
    }),
  );

  const restarted = await launchApp(regie.dataDir);
  try {
    const paragraphs = notes(restarted.controlWindow).locator('p');
    await expect(paragraphs).toHaveCount(3);
    await expect(paragraphs.nth(0)).toHaveText('Le meunier ment.');
    await expect(paragraphs.nth(1)).toHaveText('');
    await expect(paragraphs.nth(2)).toHaveText('  Il cache la farine.');
  } finally {
    await restarted.app.close();
  }
});
