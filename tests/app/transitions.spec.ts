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
