import { describe, expect, it } from 'vitest';
import { createOnAir, onAirSceneOf } from '../../core/onAir';
import type {
  Background,
  Label,
  Media,
  OnAirBackground,
  OnAirOverlay,
  OnAirScene,
  OnAirState,
  Overlay,
  Scene,
} from '../../shared/domain';
import { notesFromPlainText } from '../../core/notes';

/*
 * Allow-lists for the broadcast projection. tests/unit/onAir.test.ts checks what one Scene
 * projects to; these lists make every new field a decision. Each list must name every field of
 * its type (the compiler checks), so adding a field to a Scene, a placement, a Label or the
 * on-air types fails typecheck here until someone decides whether players may see it.
 */

/** Where each Scene field goes on air: the OnAirScene field it feeds, or null for never. */
const sceneFieldOnAir = {
  id: null, // The Active Scene's id travels as OnAirState.activeSceneId, for the windows only.
  campaignId: null,
  name: null,
  title: 'title',
  backgrounds: 'backgrounds',
  overlays: 'overlays',
  music: null,
  ambiences: null,
  volumes: null,
  notes: null,
} as const satisfies Record<keyof Scene, keyof OnAirScene | null>;

/** Where each Background field goes on air; its Media id becomes the Media address `src`. */
const backgroundFieldOnAir = {
  id: 'id',
  mediaId: 'src',
  fit: 'fit',
  zoom: 'zoom',
  focus: 'focus',
  visible: null, // Only visible Backgrounds are projected.
} as const satisfies Record<keyof Background, keyof OnAirBackground | null>;

const overlayFieldOnAir = {
  id: 'id',
  mediaId: 'src',
  position: 'position',
  height: 'height',
  visible: null, // Only visible Overlays are projected.
  label: 'label',
} as const satisfies Record<keyof Overlay, keyof OnAirOverlay | null>;

const labelFieldOnAir = {
  text: 'label',
  visible: null, // Only a shown Label's text is projected.
} as const satisfies Record<keyof Label, keyof OnAirOverlay | null>;

const onAirStateFields = {
  campaignId: true,
  activeSceneId: true,
  scene: true,
  blackout: true,
  fadeDurationMs: true, // A setting, not Scene data: every renderer fades alike.
  version: true,
} as const satisfies Record<keyof OnAirState, true>;

/** The OnAirScene fields the classification above feeds, sorted. */
function fed(classification: Record<string, string | null>): string[] {
  const targets = Object.values(classification).filter((target) => target !== null);
  return [...new Set(targets)].sort();
}

const keys = (value: object) => Object.keys(value).sort();

describe('the broadcast projection allow-list', () => {
  const hash = 'c'.repeat(64);
  const library: Media[] = [
    {
      id: 'm1',
      campaignId: 'c1',
      kind: 'image',
      category: 'scenery',
      contentHash: hash,
      originalName: 'original',
      name: 'named',
      extension: '.png',
    },
  ];
  // Everything shown and set, so every optional on-air field is present.
  const scene: Scene = {
    id: 's1',
    campaignId: 'c1',
    name: 'Scene name',
    title: 'Le titre',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'cover', zoom: 1, focus: { x: 0, y: 0 }, visible: true },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm1',
        position: { x: 0.5, y: 0.5 },
        height: 0.5,
        visible: true,
        label: { text: 'Garde', visible: true },
      },
    ],
    music: ['m2'],
    ambiences: [{ mediaId: 'm3', on: true, volume: 1 }],
    volumes: { music: 1, ambience: 1 },
    notes: notesFromPlainText('Notes'),
  };
  const projected = onAirSceneOf(scene, library);

  it('projects a Scene to exactly the fields the Scene allow-list feeds', () => {
    expect(keys(projected)).toEqual(fed(sceneFieldOnAir));
  });

  it('projects a placement to exactly the fields its allow-list feeds', () => {
    expect(keys(projected.backgrounds[0] ?? {})).toEqual(fed(backgroundFieldOnAir));
    expect(keys(projected.overlays[0] ?? {})).toEqual(
      fed({ ...overlayFieldOnAir, ...labelFieldOnAir }),
    );
  });

  it('sends the windows exactly the allow-listed on-air state fields', () => {
    const onAir = createOnAir();
    onAir.openCampaign('c1');
    expect(keys(onAir.activateScene('s1', projected))).toEqual(keys(onAirStateFields));
  });
});
