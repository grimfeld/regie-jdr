import { describe, expect, it } from 'vitest';
import { applySceneEdit, parseSceneEdit, placementEdit } from '../../core/sceneEdits';
import type { SceneEdit } from '../../shared/contract';
import type { ImageCategory, ImageMedia, Scene } from '../../shared/domain';

const empty: Scene = {
  id: 's1',
  campaignId: 'c1',
  name: 'La cantina',
  title: '',
  backgrounds: [],
  overlays: [],
  music: [],
  ambiences: [],
  volumes: { music: 1, ambience: 1 },
  notes: '',
};

/** Applies edits in order, naming new placements p1, p2, ... */
function applyAll(scene: Scene, ...edits: SceneEdit[]): Scene {
  let next = 0;
  return edits.reduce((current, edit) => applySceneEdit(current, edit, () => `p${++next}`), scene);
}

describe('Scene edit commands', () => {
  it('place a Background on top of the stack, Hidden, covering the canvas, centred', () => {
    const scene = applyAll(
      empty,
      { kind: 'place-background', mediaId: 'm1' },
      { kind: 'place-background', mediaId: 'm2' },
    );
    expect(scene.backgrounds).toEqual([
      { id: 'p1', mediaId: 'm1', fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 }, visible: false },
      { id: 'p2', mediaId: 'm2', fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 }, visible: false },
    ]);
  });

  it('place an Overlay in front of the others, Hidden, half the canvas high', () => {
    const scene = applyAll(
      empty,
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'place-overlay', mediaId: 'm1', position: { x: 0.2, y: 0.7 } },
    );
    expect(scene.overlays).toEqual([
      { id: 'p1', mediaId: 'm1', position: { x: 0.5, y: 0.5 }, height: 0.5, visible: false },
      { id: 'p2', mediaId: 'm1', position: { x: 0.2, y: 0.7 }, height: 0.5, visible: false },
    ]);
  });

  it('show and hide one placement, leaving the others', () => {
    const scene = applyAll(
      empty,
      { kind: 'place-background', mediaId: 'm1' },
      { kind: 'place-overlay', mediaId: 'm2' },
      { kind: 'set-visible', placementId: 'p2', visible: true },
    );
    expect(scene.backgrounds.map((item) => item.visible)).toEqual([false]);
    expect(scene.overlays.map((item) => item.visible)).toEqual([true]);
    const shown = applyAll(scene, { kind: 'set-visible', placementId: 'p1', visible: true });
    expect(shown.backgrounds.map((item) => item.visible)).toEqual([true]);
  });

  it('leave the Scene they are given untouched', () => {
    const before = applyAll(empty, { kind: 'place-background', mediaId: 'm1' });
    const copy = structuredClone(before);
    applyAll(before, { kind: 'set-visible', placementId: 'p1', visible: true });
    expect(before).toEqual(copy);
  });

  it('rename the Scene, trimming the name and leaving its composition', () => {
    const placed = applyAll(empty, { kind: 'place-background', mediaId: 'm1' });
    const renamed = applyAll(placed, { kind: 'rename', name: '  Le hangar ' });
    expect(renamed).toEqual({ ...placed, name: 'Le hangar' });
  });

  it('refuse an empty or too long Scene name, in French', () => {
    expect(() => applyAll(empty, { kind: 'rename', name: '   ' })).toThrow(
      'Donnez un nom à la scène.',
    );
    expect(() => applyAll(empty, { kind: 'rename', name: 'x'.repeat(101) })).toThrow(
      'Le nom de la scène est trop long (100 caractères au plus).',
    );
  });

  it('refuse to show a placement that is not on the Scene, in French', () => {
    expect(() =>
      applyAll(empty, { kind: 'set-visible', placementId: 'absent', visible: true }),
    ).toThrow('Cet élément n’est plus sur la scène.');
  });

  it('remove one Background or Overlay, leaving the others in order', () => {
    const scene = applyAll(
      empty,
      { kind: 'place-background', mediaId: 'm1' },
      { kind: 'place-background', mediaId: 'm2' },
      { kind: 'place-overlay', mediaId: 'm3' },
      { kind: 'place-overlay', mediaId: 'm3' },
    );
    const withoutBackground = applyAll(scene, { kind: 'remove-placement', placementId: 'p1' });
    expect(withoutBackground.backgrounds.map((item) => item.id)).toEqual(['p2']);
    expect(withoutBackground.overlays.map((item) => item.id)).toEqual(['p3', 'p4']);
    const withoutOverlay = applyAll(scene, { kind: 'remove-placement', placementId: 'p3' });
    expect(withoutOverlay.backgrounds.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(withoutOverlay.overlays.map((item) => item.id)).toEqual(['p4']);
  });

  it('refuse to remove a placement that is not on the Scene, in French', () => {
    expect(() => applyAll(empty, { kind: 'remove-placement', placementId: 'absent' })).toThrow(
      'Cet élément n’est plus sur la scène.',
    );
  });
});

