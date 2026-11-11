import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from '../../core/canvas';
import {
  applySceneEdit,
  MAX_OVERLAY_HEIGHT,
  MIN_OVERLAY_HEIGHT,
  nudgedPosition,
  parseSceneEdit,
  parseTransientEdit,
  placementEdit,
  resizedOverlay,
} from '../../core/sceneEdits';
import type { SceneEdit } from '../../shared/contract';
import type { ImageCategory, ImageMedia, Scene } from '../../shared/domain';
import { emptyNotes, notesFromPlainText } from '../../core/notes';

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
  notes: emptyNotes(),
  transition: 'crossfade',
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

  it('give an Overlay a Label that starts Hidden, its text trimmed', () => {
    const scene = applyAll(
      empty,
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'set-label-text', overlayId: 'p2', text: '  Garde du moulin ' },
    );
    expect(scene.overlays.map((item) => item.label)).toEqual([
      undefined,
      { text: 'Garde du moulin', visible: false },
    ]);
  });

  it('show and hide a Label independently of its Overlay, keeping it when its text changes', () => {
    const labelled = applyAll(
      empty,
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'set-label-text', overlayId: 'p1', text: 'Garde' },
      { kind: 'set-label-visible', overlayId: 'p1', visible: true },
    );
    expect(labelled.overlays[0]).toMatchObject({
      visible: false,
      label: { text: 'Garde', visible: true },
    });
    const renamed = applyAll(labelled, { kind: 'set-label-text', overlayId: 'p1', text: 'Vador' });
    expect(renamed.overlays[0].label).toEqual({ text: 'Vador', visible: true });
    const hidden = applyAll(renamed, {
      kind: 'set-label-visible',
      overlayId: 'p1',
      visible: false,
    });
    expect(hidden.overlays[0].label).toEqual({ text: 'Vador', visible: false });
  });

  it('remove a Label whose text is cleared, so a new one starts Hidden again', () => {
    const shown = applyAll(
      empty,
      { kind: 'place-overlay', mediaId: 'm1' },
      { kind: 'set-label-text', overlayId: 'p1', text: 'Garde' },
      { kind: 'set-label-visible', overlayId: 'p1', visible: true },
      { kind: 'set-label-text', overlayId: 'p1', text: '   ' },
    );
    expect(shown.overlays[0]).not.toHaveProperty('label');
    const again = applyAll(shown, { kind: 'set-label-text', overlayId: 'p1', text: 'Vador' });
    expect(again.overlays[0].label).toEqual({ text: 'Vador', visible: false });
  });

  it('refuse a Label on a placement that is not an Overlay of the Scene, in French', () => {
    const scene = applyAll(empty, { kind: 'place-background', mediaId: 'm1' });
    expect(() => applyAll(scene, { kind: 'set-label-text', overlayId: 'p1', text: 'x' })).toThrow(
      'Cet élément n’est plus sur la scène.',
    );
    expect(() =>
      applyAll(scene, { kind: 'set-label-visible', overlayId: 'absent', visible: true }),
    ).toThrow('Cet élément n’est plus sur la scène.');
  });

  it('refuse to show a Label that has no text, or a too long Label, in French', () => {
    const scene = applyAll(empty, { kind: 'place-overlay', mediaId: 'm1' });
    expect(() =>
      applyAll(scene, { kind: 'set-label-visible', overlayId: 'p1', visible: true }),
    ).toThrow('Donnez d’abord un texte à l’étiquette.');
    expect(() =>
      applyAll(scene, { kind: 'set-label-text', overlayId: 'p1', text: 'x'.repeat(61) }),
    ).toThrow('L’étiquette est trop longue (60 caractères au plus).');
  });

  it('set the Scene title, trimmed, apart from the Scene name; clear it with empty text', () => {
    const titled = applyAll(empty, { kind: 'set-title', title: '  Le vieux moulin ' });
    expect(titled).toEqual({ ...empty, title: 'Le vieux moulin' });
    expect(applyAll(titled, { kind: 'set-title', title: ' ' })).toEqual(empty);
  });

  it('refuse a too long Scene title, in French', () => {
    expect(() => applyAll(empty, { kind: 'set-title', title: 'x'.repeat(101) })).toThrow(
      'Le titre affiché est trop long (100 caractères au plus).',
    );
  });
});

