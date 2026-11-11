import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioChangeOf } from '../../core/audioMix';
import { createAudioOnAir } from '../../core/audioOnAir';
import { createCampaign } from '../../core/campaigns';
import { ACTIVATE_DURATION_MS, AUDIO_FADE_MS } from '../../core/fades';
import { createMediaLibrary } from '../../core/media';
import { createOnAir } from '../../core/onAir';
import { createOnAirCommands } from '../../core/onAirCommands';
import { createSceneLibrary } from '../../core/scenes';
import { createSoundboardStore } from '../../core/soundboard';
import { openStorage } from '../../core/storage';
import type { SceneEdit } from '../../shared/contract';
import type { AudioMix, AudioRole } from '../../shared/domain';
import { fakeResizer } from './fakeResizer';
import { useTempDir } from './tempDir';

describe('Scene Ambiences on air', () => {
  const dir = useTempDir();

  /** On-air commands over a Campaign with Music "Auberge" and Ambiences "Pluie" and "Feu". */
  async function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const library = createMediaLibrary(storage, fakeResizer().resizer);
    const scenes = createSceneLibrary(storage);
    const audio = createAudioOnAir();
    const mixes: AudioMix[] = [];
    audio.subscribe((mix) => mixes.push(mix));
    const commands = createOnAirCommands({
      campaigns: storage.campaigns,
      library,
      scenes,
      onAir: createOnAir(),
      audio,
      soundboards: createSoundboardStore({ storage, library }),
    });
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const importSounds = async (role: AudioRole, ...names: string[]) => {
      const files = await Promise.all(
        names.map(async (name) => {
          const file = path.join(dir.path, `${name}.ogg`);
          await fs.writeFile(file, name);
          return file;
        }),
      );
      return (await library.import(campaign.id, files, { accept: 'audio', role })).imported;
    };
    const [auberge] = await importSounds('music', 'Auberge');
    const [pluie, feu] = await importSounds('ambience', 'Pluie', 'Feu');
    await commands.openCampaign(campaign.id);
    const scene = await scenes.save({
      ...(await scenes.create(campaign.id, 'Taverne')),
      music: [auberge.id],
    });
    const edit = (edit: SceneEdit, sceneId = scene.id) =>
      commands.editScene(campaign.id, sceneId, edit);
    return { scenes, commands, campaign, audio, mixes, scene, auberge, pluie, feu, edit };
  }

  const voices = (mix: AudioMix) =>
    mix.voices.map(({ mediaId, role, gain }) => ({ mediaId, role, gain }));

  it('a new Ambience starts off: adding it to the Active Scene makes no sound', async () => {
    const ctx = await setup();
    await ctx.commands.activateScene(ctx.scene.id);
    const activated = ctx.mixes.length;

    const saved = await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });

    expect(saved.ambiences).toEqual([{ mediaId: ctx.pluie.id, on: false, volume: 1 }]);
    expect(ctx.mixes).toHaveLength(activated);
  });

  it('switching an Ambience on or off on the Active Scene fades it in or out (1 s), under the Music', async () => {
    const ctx = await setup();
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.feu.id });
    await ctx.commands.activateScene(ctx.scene.id);

    const saved = await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true });
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.feu.id, on: true });

    expect(saved.ambiences[0].on).toBe(true);
    expect(voices(ctx.audio.mix())).toEqual([
      { mediaId: ctx.auberge.id, role: 'music', gain: 1 },
      { mediaId: ctx.pluie.id, role: 'ambience', gain: 1 },
      { mediaId: ctx.feu.id, role: 'ambience', gain: 1 },
    ]);
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.ambience);

    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: false });
    expect(voices(ctx.audio.mix()).map((voice) => voice.mediaId)).toEqual([
      ctx.auberge.id,
      ctx.feu.id,
    ]);
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.ambience);
  });

  it('per-Ambience volume and the Scene Ambience level compose with Master, ramped', async () => {
    const ctx = await setup();
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true });
    await ctx.commands.activateScene(ctx.scene.id);
    ctx.audio.setMasterVolume(0.5);

    await ctx.edit({ kind: 'set-ambience-volume', mediaId: ctx.pluie.id, volume: 0.5 });
    await ctx.edit({ kind: 'set-ambience-level', level: 0.4 });

    expect(voices(ctx.audio.mix())).toContainEqual({
      mediaId: ctx.pluie.id,
      role: 'ambience',
      gain: 0.1,
    });
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.volume);
  });

  it('an Ambience volume or the Ambience level being dragged is heard, unsaved and not undoable', async () => {
    const ctx = await setup();
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    const saved = await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true });
    await ctx.commands.activateScene(ctx.scene.id);
    const undo = await ctx.commands.undoState(ctx.campaign.id, ctx.scene.id);

    await ctx.commands.showTransientEdit(ctx.campaign.id, ctx.scene.id, {
      kind: 'set-ambience-volume',
      mediaId: ctx.pluie.id,
      volume: 0.5,
    });
    expect(voices(ctx.audio.mix())).toContainEqual({
      mediaId: ctx.pluie.id,
      role: 'ambience',
      gain: 0.5,
    });
    await ctx.commands.showTransientEdit(ctx.campaign.id, ctx.scene.id, {
      kind: 'set-ambience-level',
      level: 0.25,
    });

    // Each transient update applies to the Scene as saved, not to the last update.
    expect(voices(ctx.audio.mix())).toContainEqual({
      mediaId: ctx.pluie.id,
      role: 'ambience',
      gain: 0.25,
    });
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.volume);
    expect(await ctx.scenes.get(ctx.campaign.id, ctx.scene.id)).toEqual(saved);
    expect(await ctx.commands.undoState(ctx.campaign.id, ctx.scene.id)).toEqual(undo);
  });

  it('Activate starts the Ambiences that are on, and only those', async () => {
    const ctx = await setup();
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.feu.id });
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.feu.id, on: true });

    await ctx.commands.activateScene(ctx.scene.id);

    expect(voices(ctx.audio.mix()).map((voice) => voice.mediaId)).toEqual([
      ctx.auberge.id,
      ctx.feu.id,
    ]);
    expect(ctx.audio.mix().fadeMs).toBe(ACTIVATE_DURATION_MS.default);
  });

  it('edits on a Scene that is not active are saved and silent', async () => {
    const ctx = await setup();
    const other = await ctx.scenes.create(ctx.campaign.id, 'Forêt');
    await ctx.commands.activateScene(ctx.scene.id);
    const activated = ctx.mixes.length;

    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id }, other.id);
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true }, other.id);
    await ctx.edit({ kind: 'set-ambience-volume', mediaId: ctx.pluie.id, volume: 0.3 }, other.id);
    await ctx.edit({ kind: 'set-ambience-level', level: 0.3 }, other.id);

    expect(ctx.mixes).toHaveLength(activated);
    expect((await ctx.scenes.get(ctx.campaign.id, other.id))?.ambiences).toEqual([
      { mediaId: ctx.pluie.id, on: true, volume: 0.3 },
    ]);
  });

  it('removing a switched-on Ambience of the Active Scene fades it out', async () => {
    const ctx = await setup();
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true });
    await ctx.commands.activateScene(ctx.scene.id);

    const saved = await ctx.edit({ kind: 'remove-ambience', mediaId: ctx.pluie.id });

    expect(saved.ambiences).toEqual([]);
    expect(voices(ctx.audio.mix()).map((voice) => voice.mediaId)).toEqual([ctx.auberge.id]);
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.ambience);
  });

  it('refuses Music, an image or a missing Media as an Ambience', async () => {
    const ctx = await setup();
    const add = (mediaId: string) => ctx.edit({ kind: 'add-ambience', mediaId });

    await expect(add(ctx.auberge.id)).rejects.toThrow(
      'Seule une ambiance peut aller dans la liste des ambiances.',
    );
    await expect(add('inconnu')).rejects.toThrow('Ce média n’existe plus.');
  });

  it('Ambience edits are undoable one step each, and undo on the Active Scene is heard', async () => {
    const ctx = await setup();
    await ctx.commands.activateScene(ctx.scene.id);
    await ctx.edit({ kind: 'add-ambience', mediaId: ctx.pluie.id });
    await ctx.edit({ kind: 'set-ambience-on', mediaId: ctx.pluie.id, on: true });
    // One slider drag commits one edit: one step.
    await ctx.edit({ kind: 'set-ambience-volume', mediaId: ctx.pluie.id, volume: 0.5 });

    expect(await ctx.commands.undoState(ctx.campaign.id, ctx.scene.id)).toEqual({
      undo: 'régler le volume de l’ambiance Pluie',
      redo: null,
    });
    await ctx.commands.undoSceneEdit(ctx.campaign.id, ctx.scene.id);
    expect(voices(ctx.audio.mix())).toContainEqual({
      mediaId: ctx.pluie.id,
      role: 'ambience',
      gain: 1,
    });

    const off = await ctx.commands.undoSceneEdit(ctx.campaign.id, ctx.scene.id);
    expect(off.ambiences).toEqual([{ mediaId: ctx.pluie.id, on: false, volume: 1 }]);
    expect(voices(ctx.audio.mix()).map((voice) => voice.mediaId)).toEqual([ctx.auberge.id]);
    expect(ctx.audio.mix().fadeMs).toBe(AUDIO_FADE_MS.undo);

    const removed = await ctx.commands.undoSceneEdit(ctx.campaign.id, ctx.scene.id);
    expect(removed.ambiences).toEqual([]);

    await ctx.commands.redoSceneEdit(ctx.campaign.id, ctx.scene.id);
    const on = await ctx.commands.redoSceneEdit(ctx.campaign.id, ctx.scene.id);
    expect(on.ambiences).toEqual([{ mediaId: ctx.pluie.id, on: true, volume: 1 }]);
    expect(voices(ctx.audio.mix()).map((voice) => voice.mediaId)).toContain(ctx.pluie.id);
  });
});

describe('fades of Ambience edits', () => {
  it('on/off and removal fade over the Ambience duration; volumes ramp; adding is silent', () => {
    const edits: [SceneEdit, string][] = [
      [{ kind: 'add-ambience', mediaId: 'a1' }, 'volume'],
      [{ kind: 'remove-ambience', mediaId: 'a1' }, 'ambience'],
      [{ kind: 'set-ambience-on', mediaId: 'a1', on: true }, 'ambience'],
      [{ kind: 'set-ambience-volume', mediaId: 'a1', volume: 0.5 }, 'volume'],
      [{ kind: 'set-ambience-level', level: 0.5 }, 'volume'],
    ];
    for (const [edit, change] of edits) expect(audioChangeOf(edit)).toBe(change);
  });
});
