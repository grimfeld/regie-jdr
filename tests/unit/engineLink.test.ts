import { describe, expect, it } from 'vitest';
import { createAudioOnAir } from '../../core/audioOnAir';
import { createEngineLink } from '../../core/engineLink';
import { emptyNotes } from '../../core/notes';
import { createPadVoices } from '../../core/padVoices';
import type { AudioMedia, Scene } from '../../shared/domain';

function sound(id: string, role: AudioMedia['role']): AudioMedia {
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

const taverne: Scene = {
  id: 's1',
  campaignId: 'c1',
  name: 'Taverne',
  title: '',
  backgrounds: [],
  overlays: [],
  music: ['m1'],
  ambiences: [],
  volumes: { music: 1, ambience: 1 },
  notes: emptyNotes(),
  transition: 'crossfade',
};

function setup() {
  const audio = createAudioOnAir();
  const pads = createPadVoices();
  const link = createEngineLink(audio, pads);
  audio.activateScene(taverne, [sound('m1', 'music')], new Set());
  return { audio, pads, link };
}

describe('the link with the audio engine', () => {
  it('shows each voice of the mix as the engine last reported it', () => {
    const { link } = setup();
    expect(link.sounding().voices).toMatchObject([{ mediaId: 'm1', state: 'loading' }]);

    link.engineReported({ voices: [{ mediaId: 'm1', state: 'playing' }] });

    expect(link.sounding().voices).toMatchObject([{ mediaId: 'm1', state: 'playing' }]);
  });

  it('carries the Master volume, for listening to a library sound at the level of the rest', () => {
    const { audio, link } = setup();
    expect(link.sounding().masterVolume).toBe(1);

    audio.setMasterVolume(0.4);

    expect(link.sounding().masterVolume).toBe(0.4);
  });

  it('forgets the last report when the engine starts again (Control window reloaded)', () => {
    const { link } = setup();
    link.engineReported({ voices: [{ mediaId: 'm1', state: 'playing' }] });

    link.engineStarted();

    // The new engine holds nothing yet: the Music is loading, not still playing.
    expect(link.sounding().voices).toMatchObject([{ mediaId: 'm1', state: 'loading' }]);
  });

  it('forgets the pad sounds when the engine starts again', () => {
    const { pads, link } = setup();
    const [play] = pads.press({ padId: 'p1', name: 'Cri', src: 'x', gain: 1 });
    if (play.kind !== 'play') throw new Error('expected a play command');
    pads.report({ voices: [{ voiceId: play.voiceId, state: 'playing' }], upTo: play.voiceId });
    expect(link.sounding().pads).toEqual([{ padId: 'p1', name: 'Cri' }]);

    link.engineStarted();

    expect(link.sounding().pads).toEqual([]);
  });
});