describe('Scene Transition', () => {
  it('sets the entry Transition to Cut and back to Crossfade, leaving the rest of the Scene', () => {
    const cut = applyAll(empty, { kind: 'set-transition', transition: 'cut' });
    expect(cut).toEqual({ ...empty, transition: 'cut' });
    expect(applyAll(cut, { kind: 'set-transition', transition: 'crossfade' })).toEqual(empty);
  });

  it('reads a Transition edit from a window message, keeping only its fields', () => {
    expect(parseSceneEdit({ kind: 'set-transition', transition: 'cut', x: 1 })).toEqual({
      kind: 'set-transition',
      transition: 'cut',
    });
    expect(parseSceneEdit({ kind: 'set-transition', transition: 'wipe' })).toBeUndefined();
    expect(parseSceneEdit({ kind: 'set-transition' })).toBeUndefined();
    expect(parseTransientEdit({ kind: 'set-transition', transition: 'cut' })).toBeUndefined();
  });
});

describe('Scene Notes', () => {
  const notes = notesFromPlainText('Le traître\nest le capitaine');

  it('replaces the Notes, leaving the rest of the Scene', () => {
    expect(applyAll(empty, { kind: 'set-notes', notes })).toEqual({ ...empty, notes });
  });

  it('reads Notes from a window message, keeping only allowed content', () => {
    expect(parseSceneEdit({ kind: 'set-notes', notes, x: 1 })).toEqual({
      kind: 'set-notes',
      notes,
    });
    expect(parseSceneEdit({ kind: 'set-notes', notes: 'texte' })).toBeUndefined();
    expect(parseSceneEdit({ kind: 'set-notes' })).toBeUndefined();
    expect(
      parseSceneEdit({
        kind: 'set-notes',
        notes: { type: 'doc', content: [{ type: 'table', content: [] }] },
      }),
    ).toBeUndefined();
  });

  it('is never a transient update', () => {
    expect(parseTransientEdit({ kind: 'set-notes', notes })).toBeUndefined();
  });
});

