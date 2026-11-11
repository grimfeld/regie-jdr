import type { Locator, Page } from '@playwright/test';
import type { ControlBridge, SceneEdit } from '../../shared/contract';
import type { Media, Scene } from '../../shared/domain';
import {
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  picturePng,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

/** A square image (not 16:9, so Cover crops it and Contain leaves bars), in blue. */
const SQUARE = { width: 90, height: 90 };
const BLUE = { red: 0, green: 0, blue: 220 };

/** Calls the Control window's bridge, as its interface does. */
function bridgeOf(controlWindow: Page) {
  return <T>(method: keyof ControlBridge, ...args: unknown[]) =>
    controlWindow.evaluate(
      ([name, params]) => {
        const bridge = (
          window as unknown as { regie: Record<string, (...a: unknown[]) => unknown> }
        ).regie;
        return bridge[name](...params) as Promise<T>;
      },
      [method, args] as const,
    );
}

/**
 * The only Campaign, "Star Wars", with a Scene "Cantina" holding two visible Backgrounds: the
 * 16:9 red fixture at the bottom, the square "Carre" on top. The Control window is reloaded,
 * so it opens the Campaign with Cantina as the Selected Scene; nothing is on air.
 */
async function cantina(running: RunningApp) {
  const { app, controlWindow } = running;
  const call = bridgeOf(controlWindow);
  const campaign = await call<{ id: string }>('createCampaign', 'Star Wars');
  await call('openCampaign', campaign.id);
  await stubFilePicker(app, [
    fixture('red-16x9.png'),
    await picturePng(running, 'Carre.png', SQUARE, BLUE),
  ]);
  const { imported } = await call<{ imported: Media[] }>('importMedia', campaign.id, {
    accept: 'image',
  });
  let scene = await call<Scene>('createScene', campaign.id, 'Cantina');
  const edit = async (command: SceneEdit) => {
    scene = await call<Scene>('editScene', campaign.id, scene.id, command);
  };
  for (const media of imported) await edit({ kind: 'place-background', mediaId: media.id });
  for (const { id } of scene.backgrounds) {
    await edit({ kind: 'set-visible', placementId: id, visible: true });
  }
  await controlWindow.reload();
  await controlWindow.getByRole('heading', { name: 'Star Wars', exact: true }).waitFor();
  await expect(editor(controlWindow).getByRole('heading', { name: 'Cantina' })).toBeVisible();
  const [red, square] = scene.backgrounds.map((item) => item.id);
  return { red, square };
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function backgroundList(page: Page) {
  return editor(page).getByRole('list', { name: 'Arrière-plans' });
}

/** The three views: the editor, the On-air monitor, the Broadcast window. */
function views(controlWindow: Page, broadcastWindow: Page): Locator[] {
  return [
    editor(controlWindow).locator('.editor-canvas'),
    controlWindow.getByRole('region', { name: 'À l’antenne' }),
    broadcastWindow.locator('main.broadcast-screen'),
  ];
}

/** A Background's box in a view, as fractions of its canvas, rounded to two places. */
function backgroundBox(view: Locator, placementId: string) {
  return view.locator('.scene-canvas-stage').evaluate((stage, id) => {
    const canvas = stage.getBoundingClientRect();
    const item = stage.querySelector(`[data-background-id="${id}"]`);
    if (!item || getComputedStyle(item).visibility === 'hidden') return null;
    const box = item.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      x: round((box.x - canvas.x) / canvas.width),
      y: round((box.y - canvas.y) / canvas.height),
      width: round(box.width / canvas.width),
      height: round(box.height / canvas.height),
    };
  }, placementId);
}

/** Background ids in a view, bottom of the stack first (drawing order). */
function stackOrder(view: Locator) {
  return view
    .locator('.canvas-background')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-background-id')));
}

async function activate(running: RunningApp) {
  const { app, controlWindow } = running;
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  return openBroadcastWindow(app, controlWindow);
}

test('on the Active Scene, Contain, zoom and pan reach the On-air monitor and the Broadcast window, as in the editor', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { square } = await cantina(regie);
  const broadcastWindow = await activate(regie);
  const all = views(controlWindow, broadcastWindow);

  // Cover: the square image fills the canvas width, cropped above and below.
  const covered = { x: 0, y: -0.39, width: 1, height: 1.78 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(covered);

  // Contain: the whole image, centred, bars left and right.
  const fit = backgroundList(controlWindow).getByLabel('Ajustement de Carre');
  await fit.selectOption({ label: 'Contenir' });
  const contained = { x: 0.22, y: 0, width: 0.56, height: 1 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(contained);
  await expect(backgroundList(controlWindow).getByLabel('Zoom de Carre')).toHaveCount(0);

  // Back to Cover; zoom to the largest, then pan to the top-left corner.
  await fit.selectOption({ label: 'Couvrir' });
  await backgroundList(controlWindow).getByLabel('Zoom de Carre').press('End');
  const zoomed = { x: -1.5, y: -3.06, width: 4, height: 7.11 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(zoomed);
  await backgroundList(controlWindow).getByLabel('Horizontal de Carre').press('Home');
  await backgroundList(controlWindow).getByLabel('Vertical de Carre').press('Home');
  const topLeft = { x: 0, y: 0, width: 4, height: 7.11 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(topLeft);
});

test('on the Active Scene, a framing slider shows its framing in all three views during the drag, and saves it once on release', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { square } = await cantina(regie);
  const broadcastWindow = await activate(regie);
  const all = views(controlWindow, broadcastWindow);
  const covered = { x: 0, y: -0.39, width: 1, height: 1.78 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(covered);
  const savedZoom = async () => {
    const call = bridgeOf(controlWindow);
    const [campaign] = await call<{ id: string }[]>('listCampaigns');
    const [scene] = await call<Scene[]>('listScenes', campaign.id);
    return scene.backgrounds.find((item) => item.id === square)?.zoom;
  };

  // Press the zoom slider's thumb (at its left end, zoom 1) and drag it to the right end.
  const slider = backgroundList(controlWindow).getByLabel('Zoom de Carre');
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error('The zoom slider is not shown.');
  const middle = box.y + box.height / 2;
  await controlWindow.mouse.move(box.x + 4, middle);
  await controlWindow.mouse.down();
  await controlWindow.mouse.move(box.x + box.width + 20, middle, { steps: 10 });

  // Still held: shown everywhere, saved nowhere.
  const zoomed = { x: -1.5, y: -3.06, width: 4, height: 7.11 };
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(zoomed);
  expect(await savedZoom()).toBe(1);

  await controlWindow.mouse.up();
  await expect.poll(savedZoom).toBe(4);
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(zoomed);

  // The whole drag is one undo step.
  await controlWindow.keyboard.press('Control+z');
  await expect.poll(savedZoom).toBe(1);
  for (const view of all) await expect.poll(() => backgroundBox(view, square)).toEqual(covered);
});

test('reordering Backgrounds changes which covers which in all three views; the list shows the top first', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { red, square } = await cantina(regie);
  const broadcastWindow = await activate(regie);
  const all = views(controlWindow, broadcastWindow);
  const list = backgroundList(controlWindow);

  for (const view of all) await expect.poll(() => stackOrder(view)).toEqual([red, square]);
  await expect(list.getByRole('listitem').first()).toContainText('Carre');
  await expect(list.getByRole('button', { name: 'Monter Carre' })).toBeDisabled();
  await expect(list.getByRole('button', { name: 'Descendre red-16x9' })).toBeDisabled();

  await list.getByRole('button', { name: 'Monter red-16x9' }).click();
  for (const view of all) await expect.poll(() => stackOrder(view)).toEqual([square, red]);
  await expect(list.getByRole('listitem').first()).toContainText('red-16x9');

  await list.getByRole('button', { name: 'Monter Carre' }).click();
  for (const view of all) await expect.poll(() => stackOrder(view)).toEqual([red, square]);
});

test('stack order, fit, zoom and pan survive a restart', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  const { red, square } = await cantina(regie);
  const list = backgroundList(controlWindow);
  await list.getByRole('button', { name: 'Monter red-16x9' }).click();
  await list.getByLabel('Zoom de Carre').press('End');
  const canvas = editor(controlWindow).locator('.editor-canvas');
  // The zoom is saved and drawn before panning.
  await expect.poll(() => backgroundBox(canvas, square)).toMatchObject({ width: 4 });
  await list.getByLabel('Horizontal de Carre').press('Home');
  await expect(list.getByLabel('Horizontal de Carre')).toHaveValue('0');
  await list.getByLabel('Ajustement de red-16x9').selectOption({ label: 'Contenir' });
  await expect(list.getByLabel('Ajustement de red-16x9')).toHaveValue('contain');
  await expect.poll(() => backgroundBox(canvas, square)).toMatchObject({ x: 0 });
  const before = await backgroundBox(canvas, square);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    const after = backgroundList(page);
    await expect(editor(page).getByRole('heading', { name: 'Cantina' })).toBeVisible();
    await expect(after.getByRole('listitem').first()).toContainText('red-16x9');
    await expect(after.getByLabel('Ajustement de red-16x9')).toHaveValue('contain');
    await expect(after.getByLabel('Ajustement de Carre')).toHaveValue('cover');
    await expect(after.getByLabel('Zoom de Carre')).toHaveValue('4');
    await expect(after.getByLabel('Horizontal de Carre')).toHaveValue('0');
    const restartedCanvas = editor(page).locator('.editor-canvas');
    await expect.poll(() => stackOrder(restartedCanvas)).toEqual([square, red]);
    await expect.poll(() => backgroundBox(restartedCanvas, square)).toEqual(before);
  } finally {
    await restarted.app.close();
  }
});

test('after a framing slider is dragged, released and undone, the slider shows the restored value', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await cantina(regie);
  const slider = backgroundList(controlWindow).getByLabel('Zoom de Carre');
  await expect(slider).toHaveValue('1');

  // Drag the zoom thumb from its left end (zoom 1) to the right end, then release: saved at 4.
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error('The zoom slider is not shown.');
  const middle = box.y + box.height / 2;
  await controlWindow.mouse.move(box.x + 4, middle);
  await controlWindow.mouse.down();
  await controlWindow.mouse.move(box.x + box.width + 20, middle, { steps: 10 });
  await controlWindow.mouse.up();
  await expect(slider).toHaveValue('4');

  // Undo brings the saved zoom back to 1, and the slider follows it.
  await controlWindow.keyboard.press('Control+z');
  await expect(slider).toHaveValue('1');
});
