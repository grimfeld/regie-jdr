import type { Page } from '@playwright/test';
import type { OnAirState } from '../../shared/domain';
import { createCampaign, dropAndWait, expect, launchApp, test } from './harness';

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function sceneList(page: Page) {
  return scenesPanel(page).getByRole('list', { name: 'Scènes de la campagne' });
}

/** The Scenes shown in a Chapter, by name, in order. */
function chapterScenes(page: Page, chapter: string) {
  return sceneList(page)
    .getByRole('list', { name: `Scènes du chapitre ${chapter}` })
    .getByRole('button');
}

/** A Chapter's collapse toggle, named by the Chapter and its Scene count. */
function chapterToggle(page: Page, chapter: string) {
  return sceneList(page)
    .getByRole('group', { name: `Chapitre ${chapter}` })
    .getByRole('button', { name: new RegExp(String.raw`^${chapter} \(\d+\)$`) });
}

function sceneEntry(page: Page, name: string) {
  return sceneList(page).getByRole('button', { name, exact: true });
}

async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

async function createChapter(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom du chapitre').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer le chapitre' }).click();
  await expect(chapterToggle(page, name)).toBeVisible();
}

async function selectScene(page: Page, name: string) {
  await sceneEntry(page, name).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Puts the Selected Scene last in a Chapter, from the editor's Chapitre menu. */
async function moveToChapter(page: Page, chapter: string) {
  await editor(page).getByRole('combobox', { name: 'Chapitre' }).selectOption({ label: chapter });
}

/** The name of the Active Scene, or null when nothing is on air. */
function activeName(page: Page) {
  return page.evaluate(async () => {
    const regie = (
      window as unknown as {
        regie: {
          getOnAir(): Promise<OnAirState>;
          listScenes(id: string): Promise<{ id: string; name: string }[]>;
        };
      }
    ).regie;
    const { campaignId, activeSceneId } = await regie.getOnAir();
    const scenes = await regie.listScenes(campaignId ?? '');
    return scenes.find((scene) => scene.id === activeSceneId)?.name ?? null;
  });
}

test('Chapters group Scenes, collapse, and keep their Scenes and collapsed state after a restart; next and previous cross them', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  await createScene(page, 'Hangar');
  await createScene(page, 'Dune');
  await createChapter(page, 'Prologue');
  await selectScene(page, 'Cantina');
  await moveToChapter(page, 'Prologue');
  await selectScene(page, 'Hangar');
  await moveToChapter(page, 'Prologue');
  await expect(chapterScenes(page, 'Prologue')).toHaveText(['Cantina', 'Hangar']);

  // A new Scene goes last in the Chapter of the Selected Scene (Hangar).
  await createScene(page, 'Taverne');
  await expect(chapterScenes(page, 'Prologue')).toHaveText(['Cantina', 'Hangar', 'Taverne']);
  await expect(editor(page).getByRole('combobox', { name: 'Chapitre' })).toHaveValue(/.+/);

  await chapterToggle(page, 'Prologue').click();
  await expect(chapterToggle(page, 'Prologue')).toHaveAttribute('aria-expanded', 'false');
  await expect(sceneEntry(page, 'Cantina')).toHaveCount(0);

  // Next and previous walk every Scene, through the collapsed Chapter.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Cantina');
  await expect(sceneList(page).getByRole('group', { name: 'Chapitre Prologue' })).toContainText(
    'Active',
  );
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Taverne');
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(() => activeName(page)).toBe('Dune');
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(() => activeName(page)).toBe('Taverne');
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const window = restarted.controlWindow;
    await expect(chapterToggle(window, 'Prologue')).toHaveAttribute('aria-expanded', 'false');
    await expect(sceneEntry(window, 'Cantina')).toHaveCount(0);
    await expect(sceneEntry(window, 'Dune')).toBeVisible();
    await chapterToggle(window, 'Prologue').click();
    await expect(chapterScenes(window, 'Prologue')).toHaveText(['Cantina', 'Hangar', 'Taverne']);
  } finally {
    await restarted.app.close();
  }
});