describe('Scene Music list', () => {
  it('adds Music at the end of the list, each Media once', () => {
    const listed = applyAll(
      empty,
      { kind: 'add-music', mediaId: 'm1' },
      { kind: 'add-music', mediaId: 'm2' },
    );
    expect(listed.music).toEqual(['m1', 'm2']);
    expect(() => applyAll(listed, { kind: 'add-music', mediaId: 'm1' })).toThrow(
      'Cette musique est déjà dans la scène.',
    );
  });

  it('refuses a malformed add-music message', () => {
    expect(parseSceneEdit({ kind: 'add-music', mediaId: '' })).toBeUndefined();
    expect(parseSceneEdit({ kind: 'add-music' })).toBeUndefined();
  });

  const three = { ...empty, music: ['m1', 'm2', 'm3'] };

  it('moves a Music to another place in the list, a move past the end going last', () => {
    expect(applyAll(three, { kind: 'move-music', mediaId: 'm3', toIndex: 0 }).music).toEqual([
      'm3',
      'm1',
      'm2',
    ]);
    expect(applyAll(three, { kind: 'move-music', mediaId: 'm1', toIndex: 1 }).music).toEqual([
      'm2',
      'm1',
      'm3',
    ]);
    expect(applyAll(three, { kind: 'move-music', mediaId: 'm1', toIndex: 9 }).music).toEqual([
      'm2',
      'm3',
      'm1',
    ]);
  });

  it('removes a Music, leaving the others in order', () => {
    expect(applyAll(three, { kind: 'remove-music', mediaId: 'm2' }).music).toEqual(['m1', 'm3']);
  });

  it('refuses to move or remove a Music that is not listed, in French', () => {
    for (const edit of [
      { kind: 'move-music', mediaId: 'm9', toIndex: 0 },
      { kind: 'remove-music', mediaId: 'm9' },
    ] as const) {
      expect(() => applyAll(three, edit)).toThrow('Cette musique n’est plus dans la scène.');
    }
  });

  it('sets the Scene Music level, leaving the Ambience level', () => {
    const quiet = applyAll(
      { ...empty, volumes: { music: 1, ambience: 0.7 } },
      { kind: 'set-music-level', level: 0.25 },
    );
    expect(quiet.volumes).toEqual({ music: 0.25, ambience: 0.7 });
  });

  it.each([
    ['a move to no place', { kind: 'move-music', mediaId: 'm1', toIndex: -1 }],
    ['a move to half a place', { kind: 'move-music', mediaId: 'm1', toIndex: 0.5 }],
    ['a move of no Music', { kind: 'move-music', toIndex: 0 }],
    ['a removal of no Music', { kind: 'remove-music', mediaId: '' }],
    ['a level above 1', { kind: 'set-music-level', level: 1.5 }],
    ['a level below 0', { kind: 'set-music-level', level: -0.1 }],
    ['a level as text', { kind: 'set-music-level', level: '0.5' }],
    ['no level', { kind: 'set-music-level', level: NaN }],
  ])('refuses %s', (_case, value) => {
    expect(parseSceneEdit(value)).toBeUndefined();
  });

  it('keeps only the fields of Music edits from a window message', () => {
    expect(parseSceneEdit({ kind: 'move-music', mediaId: 'm1', toIndex: 2, x: 1 })).toEqual({
      kind: 'move-music',
      mediaId: 'm1',
      toIndex: 2,
    });
    expect(parseSceneEdit({ kind: 'remove-music', mediaId: 'm1', toIndex: 2 })).toEqual({
      kind: 'remove-music',
      mediaId: 'm1',
    });
    expect(parseSceneEdit({ kind: 'set-music-level', level: 0, mediaId: 'm1' })).toEqual({
      kind: 'set-music-level',
      level: 0,
    });
  });
});

describe('Scene Ambiences', () => {
  const listed = applyAll(
    empty,
    { kind: 'add-ambience', mediaId: 'a1' },
    { kind: 'add-ambience', mediaId: 'a2' },
  );

  it('adds Ambiences at the end of the list, switched off at full volume, each Media once', () => {
    expect(listed.ambiences).toEqual([
      { mediaId: 'a1', on: false, volume: 1 },
      { mediaId: 'a2', on: false, volume: 1 },
    ]);
    expect(() => applyAll(listed, { kind: 'add-ambience', mediaId: 'a1' })).toThrow(
      'Cette ambiance est déjà dans la scène.',
    );
  });

  it('switches one Ambience on or off and sets its volume, leaving the others as they are', () => {
    const changed = applyAll(
      listed,
      { kind: 'set-ambience-on', mediaId: 'a2', on: true },
      { kind: 'set-ambience-volume', mediaId: 'a2', volume: 0.25 },
    );
    expect(changed.ambiences).toEqual([
      { mediaId: 'a1', on: false, volume: 1 },
      { mediaId: 'a2', on: true, volume: 0.25 },
    ]);
    expect(
      applyAll(changed, { kind: 'set-ambience-on', mediaId: 'a2', on: false }).ambiences[1],
    ).toEqual({ mediaId: 'a2', on: false, volume: 0.25 });
  });

  it('removes an Ambience', () => {
    expect(applyAll(listed, { kind: 'remove-ambience', mediaId: 'a1' }).ambiences).toEqual([
      { mediaId: 'a2', on: false, volume: 1 },
    ]);
  });

  it('sets the Scene Ambience level, leaving the Music level as it is', () => {
    const scene = { ...listed, volumes: { music: 0.7, ambience: 1 } };
    expect(applyAll(scene, { kind: 'set-ambience-level', level: 0.4 }).volumes).toEqual({
      music: 0.7,
      ambience: 0.4,
    });
  });

  it('refuses an edit of an Ambience the Scene does not list, in French', () => {
    const edits: SceneEdit[] = [
      { kind: 'remove-ambience', mediaId: 'a9' },
      { kind: 'set-ambience-on', mediaId: 'a9', on: true },
      { kind: 'set-ambience-volume', mediaId: 'a9', volume: 0.5 },
    ];
    for (const edit of edits) {
      expect(() => applyAll(listed, edit)).toThrow('Cette ambiance n’est plus dans la scène.');
    }
  });

  it('refuses malformed Ambience messages', () => {
    const malformed: unknown[] = [
      { kind: 'add-ambience', mediaId: '' },
      { kind: 'remove-ambience' },
      { kind: 'set-ambience-on', mediaId: 'a1', on: 'yes' },
      { kind: 'set-ambience-volume', mediaId: 'a1', volume: 1.5 },
      { kind: 'set-ambience-volume', mediaId: 'a1', volume: Number.NaN },
      { kind: 'set-ambience-level', level: -0.1 },
      { kind: 'set-ambience-level' },
    ];
    for (const message of malformed) expect(parseSceneEdit(message)).toBeUndefined();
  });
});

