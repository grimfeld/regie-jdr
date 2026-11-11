import { describe, expect, it } from 'vitest';
import { AUDIO_FADE_MS } from '../../core/fades';
import {
  createPadVoices,
  MAX_PAD_VOICES,
  padGain,
  parsePadReport,
  type PadPress,
} from '../../core/padVoices';

function press(padId: string, gain = 0.5): PadPress {
  return { padId, name: `Pad ${padId}`, src: `regie-media://media/c1/${padId}.wav`, gain };
}

describe('pad voices', () => {
  it('plays a pad once per press, numbering its pad sounds in press order', () => {
    const pads = createPadVoices();

    expect(pads.press(press('p1'))).toEqual([
      { kind: 'play', voiceId: 1, src: 'regie-media://media/c1/p1.wav', gain: 0.5 },
    ]);
    expect(pads.press(press('p2'))).toEqual([
      { kind: 'play', voiceId: 2, src: 'regie-media://media/c1/p2.wav', gain: 0.5 },
    ]);
  });

  it('starts an overlapping copy when a pad still sounding is pressed again', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 });

    const commands = pads.press(press('p1'));

    expect(commands).toEqual([expect.objectContaining({ kind: 'play', voiceId: 2 })]);
    pads.report({
      voices: [
        { voiceId: 1, state: 'playing' },
        { voiceId: 2, state: 'playing' },
      ],
      upTo: 2,
    });
    // Lit once, though it sounds twice.
    expect(pads.sounding()).toEqual([{ padId: 'p1', name: 'Pad p1' }]);
  });

  it(`plays at most ${MAX_PAD_VOICES} pad sounds at once, cutting the oldest first with a short fade`, () => {
    const pads = createPadVoices();
    for (let n = 1; n <= MAX_PAD_VOICES; n += 1) {
      expect(pads.press(press(`p${n}`))).toHaveLength(1);
    }

    expect(pads.press(press('p9'))).toEqual([
      { kind: 'cut', voiceIds: [1], fadeMs: AUDIO_FADE_MS.pad },
      expect.objectContaining({ kind: 'play', voiceId: 9 }),
    ]);
    expect(pads.press(press('p10'))).toEqual([
      { kind: 'cut', voiceIds: [2], fadeMs: AUDIO_FADE_MS.pad },
      expect.objectContaining({ kind: 'play', voiceId: 10 }),
    ]);
  });

  it('counts only pad sounds still sounding: ended ones leave room without a cut', () => {
    const pads = createPadVoices();
    for (let n = 1; n <= MAX_PAD_VOICES; n += 1) pads.press(press(`p${n}`));
    // The engine got all eight; the second one ended (it holds it no more).
    pads.report({
      voices: [1, 3, 4, 5, 6, 7, 8].map((voiceId) => ({ voiceId, state: 'playing' as const })),
      upTo: 8,
    });

    expect(pads.press(press('p9'))).toEqual([expect.objectContaining({ kind: 'play' })]);
    // Now full again: the oldest still sounding (the first) goes.
    expect(pads.press(press('p10'))).toEqual([
      { kind: 'cut', voiceIds: [1], fadeMs: AUDIO_FADE_MS.pad },
      expect.objectContaining({ kind: 'play', voiceId: 10 }),
    ]);
  });

  it('keeps a pad sound the engine has not received yet as loading, not ended', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.press(press('p2'));

    // A report sent before the engine got the second press.
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 });
    pads.report({ voices: [], upTo: 1 });

    expect(pads.sounding()).toEqual([]);
    pads.report({ voices: [{ voiceId: 2, state: 'playing' }], upTo: 2 });
    expect(pads.sounding()).toEqual([{ padId: 'p2', name: 'Pad p2' }]);
  });

  it('lights a pad only while the engine reports one of its pad sounds playing', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    expect(pads.sounding()).toEqual([]);

    expect(pads.report({ voices: [{ voiceId: 1, state: 'loading' }], upTo: 1 })).toBe(false);
    expect(pads.sounding()).toEqual([]);
    expect(pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 })).toBe(true);
    expect(pads.sounding()).toEqual([{ padId: 'p1', name: 'Pad p1' }]);
    expect(pads.report({ voices: [], upTo: 1 })).toBe(true);
    expect(pads.sounding()).toEqual([]);
  });

  it('cuts every pad sound when everything stops, and forgets them all', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.press(press('p2'));
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 2 });

    expect(pads.clear()).toEqual([{ kind: 'cut', voiceIds: [1], fadeMs: AUDIO_FADE_MS.stop }]);
    expect(pads.sounding()).toEqual([]);
    expect(pads.clear()).toEqual([]);
  });

  it('forgets every pad sound when the engine restarts, keeping the numbering going', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 });

    pads.forget();

    expect(pads.sounding()).toEqual([]);
    expect(pads.press(press('p1'))).toEqual([expect.objectContaining({ voiceId: 2 })]);
  });

  it('retunes the pad sounds still sounding to new levels, with a short ramp', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.press(press('p2'));
    pads.press(press('p1'));

    const commands = pads.retune(
      new Map([
        ['p1', { name: 'Pad p1', gain: 0.25 }],
        ['p2', { name: 'Pad p2', gain: 0.5 }],
      ]),
    );

    // p2 kept its level: nothing to send for it.
    expect(commands).toEqual([
      { kind: 'gain', voiceIds: [1, 3], gain: 0.25, fadeMs: AUDIO_FADE_MS.volume },
    ]);
    // Pressed again later, it plays at the level given then; a second retune to the same
    // level changes nothing.
    expect(pads.retune(new Map([['p1', { name: 'Pad p1', gain: 0.25 }]]))).toEqual([]);
  });

  it('renames the pads sounding, as the "En cours" strip shows them', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 });

    pads.retune(new Map([['p1', { name: 'Hurlement', gain: 0.5 }]]));

    expect(pads.sounding()).toEqual([{ padId: 'p1', name: 'Hurlement' }]);
  });

  it('leaves alone the pad sounds of pads it is not told about (a pad removed)', () => {
    const pads = createPadVoices();
    pads.press(press('p1'));
    pads.report({ voices: [{ voiceId: 1, state: 'playing' }], upTo: 1 });

    expect(pads.retune(new Map())).toEqual([]);
    expect(pads.sounding()).toEqual([{ padId: 'p1', name: 'Pad p1' }]);
  });
});

