import { describe, expect, it } from 'vitest';
import {
  ACTIVATE_DURATION_MS,
  AUDIO_FADE_MS,
  FADE_DURATION_MS,
  dissolveEnded,
  dissolveStarted,
  firstLayers,
  parseFadeDuration,
  withLeaving,
  withNewestPicture,
  withoutLeaving,
  withTransition,
} from '../../core/fades';

const keyOf = (item: { id: string }) => item.id;
const shown = (...ids: string[]) => ids.map((id) => ({ key: id, item: { id }, leaving: false }));

describe('the fade duration', () => {
  it('defaults to 0.6 s, within its bounds', () => {
    expect(FADE_DURATION_MS.default).toBe(600);
    expect(parseFadeDuration(FADE_DURATION_MS.default)).toBe(600);
  });

  it('accepts whole milliseconds from no fade up to the maximum', () => {
    expect(parseFadeDuration(0)).toBe(0);
    expect(parseFadeDuration(1200)).toBe(1200);
    expect(parseFadeDuration(FADE_DURATION_MS.max)).toBe(FADE_DURATION_MS.max);
  });

  it.each([
    ['a negative duration', -1],
    ['a duration above the maximum', FADE_DURATION_MS.max + 1],
    ['a fraction of a millisecond', 600.5],
    ['not a number', NaN],
    ['a string', '600'],
    ['nothing', undefined],
  ])('refuses %s', (_label, value) => {
    expect(parseFadeDuration(value)).toBeUndefined();
  });
});

describe('the items a renderer draws while they fade', () => {
  it('draws new items, none leaving, the first time', () => {
    expect(withLeaving([], [{ id: 'a' }, { id: 'b' }], keyOf)).toEqual(shown('a', 'b'));
  });

  it('keeps a removed item, as it was last drawn, where it stood in the stack', () => {
    const before = [
      { key: 'a', item: { id: 'a', x: 1 }, leaving: false },
      { key: 'b', item: { id: 'b', x: 1 }, leaving: false },
      { key: 'c', item: { id: 'c', x: 1 }, leaving: false },
    ];
    expect(
      withLeaving(
        before,
        [
          { id: 'a', x: 2 },
          { id: 'c', x: 2 },
        ],
        keyOf,
      ),
    ).toEqual([
      { key: 'a', item: { id: 'a', x: 2 }, leaving: false },
      { key: 'b', item: { id: 'b', x: 1 }, leaving: true },
      { key: 'c', item: { id: 'c', x: 2 }, leaving: false },
    ]);
  });

  it('keeps removed items at the bottom of the stack in their order', () => {
    expect(withLeaving(shown('a', 'b', 'c'), [{ id: 'c' }], keyOf)).toEqual([
      { key: 'a', item: { id: 'a' }, leaving: true },
      { key: 'b', item: { id: 'b' }, leaving: true },
      { key: 'c', item: { id: 'c' }, leaving: false },
    ]);
  });

  it('draws the old picture fading out below a new one fading in', () => {
    expect(withLeaving(shown('a'), [{ id: 'z' }], keyOf)).toEqual([
      { key: 'a', item: { id: 'a' }, leaving: true },
      { key: 'z', item: { id: 'z' }, leaving: false },
    ]);
  });

  it('brings back an item shown again while it fades out', () => {
    const fading = withLeaving(shown('a', 'b'), [{ id: 'a' }], keyOf);
    expect(withLeaving(fading, [{ id: 'a' }, { id: 'b' }], keyOf)).toEqual(shown('a', 'b'));
  });

  it('keeps an item that is still fading out when another one leaves', () => {
    const fading = withLeaving(shown('a', 'b', 'c'), [{ id: 'a' }, { id: 'c' }], keyOf);
    expect(withLeaving(fading, [{ id: 'c' }], keyOf)).toEqual([
      { key: 'a', item: { id: 'a' }, leaving: true },
      { key: 'b', item: { id: 'b' }, leaving: true },
      { key: 'c', item: { id: 'c' }, leaving: false },
    ]);
  });

  it('stops drawing items once they have faded out', () => {
    const fading = withLeaving(shown('a', 'b'), [{ id: 'b' }], keyOf);
    expect(withoutLeaving(fading)).toEqual(shown('b'));
  });
});

describe('the picture layers a renderer draws through Transitions', () => {
  const DURATION = 1000;
  const [cantina] = firstLayers(0, 'cantina');
  const keys = (layers: readonly { key: number }[]) => layers.map((layer) => layer.key);

  it('Activate dissolves picture and sound over the same 1.5 s', () => {
    expect(ACTIVATE_DURATION_MS).toBe(1500);
    expect(AUDIO_FADE_MS.activate).toBe(ACTIVATE_DURATION_MS);
  });

  it('draws the first picture as it is, with no dissolve', () => {
    expect(firstLayers(0, 'cantina')).toEqual([
      { key: 0, picture: 'cantina', durationMs: 0, phase: 'shown' },
    ]);
  });

  it('adds the incoming picture on top, transparent until its images are decoded', () => {
    expect(withTransition([cantina], 1, 'hangar', DURATION)).toEqual([
      cantina,
      { key: 1, picture: 'hangar', durationMs: DURATION, phase: 'waiting' },
    ]);
  });

  it('dissolves the incoming picture in, then draws it alone', () => {
    const waiting = withTransition([cantina], 1, 'hangar', DURATION);
    const dissolving = dissolveStarted(waiting, 1, 200);
    expect(dissolving.at(-1)).toMatchObject({ phase: 'dissolving', startedAt: 200 });
    expect(dissolveEnded(dissolving, 1)).toEqual([
      { key: 1, picture: 'hangar', durationMs: DURATION, phase: 'shown' },
    ]);
  });

  it('starts a new Transition from the frame on screen: a dissolve in progress stops where it is', () => {
    const dissolving = dissolveStarted(withTransition([cantina], 1, 'hangar', DURATION), 1, 0);
    const layers = withTransition(dissolving, 2, 'forest', DURATION);
    expect(keys(layers)).toEqual([0, 1, 2]);
    expect(layers[1]).toMatchObject({ phase: 'frozen' });
    expect(layers[2]).toMatchObject({ phase: 'waiting' });
  });

  it('drops an incoming picture still waiting for its images: nothing of it was seen', () => {
    const waiting = withTransition([cantina], 1, 'hangar', DURATION);
    expect(keys(withTransition(waiting, 2, 'forest', DURATION))).toEqual([0, 2]);
  });

  it('ignores the end or start of a dissolve a newer Transition replaced', () => {
    const first = dissolveStarted(withTransition([cantina], 1, 'hangar', DURATION), 1, 0);
    const layers = withTransition(first, 2, 'forest', DURATION);
    expect(dissolveEnded(layers, 1)).toEqual(layers);
    expect(dissolveStarted(layers, 1, 600)).toEqual(layers);
  });

  it('keeps the newest picture up to date, older ones as they were last drawn', () => {
    const layers = withTransition([cantina], 1, 'hangar', DURATION);
    expect(withNewestPicture(layers, 'hangar, edited').map((layer) => layer.picture)).toEqual([
      'cantina',
      'hangar, edited',
    ]);
  });
});