function image(category: ImageCategory): ImageMedia {
  return {
    id: `m-${category}`,
    campaignId: 'c1',
    kind: 'image',
    category,
    contentHash: 'abc',
    originalName: category,
    name: category,
    extension: '.png',
  };
}

describe('Placing a dropped image', () => {
  it('on the canvas, places Scenery as a Background', () => {
    expect(placementEdit(image('scenery'), 'canvas', { x: 0.2, y: 0.3 })).toEqual({
      kind: 'place-background',
      mediaId: 'm-scenery',
    });
  });

  it('on the canvas, places a Character as an Overlay centred on the drop point', () => {
    expect(placementEdit(image('character'), 'canvas', { x: 0.2, y: 0.3 })).toEqual({
      kind: 'place-overlay',
      mediaId: 'm-character',
      position: { x: 0.2, y: 0.3 },
    });
  });

  it('on the canvas, keeps a drop point on the black bars inside the canvas', () => {
    expect(placementEdit(image('character'), 'canvas', { x: -0.4, y: 1.3 })).toEqual({
      kind: 'place-overlay',
      mediaId: 'm-character',
      position: { x: 0, y: 1 },
    });
  });

  it('on the Background list, places any image as a Background', () => {
    expect(placementEdit(image('character'), 'backgrounds')).toEqual({
      kind: 'place-background',
      mediaId: 'm-character',
    });
  });

  it('on the Overlay list, places any image as an Overlay at the canvas centre', () => {
    expect(placementEdit(image('scenery'), 'overlays')).toEqual({
      kind: 'place-overlay',
      mediaId: 'm-scenery',
    });
  });

  it('gives new placements their default sizes: Background Cover centred, Overlay half high', () => {
    const scene = applyAll(
      empty,
      placementEdit(image('scenery'), 'canvas', { x: 0.1, y: 0.1 }),
      placementEdit(image('character'), 'canvas', { x: 0.1, y: 0.9 }),
    );
    expect(scene.backgrounds).toEqual([
      expect.objectContaining({ fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 }, visible: false }),
    ]);
    expect(scene.overlays).toEqual([
      expect.objectContaining({ position: { x: 0.1, y: 0.9 }, height: 0.5, visible: false }),
    ]);
  });
});

describe('Scene edit commands from a window message', () => {
  it.each([
    [
      { kind: 'place-background', mediaId: 'm1', extra: 1 },
      { kind: 'place-background', mediaId: 'm1' },
    ],
    [
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'place-overlay', mediaId: 'm1' },
    ],
    [
      { kind: 'place-overlay', mediaId: 'm1', position: { x: 0, y: 1, z: 2 } },
      { kind: 'place-overlay', mediaId: 'm1', position: { x: 0, y: 1 } },
    ],
    [
      { kind: 'set-visible', placementId: 'p1', visible: false },
      { kind: 'set-visible', placementId: 'p1', visible: false },
    ],
    [
      { kind: 'remove-placement', placementId: 'p1', mediaId: 'm1' },
      { kind: 'remove-placement', placementId: 'p1' },
    ],
    [
      { kind: 'rename', name: 'Le hangar', id: 's2' },
      { kind: 'rename', name: 'Le hangar' },
    ],
  ])('accept %o, keeping only its fields', (value, expected) => {
    expect(parseSceneEdit(value)).toEqual(expected);
  });

  it.each([
    ['an unknown kind', { kind: 'delete-everything' }],
    ['no Media', { kind: 'place-background' }],
    [
      'a position off the canvas',
      { kind: 'place-overlay', mediaId: 'm1', position: { x: 2, y: 0 } },
    ],
    ['a visibility that is not a boolean', { kind: 'set-visible', placementId: 'p1', visible: 1 }],
    ['a removal naming no placement', { kind: 'remove-placement', placementId: '' }],
    ['a name that is not a string', { kind: 'rename', name: 42 }],
    ['a name far too long for a message', { kind: 'rename', name: 'x'.repeat(1001) }],
    ['not an object', 'place-background'],
  ])('reject %s', (_case, value) => {
    expect(parseSceneEdit(value)).toBeUndefined();
  });
});