test('a Chapter is renamed, reordered and deleted, its Scenes kept; Alt+Up steps over a collapsed Chapter', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  await createScene(page, 'Hangar');
  await createScene(page, 'Dune');
  await createChapter(page, 'Un');
  await createChapter(page, 'Deux');
  await selectScene(page, 'Cantina');
  await moveToChapter(page, 'Un');
  await selectScene(page, 'Hangar');
  await moveToChapter(page, 'Deux');
  await chapterToggle(page, 'Un').click();
  await expect(chapterToggle(page, 'Un')).toHaveAttribute('aria-expanded', 'false');

  // Alt+Up takes Dune into the end of Deux, then above Hangar, then no further: Un is collapsed.
  await sceneEntry(page, 'Dune').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Hangar', 'Dune']);
  await expect(sceneEntry(page, 'Dune')).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Dune', 'Hangar']);
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(300);
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Dune', 'Hangar']);

  // Rename Deux, then move it above Un from the keyboard.
  await sceneList(page).getByRole('button', { name: 'Renommer le chapitre Deux' }).click();
  await sceneList(page).getByLabel('Nouveau nom du chapitre').fill('Acte II');
  await page.keyboard.press('Enter');
  await expect(chapterToggle(page, 'Acte II')).toBeVisible();
  await chapterToggle(page, 'Acte II').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(sceneList(page).getByRole('group', { name: /^Chapitre / })).toHaveText([
    /^Acte II/,
    /^Un/,
  ]);
  await expect(chapterToggle(page, 'Acte II')).toBeFocused();

  // Deleting a Chapter keeps its Scenes, in no Chapter, and is not an undo step.
  await sceneList(page).getByRole('button', { name: 'Supprimer le chapitre Acte II' }).click();
  await expect(chapterToggle(page, 'Acte II')).toHaveCount(0);
  await expect(sceneEntry(page, 'Dune')).toBeVisible();
  await expect(sceneEntry(page, 'Hangar')).toBeVisible();
  await expect(
    editor(page)
      .getByRole('toolbar', { name: 'Historique de la scène' })
      .getByRole('button', { name: 'Rien à annuler' }),
  ).toBeDisabled();
});

test('dragging moves a Scene into a Chapter, out of it, and a Chapter above another', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  await createScene(page, 'Hangar');
  await createScene(page, 'Dune');
  await createChapter(page, 'Un');
  await createChapter(page, 'Deux');
  const row = (name: string) => sceneEntry(page, name).locator('xpath=..');
  const heading = (chapter: string) =>
    sceneList(page).getByRole('group', { name: `Chapitre ${chapter}` });

  // Onto a Chapter heading: last in that Chapter.
  await dropAndWait(row('Hangar'), heading('Deux'), chapterScenes(page, 'Deux').first());
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Hangar']);
  // Onto a Scene in a Chapter: its place, in that Chapter.
  await dropAndWait(
    row('Dune'),
    row('Hangar'),
    chapterScenes(page, 'Deux').first().and(sceneEntry(page, 'Dune')),
  );
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Dune', 'Hangar']);
  // Onto "Hors chapitre": last of the Scenes in no Chapter.
  await dropAndWait(
    row('Hangar'),
    sceneList(page).getByText('Hors chapitre'),
    sceneList(page).getByRole('button').last().and(sceneEntry(page, 'Hangar')),
  );
  await expect(chapterScenes(page, 'Deux')).toHaveText(['Dune']);
  // A Chapter dropped on another takes its place.
  await dropAndWait(
    heading('Deux'),
    heading('Un'),
    sceneList(page)
      .getByRole('group', { name: /^Chapitre / })
      .first()
      .and(heading('Deux')),
  );
  await expect(sceneList(page).getByRole('group', { name: /^Chapitre / })).toHaveText([
    /^Deux/,
    /^Un/,
  ]);
});
