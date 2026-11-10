import { describe, expect, it } from 'vitest';
import { createOnAir, latestOnAir, onAirSceneOf } from '../../core/onAir';
import type { Media, OnAirScene, Scene } from '../../shared/domain';

const cantina: OnAirScene = {
  backgrounds: [{ id: 'b1', src: 'regie-asset://media/c/x.png', fit: 'cover', position: { x: 0.5, y: 0.5 } }],
  overlays: [],
};
const blank: OnAirScene = { backgrounds: [], overlays: [] };
const nothing = { campaignId: null, activeSceneId: null, scene: null };

describe('on-air state', () => {
  it('starts with nothing on air', () => {
    const onAir = createOnAir();
    expect(onAir.current()).toEqual({ ...nothing, version: 0 });
  });

  it('opens a Campaign with no Active Scene, then Activates a Scene, one version each', () => {
    const onAir = createOnAir();
    expect(onAir.openCampaign('star-wars')).toEqual({
      campaignId: 'star-wars',
      activeSceneId: null,
      scene: null,
      version: 1,
    });
    expect(onAir.activateScene('cantina', cantina)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      version: 2,
    });
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      version: 2,
    });
  });

  it('shows the edited Active Scene as a new version', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', blank);
    expect(onAir.showActiveScene('cantina', cantina)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      version: 3,
    });
  });

  it('ignores an edit of a Scene that is not the Active Scene', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', blank);
    expect(onAir.showActiveScene('hangar', cantina)).toBeUndefined();
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: blank,
      version: 2,
    });
  });

  it('switching Campaign clears the Active Scene', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.openCampaign('warhammer')).toEqual({
      campaignId: 'warhammer',
      activeSceneId: null,
      scene: null,
      version: 3,
    });
  });

  it('closing the Campaign takes everything off air', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.closeCampaign()).toEqual({ ...nothing, version: 3 });
  });

  it('refuses to Activate a Scene when no Campaign is open, leaving the state unchanged', () => {
    const onAir = createOnAir();
    expect(() => onAir.activateScene('cantina', cantina)).toThrow(/no Campaign is open/);
    onAir.openCampaign('star-wars');
    onAir.closeCampaign();
    expect(() => onAir.activateScene('cantina', cantina)).toThrow(/no Campaign is open/);
    expect(onAir.current()).toEqual({ ...nothing, version: 2 });
  });

  it('tells subscribers every new snapshot until they unsubscribe', () => {
    const onAir = createOnAir();
    const seen: unknown[] = [];
    const unsubscribe = onAir.subscribe((snapshot) => seen.push(snapshot));
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    unsubscribe();
    onAir.closeCampaign();
    expect(seen).toEqual([
      { campaignId: 'star-wars', activeSceneId: null, scene: null, version: 1 },
      { campaignId: 'star-wars', activeSceneId: 'cantina', scene: cantina, version: 2 },
    ]);
  });

  it('hands out snapshots that callers cannot use to change the state', () => {
    const onAir = createOnAir();
    onAir.subscribe((snapshot) => {
      snapshot.version = 99;
      snapshot.scene?.backgrounds.pop();
    });
    onAir.openCampaign('star-wars');
    const activated = onAir.activateScene('cantina', cantina);
    activated.activeSceneId = 'hacked';
    activated.scene?.backgrounds.pop();
    onAir.current().campaignId = 'hacked';
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      version: 2,
    });
  });
});

describe('what of a Scene goes on air', () => {
  const image = (id: string, contentHash: string): Media => ({
    id,
    campaignId: 'c1',
    kind: 'image',
    category: 'scenery',
    contentHash,
    originalName: id,
    name: id,
    extension: '.png',
  });
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const scene: Scene = {
    id: 's1',
    campaignId: 'c1',
    name: 'Nom privé',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: true },
      { id: 'b2', mediaId: 'm2', fit: 'contain', position: { x: 0, y: 1 }, visible: false },
      { id: 'b3', mediaId: 'gone', fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: true },
      { id: 'b4', mediaId: 'm2', fit: 'stretch', position: { x: 1, y: 0 }, visible: true },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm2',
        position: { x: 0.2, y: 0.8 },
        scale: 0.5,
        zIndex: 3,
        visible: true,
        label: 'Garde',
      },
      { id: 'o2', mediaId: 'm1', position: { x: 0, y: 0 }, scale: 1, zIndex: 1, visible: false },
    ],
    music: [],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: 'Notes privées',
  };

  it('keeps only visible placements of known Media, in order, with their addresses', () => {
    expect(onAirSceneOf(scene, [image('m1', hashA), image('m2', hashB)])).toEqual({
      backgrounds: [
        {
          id: 'b1',
          src: `regie-asset://media/c1/${hashA}.png`,
          fit: 'cover',
          position: { x: 0.5, y: 0.5 },
        },
        {
          id: 'b4',
          src: `regie-asset://media/c1/${hashB}.png`,
          fit: 'stretch',
          position: { x: 1, y: 0 },
        },
      ],
      overlays: [
        {
          id: 'o1',
          src: `regie-asset://media/c1/${hashB}.png`,
          position: { x: 0.2, y: 0.8 },
          scale: 0.5,
          zIndex: 3,
        },
      ],
    });
  });

  it('never carries the private name or notes', () => {
    const json = JSON.stringify(onAirSceneOf(scene, [image('m1', hashA), image('m2', hashB)]));
    expect(json).not.toContain('privé');
    expect(json).not.toContain('Garde');
  });
});

describe('the snapshot a window shows', () => {
  const v1 = { campaignId: 'star-wars', activeSceneId: null, scene: null, version: 1 };
  const v2 = { campaignId: 'star-wars', activeSceneId: 'cantina', scene: null, version: 2 };

  it('takes the first snapshot it receives', () => {
    expect(latestOnAir(null, v1)).toBe(v1);
  });

  it('takes a newer snapshot', () => {
    expect(latestOnAir(v1, v2)).toBe(v2);
  });

  it('ignores an older or same-version snapshot', () => {
    expect(latestOnAir(v2, v1)).toBe(v2);
    expect(latestOnAir(v2, { ...v2, activeSceneId: 'other' })).toBe(v2);
  });
});
