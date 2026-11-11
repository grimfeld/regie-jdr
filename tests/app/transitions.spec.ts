import type { Locator, Page } from '@playwright/test';
import type { ControlBridge, SceneEdit } from '../../shared/contract';
import type { Media, OnAirState, Scene } from '../../shared/domain';
import {
  expect,
  fixture,
  openBroadcastWindow,
  picturePng,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

/** A large image, so decoding it takes a while: the dissolve must wait for it. */
const LARGE = { width: 4000, height: 2250 };
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
 * The Campaign "Star Wars", open, with two Scenes, each showing one Background: "Cantina" the
 * red fixture, "Hangar" a large blue image and the Scene title "Le hangar". Nothing is on air;
 * the Broadcast window is open.
 */
async function twoScenes(running: RunningApp) {
  const { app, controlWindow } = running;
  const call = bridgeOf(controlWindow);
  const campaign = await call<{ id: string }>('createCampaign', 'Star Wars');
  await call('openCampaign', campaign.id);
  await stubFilePicker(app, [
    fixture('red-16x9.png'),
    await picturePng(running, 'Hangar.png', LARGE, BLUE),
  ]);
  const { imported } = await call<{ imported: Media[] }>('importMedia', campaign.id, {
    accept: 'image',
  });
  async function scene(name: string, media: Media | undefined, title: string) {
    if (!media) throw new Error('An image was not imported');
    let created = await call<Scene>('createScene', campaign.id, name);
    const edit = async (command: SceneEdit) => {
      created = await call<Scene>('editScene', campaign.id, created.id, command);
    };
    await edit({ kind: 'place-background', mediaId: media.id });
    const placed = created.backgrounds[0]?.id ?? '';
    await edit({ kind: 'set-visible', placementId: placed, visible: true });
    if (title) await edit({ kind: 'set-title', title });
    return { id: created.id, background: placed };
  }
  const cantina = await scene('Cantina', imported[0], '');
  const hangar = await scene('Hangar', imported[1], 'Le hangar');
  // The Control window shows the Campaign it opened, with its On-air monitor.
  await controlWindow.reload();
  await controlWindow.getByRole('heading', { name: 'Star Wars', exact: true }).waitFor();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  return {
    cantina,
    hangar,
    broadcastWindow,
    activate: (sceneId: string) => call<OnAirState>('activateScene', sceneId),
    setBlackout: (on: boolean) => call<OnAirState>('setBlackout', on),
  };
}

/** The renderers on air: the On-air monitor and the Broadcast window. */
function onAirViews(controlWindow: Page, broadcastWindow: Page): Locator[] {
  return [
    controlWindow.getByRole('region', { name: 'À l’antenne' }),
    broadcastWindow.locator('main.broadcast-screen'),
  ];
}

/** Each picture layer a view draws, bottom first: its Transition phase and its Backgrounds. */
function layers(view: Locator) {
  return view.locator('.canvas-layer').evaluateAll((items) =>
    items.map((layer) => ({
      phase: layer.getAttribute('data-transition'),
      backgrounds: [...layer.querySelectorAll('[data-background-id]')].map((item) =>
        item.getAttribute('data-background-id'),
      ),
    })),
  );
}

/**
 * Records, in the Broadcast window, every moment a picture layer starts dissolving while one of
 * its images is not fully loaded and decoded: a half-drawn or empty frame.
 */
async function recordHalfDrawnFrames(broadcastWindow: Page) {
  await broadcastWindow.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { halfDrawn: string[] }).halfDrawn = seen;
    new MutationObserver(() => {
      for (const layer of document.querySelectorAll(
        '.canvas-layer[data-transition="dissolving"]',
      )) {
        for (const image of layer.querySelectorAll('img')) {
          const drawn = image.complete && image.naturalWidth > 0 && !image.hidden;
          if (!drawn) seen.push(image.getAttribute('src') ?? '');
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  return () =>
    broadcastWindow.evaluate(() => (window as unknown as { halfDrawn: string[] }).halfDrawn);
}

test('Activating crossfades the Broadcast window and the On-air monitor to the incoming Scene', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { cantina, hangar, broadcastWindow, activate } = await twoScenes(regie);
  const views = onAirViews(controlWindow, broadcastWindow);
  const halfDrawn = await recordHalfDrawnFrames(broadcastWindow);

  // Nothing on air: Cantina fades in from black, then is drawn alone.
  await activate(cantina.id);
  for (const view of views) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);
  }

  // Cantina dissolves into Hangar: both drawn, Hangar on top, then Hangar alone with its title.
  await activate(hangar.id);
  await expect
    .poll(() => layers(views[1]), { intervals: [50] })
    .toEqual([
      { phase: 'shown', backgrounds: [cantina.background] },
      { phase: 'dissolving', backgrounds: [hangar.background] },
    ]);
  for (const view of views) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [hangar.background] }]);
    await expect(view.locator('.canvas-title')).toHaveText('Le hangar');
  }
  expect(await halfDrawn()).toEqual([]);
});

test('Activating again mid-Transition ends on the newest Scene', async ({ regie }) => {
  const { controlWindow } = regie;
  const { cantina, hangar, broadcastWindow, activate } = await twoScenes(regie);
  await activate(cantina.id);

  await activate(hangar.id);
  await activate(cantina.id);

  for (const view of onAirViews(controlWindow, broadcastWindow)) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);
  }
});

