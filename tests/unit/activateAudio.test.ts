import { describe, expect, it } from 'vitest';
import { createAudioOnAir } from '../../core/audioOnAir';
import { AUDIO_FADE_MS } from '../../core/fades';
import type { AudioMedia, AudioMix, Media, Scene } from '../../shared/domain';
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

const library: Media[] = [
  audio('m1', 'music'),
  audio('m2', 'music'),
  audio('a1', 'ambience'),
  audio('a2', 'ambience'),
];

function scene(id: string, changes: Partial<Scene> = {}): Scene {
  return {
    id,
    campaignId: 'c1',
    name: id,
    title: '',
    backgrounds: [],
    overlays: [],
    music: [],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: emptyNotes(),
    transition: 'crossfade',
    ...changes,
  };
}

/** No Media is missing. */
const none: ReadonlySet<string> = new Set();

const voices = (mix: AudioMix) =>
  mix.voices.map(({ mediaId, gain, playing }) => ({ mediaId, gain, playing }));

describe('Activating a Scene changes the mix', () => {
  it('drops the outgoing Scene’s voices and brings in the new one’s, over 1.5 s', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(
      scene('jour', { music: ['m1'], ambiences: [{ mediaId: 'a1', on: true, volume: 1 }] }),
      library,
      none,
    );

    const mix = audioOnAir.activateScene(
      scene('nuit', { music: ['m2'], ambiences: [{ mediaId: 'a2', on: true, volume: 1 }] }),
      library,
      none,
    );

    expect(voices(mix)).toEqual([
      { mediaId: 'm2', gain: 1, playing: true },
      { mediaId: 'a2', gain: 1, playing: true },
    ]);
    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.activate);
    expect(AUDIO_FADE_MS.activate).toBe(1500);
  });

  it('switches the audio over a very short fade (0.1 s) on a Cut, so nothing clicks', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(scene('jour', { music: ['m1'] }), library, none);

    const mix = audioOnAir.activateScene(scene('nuit', { music: ['m2'] }), library, none, 'cut');

    expect(voices(mix)).toEqual([{ mediaId: 'm2', gain: 1, playing: true }]);
    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.cut);
    expect(AUDIO_FADE_MS.cut).toBe(100);
  });

  it('keeps a shared Music playing through a Cut, as through a Crossfade', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(scene('jour', { music: ['m1'] }), library, none);

    const after = audioOnAir.activateScene(scene('nuit', { music: ['m1'] }), library, none, 'cut');

    expect(after.voices[0]?.take).toBe(before.voices[0]?.take);
  });

  it('fades over the Activate duration on a Crossfade', () => {
    const mix = createAudioOnAir().activateScene(
      scene('jour', { music: ['m1'] }),
      library,
      none,
      'crossfade',
    );
    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.activate);
  });

  it('keeps a shared Ambience as the same voice, only changing its gain', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(
      scene('taverne, jour', { ambiences: [{ mediaId: 'a1', on: true, volume: 1 }] }),
      library,
      none,
    );

    const after = audioOnAir.activateScene(
      scene('taverne, bagarre', {
        volumes: { music: 1, ambience: 0.5 },
        ambiences: [
          { mediaId: 'a2', on: true, volume: 1 },
          { mediaId: 'a1', on: true, volume: 0.8 },
        ],
      }),
      library,
      none,
    );

    const crowd = (mix: AudioMix) => mix.voices.find((voice) => voice.mediaId === 'a1');
    expect(crowd(after)).toEqual({ ...crowd(before), gain: 0.4 });
    expect(after.fadeMs).toBe(AUDIO_FADE_MS.activate);
  });

  it('keeps a shared Music playing when it is the new Scene’s first, at the new level', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(scene('jour', { music: ['m1'] }), library, none);

    const after = audioOnAir.activateScene(
      scene('nuit', { music: ['m1', 'm2'], volumes: { music: 0.6, ambience: 1 } }),
      library,
      none,
    );

    expect(after.voices).toEqual([{ ...before.voices[0], gain: 0.6 }]);
  });

  it('starts from the new Scene’s first Music, even when a later one of its list is playing', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(scene('jour', { music: ['m1', 'm2'] }), library, none);
    audioOnAir.pickMusic('m2');

    const mix = audioOnAir.activateScene(scene('nuit', { music: ['m1', 'm2'] }), library, none);

    expect(voices(mix)).toEqual([{ mediaId: 'm1', gain: 1, playing: true }]);
  });

  it('starts a paused Music over when it is the new Scene’s first, and switches an Ambience back on', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(
      scene('jour', { music: ['m1'], ambiences: [{ mediaId: 'a1', on: false, volume: 1 }] }),
      library,
      none,
    );
    audioOnAir.setMusicPlayback('paused');

    const mix = audioOnAir.activateScene(
      scene('nuit', { music: ['m1'], ambiences: [{ mediaId: 'a1', on: true, volume: 1 }] }),
      library,
      none,
    );

    expect(voices(mix)).toEqual([
      { mediaId: 'm1', gain: 1, playing: true },
      { mediaId: 'a1', gain: 1, playing: true },
    ]);
    // Only a Music still playing carries on (#38): a paused one is a new take, from its start.
    expect(mix.voices[0].take).not.toBe(before.voices[0].take);
  });

  it('keeps the take of a shared Music playing through Silence', () => {
    const audioOnAir = createAudioOnAir();
    const before = audioOnAir.activateScene(scene('jour', { music: ['m1'] }), library, none);
    audioOnAir.setSilence(true);

    const after = audioOnAir.activateScene(scene('nuit', { music: ['m1'] }), library, none);

    expect(after.voices).toEqual([before.voices[0]]);
  });

  it('plays a Scene with audio and no pictures', () => {
    const mix = createAudioOnAir().activateScene(
      scene('noir', { music: ['m1'], backgrounds: [], overlays: [] }),
      library,
      none,
    );

    expect(voices(mix)).toEqual([{ mediaId: 'm1', gain: 1, playing: true }]);
  });

  it('fades everything out over 1.5 s when the new Scene has no audio', () => {
    const audioOnAir = createAudioOnAir();
    audioOnAir.activateScene(scene('jour', { music: ['m1'] }), library, none);

    const mix = audioOnAir.activateScene(scene('muet'), library, none);

    expect(mix.voices).toEqual([]);
    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.activate);
  });
});
