import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mixOf, soundingOf, type MixInput } from '../../core/audioMix';
import { createAudioOnAir } from '../../core/audioOnAir';
import { createCampaign } from '../../core/campaigns';
import { AUDIO_FADE_MS } from '../../core/fades';
import { createMediaLibrary } from '../../core/media';
import { createOnAir } from '../../core/onAir';
import { createOnAirCommands } from '../../core/onAirCommands';
import { createPadVoices } from '../../core/padVoices';
import { createSceneLibrary } from '../../core/scenes';
import { createSoundboardStore } from '../../core/soundboard';
import { openStorage } from '../../core/storage';
import type { AudioMedia, AudioMix, OnAirState, Scene } from '../../shared/domain';
import { fakeResizer } from './fakeResizer';
import { useTempDir } from './tempDir';
import { emptyNotes } from '../../core/notes';

function audio(id: string, role: AudioMedia['role']): AudioMedia {
  return {
    id,
    campaignId: 'c1',
    contentHash: id.padEnd(64, '0'),
    originalName: id,
    name: `Nom ${id}`,
    extension: '.ogg',
    kind: 'audio',
    role,
    durationSeconds: 60,
  };
}

const library = [audio('m1', 'music'), audio('a1', 'ambience')];
/** No Media file missing. */
const none: ReadonlySet<string> = new Set();

const taverne: Scene = {
  id: 's1',
  campaignId: 'c1',
  name: 'Taverne',
  title: '',
  backgrounds: [],
  overlays: [],
  music: ['m1'],
  ambiences: [{ mediaId: 'a1', on: true, volume: 0.5 }],
  volumes: { music: 1, ambience: 1 },
  notes: emptyNotes(),
};

const heard: MixInput = {
  scene: taverne,
  library,
  masterVolume: 1,
  audio: { music: { mediaId: 'm1', playback: 'playing', take: 0 } },
  silence: false,
};

const levels = (mix: Pick<AudioMix, 'voices'>) =>
  mix.voices.map(({ mediaId, gain, playing }) => ({ mediaId, gain, playing }));

describe('Silence in the mix', () => {
  it('fades every voice out to nothing and pauses it, so the Music keeps its position', () => {
    const mix = mixOf({ ...heard, silence: true }, 'silence');

    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.silence);
    expect(levels(mix)).toEqual([
      { mediaId: 'm1', gain: 0, playing: false },
      { mediaId: 'a1', gain: 0, playing: false },
    ]);
  });

  it('keeps the voices, by their Media, so lifting it brings the same mix back', () => {
    expect(mixOf({ ...heard, silence: true }, 'silence').voices.map((v) => v.mediaId)).toEqual(
      mixOf(heard, 'silence').voices.map((v) => v.mediaId),
    );
  });
});

describe('Silence on air', () => {
  it('fades everything out; lifting it restores the same mix, Music resuming', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(taverne, library, none);

    const silenced = audioOnAir.setSilence(true);
    expect(audioOnAir.silence()).toBe(true);
    expect(silenced.fadeMs).toBe(AUDIO_FADE_MS.silence);
    expect(silenced.voices.every((voice) => voice.gain === 0 && !voice.playing)).toBe(true);

    const lifted = audioOnAir.setSilence(false);
    expect(audioOnAir.silence()).toBe(false);
    expect(lifted.fadeMs).toBe(AUDIO_FADE_MS.silence);
    expect(levels(lifted)).toEqual(levels(before));
  });

  it('keeps everything silent while the mix changes under it', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene({ ...taverne, ambiences: [] }, library, none);
    audioOnAir.setSilence(true);

    // An Ambience switched on, and the Master volume raised, during Silence.
    audioOnAir.showActiveScene(taverne, library, 'ambience', none);
    const mix = audioOnAir.setMasterVolume(0.5);

    expect(levels(mix)).toEqual([
      { mediaId: 'm1', gain: 0, playing: false },
      { mediaId: 'a1', gain: 0, playing: false },
    ]);
    expect(levels(audioOnAir.setSilence(false))).toEqual([
      { mediaId: 'm1', gain: 0.5, playing: true },
      { mediaId: 'a1', gain: 0.25, playing: true },
    ]);
  });

  it('switches a track picked during Silence silently; it plays once Silence lifts', () => {
    const twoTracks = [...library, audio('m2', 'music')];
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene({ ...taverne, music: ['m1', 'm2'], ambiences: [] }, twoTracks, none);
    audioOnAir.setSilence(true);

    const picked = audioOnAir.pickMusic('m2');
    expect(levels(picked)).toEqual([{ mediaId: 'm2', gain: 0, playing: false }]);
    expect(audioOnAir.silence()).toBe(true);
    // Played (or paused) during Silence: still silent.
    expect(levels(audioOnAir.setMusicPlayback('playing'))).toEqual([
      { mediaId: 'm2', gain: 0, playing: false },
    ]);

    expect(levels(audioOnAir.setSilence(false))).toEqual([
      { mediaId: 'm2', gain: 1, playing: true },
    ]);
  });

  it('is lifted by Activate', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(taverne, library, none);
    audioOnAir.setSilence(true);

    const mix = audioOnAir.activateScene(taverne, library, none);

    expect(audioOnAir.silence()).toBe(false);
    expect(mix.voices.every((voice) => voice.playing && voice.gain > 0)).toBe(true);
  });

  it('is cleared when everything stops (a Campaign opened, switched or closed)', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(taverne, library, none);
    audioOnAir.setSilence(true);

    audioOnAir.clear();

    expect(audioOnAir.silence()).toBe(false);
  });

  it('is off in a fresh audio state, as after a restart', () => {
    expect(createAudioOnAir().silence()).toBe(false);
  });

  it('gives a new mix even when nothing sounds, so the strip learns it changed', () => {
    const audioOnAir = createAudioOnAir();
    const mixes: AudioMix[] = [];
    audioOnAir.subscribe((mix) => mixes.push(mix));

    audioOnAir.setSilence(true);
    audioOnAir.setSilence(true);
    audioOnAir.activateScene({ ...taverne, music: [], ambiences: [] }, library, none);

    expect(mixes.map((mix) => mix.version)).toEqual([1, 2]);
    expect(audioOnAir.silence()).toBe(false);
  });
});