describe('Overlay transform commands', () => {
  const placed = applyAll(
    empty,
    { kind: 'place-background', mediaId: 'm1' },
    { kind: 'place-overlay', mediaId: 'm2' },
    { kind: 'place-overlay', mediaId: 'm3' },
    { kind: 'place-overlay', mediaId: 'm4' },
  );
  const order = (scene: Scene) => scene.overlays.map((item) => item.id);
  const moveTo = (placementId: string, toIndex: number) =>
    order(applyAll(placed, { kind: 'move-overlay', placementId, toIndex }));

  it('move an Overlay’s centre, leaving its size and the other placements', () => {
    const moved = applyAll(placed, {
      kind: 'transform-overlay',
      placementId: 'p3',
      position: { x: 0.1, y: 0.8 },
    });
    expect(moved.overlays[1]).toEqual({ ...placed.overlays[1], position: { x: 0.1, y: 0.8 } });
    expect(moved.overlays.filter((item) => item.id !== 'p3')).toEqual(
      placed.overlays.filter((item) => item.id !== 'p3'),
    );
    expect(moved.backgrounds).toEqual(placed.backgrounds);
  });

  it('change only the fields given, so one change never overwrites another', () => {
    const resized = applyAll(placed, { kind: 'transform-overlay', placementId: 'p2', height: 0.3 });
    const moved = applyAll(resized, {
      kind: 'transform-overlay',
      placementId: 'p2',
      position: { y: 0.2 },
    });
    expect(moved.overlays[0]).toEqual({
      ...placed.overlays[0],
      position: { x: 0.5, y: 0.2 },
      height: 0.3,
    });
  });

  it('keep a moved Overlay’s centre on the canvas', () => {
    const moved = applyAll(placed, {
      kind: 'transform-overlay',
      placementId: 'p2',
      position: { x: -0.3, y: 1.4 },
    });
    expect(moved.overlays[0].position).toEqual({ x: 0, y: 1 });
  });

  it('resize an Overlay: new height and centre', () => {
    const resized = applyAll(placed, {
      kind: 'transform-overlay',
      placementId: 'p2',
      position: { x: 0.6, y: 0.4 },
      height: 0.3,
    });
    expect(resized.overlays[0]).toEqual({
      ...placed.overlays[0],
      position: { x: 0.6, y: 0.4 },
      height: 0.3,
    });
  });

  it('keep a resized Overlay between the smallest and the largest height', () => {
    const resize = (height: number) =>
      applyAll(placed, { kind: 'transform-overlay', placementId: 'p2', height }).overlays[0].height;
    expect(resize(0.001)).toBe(MIN_OVERLAY_HEIGHT);
    expect(resize(50)).toBe(MAX_OVERLAY_HEIGHT);
  });

  it('bring an Overlay forward or send it back among the Overlays', () => {
    expect(moveTo('p2', 1)).toEqual(['p3', 'p2', 'p4']);
    expect(moveTo('p4', 1)).toEqual(['p2', 'p4', 'p3']);
    expect(moveTo('p4', 0)).toEqual(['p4', 'p2', 'p3']);
  });

  it('keep an Overlay moved past the front in front', () => {
    expect(moveTo('p2', 9)).toEqual(['p3', 'p4', 'p2']);
  });

  it('keep Overlays in their own stack: reordering never touches the Backgrounds', () => {
    const back = applyAll(placed, { kind: 'move-overlay', placementId: 'p3', toIndex: 0 });
    expect(back.backgrounds).toEqual(placed.backgrounds);
  });

  it.each([
    { kind: 'transform-overlay', placementId: 'p1', position: { x: 0.5 } },
    { kind: 'transform-overlay', placementId: 'absent', height: 0.4 },
    { kind: 'move-overlay', placementId: 'p1', toIndex: 0 },
  ] as const)('refuse %o when it names no Overlay of the Scene, in French', (edit) => {
    expect(() => applyAll(placed, edit)).toThrow('Cet élément n’est plus sur la scène.');
  });
});

