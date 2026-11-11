import { describe, expect, it } from 'vitest';
import {
  activatedMusic,
  audioChangeOf,
  latestMix,
  mixOf,
  musicAfterEdit,
  parseAudioEngineReport,
  soundingOf,
} from '../../core/audioMix';
import { AUDIO_FADE_MS } from '../../core/fades';
import type { SceneEdit } from '../../shared/contract';
import type { AudioMedia, AudioMix, Media, Scene } from '../../shared/domain';

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
  };
}

const library: Media[] = [
  audio('m1', 'music'),
  audio('m2', 'music'),
  audio('a1', 'ambience'),
  audio('a2', 'ambience'),
];

function scene(changes: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Taverne',
    title: '',
    backgrounds: [],
    overlays: [],
    music: ['m1', 'm2'],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: '',
    ...changes,
  };
}

const playingM1 = { music: { mediaId: 'm1', playback: 'playing' as const } };

describe('the mix', () => {
  it('plays the current Music at Master × the Scene Music level, looping, by its Media', () => {
    const mix = mixOf(
      {
        scene: scene({ volumes: { music: 0.5, ambience: 1 } }),
        library,
        masterVolume: 0.8,
        audio: playingM1,
      },
      'activate',
    );

    expect(mix).toEqual({
      fadeMs: AUDIO_FADE_MS.activate,
      voices: [
        {
          mediaId: 'm1',
          role: 'music',
          name: 'Nom m1',
          src: expect.stringContaining('regie-media://media/c1/m1'),
          gain: 0.4,
          playing: true,
        },
      ],
    });
  });

  it('plays switched-on Ambiences at Master × the Ambience level × their own volume', () => {
    const mix = mixOf(
      {
        scene: scene({
          music: [],
          volumes: { music: 1, ambience: 0.5 },
          ambiences: [
            { mediaId: 'a1', on: true, volume: 0.5 },
            { mediaId: 'a2', on: false, volume: 1 },
          ],
        }),
        library,
        masterVolume: 0.5,
        audio: { music: null },
      },
      'ambience',
    );

    expect(mix.voices).toEqual([
      expect.objectContaining({ mediaId: 'a1', role: 'ambience', gain: 0.125, playing: true }),
    ]);
    expect(mix.fadeMs).toBe(AUDIO_FADE_MS.ambience);
  });

  it('keeps a paused Music as a voice that is not playing, and drops a stopped one', () => {
    const input = { scene: scene(), library, masterVolume: 1 };
    const paused = mixOf(
      { ...input, audio: { music: { mediaId: 'm1', playback: 'paused' } } },
      'pause',
    );
    const stopped = mixOf(
      { ...input, audio: { music: { mediaId: 'm1', playback: 'stopped' } } },
      'stop',
    );

    expect(paused.voices).toEqual([expect.objectContaining({ mediaId: 'm1', playing: false })]);
    expect(stopped.voices).toEqual([]);
  });

  it('is silent with no Active Scene, whatever the audio state says', () => {
    expect(
      mixOf({ scene: null, library, masterVolume: 1, audio: playingM1 }, 'stop').voices,
    ).toEqual([]);
  });

  it('leaves out Media that are not audio of the library (deleted, or an image)', () => {
    const mix = mixOf(
      {
        scene: scene({ ambiences: [{ mediaId: 'gone', on: true, volume: 1 }] }),
        library: [],
        masterVolume: 1,
        audio: playingM1,
      },
      'activate',
    );

    expect(mix.voices).toEqual([]);
  });

  it('applies the Master volume to every voice', () => {
    const input = {
      scene: scene({ ambiences: [{ mediaId: 'a1', on: true, volume: 1 }] }),
      library,
      audio: playingM1,
    };

    expect(mixOf({ ...input, masterVolume: 0 }, 'volume').voices.map((v) => v.gain)).toEqual([
      0, 0,
    ]);
    expect(mixOf({ ...input, masterVolume: 0.3 }, 'volume').voices.map((v) => v.gain)).toEqual([
      0.3, 0.3,
    ]);
  });
});

describe('the current Music', () => {
  it('Activate starts the Scene’s first Music, playing', () => {
    expect(activatedMusic(scene())).toEqual({ mediaId: 'm1', playback: 'playing' });
  });

  it('Activate starts no Music on a Scene without Music', () => {
    expect(activatedMusic(scene({ music: [] }))).toBeNull();
  });

  it('stays the same after an edit while it is still in the Scene’s Music list', () => {
    const current = { mediaId: 'm2', playback: 'paused' as const };

    expect(musicAfterEdit(scene({ music: ['m2'] }), current)).toEqual(current);
    expect(musicAfterEdit(scene({ music: ['m1'] }), current)).toBeNull();
    expect(musicAfterEdit(scene(), null)).toBeNull();
  });
});

describe('fades of a Scene edit', () => {
  it('adding Music takes a short ramp; picture edits change nothing that is heard', () => {
    const edits: [SceneEdit, string][] = [
      [{ kind: 'add-music', mediaId: 'm1' }, 'volume'],
      [{ kind: 'rename', name: 'x' }, 'volume'],
    ];
    for (const [edit, change] of edits) expect(audioChangeOf(edit)).toBe(change);
  });
});

describe('what is sounding', () => {
  const mix: AudioMix = {
    version: 3,
    fadeMs: 0,
    voices: [
      { mediaId: 'm1', role: 'music', name: 'Nom m1', src: 'x', gain: 1, playing: true },
      { mediaId: 'a1', role: 'ambience', name: 'Nom a1', src: 'y', gain: 1, playing: true },
    ],
  };

  it('shows each voice of the mix as the engine reports it, loading until it does', () => {
    expect(soundingOf(mix, { voices: [{ mediaId: 'm1', state: 'playing' }] })).toEqual({
      voices: [
        { mediaId: 'm1', role: 'music', name: 'Nom m1', state: 'playing' },
        { mediaId: 'a1', role: 'ambience', name: 'Nom a1', state: 'loading' },
      ],
    });
  });

  it('ignores voices the engine still holds that left the mix (fading out)', () => {
    expect(
      soundingOf({ ...mix, voices: [] }, { voices: [{ mediaId: 'm1', state: 'playing' }] }),
    ).toEqual({ voices: [] });
  });
});

describe('untrusted engine reports', () => {
  it('keeps only the report’s fields', () => {
    expect(
      parseAudioEngineReport({
        voices: [{ mediaId: 'm1', state: 'failed', extra: 1 }],
        extra: true,
      }),
    ).toEqual({ voices: [{ mediaId: 'm1', state: 'failed' }] });
  });

  it.each([
    ['no voices', {}],
    ['an unknown state', { voices: [{ mediaId: 'm1', state: 'loud' }] }],
    ['an empty Media id', { voices: [{ mediaId: '', state: 'playing' }] }],
    [
      'too many voices',
      { voices: Array.from({ length: 65 }, () => ({ mediaId: 'm', state: 'playing' })) },
    ],
    ['not an object', 'playing'],
  ])('refuses a report with %s', (_case, value) => {
    expect(parseAudioEngineReport(value)).toBeUndefined();
  });
});

describe('the newest mix', () => {
  const at = (version: number): AudioMix => ({ version, fadeMs: 0, voices: [] });

  it('takes a mix only if it is newer than the one applied', () => {
    expect(latestMix(null, at(1))).toEqual(at(1));
    expect(latestMix(at(2), at(1))).toEqual(at(2));
    expect(latestMix(at(2), at(3))).toEqual(at(3));
  });
});
