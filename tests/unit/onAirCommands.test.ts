import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignError, createCampaign } from '../../core/campaigns';
import { createAudioOnAir } from '../../core/audioOnAir';
import { AUDIO_FADE_MS } from '../../core/fades';
import { createMediaLibrary } from '../../core/media';
import { mediaFileName } from '../../core/mediaAddress';
import { createOnAir } from '../../core/onAir';
import { createOnAirCommands } from '../../core/onAirCommands';
import { createSceneLibrary } from '../../core/scenes';
import { openStorage } from '../../core/storage';
import type { SceneEdit } from '../../shared/contract';
import type { AudioMix, Media, OnAirState } from '../../shared/domain';
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
    const audio = createAudioOnAir();
    const mixes: AudioMix[] = [];
    audio.subscribe((mix) => mixes.push(mix));
    let placements = 0;
    // When set, the commands' Scene saves fail, as on a full or read-only disk.
    let saveFailure: Error | undefined;
    const commands = createOnAirCommands({
      campaigns: storage.campaigns,
      library,
      scenes: {
        ...scenes,
        save: (scene) => (saveFailure ? Promise.reject(saveFailure) : scenes.save(scene)),
      },
      onAir,
      audio,
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
      audio,
      mixes,
      failSaves: (failure: Error | undefined) => {
        saveFailure = failure;
      },
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
      fadeDurationMs: 600,
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
      fadeDurationMs: 600,
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
    await ctx.commands.activateScene(scene.id);

    expect(await ctx.commands.openCampaign(other.id)).toMatchObject({
      campaignId: other.id,
      activeSceneId: null,
      scene: null,
    });
    expect(await ctx.commands.closeCampaign()).toMatchObject({ campaignId: null, scene: null });
  });

  describe('audio', () => {
    /** The on-air commands with two Music Media in the library, Taverne then Bagarre. */
    async function setupWithMusic() {
      const ctx = await setup();
      const tracks = await Promise.all(
        ['Taverne', 'Bagarre'].map(async (name) => {
          const file = path.join(dir.path, `${name}.ogg`);
          await fs.writeFile(file, name);
          return file;
        }),
      );
      const { imported } = await ctx.library.import(ctx.campaign.id, tracks, {
        accept: 'audio',
        role: 'music',
      });
      return { ...ctx, music: imported };
    }

    /** A Scene with both Music Media listed, Taverne first. */
    async function withMusic(ctx: Awaited<ReturnType<typeof setupWithMusic>>, name = 'Taverne') {
      const created = await ctx.scenes.create(ctx.campaign.id, name);
      return ctx.scenes.save({ ...created, music: ctx.music.map((m) => m.id) });
    }
    const voices = (mix: AudioMix | undefined) =>
      mix?.voices.map(({ mediaId, playing }) => ({ mediaId, playing }));

    it('Activating a Scene plays its first Music, fading in', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);

      await ctx.commands.activateScene(scene.id);

      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[0].id, playing: true }]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.activate);
      expect(ctx.mixes).toHaveLength(1);
    });

    it('opening, switching or closing a Campaign stops audio', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      const other = await createCampaign(ctx.storage.campaigns, 'Warhammer');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      await ctx.commands.openCampaign(other.id);
      expect(ctx.audio.mix().voices).toEqual([]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.stop);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);
      await ctx.commands.closeCampaign();
      expect(ctx.audio.mix().voices).toEqual([]);
    });

    it('nothing plays in a fresh audio state, as after a restart', () => {
      expect(createAudioOnAir().mix()).toEqual({
        voices: [],
        missing: [],
        fadeMs: 0,
        version: 0,
      });
    });

    it('adding Music saves it in the Scene and makes no sound, Active or not', async () => {
      const ctx = await setupWithMusic();
      const empty = await ctx.scenes.create(ctx.campaign.id, 'Vide');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(empty.id);

      const saved = await ctx.commands.editScene(ctx.campaign.id, empty.id, {
        kind: 'add-music',
        mediaId: ctx.music[1].id,
      });

      expect(saved.music).toEqual([ctx.music[1].id]);
      expect(await ctx.scenes.get(ctx.campaign.id, empty.id)).toEqual(saved);
      expect(ctx.mixes).toEqual([]);
    });

    it('refuses to add an image or a missing Media to the Music list', async () => {
      const ctx = await setupWithMusic();
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Vide');
      const add = (mediaId: string) =>
        ctx.commands.editScene(ctx.campaign.id, scene.id, { kind: 'add-music', mediaId });

      await expect(add(ctx.image.id)).rejects.toThrow(
        'Seule une musique peut aller dans la liste des musiques.',
      );
      await expect(add('inconnu')).rejects.toThrow('Ce média n’existe plus.');
    });

    it('a picture edit of the Active Scene keeps the Music playing, with no new mix', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      await ctx.commands.editScene(ctx.campaign.id, scene.id, { kind: 'set-title', title: 'Nuit' });

      expect(ctx.mixes).toHaveLength(1);
    });

    it('deleting the Active Scene stops its audio', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      await ctx.commands.deleteScene(ctx.campaign.id, scene.id);

      expect(ctx.audio.mix().voices).toEqual([]);
    });

    it('deleting the current Music stops it on air', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      await ctx.commands.deleteMedia(ctx.campaign.id, ctx.music[0].id, true);

      expect(ctx.audio.mix().voices).toEqual([]);
    });

    describe('a file missing on disk', () => {
      /** Scene Taverne with both Music and the switched-on Ambience Pluie; Campaign open. */
      async function withAmbience(ctx: Awaited<ReturnType<typeof setupWithMusic>>) {
        const file = path.join(dir.path, 'Pluie.ogg');
        await fs.writeFile(file, 'Pluie');
        const { imported } = await ctx.library.import(ctx.campaign.id, [file], {
          accept: 'audio',
          role: 'ambience',
        });
        const [rain] = imported;
        const created = await ctx.scenes.create(ctx.campaign.id, 'Taverne');
        const scene = await ctx.scenes.save({
          ...created,
          music: ctx.music.map((m) => m.id),
          ambiences: [{ mediaId: rain.id, on: true, volume: 1 }],
        });
        await ctx.commands.openCampaign(ctx.campaign.id);
        return { scene, rain };
      }
      const deleteFile = (ctx: Awaited<ReturnType<typeof setup>>, media: Media) =>
        fs.rm(
          path.join(ctx.storage.campaignFolder(ctx.campaign.id), 'media', mediaFileName(media)),
        );

      it('leaves the Media out on Activate, listed as missing; the other sounds play', async () => {
        const ctx = await setupWithMusic();
        const { scene, rain } = await withAmbience(ctx);
        await deleteFile(ctx, ctx.music[0]);

        await ctx.commands.activateScene(scene.id);

        expect(voices(ctx.audio.mix())).toEqual([{ mediaId: rain.id, playing: true }]);
        expect(ctx.audio.mix().missing).toEqual([
          { mediaId: ctx.music[0].id, role: 'music', name: 'Taverne' },
        ]);
      });

      it('drops a sound whose file went missing at the next change of the Active Scene', async () => {
        const ctx = await setupWithMusic();
        const { scene, rain } = await withAmbience(ctx);
        await ctx.commands.activateScene(scene.id);
        await deleteFile(ctx, rain);

        await ctx.commands.editScene(ctx.campaign.id, scene.id, {
          kind: 'set-title',
          title: 'Nuit',
        });

        expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[0].id, playing: true }]);
        expect(ctx.audio.mix().missing).toEqual([
          { mediaId: rain.id, role: 'ambience', name: 'Pluie' },
        ]);
      });
    });

    it('refuses to undo the removal of a Music deleted since', async () => {
      const ctx = await setupWithMusic();
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Vide');
      const edit = (command: SceneEdit) =>
        ctx.commands.editScene(ctx.campaign.id, scene.id, command);
      await edit({ kind: 'add-music', mediaId: ctx.music[0].id });
      const removed = await edit({ kind: 'remove-music', mediaId: ctx.music[0].id });
      // The Scene no longer uses the Music: it goes at once, and the history stays.
      expect(await ctx.commands.deleteMedia(ctx.campaign.id, ctx.music[0].id, false)).toMatchObject(
        { deleted: true },
      );

      await expect(ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id)).rejects.toThrow(
        'Un média de cette étape a été supprimé',
      );
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: null,
        redo: null,
      });
      expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(removed);
    });

    it('refuses to bring back a Music deleted after its step was undone', async () => {
      const ctx = await setupWithMusic();
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Vide');
      const added = await ctx.commands.editScene(ctx.campaign.id, scene.id, {
        kind: 'add-music',
        mediaId: ctx.music[0].id,
      });
      expect(added.music).toEqual([ctx.music[0].id]);
      await ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id);
      // The Scene no longer uses the Music: it goes at once, and the history stays.
      expect(await ctx.commands.deleteMedia(ctx.campaign.id, ctx.music[0].id, false)).toMatchObject(
        { deleted: true },
      );

      await expect(ctx.commands.redoSceneEdit(ctx.campaign.id, scene.id)).rejects.toThrow(
        'Un média de cette étape a été supprimé',
      );
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: null,
        redo: null,
      });
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.music).toEqual([]);
    });

    it('the Master volume sets every level, without restarting anything', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);

      const mix = ctx.audio.setMasterVolume(0.25);

      expect(mix.voices).toEqual([expect.objectContaining({ gain: 0.25, playing: true })]);
      expect(mix.fadeMs).toBe(AUDIO_FADE_MS.volume);
    });

    /** The Campaign open and a Scene with both Music Media Active, Taverne playing. */
    async function playing(ctx: Awaited<ReturnType<typeof setupWithMusic>>) {
      const scene = await withMusic(ctx);
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);
      return scene;
    }

    it('picking a track crossfades to it in 2 s, without saving it into the Scene', async () => {
      const ctx = await setupWithMusic();
      const scene = await playing(ctx);

      await ctx.commands.pickMusic(ctx.music[1].id);

      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[1].id, playing: true }]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.crossfade);
      expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(scene);
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: null,
        redo: null,
      });
      // The next Activate starts from the first Music again.
      await ctx.commands.activateScene(scene.id);
      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[0].id, playing: true }]);
    });

    it('refuses a pick with no Active Scene or of a Music not in its list', async () => {
      const ctx = await setupWithMusic();
      await ctx.commands.openCampaign(ctx.campaign.id);
      await expect(ctx.commands.pickMusic(ctx.music[0].id)).rejects.toThrow(
        'Activez une scène pour choisir sa musique.',
      );
      const other = await ctx.scenes.create(ctx.campaign.id, 'Vide');
      await ctx.commands.activateScene(other.id);
      await expect(ctx.commands.pickMusic(ctx.music[0].id)).rejects.toThrow(
        'Cette musique n’est pas dans la scène active.',
      );
      expect(ctx.mixes).toEqual([]);
    });

    it('pause keeps the Music in the mix, not playing; resume plays it again (0.3 s)', async () => {
      const ctx = await setupWithMusic();
      await playing(ctx);

      await ctx.commands.setMusicPlayback('paused');
      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[0].id, playing: false }]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.pause);

      await ctx.commands.setMusicPlayback('playing');
      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ctx.music[0].id, playing: true }]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.pause);
    });

    it('stop leaves only the Ambiences; play then starts the same track over', async () => {
      const ctx = await setupWithMusic();
      const scene = await withMusic(ctx);
      const rain = path.join(dir.path, 'Pluie.ogg');
      await fs.writeFile(rain, 'Pluie');
      const [ambience] = (
        await ctx.library.import(ctx.campaign.id, [rain], { accept: 'audio', role: 'ambience' })
      ).imported;
      await ctx.scenes.save({
        ...scene,
        ambiences: [{ mediaId: ambience.id, on: true, volume: 1 }],
      });
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);
      await ctx.commands.pickMusic(ctx.music[1].id);

      await ctx.commands.setMusicPlayback('stopped');
      expect(voices(ctx.audio.mix())).toEqual([{ mediaId: ambience.id, playing: true }]);

      await ctx.commands.setMusicPlayback('playing');
      expect(voices(ctx.audio.mix())).toEqual([
        { mediaId: ctx.music[1].id, playing: true },
        { mediaId: ambience.id, playing: true },
      ]);
    });

    it('the Scene Music level is saved and ramped, an undo step of its own', async () => {
      const ctx = await setupWithMusic();
      const scene = await playing(ctx);

      const saved = await ctx.commands.editScene(ctx.campaign.id, scene.id, {
        kind: 'set-music-level',
        level: 0.5,
      });

      expect(saved.volumes.music).toBe(0.5);
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.volumes.music).toBe(0.5);
      expect(ctx.audio.mix().voices).toEqual([expect.objectContaining({ gain: 0.5 })]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.volume);
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: 'régler le niveau des musiques',
        redo: null,
      });

      await ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id);
      expect(ctx.audio.mix().voices).toEqual([expect.objectContaining({ gain: 1 })]);
    });

    it('a Music level drag is heard on the Active Scene but neither saved nor undoable', async () => {
      const ctx = await setupWithMusic();
      const scene = await playing(ctx);
      const broadcast = ctx.broadcast.length;

      for (const level of [0.8, 0.6, 0.4]) {
        await ctx.commands.showTransientEdit(ctx.campaign.id, scene.id, {
          kind: 'set-music-level',
          level,
        });
      }

      expect(ctx.audio.mix().voices).toEqual([expect.objectContaining({ gain: 0.4 })]);
      expect(ctx.broadcast).toHaveLength(broadcast);
      expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(scene);
      expect((await ctx.commands.undoState(ctx.campaign.id, scene.id)).undo).toBeNull();

      // The drag's end: one step.
      await ctx.commands.editScene(ctx.campaign.id, scene.id, {
        kind: 'set-music-level',
        level: 0.4,
      });
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: 'régler le niveau des musiques',
        redo: null,
      });
    });

    it('puts the saved Music level back in the mix when the committed drag fails', async () => {
      const ctx = await setupWithMusic();
      const scene = await playing(ctx);
      await ctx.commands.showTransientEdit(ctx.campaign.id, scene.id, {
        kind: 'set-music-level',
        level: 0.4,
      });
      expect(ctx.audio.mix().voices).toEqual([expect.objectContaining({ gain: 0.4 })]);
      ctx.failSaves(new Error('disk full'));

      await expect(
        ctx.commands.editScene(ctx.campaign.id, scene.id, { kind: 'set-music-level', level: 0.4 }),
      ).rejects.toThrow('disk full');

      expect(ctx.audio.mix().voices).toEqual([expect.objectContaining({ gain: 1 })]);
    });

    it('reorder and remove are saved and undoable; removing the current Music stops it', async () => {
      const ctx = await setupWithMusic();
      const scene = await playing(ctx);
      const [taverne, bagarre] = ctx.music.map((m) => m.id);

      const moved = await ctx.commands.editScene(ctx.campaign.id, scene.id, {
        kind: 'move-music',
        mediaId: bagarre,
        toIndex: 0,
      });
      expect(moved.music).toEqual([bagarre, taverne]);
      // Reordering changes nothing heard.
      expect(ctx.mixes).toHaveLength(1);

      const removed = await ctx.commands.editScene(ctx.campaign.id, scene.id, {
        kind: 'remove-music',
        mediaId: taverne,
      });
      expect(removed.music).toEqual([bagarre]);
      expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(removed);
      expect(ctx.audio.mix().voices).toEqual([]);
      expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.pause);

      await ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id);
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.music).toEqual([bagarre, taverne]);
      await ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id);
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.music).toEqual([taverne, bagarre]);
    });

    it('Music edits on a Scene that is not active make no sound', async () => {
      const ctx = await setupWithMusic();
      await playing(ctx);
      const other = await withMusic(ctx, 'Forêt');

      for (const edit of [
        { kind: 'set-music-level', level: 0.2 },
        { kind: 'move-music', mediaId: ctx.music[1].id, toIndex: 0 },
        { kind: 'remove-music', mediaId: ctx.music[0].id },
      ] as const) {
        await ctx.commands.editScene(ctx.campaign.id, other.id, edit);
      }
      await ctx.commands.showTransientEdit(ctx.campaign.id, other.id, {
        kind: 'set-music-level',
        level: 0.9,
      });

      expect(ctx.mixes).toHaveLength(1);
      expect((await ctx.scenes.get(ctx.campaign.id, other.id))?.music).toEqual([ctx.music[1].id]);
    });
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

  describe('a live drag of an Overlay', () => {
    /** A Scene with one visible Overlay p1 at the centre; Active unless `active` is false. */
    async function dragging(ctx: Awaited<ReturnType<typeof setup>>, active = true) {
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
      const edit = (command: SceneEdit) =>
        ctx.commands.editScene(ctx.campaign.id, scene.id, command);
      await edit({ kind: 'place-overlay', mediaId: ctx.image.id });
      const saved = await edit({ kind: 'set-visible', placementId: 'p1', visible: true });
      await ctx.commands.openCampaign(ctx.campaign.id);
      if (active) await ctx.commands.activateScene(scene.id);
      return { saved, edit };
    }
    const move = (x: number, y: number) =>
      ({ kind: 'transform-overlay', placementId: 'p1', position: { x, y } }) as const;
    const onAirOverlay = (ctx: Awaited<ReturnType<typeof setup>>) =>
      ctx.broadcast.at(-1)?.scene?.overlays[0];

    it('shows each transient update on the Active Scene without saving it', async () => {
      const ctx = await setup();
      const { saved } = await dragging(ctx);

      await ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, move(0.2, 0.3));
      expect(onAirOverlay(ctx)).toMatchObject({ position: { x: 0.2, y: 0.3 }, height: 0.5 });
      await ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, {
        kind: 'transform-overlay',
        placementId: 'p1',
        position: { x: 0.25, y: 0.35 },
        height: 0.4,
      });
      expect(onAirOverlay(ctx)).toMatchObject({ position: { x: 0.25, y: 0.35 }, height: 0.4 });

      expect(await ctx.scenes.get(ctx.campaign.id, saved.id)).toEqual(saved);
    });

    it('saves the drag once, with the committed edit at its end', async () => {
      const ctx = await setup();
      const { saved, edit } = await dragging(ctx);
      for (const x of [0.1, 0.2, 0.3]) {
        await ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, move(x, 0.5));
      }

      const committed = await edit(move(0.4, 0.6));

      expect(committed.overlays[0].position).toEqual({ x: 0.4, y: 0.6 });
      expect(await ctx.scenes.get(ctx.campaign.id, saved.id)).toEqual(committed);
      expect(onAirOverlay(ctx)).toMatchObject({ position: { x: 0.4, y: 0.6 } });
    });

    it('puts the saved Scene back on air when the committed edit fails', async () => {
      const ctx = await setup();
      const { saved, edit } = await dragging(ctx);
      await ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, move(0.2, 0.3));
      ctx.failSaves(new Error('disk full'));

      await expect(edit(move(0.2, 0.3))).rejects.toThrow('disk full');

      expect(onAirOverlay(ctx)).toMatchObject({ position: { x: 0.5, y: 0.5 } });
      expect(await ctx.scenes.get(ctx.campaign.id, saved.id)).toEqual(saved);
    });

    it('never touches the broadcast, nor saves, on a Scene that is not active', async () => {
      const ctx = await setup();
      const { saved } = await dragging(ctx, false);
      const sent = ctx.broadcast.length;

      await ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, move(0.2, 0.3));

      expect(ctx.broadcast.length).toBe(sent);
      expect(await ctx.scenes.get(ctx.campaign.id, saved.id)).toEqual(saved);
    });

    it('refuses a transient update of an Overlay that is gone, in French', async () => {
      const ctx = await setup();
      const { saved } = await dragging(ctx);
      const sent = ctx.broadcast.length;

      await expect(
        ctx.commands.showTransientEdit(ctx.campaign.id, saved.id, {
          ...move(0.2, 0.3),
          placementId: 'absent',
        }),
      ).rejects.toThrow('Cet élément n’est plus sur la scène.');
      expect(ctx.broadcast.length).toBe(sent);
    });
  });

  it('shows a live framing of a Background on the Active Scene without saving it', async () => {
    const ctx = await setup();
    const scene = await sceneShowing(ctx, 'Cantina');
    await ctx.commands.openCampaign(ctx.campaign.id);
    await ctx.commands.activateScene(scene.id);

    await ctx.commands.showTransientEdit(ctx.campaign.id, scene.id, {
      kind: 'frame-background',
      placementId: 'bg-Cantina',
      zoom: 2,
      focus: { x: 0.25 },
    });

    expect(ctx.broadcast.at(-1)?.scene?.backgrounds[0]).toMatchObject({
      zoom: 2,
      focus: { x: 0.25, y: 0.5 },
    });
    expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(scene);
    expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
      undo: null,
      redo: null,
    });
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
        fadeDurationMs: 600,
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
        fadeDurationMs: 600,
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
        fadeDurationMs: 600,
        version: 3,
      });
      expect(ctx.broadcast.at(-1)).toEqual(state);
      expect(await ctx.commands.setBlackout(false)).toMatchObject({
        activeSceneId: scene.id,
        scene: cantinaPicture,
        blackout: false,
        fadeDurationMs: 600,
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
        fadeDurationMs: 600,
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

  describe('undo and redo', () => {
    /** An open Campaign with Scene Cantina, Active, holding a Hidden Overlay p1 of the image. */
    async function editing(ctx: Awaited<ReturnType<typeof setup>>) {
      const scene = await ctx.scenes.create(ctx.campaign.id, 'Cantina');
      await ctx.commands.openCampaign(ctx.campaign.id);
      await ctx.commands.activateScene(scene.id);
      const edit = (command: SceneEdit) =>
        ctx.commands.editScene(ctx.campaign.id, scene.id, command);
      const placed = await edit({ kind: 'place-overlay', mediaId: ctx.image.id });
      return {
        scene,
        placed,
        edit,
        undo: () => ctx.commands.undoSceneEdit(ctx.campaign.id, scene.id),
        redo: () => ctx.commands.redoSceneEdit(ctx.campaign.id, scene.id),
        state: () => ctx.commands.undoState(ctx.campaign.id, scene.id),
      };
    }
    const onAirOverlays = (ctx: Awaited<ReturnType<typeof setup>>) =>
      ctx.broadcast.at(-1)?.scene?.overlays ?? [];

    it('undoes and redoes an edit on the Active Scene, live, naming it by its Media', async () => {
      const ctx = await setup();
      const { placed, edit, undo, redo, state } = await editing(ctx);
      const shown = await edit({ kind: 'set-visible', placementId: 'p1', visible: true });
      expect(onAirOverlays(ctx)).toHaveLength(1);
      expect(await state()).toEqual({ undo: 'afficher Cantina', redo: null });

      expect(await undo()).toEqual(placed);
      expect(await ctx.scenes.get(ctx.campaign.id, placed.id)).toEqual(placed);
      expect(onAirOverlays(ctx)).toEqual([]);
      expect(await state()).toEqual({
        undo: 'placer Cantina en superposition',
        redo: 'afficher Cantina',
      });

      expect(await redo()).toEqual(shown);
      expect(onAirOverlays(ctx)).toHaveLength(1);
      expect(await state()).toEqual({ undo: 'afficher Cantina', redo: null });
    });

    it('undoes a whole drag as one step, whatever transient updates came before', async () => {
      const ctx = await setup();
      const { scene, placed, edit, undo, state } = await editing(ctx);
      for (const x of [0.1, 0.2, 0.3]) {
        await ctx.commands.showTransientEdit(ctx.campaign.id, scene.id, {
          kind: 'transform-overlay',
          placementId: 'p1',
          position: { x, y: 0.5 },
        });
      }
      await edit({ kind: 'transform-overlay', placementId: 'p1', position: { x: 0.4, y: 0.6 } });
      expect((await state()).undo).toBe('déplacer Cantina');

      expect(await undo()).toEqual(placed);
    });

    it('keeps a drag and a resize of one Overlay as two steps, however quick', async () => {
      const ctx = await setup();
      const { placed, edit, undo, state } = await editing(ctx);
      const moved = await edit({
        kind: 'transform-overlay',
        placementId: 'p1',
        position: { x: 0.4, y: 0.5 },
      });
      await edit({
        kind: 'transform-overlay',
        placementId: 'p1',
        position: { x: 0.4, y: 0.5 },
        height: 0.3,
      });
      expect((await state()).undo).toBe('redimensionner Cantina');

      expect(await undo()).toEqual(moved);
      expect((await state()).undo).toBe('déplacer Cantina');
      expect(await undo()).toEqual(placed);
    });

    it('refuses to undo or redo with nothing to, in French', async () => {
      const ctx = await setup();
      const { undo, redo } = await editing(ctx);
      await expect(redo()).rejects.toThrow('Rien à rétablir.');
      await undo();
      await expect(undo()).rejects.toThrow('Rien à annuler.');
    });

    it('keeps each Scene its own history, across Activating, until the Campaign is opened again', async () => {
      const ctx = await setup();
      const { scene, state } = await editing(ctx);
      const hangar = await ctx.scenes.create(ctx.campaign.id, 'Hangar');
      await ctx.commands.editScene(ctx.campaign.id, hangar.id, { kind: 'rename', name: 'Dock' });
      await ctx.commands.activateScene(hangar.id);
      await ctx.commands.setBlackout(true);

      expect(await state()).toEqual({ undo: 'placer Cantina en superposition', redo: null });
      expect(await ctx.commands.undoState(ctx.campaign.id, hangar.id)).toEqual({
        undo: 'renommer la scène',
        redo: null,
      });

      await ctx.commands.openCampaign(ctx.campaign.id);
      expect(await state()).toEqual({ undo: null, redo: null });
      expect(await ctx.commands.undoState(ctx.campaign.id, scene.id)).toEqual({
        undo: null,
        redo: null,
      });
    });

    it('clears the history when the Campaign is closed or the Scene deleted', async () => {
      const ctx = await setup();
      const first = await editing(ctx);
      await ctx.commands.closeCampaign();
      expect(await first.state()).toEqual({ undo: null, redo: null });

      await ctx.commands.openCampaign(ctx.campaign.id);
      await first.edit({ kind: 'rename', name: 'Cantina 2' });
      await ctx.commands.deleteScene(ctx.campaign.id, first.scene.id);
      expect(await first.state()).toEqual({ undo: null, redo: null });
    });

    it('clears the history of the Scenes whose placements a Media deletion removed', async () => {
      const ctx = await setup();
      const { state, undo } = await editing(ctx);
      await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, true);

      expect(await state()).toEqual({ undo: null, redo: null });
      await expect(undo()).rejects.toThrow('Rien à annuler.');
    });

    it('refuses to bring back a placement whose Media was deleted after it was removed', async () => {
      const ctx = await setup();
      const { scene, edit, undo, redo, state } = await editing(ctx);
      const removed = await edit({ kind: 'remove-placement', placementId: 'p1' });
      // The Scene no longer uses the image: it goes at once, and the history stays.
      await ctx.commands.deleteMedia(ctx.campaign.id, ctx.image.id, false);

      await expect(undo()).rejects.toThrow('Un média de cette étape a été supprimé');
      expect(await state()).toEqual({ undo: null, redo: null });
      expect(await ctx.scenes.get(ctx.campaign.id, scene.id)).toEqual(removed);
      expect(onAirOverlays(ctx)).toEqual([]);
      await expect(redo()).rejects.toThrow('Rien à rétablir.');
    });

    it('refuses an undo once the Scene changed outside its history, and clears it', async () => {
      const ctx = await setup();
      const { scene, placed, undo, state } = await editing(ctx);
      await ctx.scenes.save({ ...placed, notes: 'changed elsewhere' });

      await expect(undo()).rejects.toThrow('La scène a changé entre-temps');
      expect(await state()).toEqual({ undo: null, redo: null });
      expect((await ctx.scenes.get(ctx.campaign.id, scene.id))?.notes).toBe('changed elsewhere');
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
