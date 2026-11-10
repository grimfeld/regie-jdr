import { describe, expect, it } from 'vitest';
import { FADE_DURATION_MS, parseFadeDuration, withLeaving, withoutLeaving } from '../../core/fades';

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
