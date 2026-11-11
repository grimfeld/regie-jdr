import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignError, createCampaign } from '../../core/campaigns';
import { emptyNotes, notesFromPlainText } from '../../core/notes';
import {
  copyOfScene,
  createSceneLibrary,
  parseScene,
  RECOVERED_FOLDER,
  SceneError,
  type SceneLibrary,
} from '../../core/scenes';
import { MAX_SCENE_NAME_LENGTH } from '../../core/sceneEdits';
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
      transition: 'crossfade',
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

    const affected = await scenes.removeMediaUses(campaign.id, 'gone');

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

  it('removes the images of a Media from the Notes of the Scenes showing it there', async () => {
    const { campaign, scenes } = await setup();
    const map = '9b2d1c3e-1111-4d8e-9a43-0f0f2b0c1d2e';
    const portrait = '1c0ffee0-2222-4abc-8def-0123456789ab';
    const image = (mediaId: string) => ({ type: 'image', attrs: { mediaId } });
    const mill = await scenes.save({
      ...(await scenes.create(campaign.id, 'Le moulin')),
      notes: { type: 'doc', content: [image(map), image(portrait)] },
    });
    const bridge = await scenes.save({
      ...(await scenes.create(campaign.id, 'La passerelle')),
      notes: { type: 'doc', content: [image(portrait)] },
    });

    const affected = await scenes.removeMediaUses(campaign.id, map);

    const cleaned: Scene = { ...mill, notes: { type: 'doc', content: [image(portrait)] } };
    expect(affected).toEqual([cleaned]);
    const reopened = createSceneLibrary(openStorage(root()));
    expect(await reopened.list(campaign.id)).toEqual([cleaned, bridge]);
  });

  it('changes nothing when no Scene uses the Media', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');

    expect(await scenes.removeMediaUses(campaign.id, 'unused')).toEqual([]);
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
        transition: 'crossfade',
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

  it('gives a new Scene the Crossfade Transition', async () => {
    const { campaign, scenes } = await setup();
    expect((await scenes.create(campaign.id, 'La cantina')).transition).toBe('crossfade');
  });

  it('keeps a Scene’s Transition after the storage is reopened (restart)', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'Embuscade');
    await scenes.save({ ...scene, transition: 'cut' });

    const reopened = createSceneLibrary(openStorage(root()));
    expect((await reopened.get(campaign.id, scene.id))?.transition).toBe('cut');
  });

  it('gives every Scene saved before Transitions (version 3) the Crossfade Transition', async () => {
    const { storage, campaign, scenes } = await setup();
    const {
      campaignId: _campaignId,
      transition: _transition,
      ...stored
    } = await scenes.create(campaign.id, 'La cantina');
    await fs.writeFile(
      path.join(storage.campaignFolder(campaign.id), 'scenes.json'),
      JSON.stringify({ schemaVersion: 3, scenes: [stored, { ...stored, id: 's2' }] }),
    );

    const migrated = await scenes.list(campaign.id);
    expect(migrated.map((scene) => scene.transition)).toEqual(['crossfade', 'crossfade']);
  });

  describe('a Scene whose stored Notes cannot be read', () => {
    /** Scenes Cantina (its Notes unreadable: a link) and Hangar, saved, then read afresh. */
    async function damaged() {
      const { storage, campaign } = await setup();
      const notices: string[] = [];
      const scenes = createSceneLibrary(storage, { notify: (text) => notices.push(text) });
      const cantina = await scenes.save({
        ...(await scenes.create(campaign.id, 'Cantina')),
        title: 'La cantina',
      });
      const hangar = await scenes.save({
        ...(await scenes.create(campaign.id, 'Hangar')),
        notes: notesFromPlainText('Garde à droite'),
      });
      const folder = storage.campaignFolder(campaign.id);
      const file = path.join(folder, 'scenes.json');
      const badNotes = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'link', text: 'Secret' }] }],
      };
      const stored = JSON.parse(await fs.readFile(file, 'utf8')) as {
        scenes: Record<string, unknown>[];
      };
      stored.scenes[0].notes = badNotes;
      await fs.writeFile(file, JSON.stringify(stored));
      return { campaign, scenes, notices, folder, cantina, hangar, badNotes };
    }

    it('keeps its other fields with empty Notes, and the other Scenes as they are', async () => {
      const { campaign, scenes, cantina, hangar } = await damaged();

      expect(await scenes.list(campaign.id)).toEqual([{ ...cantina, notes: emptyNotes() }, hangar]);
    });

    it('keeps the unreadable Notes in a file of the Campaign’s recovered folder, and says where, once', async () => {
      const { campaign, scenes, notices, folder, badNotes, cantina } = await damaged();

      await scenes.list(campaign.id);
      await scenes.list(campaign.id);

      const recovered = path.join(folder, RECOVERED_FOLDER);
      const kept = await fs.readdir(recovered);
      expect(kept).toEqual([expect.stringMatching(/^notes-illisibles-.*\.json$/)]);
      expect(JSON.parse(await fs.readFile(path.join(recovered, kept[0]), 'utf8'))).toEqual({
        sceneId: cantina.id,
        sceneName: 'Cantina',
        notes: badNotes,
      });
      expect(notices).toEqual([
        `Les notes de la scène « Cantina » étaient illisibles : elles sont vides. Leur contenu d’origine est gardé dans ${path.join(recovered, kept[0])}.`,
      ]);
      // Never at the top of the Campaign folder, where the Campaign's documents are.
      expect((await fs.readdir(folder)).filter((name) => name.startsWith('notes-'))).toEqual([
        RECOVERED_FOLDER,
      ]);
    });

    it('moves Notes kept at the top of the Campaign folder by an older version into the recovered folder', async () => {
      const { campaign, scenes, storage } = await setup();
      const folder = storage.campaignFolder(campaign.id);
      const old = 'notes-illisibles-cantina-1762000000000.json';
      await fs.writeFile(path.join(folder, old), '{"sceneName":"Cantina"}');

      await scenes.list(campaign.id);

      expect(await fs.readdir(path.join(folder, RECOVERED_FOLDER))).toEqual([old]);
      expect(await fs.readFile(path.join(folder, RECOVERED_FOLDER, old), 'utf8')).toBe(
        '{"sceneName":"Cantina"}',
      );
      expect((await fs.readdir(folder)).includes(old)).toBe(false);
    });
  });

  it('rejects a stored Scene with an unknown Transition', async () => {
    const { campaign, scenes } = await setup();
    const scene = await scenes.create(campaign.id, 'La cantina');
    expect(parseScene({ ...scene, transition: 'wipe' }, campaign.id)).toBeUndefined();
    expect(parseScene({ ...scene, transition: 'cut' }, campaign.id)).toEqual({
      ...scene,
      transition: 'cut',
    });
  });

  describe('running order', () => {
    const names = (list: Scene[]) => list.map((scene) => scene.name);
    const moveScene = (
      scenes: SceneLibrary,
      campaignId: string,
      sceneId: string,
      toIndex: number,
      chapterId: string | null = null,
    ) => scenes.editRunningOrder(campaignId, { kind: 'move-scene', sceneId, chapterId, toIndex });

    it('adds a new Scene at the end', async () => {
      const { campaign, scenes } = await setup();
      const first = await scenes.create(campaign.id, 'A');
      await scenes.create(campaign.id, 'B');
      await moveScene(scenes, campaign.id, first.id, 1);

      await scenes.create(campaign.id, 'C');

      expect(names(await scenes.list(campaign.id))).toEqual(['B', 'A', 'C']);
    });

    it('moves a Scene and keeps the order after the storage is reopened (restart)', async () => {
      const { campaign, scenes } = await setup();
      const [a, b, c] = [
        await scenes.create(campaign.id, 'A'),
        await scenes.create(campaign.id, 'B'),
        await scenes.create(campaign.id, 'C'),
      ];

      expect((await moveScene(scenes, campaign.id, c.id, 0)).sceneIds).toEqual([c.id, a.id, b.id]);
      await moveScene(scenes, campaign.id, a.id, 2);
      expect(names(await scenes.list(campaign.id))).toEqual(['C', 'B', 'A']);

      const reopened = createSceneLibrary(openStorage(root()));
      expect(names(await reopened.list(campaign.id))).toEqual(['C', 'B', 'A']);
    });

    it('changes no Scene when moving one, and saving a Scene keeps its place', async () => {
      const { campaign, scenes } = await setup();
      const a = await scenes.create(campaign.id, 'A');
      const b = await scenes.create(campaign.id, 'B');
      await moveScene(scenes, campaign.id, b.id, 0);

      await scenes.save({ ...a, title: 'Le vieux moulin' });

      expect(await scenes.list(campaign.id)).toEqual([b, { ...a, title: 'Le vieux moulin' }]);
    });

    it('refuses to move a Scene that no longer exists', async () => {
      const { campaign, scenes } = await setup();
      await scenes.create(campaign.id, 'A');
      await expect(moveScene(scenes, campaign.id, 'inconnue', 0)).rejects.toThrow(SceneError);
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

  describe('Chapters', () => {
    const names = (list: Scene[]) => list.map((scene) => scene.name);

    /** A Campaign with Scenes A, B, C, D, Chapters "Un" (A, B) and "Deux" (C), D in none. */
    async function withChapters() {
      const ctx = await setup();
      const { campaign, scenes } = ctx;
      const [a, b, c, d] = [
        await scenes.create(campaign.id, 'A'),
        await scenes.create(campaign.id, 'B'),
        await scenes.create(campaign.id, 'C'),
        await scenes.create(campaign.id, 'D'),
      ];
      const one = (
        await scenes.editRunningOrder(campaign.id, { kind: 'create-chapter', name: 'Un' })
      ).chapters[0];
      const two = (
        await scenes.editRunningOrder(campaign.id, { kind: 'create-chapter', name: ' Deux ' })
      ).chapters[1];
      for (const [scene, chapter] of [
        [a, one],
        [b, one],
        [c, two],
      ] as const) {
        await scenes.editRunningOrder(campaign.id, {
          kind: 'move-scene',
          sceneId: scene.id,
          chapterId: chapter.id,
          toIndex: 99,
        });
      }
      return { ...ctx, a, b, c, d, one, two };
    }

    it('starts with none in a new Campaign', async () => {
      const { campaign, scenes } = await setup();
      const a = await scenes.create(campaign.id, 'A');

      expect(await scenes.runningOrder(campaign.id)).toEqual({ sceneIds: [a.id], chapters: [] });
    });

    it('keeps Chapters, their Scenes and their collapsed state after a restart', async () => {
      const { campaign, scenes, a, b, c, d, one, two } = await withChapters();
      await scenes.editRunningOrder(campaign.id, {
        kind: 'set-chapter-collapsed',
        chapterId: one.id,
        collapsed: true,
      });

      const reopened = createSceneLibrary(openStorage(root()));

      expect(await reopened.runningOrder(campaign.id)).toEqual({
        sceneIds: [a.id, b.id, c.id, d.id],
        chapters: [
          { id: one.id, name: 'Un', collapsed: true, sceneIds: [a.id, b.id] },
          { id: two.id, name: 'Deux', collapsed: false, sceneIds: [c.id] },
        ],
      });
      expect(names(await reopened.list(campaign.id))).toEqual(['A', 'B', 'C', 'D']);
    });

    it('lists the Scenes of a reordered Chapter in their new running order', async () => {
      const { campaign, scenes, two } = await withChapters();

      await scenes.editRunningOrder(campaign.id, {
        kind: 'move-chapter',
        chapterId: two.id,
        toIndex: 0,
      });

      expect(names(await scenes.list(campaign.id))).toEqual(['C', 'A', 'B', 'D']);
    });

    it('deleting a Chapter keeps every Scene', async () => {
      const { campaign, scenes, one } = await withChapters();

      await scenes.editRunningOrder(campaign.id, { kind: 'delete-chapter', chapterId: one.id });

      expect(names(await scenes.list(campaign.id))).toEqual(['C', 'A', 'B', 'D']);
      expect((await scenes.runningOrder(campaign.id)).chapters.map((c) => c.name)).toEqual([
        'Deux',
      ]);
    });

    it('a deleted Scene leaves its Chapter', async () => {
      const { campaign, scenes, a, b, one } = await withChapters();

      await scenes.delete(campaign.id, a.id);

      const { chapters } = await scenes.runningOrder(campaign.id);
      expect(chapters.find((chapter) => chapter.id === one.id)?.sceneIds).toEqual([b.id]);
    });

    it('puts a new Scene last in the Chapter of the Selected Scene, or last in none', async () => {
      const { campaign, scenes, a, d } = await withChapters();

      await scenes.create(campaign.id, 'E', a.id);
      await scenes.create(campaign.id, 'F', d.id);
      await scenes.create(campaign.id, 'G');

      expect(names(await scenes.list(campaign.id))).toEqual(['A', 'B', 'E', 'C', 'D', 'F', 'G']);
    });

    it('puts a copy right after its source, in its Chapter', async () => {
      const { campaign, scenes, a, one } = await withChapters();

      const copy = await scenes.duplicate(campaign.id, a.id);

      expect(names(await scenes.list(campaign.id))).toEqual(['A', 'A (copie)', 'B', 'C', 'D']);
      const { chapters } = await scenes.runningOrder(campaign.id);
      expect(chapters.find((chapter) => chapter.id === one.id)?.sceneIds).toContain(copy.id);
    });

    it('changes no Scene: a Scene saved after a Chapter change keeps its Chapter', async () => {
      const { campaign, scenes, a, one } = await withChapters();
      const before = await scenes.get(campaign.id, a.id);

      await scenes.editRunningOrder(campaign.id, {
        kind: 'rename-chapter',
        chapterId: one.id,
        name: 'Prologue',
      });
      await scenes.save({ ...a, title: 'Le vieux moulin' });

      expect(await scenes.get(campaign.id, a.id)).toEqual({ ...before, title: 'Le vieux moulin' });
      const { chapters } = await scenes.runningOrder(campaign.id);
      expect(chapters[0]).toMatchObject({ name: 'Prologue', sceneIds: [a.id, expect.any(String)] });
    });

    it('refuses a Chapter that no longer exists, and an empty name', async () => {
      const { campaign, scenes } = await withChapters();

      await expect(
        scenes.editRunningOrder(campaign.id, { kind: 'delete-chapter', chapterId: 'inconnu' }),
      ).rejects.toThrow(SceneError);
      await expect(
        scenes.editRunningOrder(campaign.id, { kind: 'create-chapter', name: '  ' }),
      ).rejects.toThrow(SceneError);
    });

    it('gives a Campaign saved before Chapters (version 4) none, its order unchanged', async () => {
      const { storage, campaign, scenes } = await setup();
      const { campaignId: _campaignId, ...stored } = await scenes.create(campaign.id, 'x');
      const file = path.join(storage.campaignFolder(campaign.id), 'scenes.json');
      await fs.writeFile(
        file,
        JSON.stringify({
          schemaVersion: 4,
          scenes: ['Zéro', 'Alpha'].map((name, i) => ({ ...stored, id: `s${i}`, name })),
        }),
      );

      expect(await scenes.runningOrder(campaign.id)).toEqual({
        sceneIds: ['s0', 's1'],
        chapters: [],
      });
      await scenes.create(campaign.id, 'Milieu');
      const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      expect(saved).toMatchObject({ schemaVersion: 5, chapters: [] });
    });

    it('reads stored Scenes in the order of their Chapters, dropping unknown Scenes from Chapters', async () => {
      const { storage, campaign, scenes } = await setup();
      const { campaignId: _campaignId, ...stored } = await scenes.create(campaign.id, 'x');
      await fs.writeFile(
        path.join(storage.campaignFolder(campaign.id), 'scenes.json'),
        JSON.stringify({
          schemaVersion: 5,
          scenes: ['A', 'B', 'C'].map((name) => ({ ...stored, id: name, name })),
          chapters: [
            { id: 'un', name: 'Un', collapsed: false, sceneIds: ['C', 'disparue'] },
            { id: 'deux', name: 'Deux', collapsed: true, sceneIds: ['C', 'A'] },
          ],
        }),
      );

      expect(await scenes.runningOrder(campaign.id)).toEqual({
        sceneIds: ['C', 'A', 'B'],
        chapters: [
          { id: 'un', name: 'Un', collapsed: false, sceneIds: ['C'] },
          { id: 'deux', name: 'Deux', collapsed: true, sceneIds: ['A'] },
        ],
      });
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

  describe('duplicating a Scene', () => {
    const names = (list: Scene[]) => list.map((scene) => scene.name);

    it('inserts the copy right after its source and keeps it after a restart', async () => {
      const { campaign, scenes } = await setup();
      const a = await scenes.create(campaign.id, 'A');
      const b = await scenes.create(campaign.id, 'B');
      await scenes.save({ ...b, title: 'Le vieux moulin' });

      const copy = await scenes.duplicate(campaign.id, a.id);

      expect(copy).toEqual({ ...a, id: expect.any(String), name: 'A (copie)' });
      expect(copy.id).not.toBe(a.id);
      expect(names(await scenes.list(campaign.id))).toEqual(['A', 'A (copie)', 'B']);
      const reopened = createSceneLibrary(openStorage(root()));
      expect(await reopened.get(campaign.id, copy.id)).toEqual(copy);
      expect(await reopened.get(campaign.id, a.id)).toEqual(a);
    });

    it('copies the last Scene to the end, and a copy of a copy right after that copy', async () => {
      const { campaign, scenes } = await setup();
      const a = await scenes.create(campaign.id, 'A');
      const b = await scenes.create(campaign.id, 'B');
      const copy = await scenes.duplicate(campaign.id, a.id);

      await scenes.duplicate(campaign.id, copy.id);
      await scenes.duplicate(campaign.id, b.id);

      expect(names(await scenes.list(campaign.id))).toEqual([
        'A',
        'A (copie)',
        'A (copie) (copie)',
        'B',
        'B (copie)',
      ]);
    });

    it('refuses to duplicate a Scene that no longer exists', async () => {
      const { campaign, scenes } = await setup();
      await expect(scenes.duplicate(campaign.id, 'inconnue')).rejects.toThrow(
        'Cette scène n’existe plus.',
      );
    });
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
    transition: 'cut',
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

describe('copy of a Scene', () => {
  /** A Scene with every field set to something other than a new Scene's default. */
  const source: Scene = {
    id: 'cantina',
    campaignId: 'c1',
    name: 'La cantina',
    title: 'Le vieux moulin',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'contain', zoom: 2, focus: { x: 0, y: 1 }, visible: true },
      { id: 'b2', mediaId: 'm2', fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 }, visible: false },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm3',
        position: { x: 0.25, y: 0.75 },
        height: 0.4,
        visible: false,
        label: { text: 'Garde', visible: true },
      },
      { id: 'o2', mediaId: 'm3', position: { x: 0.5, y: 0.5 }, height: 0.2, visible: true },
    ],
    music: ['m4', 'm5'],
    ambiences: [
      { mediaId: 'm6', on: true, volume: 0.3 },
      { mediaId: 'm7', on: false, volume: 1 },
    ],
    volumes: { music: 0.5, ambience: 0.8 },
    transition: 'cut',
    notes: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Indices' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Le traître', marks: [{ type: 'bold' }] }],
        },
        // A Notes image (#52): a reference to a Media, copied as the same reference, at the
        // same size (#53).
        { type: 'image', attrs: { mediaId: 'm8', width: 40 } },
      ],
    },
  };

  /**
   * How a copy gets each Scene field. The compiler checks that every field is named, so a new
   * Scene field fails typecheck here until someone decides; the tests below then check the copy
   * has it and shares no object with the source through it.
   */
  const sceneFieldInCopy = {
    id: 'new',
    campaignId: 'same',
    name: 'named as a copy',
    title: 'same',
    backgrounds: 'same but new placement ids',
    overlays: 'same but new placement ids',
    music: 'same',
    ambiences: 'same',
    volumes: 'same',
    notes: 'same',
    transition: 'same',
  } as const satisfies Record<keyof Scene, string>;

  let ids = 0;
  const copy = copyOfScene(source, () => `new-${++ids}`);

  /** Every object and array inside a value, the value included. */
  function objectsIn(value: unknown, found: object[] = []): object[] {
    if (typeof value !== 'object' || value === null) return found;
    found.push(value);
    for (const item of Object.values(value)) objectsIn(item, found);
    return found;
  }

  it('decides how a copy gets every Scene field, and copies every field', () => {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
    expect(Object.keys(sceneFieldInCopy).sort()).toEqual(Object.keys(source).sort());
    for (const [field, rule] of Object.entries(sceneFieldInCopy)) {
      const key = field as keyof Scene;
      if (rule === 'same') expect(copy[key], field).toEqual(source[key]);
    }
  });

  it('shares no object or array with its source, at any depth', () => {
    const sourceObjects = new Set(objectsIn(source));
    for (const field of Object.keys(source) as (keyof Scene)[]) {
      for (const object of objectsIn(copy[field])) {
        expect(sourceObjects.has(object), `${field} shares an object with the source`).toBe(false);
      }
    }
  });

  it('gets a new Scene id and new placement ids, keeping the same Media', () => {
    expect(copy.id).not.toBe(source.id);
    const placementIds = [...copy.backgrounds, ...copy.overlays].map((item) => item.id);
    const sourceIds = [...source.backgrounds, ...source.overlays].map((item) => item.id);
    expect(new Set([copy.id, ...placementIds]).size).toBe(placementIds.length + 1);
    for (const id of placementIds) expect(sourceIds).not.toContain(id);
    const withoutId = ({ id: _id, ...placement }: { id: string }) => placement;
    expect(copy.backgrounds.map(withoutId)).toEqual(source.backgrounds.map(withoutId));
    expect(copy.overlays.map(withoutId)).toEqual(source.overlays.map(withoutId));
    expect(copy.notes.content.at(-1)).toEqual({
      type: 'image',
      attrs: { mediaId: 'm8', width: 40 },
    });
  });

  it('is named "<name> (copie)", shortening a long name to fit the name limit', () => {
    expect(copy.name).toBe('La cantina (copie)');
    const long = copyOfScene({ ...source, name: 'x'.repeat(MAX_SCENE_NAME_LENGTH) }, () => 'n');
    expect(long.name).toHaveLength(MAX_SCENE_NAME_LENGTH);
    expect(long.name.endsWith('x (copie)')).toBe(true);
  });

  it('leaves the source unchanged when the copy is edited', () => {
    const before = structuredClone(source);
    const edited = copyOfScene(source, () => 'n');
    edited.backgrounds[0].focus.x = 1;
    edited.overlays[0].label = { text: 'Autre', visible: false };
    edited.music.push('m9');
    edited.ambiences[0].on = false;
    edited.volumes.music = 0;
    edited.notes.content.pop();
    expect(source).toEqual(before);
  });
});
