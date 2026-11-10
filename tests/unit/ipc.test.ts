import { describe, expect, it } from 'vitest';
import { checkInvoke } from '../../core/ipc';

const campaign = { campaignId: 'star-wars' };
const scene = { sceneId: 'cantina' };

describe('sender policy', () => {
  it('lets the Control window call every channel', () => {
    expect(checkInvoke('onAir:get', 'control', [])).toEqual({ ok: true, payload: undefined });
    expect(checkInvoke('onAir:open-campaign', 'control', [campaign])).toEqual({
      ok: true,
      payload: campaign,
    });
    expect(checkInvoke('onAir:close-campaign', 'control', [])).toMatchObject({ ok: true });
    expect(checkInvoke('onAir:activate-scene', 'control', [scene])).toEqual({
      ok: true,
      payload: scene,
    });
    expect(checkInvoke('broadcast:open', 'control', [])).toMatchObject({ ok: true });
    expect(checkInvoke('media:import-images', 'control', [])).toMatchObject({ ok: true });
  });

  it('lets the Broadcast window read the on-air state', () => {
    expect(checkInvoke('onAir:get', 'broadcast', [])).toMatchObject({ ok: true });
  });

  it('rejects every mutation from the Broadcast window', () => {
    for (const [channel, args] of [
      ['onAir:open-campaign', [campaign]],
      ['onAir:close-campaign', []],
      ['onAir:activate-scene', [scene]],
      ['broadcast:open', []],
      ['media:import-images', []],
    ] as const) {
      const verdict = checkInvoke(channel, 'broadcast', [...args]);
      expect(verdict.ok).toBe(false);
      expect(verdict).toMatchObject({ reason: expect.stringContaining('broadcast') });
    }
  });

  it('rejects messages from a window that is neither the Control nor the Broadcast window', () => {
    expect(checkInvoke('onAir:get', undefined, [])).toMatchObject({ ok: false });
  });

  it('rejects channels missing from the contract', () => {
    expect(checkInvoke('fs:delete-everything', 'control', [])).toMatchObject({ ok: false });
    expect(checkInvoke('display:set', 'control', [{}])).toMatchObject({ ok: false });
    expect(checkInvoke('__proto__', 'control', [])).toMatchObject({ ok: false });
    expect(checkInvoke('toString', 'control', [])).toMatchObject({ ok: false });
  });
});

describe('payload guards', () => {
  it.each([
    ['nothing', []],
    ['null', [null]],
    ['a bare string', ['star-wars']],
    ['an array', [[campaign]]],
    ['a missing id', [{}]],
    ['an id of the wrong type', [{ campaignId: 42 }]],
    ['an empty id', [{ campaignId: '' }]],
    ['two arguments', [campaign, campaign]],
  ])('rejects a Campaign to open given as %s', (_label, args) => {
    expect(checkInvoke('onAir:open-campaign', 'control', args)).toMatchObject({ ok: false });
  });

  it.each([
    ['nothing', []],
    ['a missing id', [{ campaignId: 'star-wars' }]],
    ['an id of the wrong type', [{ sceneId: null }]],
    ['an empty id', [{ sceneId: '' }]],
  ])('rejects a Scene to Activate given as %s', (_label, args) => {
    expect(checkInvoke('onAir:activate-scene', 'control', args)).toMatchObject({ ok: false });
  });

  it('rejects an argument on a channel that takes none', () => {
    expect(checkInvoke('broadcast:open', 'control', [{}])).toMatchObject({ ok: false });
    expect(checkInvoke('onAir:close-campaign', 'control', [campaign])).toMatchObject({
      ok: false,
    });
    expect(checkInvoke('onAir:get', 'broadcast', [undefined])).toMatchObject({ ok: false });
  });

  it('keeps only the contract fields of an accepted payload', () => {
    expect(
      checkInvoke('onAir:open-campaign', 'control', [{ ...campaign, injected: true }]),
    ).toEqual({ ok: true, payload: campaign });
    expect(checkInvoke('onAir:activate-scene', 'control', [{ ...scene, version: 7 }])).toEqual({
      ok: true,
      payload: scene,
    });
  });
});