describe('Nudging an Overlay with the arrow keys', () => {
  it('moves it 10 canvas units, or 50 with Shift, in the key’s direction', () => {
    const centre = { x: 0.5, y: 0.5 };
    expect(nudgedPosition(centre, 'ArrowRight', false).x).toBeCloseTo(0.5 + 10 / 1920);
    expect(nudgedPosition(centre, 'ArrowLeft', false).x).toBeCloseTo(0.5 - 10 / 1920);
    expect(nudgedPosition(centre, 'ArrowDown', false).y).toBeCloseTo(0.5 + 10 / 1080);
    expect(nudgedPosition(centre, 'ArrowUp', true).y).toBeCloseTo(0.5 - 50 / 1080);
    expect(nudgedPosition(centre, 'ArrowUp', true).x).toBe(0.5);
  });

  it('stops at the canvas edge', () => {
    expect(nudgedPosition({ x: 0.001, y: 0.999 }, 'ArrowLeft', true)).toEqual({ x: 0, y: 0.999 });
    expect(nudgedPosition({ x: 0.5, y: 0.999 }, 'ArrowDown', true)).toEqual({ x: 0.5, y: 1 });
  });
});

describe('Resizing an Overlay by its corner', () => {
  // A square image, a quarter of the canvas high, centred: 270 x 270 canvas units at (825, 405).
  const square = { position: { x: 0.5, y: 0.5 }, height: 0.25 };

  it('keeps its proportions and its top-left corner where they were', () => {
    // Corner dragged to (1365, 945): 540 wide, 540 high.
    const resized = resizedOverlay(square, 1, { x: 1365 / 1920, y: 945 / 1080 });
    expect(resized.height).toBeCloseTo(0.5);
    expect(resized.position.x).toBeCloseTo((825 + 270) / 1920);
    expect(resized.position.y).toBeCloseTo((405 + 270) / 1080);
  });

  it('follows whichever of the pointer’s two directions goes further', () => {
    // Wide image (2:1): dragging right 540 units gives 1080 wide, so 540 high.
    const wide = { position: { x: 0.5, y: 0.5 }, height: 0.25 };
    const resized = resizedOverlay(wide, 2, { x: (690 + 1080) / 1920, y: 0.5 });
    expect(resized.height).toBeCloseTo(0.5);
  });

  it('never goes below the smallest height, nor above the largest', () => {
    expect(resizedOverlay(square, 1, { x: 0, y: 0 }).height).toBe(MIN_OVERLAY_HEIGHT);
    expect(resizedOverlay(square, 1, { x: 40, y: 40 }).height).toBe(MAX_OVERLAY_HEIGHT);
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

  it('on the canvas, places a Reference image as an Overlay centred on the drop point', () => {
    expect(placementEdit(image('reference'), 'canvas', { x: 0.6, y: 0.4 })).toEqual({
      kind: 'place-overlay',
      mediaId: 'm-reference',
      position: { x: 0.6, y: 0.4 },
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
    [
      { kind: 'set-label-text', overlayId: 'p1', text: 'Garde', visible: true },
      { kind: 'set-label-text', overlayId: 'p1', text: 'Garde' },
    ],
    [
      { kind: 'set-label-visible', overlayId: 'p1', visible: true, text: 'Garde' },
      { kind: 'set-label-visible', overlayId: 'p1', visible: true },
    ],
    [
      { kind: 'add-music', mediaId: 'm1', toIndex: 0 },
      { kind: 'add-music', mediaId: 'm1' },
    ],
    [
      { kind: 'add-ambience', mediaId: 'a1', on: true },
      { kind: 'add-ambience', mediaId: 'a1' },
    ],
    [
      { kind: 'remove-ambience', mediaId: 'a1', volume: 1 },
      { kind: 'remove-ambience', mediaId: 'a1' },
    ],
    [
      { kind: 'set-ambience-on', mediaId: 'a1', on: true, volume: 1 },
      { kind: 'set-ambience-on', mediaId: 'a1', on: true },
    ],
    [
      { kind: 'set-ambience-volume', mediaId: 'a1', volume: 0, on: true },
      { kind: 'set-ambience-volume', mediaId: 'a1', volume: 0 },
    ],
    [
      { kind: 'set-ambience-level', level: 1, mediaId: 'a1' },
      { kind: 'set-ambience-level', level: 1 },
    ],
    [
      { kind: 'set-title', title: 'Le vieux moulin', name: 'x' },
      { kind: 'set-title', title: 'Le vieux moulin' },
    ],
    [
      {
        kind: 'transform-overlay',
        placementId: 'p1',
        position: { x: 0.2, y: 1, z: 0 },
        toIndex: 1,
      },
      { kind: 'transform-overlay', placementId: 'p1', position: { x: 0.2, y: 1 } },
    ],
    [
      { kind: 'transform-overlay', placementId: 'p1', position: { y: 0.5 }, height: 0.3 },
      { kind: 'transform-overlay', placementId: 'p1', position: { y: 0.5 }, height: 0.3 },
    ],
    [
      { kind: 'transform-overlay', placementId: 'p1', height: 0.3 },
      { kind: 'transform-overlay', placementId: 'p1', height: 0.3 },
    ],
    [
      { kind: 'move-overlay', placementId: 'p1', toIndex: 2, direction: 'back' },
      { kind: 'move-overlay', placementId: 'p1', toIndex: 2 },
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
    ['a Label naming no Overlay', { kind: 'set-label-text', overlayId: '', text: 'Garde' }],
    ['a Label text that is not a string', { kind: 'set-label-text', overlayId: 'p1', text: 1 }],
    [
      'a Label text far too long for a message',
      { kind: 'set-label-text', overlayId: 'p1', text: 'x'.repeat(1001) },
    ],
    [
      'a Label visibility that is not a boolean',
      { kind: 'set-label-visible', overlayId: 'p1', visible: 'yes' },
    ],
    ['a title that is not a string', { kind: 'set-title', title: null }],
    ['a title far too long for a message', { kind: 'set-title', title: 'x'.repeat(1001) }],
    ['not an object', 'place-background'],
    [
      'a move off the canvas',
      { kind: 'transform-overlay', placementId: 'p1', position: { y: -1 } },
    ],
    [
      'a position that is not an object',
      { kind: 'transform-overlay', placementId: 'p1', position: 0.5 },
    ],
    ['a resize to nothing', { kind: 'transform-overlay', placementId: 'p1', height: 0 }],
    [
      'a resize beyond the largest height',
      { kind: 'transform-overlay', placementId: 'p1', height: MAX_OVERLAY_HEIGHT + 1 },
    ],
    ['a resize to no number', { kind: 'transform-overlay', placementId: 'p1', height: NaN }],
    ['a reorder to no place', { kind: 'move-overlay', placementId: 'p1', toIndex: -1 }],
    ['a reorder to half a place', { kind: 'move-overlay', placementId: 'p1', toIndex: 0.5 }],
  ])('reject %s', (_case, value) => {
    expect(parseSceneEdit(value)).toBeUndefined();
  });

  it('accept only a transform, a framing or a Music level as a transient update', () => {
    const move = { kind: 'transform-overlay', placementId: 'p1', position: { x: 0.2, y: 0.3 } };
    expect(parseTransientEdit({ ...move, extra: 1 })).toEqual(move);
    const resize = { ...move, height: 0.2 };
    expect(parseTransientEdit(resize)).toEqual(resize);
    const framing = { kind: 'frame-background', placementId: 'b1', zoom: 2, focus: { x: 0.3 } };
    expect(parseTransientEdit({ ...framing, extra: 1 })).toEqual(framing);
    expect(parseTransientEdit({ kind: 'set-music-level', level: 0.5 })).toEqual({
      kind: 'set-music-level',
      level: 0.5,
    });
    expect(
      parseTransientEdit({ kind: 'set-visible', placementId: 'p1', visible: true }),
    ).toBeUndefined();
    expect(
      parseTransientEdit({ kind: 'move-overlay', placementId: 'p1', toIndex: 0 }),
    ).toBeUndefined();
    expect(parseTransientEdit({ kind: 'remove-music', mediaId: 'm1' })).toBeUndefined();
  });
});

describe('Background stack and fit edits', () => {
  const stacked = applyAll(
    empty,
    { kind: 'place-background', mediaId: 'm1' },
    { kind: 'place-background', mediaId: 'm2' },
    { kind: 'place-background', mediaId: 'm3' },
    { kind: 'place-overlay', mediaId: 'm4' },
  );
  const order = (scene: Scene) => scene.backgrounds.map((item) => item.id);

  it('move a Background to another place in the stack, keeping the others in order', () => {
    expect(
      order(applyAll(stacked, { kind: 'move-background', placementId: 'p1', toIndex: 2 })),
    ).toEqual(['p2', 'p3', 'p1']);
    expect(
      order(applyAll(stacked, { kind: 'move-background', placementId: 'p3', toIndex: 0 })),
    ).toEqual(['p3', 'p1', 'p2']);
    expect(
      order(applyAll(stacked, { kind: 'move-background', placementId: 'p2', toIndex: 1 })),
    ).toEqual(['p1', 'p2', 'p3']);
  });

  it('keep a move past either end of the stack at that end', () => {
    expect(
      order(applyAll(stacked, { kind: 'move-background', placementId: 'p1', toIndex: 9 })),
    ).toEqual(['p2', 'p3', 'p1']);
  });

  it('set a Background to Contain or Cover, keeping its framing', () => {
    const framed = applyAll(stacked, {
      kind: 'frame-background',
      placementId: 'p2',
      zoom: 2,
      focus: { x: 0, y: 1 },
    });
    const contained = applyAll(framed, {
      kind: 'set-background-fit',
      placementId: 'p2',
      fit: 'contain',
    });
    expect(contained.backgrounds[1]).toMatchObject({
      fit: 'contain',
      zoom: 2,
      focus: { x: 0, y: 1 },
    });
    expect(contained.backgrounds[0]).toEqual(stacked.backgrounds[0]);
    const covered = applyAll(contained, {
      kind: 'set-background-fit',
      placementId: 'p2',
      fit: 'cover',
    });
    expect(covered.backgrounds[1]).toEqual(framed.backgrounds[1]);
  });

  it('frame a Background with a zoom and a focal point, the zoom kept within its limits', () => {
    const framed = applyAll(stacked, {
      kind: 'frame-background',
      placementId: 'p1',
      zoom: 1.5,
      focus: { x: 0.25, y: 0.75 },
    });
    expect(framed.backgrounds[0]).toMatchObject({ zoom: 1.5, focus: { x: 0.25, y: 0.75 } });
    const tooFar = applyAll(stacked, {
      kind: 'frame-background',
      placementId: 'p1',
      zoom: 100,
      focus: { x: 0.5, y: 0.5 },
    });
    expect(tooFar.backgrounds[0].zoom).toBe(MAX_ZOOM);
    const tooClose = applyAll(stacked, {
      kind: 'frame-background',
      placementId: 'p1',
      zoom: 0.2,
      focus: { x: 0.5, y: 0.5 },
    });
    expect(tooClose.backgrounds[0].zoom).toBe(MIN_ZOOM);
  });

  it('frame only what is given, keeping the rest of the framing as saved', () => {
    const zoomed = applyAll(stacked, { kind: 'frame-background', placementId: 'p1', zoom: 3 });
    expect(zoomed.backgrounds[0]).toMatchObject({ zoom: 3, focus: { x: 0.5, y: 0.5 } });
    const panned = applyAll(
      zoomed,
      { kind: 'frame-background', placementId: 'p1', focus: { x: 0 } },
      { kind: 'frame-background', placementId: 'p1', focus: { y: 1 } },
    );
    expect(panned.backgrounds[0]).toMatchObject({ zoom: 3, focus: { x: 0, y: 1 } });
  });

  it('refuse to move or fit a Background that is not on the Scene, or an Overlay, in French', () => {
    const refused = 'Cet arrière-plan n’est plus sur la scène.';
    expect(() =>
      applyAll(stacked, { kind: 'move-background', placementId: 'absent', toIndex: 0 }),
    ).toThrow(refused);
    expect(() =>
      applyAll(stacked, { kind: 'set-background-fit', placementId: 'p4', fit: 'contain' }),
    ).toThrow(refused);
    expect(() =>
      applyAll(stacked, {
        kind: 'frame-background',
        placementId: 'p4',
        zoom: 1,
        focus: { x: 0.5, y: 0.5 },
      }),
    ).toThrow(refused);
  });

  it.each([
    [
      { kind: 'move-background', placementId: 'p1', toIndex: 2, extra: true },
      { kind: 'move-background', placementId: 'p1', toIndex: 2 },
    ],
    [
      { kind: 'set-background-fit', placementId: 'p1', fit: 'contain', zoom: 3 },
      { kind: 'set-background-fit', placementId: 'p1', fit: 'contain' },
    ],
    [
      { kind: 'frame-background', placementId: 'p1', zoom: 2, focus: { x: 0, y: 1, z: 3 } },
      { kind: 'frame-background', placementId: 'p1', zoom: 2, focus: { x: 0, y: 1 } },
    ],
    [
      { kind: 'frame-background', placementId: 'p1', focus: { y: 0.3 } },
      { kind: 'frame-background', placementId: 'p1', focus: { y: 0.3 } },
    ],
  ])('accept %o from a window, keeping only its fields', (value, expected) => {
    expect(parseSceneEdit(value)).toEqual(expected);
  });

  it.each([
    ['a move to no place', { kind: 'move-background', placementId: 'p1' }],
    ['a move to a negative place', { kind: 'move-background', placementId: 'p1', toIndex: -1 }],
    ['a move to a fractional place', { kind: 'move-background', placementId: 'p1', toIndex: 0.5 }],
    ['an unknown fit', { kind: 'set-background-fit', placementId: 'p1', fit: 'stretch' }],
    ['a fit naming no placement', { kind: 'set-background-fit', fit: 'cover' }],
    [
      'a zoom that is not a number',
      { kind: 'frame-background', placementId: 'p1', zoom: '2', focus: { x: 0, y: 0 } },
    ],
    [
      'an infinite zoom',
      { kind: 'frame-background', placementId: 'p1', zoom: Infinity, focus: { x: 0, y: 0 } },
    ],
    [
      'a focal point off the image',
      { kind: 'frame-background', placementId: 'p1', zoom: 1, focus: { x: 1.5, y: 0 } },
    ],
    [
      'a focal point that is not an object',
      { kind: 'frame-background', placementId: 'p1', focus: 0.5 },
    ],
    ['a framing naming no placement', { kind: 'frame-background', zoom: 1 }],
  ])('reject %s from a window', (_case, value) => {
    expect(parseSceneEdit(value)).toBeUndefined();
  });
});
