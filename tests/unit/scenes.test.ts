import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignError, createCampaign } from '../../core/campaigns';
import { emptyNotes, notesFromPlainText } from '../../core/notes';
import { createSceneLibrary, parseScene, SceneError } from '../../core/scenes';
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
      title: '',
      backgrounds: [],
      overlays: [],
      music: [],
      ambiences: [],
      volumes: { music: 1, ambience: 1 },
      notes: emptyNotes(),
    });
    expect(await scenes.list(campaign.id)).toEqual([scene]);
  });

  it('keeps a Scene with a Background after the storage is reopened (restart)', async () => {
    const { campaign, scenes } = await setup();
    const created = await scenes.create(campaign.id, 'La cantina');
    const edited: Scene = {
      ...created,
      backgrounds: [
        { id: 'b1', mediaId: 'm1', fit: 'cover', zoom: 2, focus: { x: 0, y: 1 }, visible: true },
      ],
      overlays: [
        {
          id: 'o1',
          mediaId: 'm2',
          position: { x: 0.25, y: 0.75 },
          height: 0.4,
          visible: true,
          label: { text: 'Garde', visible: false },
        },
      ],
      title: 'Le vieux moulin',
    };
    await scenes.save(edited);

    const reopened = createSceneLibrary(openStorage(root()));
    expect(await reopened.list(campaign.id)).toEqual([edited]);
    expect(await reopened.get(campaign.id, created.id)).toEqual(edited);
  });

  it('removes every placement of a Media from the Scenes using it, and only from those', async () => {
    const { campaign, scenes } = await setup();
    const placed = (mediaId: string, id: string) => ({ id, mediaId, visible: true });
    const background = { fit: 'cover' as const, zoom: 1, focus: { x: 0.5, y: 0.5 } };
    const cantina = await scenes.save({
      ...(await scenes.create(campaign.id, 'La cantina')),
      backgrounds: [
        { ...placed('gone', 'b1'), ...background },
        { ...placed('kept', 'b2'), ...background },
      ],
      overlays: [{ ...placed('gone', 'o1'), position: { x: 0.5, y: 0.5 }, height: 1 }],
      music: ['gone', 'kept'],
      ambiences: [{ mediaId: 'gone', on: true, volume: 1 }],
    });
    const bridge = await scenes.save({
      ...(await scenes.create(campaign.id, 'La passerelle')),
      backgrounds: [{ ...placed('kept', 'b3'), ...background }],
    });

    const affected = await scenes.removeMediaPlacements(campaign.id, 'gone');

    const cleaned: Scene = {
      ...cantina,
      backgrounds: [{ ...placed('kept', 'b2'), ...background }],
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
    await expect(scenes.list('inconnue')).rejects.toBeInstanceOf(CampaignError);
  });

  it('deletes a Scene, keeping the others, after the storage is reopened (restart)', async () => {
    const { campaign, scenes } = await setup();
    const cantina = await scenes.create(campaign.id, 'La cantina');
    const hangar = await scenes.create(campaign.id, 'Le hangar');

    await scenes.delete(campaign.id, cantina.id);

    expect(await scenes.list(campaign.id)).toEqual([hangar]);
    const reopened = createSceneLibrary(openStorage(root()));
    expect(await reopened.list(campaign.id)).toEqual([hangar]);
  });

  it('refuses to delete a Scene that does not exist, in French', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');
    await expect(scenes.delete(campaign.id, 'autre')).rejects.toThrow('Cette scène n’existe plus.');
    expect(await scenes.list(campaign.id)).toEqual([scene]);
  });

  it('refuses to save a Scene that does not exist', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');
    await expect(scenes.save({ ...scene, id: 'autre' })).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
    expect(await scenes.get(campaign.id, 'autre')).toBeUndefined();
  });

  it('upgrades Milestone 0 Scenes (version 1) to the Milestone 1 placements', async () => {
    const { storage, campaign, scenes } = await setup();
    const placement = { mediaId: 'm1', visible: true };
    await fs.writeFile(
      path.join(storage.campaignFolder(campaign.id), 'scenes.json'),
      JSON.stringify({
        schemaVersion: 1,
        scenes: [
          {
            id: 's1',
            name: 'La cantina',
            backgrounds: [
              { id: 'b1', ...placement, fit: 'stretch', position: { x: 0.2, y: 0.3 } },
              { id: 'b2', ...placement, fit: 'contain', position: { x: 0.5, y: 0.5 } },
            ],
            overlays: [
              { id: 'front', ...placement, position: { x: 0.1, y: 0.2 }, scale: 0.3, zIndex: 5 },
              {
                id: 'back',
                ...placement,
                position: { x: 0.5, y: 0.5 },
                scale: 0.6,
                zIndex: 1,
                label: 'Garde',
              },
            ],
            music: [],
            ambiences: [],
            volumes: { music: 1, ambience: 1 },
            notes: 'secret',
          },
        ],
      }),
    );

    expect(await scenes.list(campaign.id)).toEqual([
      {
        id: 's1',
        campaignId: campaign.id,
        name: 'La cantina',
        title: '',
        backgrounds: [
          { id: 'b1', ...placement, fit: 'cover', zoom: 1, focus: { x: 0.2, y: 0.3 } },
          { id: 'b2', ...placement, fit: 'contain', zoom: 1, focus: { x: 0.5, y: 0.5 } },
        ],
        overlays: [
          {
            id: 'back',
            ...placement,
            position: { x: 0.5, y: 0.5 },
            height: 0.6,
            label: { text: 'Garde', visible: false },
          },
          { id: 'front', ...placement, position: { x: 0.1, y: 0.2 }, height: 0.3 },
        ],
        music: [],
        ambiences: [],
        volumes: { music: 1, ambience: 1 },
        notes: notesFromPlainText('secret'),
      },
    ]);
  });

  it('upgrades plain-text Notes (version 2) to rich text, one paragraph per line', async () => {
    const { storage, campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');
    const { campaignId: _campaignId, ...stored } = scene;
    await fs.writeFile(
      path.join(storage.campaignFolder(campaign.id), 'scenes.json'),
      JSON.stringify({
        schemaVersion: 2,
        scenes: [
          { ...stored, notes: 'Le traître\n\nest le capitaine' },
          { ...stored, id: 's2', notes: '' },
        ],
      }),
    );

    const [migrated, empty] = await scenes.list(campaign.id);
    expect(migrated.notes).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Le traître' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'est le capitaine' }] },
      ],
    });
    expect(empty.notes).toEqual(emptyNotes());
  });

  describe('running order', () => {
    const names = (list: Scene[]) => list.map((scene) => scene.name);

    it('adds a new Scene at the end', async () => {
      const { campaign, scenes } = await setup();
      const first = await scenes.create(campaign.id, 'A');
      await scenes.create(campaign.id, 'B');
      await scenes.move(campaign.id, first.id, 1);

      await scenes.create(campaign.id, 'C');

      expect(names(await scenes.list(campaign.id))).toEqual(['B', 'A', 'C']);
    });

    it('moves a Scene and keeps the order after the storage is reopened (restart)', async () => {
      const { campaign, scenes } = await setup();
      const [a, , c] = [
        await scenes.create(campaign.id, 'A'),
        await scenes.create(campaign.id, 'B'),
        await scenes.create(campaign.id, 'C'),
      ];

      expect(names(await scenes.move(campaign.id, c.id, 0))).toEqual(['C', 'A', 'B']);
      expect(names(await scenes.move(campaign.id, a.id, 2))).toEqual(['C', 'B', 'A']);

      const reopened = createSceneLibrary(openStorage(root()));
      expect(names(await reopened.list(campaign.id))).toEqual(['C', 'B', 'A']);
    });

    it('changes no Scene when moving one, and saving a Scene keeps its place', async () => {
      const { campaign, scenes } = await setup();
      const a = await scenes.create(campaign.id, 'A');
      const b = await scenes.create(campaign.id, 'B');
      await scenes.move(campaign.id, b.id, 0);

      await scenes.save({ ...a, title: 'Le vieux moulin' });

      expect(await scenes.list(campaign.id)).toEqual([b, { ...a, title: 'Le vieux moulin' }]);
    });

    it('refuses to move a Scene that no longer exists', async () => {
      const { campaign, scenes } = await setup();
      await scenes.create(campaign.id, 'A');
      await expect(scenes.move(campaign.id, 'inconnue', 0)).rejects.toThrow(SceneError);
    });

    it('starts as the list order of a Campaign saved before running orders (version 2)', async () => {
      const { storage, campaign, scenes } = await setup();
      const { campaignId: _campaignId, ...stored } = await scenes.create(campaign.id, 'x');
      await fs.writeFile(
        path.join(storage.campaignFolder(campaign.id), 'scenes.json'),
        JSON.stringify({
          schemaVersion: 2,
          scenes: ['Zéro', 'Alpha', 'Milieu'].map((name, i) => ({
            ...stored,
            id: `s${i}`,
            name,
            notes: '',
          })),
        }),
      );

      expect(names(await scenes.list(campaign.id))).toEqual(['Zéro', 'Alpha', 'Milieu']);
    });
  });

  it('keeps every Scene when saves run at the same time', async () => {
    const { campaign, scenes } = await setup();
    const created = await Promise.all(
      ['A', 'B', 'C'].map((name) => scenes.create(campaign.id, name)),
    );
    await Promise.all(
      created.map((scene) =>
        scenes.save({ ...scene, notes: notesFromPlainText(`n-${scene.name}`) }),
      ),
    );
    const listed = await scenes.list(campaign.id);
    expect(listed.map((s) => s.notes)).toEqual(['n-A', 'n-B', 'n-C'].map(notesFromPlainText));
  });
});