describe('Silence and pads', () => {
  const press = (padId: string) => ({ padId, name: padId, src: `x/${padId}.wav`, gain: 0.7 });

  it('fades out the pad sounds sounding when it starts', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));

    expect(pads.clear('silence')).toEqual([
      { kind: 'cut', voiceIds: [1], fadeMs: AUDIO_FADE_MS.silence },
    ]);
  });

  it('lets a pad pressed during Silence play at its normal level', () => {
    const pads = createPadVoices();
    pads.clear('silence');

    expect(pads.press(press('p1'))).toEqual([
      { kind: 'play', voiceId: 1, src: 'x/p1.wav', gain: 0.7 },
    ]);
  });
});

describe('what is sounding during Silence', () => {
  it('says whether Silence is on', () => {
    const mix: AudioMix = { voices: [], missing: [], fadeMs: 0, version: 1 };
    expect(soundingOf(mix, { voices: [] }).silence).toBe(false);
    expect(soundingOf(mix, { voices: [] }, [], true)).toEqual({
      voices: [],
      pads: [],
      silence: true,
      masterVolume: 1,
    });
  });
});

describe('Silence and Blackout stay apart', () => {
  const dir = useTempDir();

  async function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const media = createMediaLibrary(storage, fakeResizer().resizer);
    const scenes = createSceneLibrary(storage);
    const onAir = createOnAir();
    const snapshots: OnAirState[] = [];
    onAir.subscribe((snapshot) => snapshots.push(snapshot));
    const audioOnAir = createAudioOnAir();
    const mixes: AudioMix[] = [];
    audioOnAir.subscribe((mix) => mixes.push(mix));
    const commands = createOnAirCommands({
      campaigns: storage.campaigns,
      library: media,
      scenes,
      onAir,
      audio: audioOnAir,
      soundboards: createSoundboardStore({ storage, library: media }),
    });
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const file = path.join(dir.path, 'Auberge.ogg');
    await fs.writeFile(file, 'Auberge');
    const { imported } = await media.import(campaign.id, [file], {
      accept: 'audio',
      role: 'music',
    });
    const created = await scenes.create(campaign.id, 'Taverne');
    const scene = await scenes.save({ ...created, music: imported.map((m) => m.id) });
    await commands.openCampaign(campaign.id);
    await commands.activateScene(scene.id);
    snapshots.length = 0;
    mixes.length = 0;
    return { commands, audioOnAir, snapshots, mixes, scene, campaign, onAir };
  }

  it('Blackout does not change audio', async () => {
    const ctx = await setup();

    await ctx.commands.setBlackout(true);
    await ctx.commands.setBlackout(false);

    expect(ctx.mixes).toEqual([]);
    expect(ctx.snapshots).toHaveLength(2);
  });

  it('Silence does not change the picture', async () => {
    const ctx = await setup();

    ctx.audioOnAir.setSilence(true);

    expect(ctx.snapshots).toEqual([]);
    expect(ctx.onAir.current()).not.toHaveProperty('silence');
  });

  it('Activating a Scene through the commands lifts Silence; switching Campaign clears it', async () => {
    const ctx = await setup();
    ctx.audioOnAir.setSilence(true);

    await ctx.commands.activateScene(ctx.scene.id);
    expect(ctx.audioOnAir.silence()).toBe(false);

    ctx.audioOnAir.setSilence(true);
    await ctx.commands.openCampaign(ctx.campaign.id);
    expect(ctx.audioOnAir.silence()).toBe(false);
  });

  it('Silence given after an Activate waits for it, so the Activate does not lift it', async () => {
    const ctx = await setup();

    const activated = ctx.commands.activateScene(ctx.scene.id);
    const started = ctx.commands.setSilence(true);
    await Promise.all([activated, started]);

    expect(await started).toBe(true);
    expect(ctx.audioOnAir.silence()).toBe(true);
  });

  it('toggling Silence twice starts it, then lifts it, each from the state the one before left', async () => {
    const ctx = await setup();

    const toggles = [ctx.commands.toggleSilence(), ctx.commands.toggleSilence()];

    expect(await Promise.all(toggles)).toEqual([true, false]);
    expect(ctx.audioOnAir.silence()).toBe(false);
    expect(await ctx.commands.setSilence(false)).toBe(false);
  });
});
