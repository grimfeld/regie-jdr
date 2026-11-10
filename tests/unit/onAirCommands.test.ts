import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignError, createCampaign } from '../../core/campaigns';
import { createMediaLibrary } from '../../core/media';
import { createOnAir } from '../../core/onAir';
import { createOnAirCommands } from '../../core/onAirCommands';
import { createSceneLibrary } from '../../core/scenes';
import { openStorage } from '../../core/storage';
import type { SceneEdit } from '../../shared/contract';
import type { OnAirState } from '../../shared/domain';
import { fakeResizer } from './fakeResizer';
import { useTempDir } from './tempDir';

// SHA-256 of the three bytes "abc" (FIPS 180-2 test vector).
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('on-air commands', () => {
  const dir = useTempDir();

  async function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const library = createMediaLibrary(storage, fakeResizer().resizer);
    const scenes = createSceneLibrary(storage);
    const onAir = createOnAir();
    const broadcast: OnAirState[] = [];
    onAir.subscribe((snapshot) => broadcast.push(snapshot));
    let audioHalts = 0;
    let placements = 0;
    const commands = createOnAirCommands({
      campaigns: storage.campaigns,
      library,
      scenes,
      onAir,
      audio: {
        halt: () => {
          audioHalts++;
        },
      },
      newId: () => `p${++placements}`,
    });
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const picked = path.join(dir.path, 'Cantina.png');
    await fs.writeFile(picked, 'abc');
    const [image] = (await library.import(campaign.id, [picked], { accept: 'image' })).imported;
    return {
      storage,
      library,
      scenes,
      commands,
      campaign,
      image,
      broadcast,
      audioHalts: () => audioHalts,
    };
  }

  /** A Scene with the imported image as a visible Background `bg-<name>`. */
  async function sceneShowing(ctx: Awaited<ReturnType<typeof setup>>, name: string) {
    const created = await ctx.scenes.create(ctx.campaign.id, name);
    return ctx.scenes.save({
      ...created,
      backgrounds: [
        {
          id: `bg-${name}`,
          mediaId: ctx.image.id,
          fit: 'cover',
          zoom: 1,
          focus: { x: 0.5, y: 0.5 },
          visible: true,
        },
      ],
    });
  }

  const cantinaPicture = {
    backgrounds: [
      {
        id: 'bg-Cantina',
        src: expect.stringContaining(`${ABC_SHA256}.png`),
        fit: 'cover',
        zoom: 1,
        focus: { x: 0.5, y: 0.5 },
      },
    ],
    overlays: [],
  };

  it('Activating a Scene puts its picture on air', async () => {
    const ctx = await setup();
    const scene = await sceneShowing(ctx, 'Cantina');
    await ctx.commands.openCampaign(ctx.campaign.id);

    const state = await ctx.commands.activateScene(scene.id);

    expect(state).toEqual({
      campaignId: ctx.campaign.id,
      activeSceneId: scene.id,
      scene: cantinaPicture,
      blackout: false,
      version: 2,
    });
    expect(ctx.broadcast.at(-1)).toEqual(state);
  });

  it('editing the Active Scene saves it and updates the broadcast', async () => {
    const ctx = await setup();
    const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(scene.id);
    expect(ctx.broadcast.at(-1)?.scene).toEqual({ backgrounds: [], overlays: [] });
    const edit = (command: SceneEdit) => ctx.commands.editScene(ctx.campaign.id, scene.id, command);

    const placed = await edit({ kind: 'place-background', mediaId: ctx.image.id });
    // A new Background starts Hidden: nothing new reaches the broadcast.
    expect(placed.backgrounds).toEqual([expect.objectContaining({ id: 'p1', visible: false })]);
    expect(ctx.broadcast.at(-1)?.scene).toEqual({ backgrounds: [], overlays: [] });
    const shown = await edit({ kind: 'set-visible', placementId: 'p1', visible: true });

    expect(ctx.broadcast.at(-1)).toEqual({
      campaignId: ctx.campaign.id,
      activeSceneId: scene.id,
      scene: {
        ...cantinaPicture,
        backgrounds: [{ ...cantinaPicture.backgrounds[0], id: 'p1' }],
      },
      blackout: false,
      version: 4,
    });
    expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(shown);
  });

  it('places Overlays above every Background', async () => {
    const ctx = await setup();
    const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
    const edit = (command: SceneEdit) => ctx.commands.editScene(ctx.campaign.id, scene.id, command);
    await edit({ kind: 'place-overlay', mediaId: ctx.image.id, position: { x: 0.25, y: 0.5 } });
    await edit({ kind: 'place-background', mediaId: ctx.image.id });
    for (const placementId of ['p1', 'p2']) {
      await edit({ kind: 'set-visible', placementId, visible: true });
    }
    await ctx.commands.openCampaign(ctx.campaign.id);

    const { scene: picture } = await ctx.commands.activateScene(scene.id);

    expect(picture?.backgrounds.map((item) => item.id)).toEqual(['p2']);
    expect(picture?.overlays).toEqual([
      { id: 'p1', src: expect.any(String), position: { x: 0.25, y: 0.5 }, height: 0.5 },
    ]);
  });

  it('showing, hiding and removing an Overlay of the Active Scene updates the broadcast', async () => {
    const ctx = await setup();
    const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(scene.id);
    const edit = (command: SceneEdit) => ctx.commands.editScene(ctx.campaign.id, scene.id, command);
    const onAirOverlays = () => ctx.broadcast.at(-1)?.scene?.overlays.map((item) => item.id);

    await edit({ kind: 'place-overlay', mediaId: ctx.image.id });
    await edit({ kind: 'place-overlay', mediaId: ctx.image.id });
    expect(onAirOverlays()).toEqual([]);
    await edit({ kind: 'set-visible', placementId: 'p1', visible: true });
    await edit({ kind: 'set-visible', placementId: 'p2', visible: true });
    expect(onAirOverlays()).toEqual(['p1', 'p2']);
    await edit({ kind: 'set-visible', placementId: 'p1', visible: false });
    expect(onAirOverlays()).toEqual(['p2']);
    const removed = await edit({ kind: 'remove-placement', placementId: 'p2' });

    expect(onAirOverlays()).toEqual([]);
    expect(removed.overlays.map((item) => item.id)).toEqual(['p1']);
    expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(removed);
  });

  it('editing another Scene saves it and never changes the broadcast', async () => {
    const ctx = await setup();
    const active = await sceneShowing(ctx, 'Cantina');
    const other = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(active.id);
    const sent = ctx.broadcast.length;

    await ctx.commands.editScene(ctx.campaign.id, other.id, {
      kind: 'place-background',
      mediaId: ctx.image.id,
    });
    const edited = await ctx.commands.editScene(ctx.campaign.id, other.id, {
      kind: 'set-visible',
      placementId: 'p1',
      visible: true,
    });

    expect(ctx.broadcast.length).toBe(sent);
    expect(await ctx.scenes.get(ctx.campaign.id, other.id)).toEqual(edited);
  });

  it('refuses to edit a Scene that does not exist, or to place unknown Media', async () => {
    const ctx = await setup();
    const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
    const place = { kind: 'place-overlay', mediaId: ctx.image.id } as const;

    await expect(ctx.commands.editScene(ctx.campaign.id, 'inconnue', place)).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
    await expect(
      ctx.commands.editScene(ctx.campaign.id, scene.id, { ...place, mediaId: 'inconnu' }),
    ).rejects.toThrow('Ce média n’existe plus.');
    expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(scene);
  });

  it('opening a Campaign puts nothing on air and stops audio; switching clears the broadcast', async () => {
    const ctx = await setup();
    const scene = await sceneShowing(ctx, 'Cantina');
    const other = await createCampaign(ctx.storage.campaigns, 'Warhammer');

    expect(await ctx.commands.openCampaign(ctx.campaign.id)).toMatchObject({
      activeSceneId: null,
      scene: null,
    });
    expect(ctx.audioHalts()).toBe(1);
    await ctx.commands.activateScene(scene.id);

    expect(await ctx.commands.openCampaign(other.id)).toMatchObject({
      campaignId: other.id,
      activeSceneId: null,
      scene: null,
    });
    expect(ctx.audioHalts()).toBe(2);
    expect(await ctx.commands.closeCampaign()).toMatchObject({ campaignId: null, scene: null });
    expect(ctx.audioHalts()).toBe(3);
  });

  it('refuses unknown Campaigns and Scenes, and Activating with no Campaign open', async () => {
    const ctx = await setup();
    const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');

    await expect(ctx.commands.openCampaign('inconnue')).rejects.toThrow(
      'Cette campagne n’existe plus.',
    );
    await expect(ctx.commands.openCampaign('inconnue')).rejects.toBeInstanceOf(CampaignError);
    await expect(ctx.commands.activateScene(scene.id)).rejects.toThrow(
      'Ouvrez une campagne avant d’activer une scène.',
    );
    await ctx.commands.openCampaign(ctx.campaign.id);
    await expect(ctx.commands.activateScene('inconnue')).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
    expect(ctx.broadcast.map((s) => s.version)).toEqual([1]);
  });

  it('renames a Scene; on the Active Scene the broadcast carries no Scene name', async () => {
    const ctx = await setup();
    const scene = await sceneShowing(ctx, 'Cantina');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(scene.id);

    const renamed = await ctx.commands.editScene(ctx.campaign.id, scene.id, {
      kind: 'rename',
      name: 'Embuscade',
    });

    expect(renamed).toEqual({ ...scene, name: 'Embuscade' });
    expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(renamed);
    expect(JSON.stringify(ctx.broadcast)).not.toContain('Embuscade');
  });

  describe('deleting a Scene', () => {
    it('deletes a Scene that is not active, leaving the broadcast alone', async () => {
      const ctx = await setup();
      const active = await sceneShowing(ctx, 'Cantina');
      const other = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(active.id);
      const sent = ctx.broadcast.length;

      await ctx.commands.deleteScene(ctx.campaign.id, other.id);

      expect(await ctx.scenes.list(ctx.campaign.id)).toEqual([active]);
      expect(ctx.broadcast.length).toBe(sent);
    });

    it('deleting the Active Scene clears the Active Scene and the broadcast', async () => {
      const ctx = await setup();
      const active = await sceneShowing(ctx, 'Cantina');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(active.id);

      await ctx.commands.deleteScene(ctx.campaign.id, active.id);

      expect(await ctx.scenes.list(ctx.campaign.id)).toEqual([]);
      expect(ctx.broadcast.at(-1)).toEqual({
        campaignId: ctx.campaign.id,
        activeSceneId: null,
        scene: null,
        blackout: false,
        version: 3,
      });
    });

    it('refuses a Scene that no longer exists', async () => {
      const ctx = await setup();
      await expect(ctx.commands.deleteScene(ctx.campaign.id, 'inconnue')).rejects.toThrow(
        'Cette scène n’existe plus.',
      );
    });
  });

  describe('deleting Media', () => {
    const mediaFiles = (ctx: Awaited<ReturnType<typeof setup>>) =>
      fs.readdir(path.join(ctx.storage.campaignFolder(ctx.campaign.id), 'media'));

    it('deletes unused Media and its file at once', async () => {
      const ctx = await setup();
      await ctx.scenes.create(ctx.campaign.id, 'Hangar');

      expect(await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, false)).toEqual({
        deleted: true,
        affectedScenes: [],
      });

      expect(await ctx.library.list(ctx.campaign.id)).toEqual([]);
      expect(await mediaFiles(ctx)).toEqual([]);
    });

    it('lists the Scenes using the Media and changes nothing until confirmed', async () => {
      const ctx = await setup();
      const cantina = await sceneShowing(ctx, 'Cantina');
      const hangar = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(cantina.id);
      const sent = ctx.broadcast.length;

      expect(await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, false)).toEqual({
        deleted: false,
        affectedScenes: [{ id: cantina.id, name: 'Cantina' }],
      });

      expect(await ctx.library.list(ctx.campaign.id)).toEqual([ctx.image]);
      expect(await mediaFiles(ctx)).toEqual([`${ABC_SHA256}.png`]);
      expect(await ctx.scenes.list(ctx.campaign.id)).toEqual([cantina, hangar]);
      expect(ctx.broadcast.length).toBe(sent);
    });

    it('on confirmation removes the Media, its file and its placements; the broadcast drops it', async () => {
      const ctx = await setup();
      const cantina = await sceneShowing(ctx, 'Cantina');
      const hangar = await sceneShowing(ctx, 'Hangar');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(cantina.id);
      expect(ctx.broadcast.at(-1)?.scene).toEqual(cantinaPicture);

      expect(await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, true)).toEqual({
        deleted: true,
        affectedScenes: [
          { id: cantina.id, name: 'Cantina' },
          { id: hangar.id, name: 'Hangar' },
        ],
      });

      expect(await ctx.library.list(ctx.campaign.id)).toEqual([]);
      expect(await mediaFiles(ctx)).toEqual([]);
      expect(await ctx.scenes.list(ctx.campaign.id)).toEqual([
        { ...cantina, backgrounds: [] },
        { ...hangar, backgrounds: [] },
      ]);
      expect(ctx.broadcast.at(-1)).toEqual({
        campaignId: ctx.campaign.id,
        activeSceneId: cantina.id,
        scene: { backgrounds: [], overlays: [] },
        blackout: false,
        version: 3,
      });
    });

    it('leaves the broadcast alone when the Active Scene did not use the Media', async () => {
      const ctx = await setup();
      await sceneShowing(ctx, 'Cantina');
      const hangar = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(hangar.id);
      const sent = ctx.broadcast.length;

      await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, true);

      expect(ctx.broadcast.length).toBe(sent);
    });

    it('refuses Media that no longer exists', async () => {
      const ctx = await setup();

      await expect(ctx.commands.deleteMedia(ctx.campaign.id, 'gone', true)).rejects.toThrow(
        'Ce média n’existe plus.',
      );
    });
  });

  describe('Blackout', () => {
    it('blacks out the broadcast and leaves the Active Scene as it is', async () => {
      const ctx = await setup();
      const scene = await sceneShowing(ctx, 'Cantina');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      const state = await ctx.commands.setBlackout(true);

      expect(state).toEqual({
        campaignId: ctx.campaign.id,
        activeSceneId: scene.id,
        scene: cantinaPicture,
        blackout: true,
        version: 3,
      });
      expect(ctx.broadcast.at(-1)).toEqual(state);
      expect(await ctx.commands.setBlackout(false)).toMatchObject({
        activeSceneId: scene.id,
        scene: cantinaPicture,
        blackout: false,
      });
    });

    it('keeps edits made during Blackout, shown once it ends', async () => {
      const ctx = await setup();
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);
      await ctx.commands.setBlackout(true);
      const edit = (command: SceneEdit) =>
        ctx.commands.editScene(ctx.campaign.id, scene.id, command);

      await edit({ kind: 'place-background', mediaId: ctx.image.id });
      await edit({ kind: 'set-visible', placementId: 'p1', visible: true });

      expect(ctx.broadcast.at(-1)).toMatchObject({ blackout: true });
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.backgrounds).toEqual([
        expect.objectContaining({ id: 'p1', visible: true }),
      ]);
      const ended = await ctx.commands.setBlackout(false);
      expect(ended.scene?.backgrounds).toEqual([expect.objectContaining({ id: 'p1' })]);
    });

    it('stays on when another Scene is Activated', async () => {
      const ctx = await setup();
      const cantina = await sceneShowing(ctx, 'Cantina');
      const hangar = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(cantina.id);
      await ctx.commands.setBlackout(true);

      expect(await ctx.commands.activateScene(hangar.id)).toMatchObject({
        activeSceneId: hangar.id,
        blackout: true,
      });
    });

    it('is cleared when a Campaign is opened, switched or closed', async () => {
      const ctx = await setup();
      const other = await createCampaign(ctx.storage.campaigns, 'Warhammer');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.setBlackout(true);
      expect((await ctx.commands.openCampaign(other.id)).blackout).toBe(false);
      await ctx.commands.setBlackout(true);
      expect((await ctx.commands.closeCampaign()).blackout).toBe(false);
    });

    it('is refused when no Campaign is open', async () => {
      const ctx = await setup();

      await expect(ctx.commands.setBlackout(true)).rejects.toThrow(CampaignError);
      expect(ctx.broadcast).toEqual([]);
    });
  });

  it('does not put a Scene of another Campaign on air', async () => {
    const ctx = await setup();
    const scene = await sceneShowing(ctx, 'Cantina');
    const other = await createCampaign(ctx.storage.campaigns, 'Warhammer');
    await ctx.commands.openCampaign(other.id);
    await expect(ctx.commands.activateScene(scene.id)).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
  });
});