test('Activating during Blackout keeps the broadcast black while the Transition runs underneath', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { cantina, hangar, broadcastWindow, activate, setBlackout } = await twoScenes(regie);
  await activate(cantina.id);
  await setBlackout(true);

  expect(await activate(hangar.id)).toMatchObject({ activeSceneId: hangar.id, blackout: true });

  for (const view of onAirViews(controlWindow, broadcastWindow)) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [hangar.background] }]);
    await expect(view.locator('.canvas-blackout')).toHaveAttribute('data-fade', 'shown');
  }
  await expect(controlWindow.getByRole('button', { name: 'Noir' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

/** The editor of the Selected Scene, opened on Scene `name` from the Scene list. */
async function openScene(controlWindow: Page, name: string) {
  await controlWindow
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true })
    .click();
  const editor = controlWindow.getByRole('region', { name: 'Scène ouverte' });
  await expect(editor.getByRole('heading', { name, exact: true })).toBeVisible();
  return editor;
}

/**
 * Records, in the Broadcast window, each picture layer drawn dissolving over some time (what a
 * Cut must never show), once, as "<its Backgrounds> over <duration>". Returns the reader.
 */
async function recordDissolves(broadcastWindow: Page) {
  await broadcastWindow.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { dissolves: string[] }).dissolves = seen;
    new MutationObserver(() => {
      for (const layer of document.querySelectorAll<HTMLElement>(
        '.canvas-layer[data-transition="dissolving"]',
      )) {
        const duration = layer.style.getPropertyValue('--transition-duration');
        const backgrounds = [...layer.querySelectorAll('[data-background-id]')]
          .map((item) => item.getAttribute('data-background-id'))
          .join(' ');
        const entry = `${backgrounds} over ${duration}`;
        if (duration !== '0ms' && !seen.includes(entry)) seen.push(entry);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  return () =>
    broadcastWindow.evaluate(() => (window as unknown as { dissolves: string[] }).dissolves);
}

test('A Scene set to Cut replaces the broadcast picture at once, and keeps its Transition', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { cantina, hangar, broadcastWindow, activate } = await twoScenes(regie);
  const views = onAirViews(controlWindow, broadcastWindow);
  await activate(cantina.id);
  for (const view of views) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);
  }

  // The Game Master sets Hangar's Transition to Cut, then Activates it.
  let editor = await openScene(controlWindow, 'Hangar');
  await editor.getByRole('combobox', { name: 'Transition' }).selectOption({ label: 'Cut' });
  await expect(
    editor.getByRole('button', { name: 'Annuler : régler la transition sur Cut' }),
  ).toBeVisible();
  const dissolves = await recordDissolves(broadcastWindow);
  await editor.getByRole('button', { name: 'Activer', exact: true }).click();

  for (const view of views) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [hangar.background] }]);
    await expect(view.locator('.canvas-title')).toHaveText('Le hangar');
  }
  expect(await dissolves()).toEqual([]);

  // Saved with the Scene.
  await controlWindow.reload();
  editor = await openScene(controlWindow, 'Hangar');
  await expect(editor.getByRole('combobox', { name: 'Transition' })).toHaveValue('cut');
});

test('Shift+click on Activate forces a Cut once and leaves the Scene’s Crossfade as it is', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  const { cantina, hangar, broadcastWindow, activate } = await twoScenes(regie);
  await activate(cantina.id);
  await expect
    .poll(() => layers(broadcastWindow.locator('main.broadcast-screen')))
    .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);

  const editor = await openScene(controlWindow, 'Hangar');
  const transition = editor.getByRole('combobox', { name: 'Transition' });
  await expect(transition).toHaveValue('crossfade');
  const dissolves = await recordDissolves(broadcastWindow);
  await editor
    .getByRole('button', { name: 'Activer', exact: true })
    .click({ modifiers: ['Shift'] });

  for (const view of onAirViews(controlWindow, broadcastWindow)) {
    await expect
      .poll(() => layers(view))
      .toEqual([{ phase: 'shown', backgrounds: [hangar.background] }]);
  }
  expect(await dissolves()).toEqual([]);
  await expect(transition).toHaveValue('crossfade');

  // Activated again without Shift, Hangar crossfades as prepared.
  await activate(cantina.id);
  await editor.getByRole('button', { name: 'Activer', exact: true }).click();
  await expect.poll(dissolves).toContain(`${hangar.background} over 1500ms`);
});

test('a Broadcast window reloaded mid-session shows what is on air at once, with no Transition replayed', async ({
  regie,
}) => {
  const { cantina, broadcastWindow, activate } = await twoScenes(regie);
  await activate(cantina.id);
  const broadcast = onAirViews(regie.controlWindow, broadcastWindow)[1];
  await expect
    .poll(() => layers(broadcast))
    .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);

  // Every Transition phase the reloaded window ever draws, from its first frame.
  await broadcastWindow.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { phases: string[] }).phases = seen;
    new MutationObserver(() => {
      for (const layer of document.querySelectorAll('.canvas-layer')) {
        seen.push(layer.getAttribute('data-transition') ?? '');
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await broadcastWindow.reload();

  await expect
    .poll(() => layers(broadcast))
    .toEqual([{ phase: 'shown', backgrounds: [cantina.background] }]);
  const phases = await broadcastWindow.evaluate(
    () => (window as unknown as { phases: string[] }).phases,
  );
  expect(new Set(phases)).toEqual(new Set(['shown']));
});