describe('Scene parsing', () => {
  const valid = {
    id: 's1',
    name: 'La cantina',
    title: 'Le vieux moulin',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'contain', zoom: 1, focus: { x: 0, y: 1 }, visible: false },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm2',
        position: { x: 0.2, y: 0.8 },
        height: 0.5,
        visible: true,
        label: { text: 'Garde', visible: true },
      },
    ],
    music: ['m3'],
    ambiences: [{ mediaId: 'm4', on: true, volume: 0.3 }],
    volumes: { music: 0.5, ambience: 0.7 },
    notes: notesFromPlainText('secret'),
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
    ['no Scene title', { ...valid, title: undefined }],
    [
      'a focal point off the canvas',
      { ...valid, backgrounds: [{ ...valid.backgrounds[0], focus: { x: 1.5, y: 0 } }] },
    ],
    ['a zero zoom', { ...valid, backgrounds: [{ ...valid.backgrounds[0], zoom: 0 }] }],
    ['a negative height', { ...valid, overlays: [{ ...valid.overlays[0], height: -1 }] }],
    ['a Label that is bare text', { ...valid, overlays: [{ ...valid.overlays[0], label: 'X' }] }],
    ['a volume above 1', { ...valid, volumes: { music: 2, ambience: 0 } }],
    ['missing notes', { ...valid, notes: undefined }],
    ['plain-text notes', { ...valid, notes: 'secret' }],
    [
      'notes with a link',
      {
        ...valid,
        notes: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'a', marks: [{ type: 'link' }] }],
            },
          ],
        },
      },
    ],
    [
      'a visibility that is not a boolean',
      { ...valid, backgrounds: [{ ...valid.backgrounds[0], visible: 'yes' }] },
    ],
  ])('rejects %s', (_case, value) => {
    expect(parseScene(value, 'c1')).toBeUndefined();
  });
});
