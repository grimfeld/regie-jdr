import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../core/campaigns';
import { createMediaLibrary } from '../../core/media';
import { createOnAir } from '../../core/onAir';
import { createOnAirCommands } from '../../core/onAirCommands';
import { addBackground, setBackgroundVisible } from '../../core/sceneEdits';
import { createSceneLibrary } from '../../core/scenes';
import { openStorage } from '../../core/storage';
import type { OnAirState } from '../../shared/domain';
import { useTempDir } from './tempDir';

// SHA-256 of the three bytes "abc" (FIPS 180-2 test vector).
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('on-air commands', () => {
  const dir = useTempDir();

  async function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const library = createMediaLibrary(storage);
    const scenes = createSceneLibrary(storage);
    const onAir = createOnAir();
    const broadcast: OnAirState[] = [];
    onAir.subscribe((snapshot) => broadcast.push(snapshot));
    let audioHalts = 0;
    const commands = createOnAirCommands({
      campaigns: storage.campaigns,
      library,
      scenes,
      onAir,
      audio: { halt: () => void audioHalts++ },
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

  /** A Scene with the imported image as a visible Background. */
  async function sceneShowing(ctx: Awaited<ReturnType<typeof setup>>, name: string) {
    const created = await ctx.scenes.create(ctx.campaign.id, name);
    const withBackground = addBackground(created, ctx.image.id, `bg-${name}`);
    return ctx.scenes.save(setBackgroundVisible(withBackground, `bg-${name}`, true));
  }

  const cantinaPicture = {
    backgrounds: [
      {
        id: 'bg-Cantina',
        src: expect.stringContaining(`${ABC_SHA256}.png`),
        fit: 'cover',
        position: { x: 0.5, y: 0.5 },
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

    const hidden = await ctx.commands.updateScene(addBackground(scene, ctx.image.id, 'bg-Cantina'));
    // A new Background starts Hidden: nothing new reaches the broadcast.
    expect(ctx.broadcast.at(-1)?.scene).toEqual({ backgrounds: [], overlays: [] });
    await ctx.commands.updateScene(setBackgroundVisible(hidden, 'bg-Cantina', true));

    expect(ctx.broadcast.at(-1)).toEqual({
      campaignId: ctx.campaign.id,
      activeSceneId: scene.id,
      scene: cantinaPicture,
      version: 4,
    });
    expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.backgrounds).toEqual([
      expect.objectContaining({ id: 'bg-Cantina', visible: true }),
    ]);
  });

  it('editing another Scene saves it and never changes the broadcast', async () => {
    const ctx = await setup();
    const active = await sceneShowing(ctx, 'Cantina');
    const other = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(active.id);
    const sent = ctx.broadcast.length;

    const edited = setBackgroundVisible(addBackground(other, ctx.image.id, 'b'), 'b', true);
    await ctx.commands.updateScene(edited);

    expect(ctx.broadcast.length).toBe(sent);
    expect(await ctx.scenes.get(ctx.campaign.id, other.id)).toEqual(edited);
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
    await expect(ctx.commands.activateScene(scene.id)).rejects.toThrow(
      'Ouvrez une campagne avant d’activer une scène.',
    );
    await ctx.commands.openCampaign(ctx.campaign.id);
    await expect(ctx.commands.activateScene('inconnue')).rejects.toThrow(
      'Cette scène n’existe plus.',
    );
    expect(ctx.broadcast.map((s) => s.version)).toEqual([1]);
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
