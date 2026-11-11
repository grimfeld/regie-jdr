import { describe, expect, it } from 'vitest';
import {
  activatedMusic,
  audioChangeOf,
  latestMix,
  mixOf,
  musicAfterEdit,
  musicWithPlayback,
  newlyUnplayable,
  parseAudioEngineReport,
  pickedMusic,
  soundingOf,
} from '../../core/audioMix';
import { AUDIO_FADE_MS } from '../../core/fades';
import type { SceneEdit } from '../../shared/contract';
import type { AudioMedia, AudioMix, Media, Scene, SoundingState } from '../../shared/domain';

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
      missing: [],
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

  it('leaves Media whose file is missing out of the mix, listed as missing; the others play on', () => {
    const mix = mixOf(
      {
        scene: scene({
          ambiences: [
            { mediaId: 'a1', on: true, volume: 1 },
            { mediaId: 'a2', on: true, volume: 1 },
          ],
        }),
        library,
        masterVolume: 1,
        audio: playingM1,
        missing: new Set(['m1', 'a2']),
      },
      'activate',
    );

    expect(mix.voices).toEqual([
      expect.objectContaining({ mediaId: 'a1', role: 'ambience', gain: 1, playing: true }),
    ]);
    expect(mix.missing).toEqual([
      { mediaId: 'm1', role: 'music', name: 'Nom m1' },
      { mediaId: 'a2', role: 'ambience', name: 'Nom a2' },
    ]);
  });

  it('lists as missing only what would be heard: not a switched-off Ambience', () => {
    const mix = mixOf(
      {
        scene: scene({ music: [], ambiences: [{ mediaId: 'a1', on: false, volume: 1 }] }),
        library,
        masterVolume: 1,
        audio: { music: null },
        missing: new Set(['a1', 'm1']),
      },
      'activate',
    );

    expect(mix).toMatchObject({ voices: [], missing: [] });
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

  it('picking a track of the Active Scene plays it, whatever played before', () => {
    expect(pickedMusic(scene(), 'm2')).toEqual({ mediaId: 'm2', playback: 'playing' });
  });

  it('refuses a pick with no Active Scene or of a Music not in its list, in French', () => {
    expect(() => pickedMusic(null, 'm1')).toThrow('Activez une scène pour choisir sa musique.');
    expect(() => pickedMusic(scene({ music: ['m1'] }), 'm2')).toThrow(
      'Cette musique n’est pas dans la scène active.',
    );
  });

  it('pauses, resumes and stops the current Music, keeping which one it is', () => {
    const current = { mediaId: 'm2', playback: 'playing' as const };
    for (const playback of ['paused', 'playing', 'stopped'] as const) {
      expect(musicWithPlayback(scene(), current, playback)).toEqual({ mediaId: 'm2', playback });
    }
  });

  it('play with no current Music starts the first; pause or stop leaves none', () => {
    expect(musicWithPlayback(scene(), null, 'playing')).toEqual({
      mediaId: 'm1',
      playback: 'playing',
    });
    expect(musicWithPlayback(scene(), null, 'paused')).toBeNull();
    expect(musicWithPlayback(scene(), null, 'stopped')).toBeNull();
    expect(() => musicWithPlayback(scene({ music: [] }), null, 'playing')).toThrow(
      'La scène active n’a pas de musique.',
    );
    expect(() => musicWithPlayback(null, null, 'playing')).toThrow(
      'Activez une scène pour lancer sa musique.',
    );
  });
});

