import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../core/campaigns';
import { createSceneLibrary, parseScene } from '../../core/scenes';
import { openStorage } from '../../core/storage';
import type { Scene } from '../../shared/domain';
import { useTempDir } from './tempDir';

describe('scene library', () => {
  const dir = useTempDir();
  const root = () => path.join(dir.path, 'data');

  async function setup() {
    const storage = openStorage(root());
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    return { storage, campaign, scenes: createSceneLibrary(storage) };
  }

  it('creates an empty Scene in the Campaign', async () => {
    const { campaign, scenes } = await setup();

    const scene = await scenes.create(campaign.id, '  La cantina ');

    expect(scene).toEqual({
      id: expect.any(String),
      campaignId: campaign.id,
      name: 'La cantina',
      backgrounds: [],
      overlays: [],
      music: [],
      ambiences: [],
      volumes: { music: 1, ambience: 1 },
      notes: '',
    });
    expect(await scenes.list(campaign.id)).toEqual([scene]);
  });

  it('keeps a Scene with a Background after the storage is reopened (restart)', async () => {
    const { campaign, scenes } = await setup();
    const created = await scenes.create(campaign.id, 'La cantina');
    const edited: Scene = {
      ...created,
      backgrounds: [
        { id: 'b1', mediaId: 'm1', fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: true },
      ],
    };
    await scenes.save(edited);

    const reopened = createSceneLibrary(openStorage(root()));
    expect(await reopened.list(campaign.id)).toEqual([edited]);
    expect(await reopened.get(campaign.id, created.id)).toEqual(edited);
  });

  it('removes every placement of a Media from the Scenes using it, and only from those', async () => {
    const { campaign, scenes } = await setup();
    const placed = (mediaId: string, id: string) => ({
      id,
      mediaId,
      position: { x: 0.5, y: 0.5 },
      visible: true,
    });
    const cantina = await scenes.save({
      ...(await scenes.create(campaign.id, 'La cantina')),
      backgrounds: [
        { ...placed('gone', 'b1'), fit: 'cover' },
        { ...placed('kept', 'b2'), fit: 'cover' },
      ],
      overlays: [{ ...placed('gone', 'o1'), scale: 1, zIndex: 0 }],
      music: ['gone', 'kept'],
      ambiences: [{ mediaId: 'gone', on: true, volume: 1 }],
    });
    const bridge = await scenes.save({
      ...(await scenes.create(campaign.id, 'La passerelle')),
      backgrounds: [{ ...placed('kept', 'b3'), fit: 'cover' }],
    });

    const affected = await scenes.removeMediaPlacements(campaign.id, 'gone');

    const cleaned: Scene = {
      ...cantina,
      backgrounds: [{ ...placed('kept', 'b2'), fit: 'cover' }],
      overlays: [],
      music: ['kept'],
      ambiences: [],
    };
    expect(affected).toEqual([cleaned]);
    const reopened = createSceneLibrary(openStorage(root()));
    expect(await reopened.list(campaign.id)).toEqual([cleaned, bridge]);
  });

  it('changes nothing when no Scene uses the Media', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');

    expect(await scenes.removeMediaPlacements(campaign.id, 'unused')).toEqual([]);
    expect(await scenes.list(campaign.id)).toEqual([scene]);
  });

  it('lists Scenes in creation order, each Campaign its own', async () => {
    const { storage, campaign, scenes } = await setup();
    const other = await createCampaign(storage.campaigns, 'Warhammer');
    const a = await scenes.create(campaign.id, 'Zeta');
    const b = await scenes.create(campaign.id, 'Alpha');
    const c = await scenes.create(other.id, 'Pont');

    expect((await scenes.list(campaign.id)).map((s) => s.id)).toEqual([a.id, b.id]);
    expect((await scenes.list(other.id)).map((s) => s.id)).toEqual([c.id]);
  });

  it('stores the Scenes in the Campaign folder', async () => {
    const { storage, campaign, scenes } = await setup();
    await scenes.create(campaign.id, 'La cantina');
    const files = await fs.readdir(storage.campaignFolder(campaign.id));
    expect(files).toContain('scenes.json');
  });

  it('refuses a Scene without a name, or in an unknown Campaign, in French', async () => {
    const { campaign, scenes } = await setup();
    await expect(scenes.create(campaign.id, '   ')).rejects.toThrow('Donnez un nom à la scène.');
    await expect(scenes.create('inconnue', 'X')).rejects.toThrow('Cette campagne n’existe plus.');
    await expect(scenes.list('inconnue')).rejects.toThrow('Cette campagne n’existe plus.');
  });

  it('refuses to save a Scene that does not exist', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');
    await expect(scenes.save({ ...scene, id: 'autre' })).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
    expect(await scenes.get(campaign.id, 'autre')).toBeUndefined();
  });

  it('keeps every Scene when saves run at the same time', async () => {
    const { campaign, scenes } = await setup();
    const created = await Promise.all(
      ['A', 'B', 'C'].map((name) => scenes.create(campaign.id, name)),
    );
    await Promise.all(created.map((scene) => scenes.save({ ...scene, notes: `n-${scene.name}` })));
    const listed = await scenes.list(campaign.id);
    expect(listed.map((s) => s.notes).sort()).toEqual(['n-A', 'n-B', 'n-C']);
  });
});

describe('Scene parsing', () => {
  const valid = {
    id: 's1',
    name: 'La cantina',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'contain', position: { x: 0, y: 1 }, visible: false },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm2',
        position: { x: 0.2, y: 0.8 },
        scale: 0.5,
        zIndex: 2,
        visible: true,
        label: 'Garde',
      },
    ],
    music: ['m3'],
    ambiences: [{ mediaId: 'm4', on: true, volume: 0.3 }],
    volumes: { music: 0.5, ambience: 0.7 },
    notes: 'secret',
  };

  it('accepts a complete Scene and attaches the Campaign id', () => {
    expect(parseScene(valid, 'c1')).toEqual({ ...valid, campaignId: 'c1' });
  });

  it('drops fields that are not part of a Scene', () => {
    const parsed = parseScene({ ...valid, extra: 1 }, 'c1');
    expect(parsed).not.toHaveProperty('extra');
  });

  it.each([
    ['an empty id', { ...valid, id: '' }],
    ['a name that is not text', { ...valid, name: 3 }],
    ['an unknown fit', { ...valid, backgrounds: [{ ...valid.backgrounds[0], fit: 'tile' }] }],
    [
      'a position off the canvas',
      { ...valid, backgrounds: [{ ...valid.backgrounds[0], position: { x: 1.5, y: 0 } }] },
    ],
    ['a negative scale', { ...valid, overlays: [{ ...valid.overlays[0], scale: -1 }] }],
    ['a volume above 1', { ...valid, volumes: { music: 2, ambience: 0 } }],
    ['missing notes', { ...valid, notes: undefined }],
    [
      'a visibility that is not a boolean',
      { ...valid, backgrounds: [{ ...valid.backgrounds[0], visible: 'yes' }] },
    ],
  ])('rejects %s', (_case, value) => {
    expect(parseScene(value, 'c1')).toBeUndefined();
  });
});