describe('pad gain', () => {
  it('is Master volume × Soundboard level × pad volume', () => {
    expect(padGain(0.5, 0.8, 0.5)).toBeCloseTo(0.2);
    expect(padGain(1, 1, 1)).toBe(1);
    expect(padGain(0, 1, 1)).toBe(0);
  });
});

describe('pad report parsing', () => {
  it('keeps only the report fields', () => {
    expect(
      parsePadReport({ voices: [{ voiceId: 3, state: 'playing', extra: 1 }], upTo: 3, x: 2 }),
    ).toEqual({ voices: [{ voiceId: 3, state: 'playing' }], upTo: 3 });
  });

  it.each([
    ['no voices', { upTo: 1 }],
    ['no upTo', { voices: [] }],
    ['a negative upTo', { voices: [], upTo: -1 }],
    ['a fractional voice id', { voices: [{ voiceId: 1.5, state: 'playing' }], upTo: 2 }],
    ['an unknown state', { voices: [{ voiceId: 1, state: 'ringing' }], upTo: 1 }],
    [
      'too many voices',
      {
        voices: Array.from({ length: 65 }, (_, i) => ({ voiceId: i + 1, state: 'playing' })),
        upTo: 65,
      },
    ],
  ])('refuses %s', (_name, value) => {
    expect(parsePadReport(value)).toBeUndefined();
  });
});
