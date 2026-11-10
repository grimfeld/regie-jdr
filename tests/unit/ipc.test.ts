import { describe, expect, it } from 'vitest';
import { checkInvoke } from '../../core/ipc';

const display = { title: 'La taverne', background: 'regie-asset://assets/a.png', description: '' };

describe('sender policy', () => {
  it('lets the Control window call every channel', () => {
    expect(checkInvoke('display:get', 'control', [])).toEqual({ ok: true, payload: undefined });
    expect(checkInvoke('display:set', 'control', [display])).toEqual({
      ok: true,
      payload: display,
    });
    expect(checkInvoke('broadcast:open', 'control', [])).toMatchObject({ ok: true });
    expect(checkInvoke('media:import-images', 'control', [])).toMatchObject({ ok: true });
  });

  it('lets the Broadcast window read', () => {
    expect(checkInvoke('display:get', 'broadcast', [])).toMatchObject({ ok: true });
  });

  it('rejects every mutation from the Broadcast window', () => {
    for (const [channel, args] of [
      ['display:set', [display]],
      ['broadcast:open', []],
      ['media:import-images', []],
    ] as const) {
      const verdict = checkInvoke(channel, 'broadcast', [...args]);
      expect(verdict.ok).toBe(false);
      expect(verdict).toMatchObject({ reason: expect.stringContaining('broadcast') });
    }
  });

  it('rejects messages from a window that is neither the Control nor the Broadcast window', () => {
    expect(checkInvoke('display:get', undefined, [])).toMatchObject({ ok: false });
  });

  it('rejects channels missing from the contract', () => {
    expect(checkInvoke('fs:delete-everything', 'control', [])).toMatchObject({ ok: false });
    expect(checkInvoke('__proto__', 'control', [])).toMatchObject({ ok: false });
    expect(checkInvoke('toString', 'control', [])).toMatchObject({ ok: false });
  });
});

describe('payload guards', () => {
  it.each([
    ['nothing', []],
    ['null', [null]],
    ['a string', ['La taverne']],
    ['an array', [[display]]],
    ['a missing field', [{ title: 'La taverne', background: '' }]],
    ['a field of the wrong type', [{ ...display, title: 42 }]],
    ['two arguments', [display, display]],
  ])('rejects a display given as %s', (_label, args) => {
    expect(checkInvoke('display:set', 'control', args)).toMatchObject({ ok: false });
  });

  it('rejects an argument on a channel that takes none', () => {
    expect(checkInvoke('broadcast:open', 'control', [{}])).toMatchObject({ ok: false });
    expect(checkInvoke('display:get', 'broadcast', [undefined])).toMatchObject({ ok: false });
  });

  it('keeps only the contract fields of an accepted display', () => {
    const verdict = checkInvoke('display:set', 'control', [{ ...display, injected: true }]);
    expect(verdict).toEqual({ ok: true, payload: display });
  });
});
