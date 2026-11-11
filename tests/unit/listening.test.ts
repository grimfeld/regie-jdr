import { describe, expect, it } from 'vitest';
import { listeningAllowed } from '../../core/audioMix';
import type { AudioSounding, SoundingState } from '../../shared/domain';

function sounding(silence: boolean, voiceStates: SoundingState[] = [], pads = 0): AudioSounding {
  return {
    silence,
    masterVolume: 1,
    voices: voiceStates.map((state, index) => ({
      mediaId: `m${index}`,
      role: 'music',
      name: `Son ${index}`,
      state,
    })),
    pads: Array.from({ length: pads }, (_, index) => ({
      padId: `p${index}`,
      name: `Bruitage ${index}`,
    })),
  };
}

// ADR-0002: Discord carries every sound the app plays, so listening is never private.
describe('listening to a library sound', () => {
  it('is refused before the sounding state is known', () => {
    expect(listeningAllowed(null)).toBe(false);
  });

  it('is refused without Silence, even when nothing sounds', () => {
    expect(listeningAllowed(sounding(false))).toBe(false);
    expect(listeningAllowed(sounding(false, ['paused']))).toBe(false);
  });

  it('is allowed during Silence once nothing sounds', () => {
    expect(listeningAllowed(sounding(true))).toBe(true);
    expect(listeningAllowed(sounding(true, ['paused', 'missing', 'failed', 'loading']))).toBe(true);
  });

  it('waits for the voices to finish fading out into Silence', () => {
    expect(listeningAllowed(sounding(true, ['paused', 'playing']))).toBe(false);
  });

  it('is refused while a pad sounds, Silence or not', () => {
    expect(listeningAllowed(sounding(true, [], 1))).toBe(false);
  });
});