describe('a crossfade between two tracks', () => {
  const input = {
    scene: scene({ volumes: { music: 0.5, ambience: 1 } }),
    library,
    masterVolume: 1,
  };
  const before = mixOf({ ...input, audio: playingM1 }, 'activate');
  const after = mixOf(
    { ...input, audio: { music: { mediaId: 'm2', playback: 'playing' } } },
    'crossfade',
  );

  it('drops the old track and brings the new one in at the same level, over 2 s', () => {
    expect(before.voices.map(({ mediaId, gain }) => ({ mediaId, gain }))).toEqual([
      { mediaId: 'm1', gain: 0.5 },
    ]);
    expect(after.voices.map(({ mediaId, gain }) => ({ mediaId, gain }))).toEqual([
      { mediaId: 'm2', gain: 0.5 },
    ]);
    expect(after.fadeMs).toBe(2000);
  });
});

describe('fades of a Scene edit', () => {
  it('a Music level or list change takes a short ramp; removing the current Music fades it', () => {
    const edits: [SceneEdit, string][] = [
      [{ kind: 'add-music', mediaId: 'm1' }, 'volume'],
      [{ kind: 'move-music', mediaId: 'm1', toIndex: 1 }, 'volume'],
      [{ kind: 'set-music-level', level: 0.5 }, 'volume'],
      [{ kind: 'remove-music', mediaId: 'm1' }, 'pause'],
      [{ kind: 'rename', name: 'x' }, 'volume'],
    ];
    for (const [edit, change] of edits) expect(audioChangeOf(edit)).toBe(change);
  });
});

describe('what is sounding', () => {
  const mix: AudioMix = {
    version: 3,
    fadeMs: 0,
    missing: [],
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
      pads: [],
    });
  });

  it('shows the Soundboard pads sounding beside the voices', () => {
    const pads = [{ padId: 'p1', name: 'Épée' }];
    expect(soundingOf({ ...mix, voices: [] }, { voices: [] }, pads)).toEqual({ voices: [], pads });
  });

  it('shows the voices left out for a missing file after the others, as missing', () => {
    const withMissing: AudioMix = {
      ...mix,
      missing: [{ mediaId: 'a2', role: 'ambience', name: 'Nom a2' }],
    };
    expect(
      soundingOf(withMissing, { voices: [] }).voices.map(({ mediaId, state }) => [mediaId, state]),
    ).toEqual([
      ['m1', 'loading'],
      ['a1', 'loading'],
      ['a2', 'missing'],
    ]);
  });

  it('ignores voices the engine still holds that left the mix (fading out)', () => {
    expect(
      soundingOf({ ...mix, voices: [] }, { voices: [{ mediaId: 'm1', state: 'playing' }] }),
    ).toEqual({ voices: [], pads: [] });
  });
});

describe('sounds that cannot be played', () => {
  const sounding = (...states: [string, SoundingState][]) => ({
    pads: [],
    voices: states.map(([mediaId, state]) => ({
      mediaId,
      role: 'ambience' as const,
      name: `Nom ${mediaId}`,
      state,
    })),
  });

  it('are told once, when they become missing or unreadable', () => {
    const first = sounding(['m1', 'missing'], ['a1', 'loading']);
    const failed = sounding(['m1', 'missing'], ['a1', 'failed']);

    expect(newlyUnplayable(null, first).map((voice) => voice.mediaId)).toEqual(['m1']);
    expect(newlyUnplayable(first, failed).map((voice) => voice.mediaId)).toEqual(['a1']);
    expect(newlyUnplayable(failed, failed)).toEqual([]);
    expect(newlyUnplayable(failed, sounding(['a1', 'missing']))).toEqual([]);
  });

  it('are told again once they played in between', () => {
    const missing = sounding(['m1', 'missing']);
    expect(newlyUnplayable(sounding(['m1', 'playing']), missing)).toHaveLength(1);
    expect(newlyUnplayable(sounding(), missing)).toHaveLength(1);
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
  const at = (version: number): AudioMix => ({ version, fadeMs: 0, voices: [], missing: [] });

  it('takes a mix only if it is newer than the one applied', () => {
    expect(latestMix(null, at(1))).toEqual(at(1));
    expect(latestMix(at(2), at(1))).toEqual(at(2));
    expect(latestMix(at(2), at(3))).toEqual(at(3));
  });
});
