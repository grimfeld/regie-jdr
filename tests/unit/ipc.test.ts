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
      ['media:import', [{ campaignId: 'star-wars', accept: 'image' }]],
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

describe('Campaign channels', () => {
  const id = '3f0c9a52-7a51-4d8e-9a43-0f0f2b0c1d2e';

  it('are for the Control window only', () => {
    for (const [channel, args] of [
      ['campaigns:list', []],
      ['campaigns:create', [{ name: 'Star Wars' }]],
      ['campaigns:update', [{ id, changes: { name: 'Star Wars' } }]],
      ['notices:take', []],
    ] as const) {
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
    }
  });

  it('accept a name to create, keeping only contract fields', () => {
    expect(checkInvoke('campaigns:create', 'control', [{ name: 'Star Wars', id: 'x' }])).toEqual({
      ok: true,
      payload: { name: 'Star Wars' },
    });
  });

  it('accept a rename, a theme change, or both', () => {
    expect(
      checkInvoke('campaigns:update', 'control', [
        { id, changes: { name: 'Star Wars', theme: 'retro', extra: 1 } },
      ]),
    ).toEqual({ ok: true, payload: { id, changes: { name: 'Star Wars', theme: 'retro' } } });
    expect(
      checkInvoke('campaigns:update', 'control', [{ id, changes: { theme: 'fantasy' } }]),
    ).toEqual({ ok: true, payload: { id, changes: { theme: 'fantasy' } } });
  });

  it.each([
    ['no name', 'campaigns:create', [{}]],
    ['a name that is not text', 'campaigns:create', [{ name: 42 }]],
    ['a huge name', 'campaigns:create', [{ name: 'x'.repeat(10_000) }]],
    ['an id that is a path', 'campaigns:update', [{ id: '../..', changes: { name: 'X' } }]],
    ['an unknown theme', 'campaigns:update', [{ id, changes: { theme: 'neon' } }]],
    ['no changes object', 'campaigns:update', [{ id }]],
    ['a name of the wrong type', 'campaigns:update', [{ id, changes: { name: null } }]],
  ] as const)('reject %s', (_label, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});

describe('Media channels', () => {
  const campaignId = '3f0c9a52-7a51-4d8e-9a43-0f0f2b0c1d2e';
  const mediaId = '9b2d1c3e-1111-4d8e-9a43-0f0f2b0c1d2e';

  it('are for the Control window only', () => {
    for (const [channel, args] of [
      ['media:list', [{ campaignId }]],
      ['media:import', [{ campaignId, accept: 'image' }]],
      ['media:set-category', [{ campaignId, mediaId, category: 'character' }]],
      ['media:delete', [{ campaignId, mediaId, confirmed: false }]],
    ] as const) {
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
    }
  });

  it('accept an image import, or an audio import with one of the three roles', () => {
    expect(
      checkInvoke('media:import', 'control', [{ campaignId, accept: 'image', role: 'music' }]),
    ).toEqual({ ok: true, payload: { campaignId, accept: 'image' } });
    for (const role of ['music', 'soundEffect', 'ambience']) {
      expect(
        checkInvoke('media:import', 'control', [{ campaignId, accept: 'audio', role, x: 1 }]),
      ).toEqual({ ok: true, payload: { campaignId, accept: 'audio', role } });
    }
  });

  it('accept a category change, keeping only contract fields', () => {
    expect(
      checkInvoke('media:set-category', 'control', [
        { campaignId, mediaId, category: 'scenery', role: 'music' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, mediaId, category: 'scenery' } });
  });

  it('accept a delete, confirmed or not, keeping only contract fields', () => {
    for (const confirmed of [true, false]) {
      expect(
        checkInvoke('media:delete', 'control', [{ campaignId, mediaId, confirmed, x: 1 }]),
      ).toEqual({ ok: true, payload: { campaignId, mediaId, confirmed } });
    }
  });

  it.each([
    ['a delete with no Media id', 'media:delete', [{ campaignId, confirmed: true }]],
    ['a delete with no confirmation flag', 'media:delete', [{ campaignId, mediaId }]],
    ['a delete confirmed by a string', 'media:delete', [{ campaignId, mediaId, confirmed: 'yes' }]],
    [
      'a delete with a Campaign id that is a path',
      'media:delete',
      [{ campaignId: '..', mediaId, confirmed: true }],
    ],
    ['a Campaign id that is a path', 'media:list', [{ campaignId: '../..' }]],
    ['no Campaign id', 'media:list', [{}]],
    ['an unknown kind', 'media:import', [{ campaignId, accept: 'video' }]],
    ['audio with no role', 'media:import', [{ campaignId, accept: 'audio' }]],
    ['audio with an unknown role', 'media:import', [{ campaignId, accept: 'audio', role: 'loop' }]],
    [
      'source files chosen by the window',
      'media:import',
      [{ campaignId, accept: 'image' }, ['C:/x.png']],
    ],
    ['an unknown category', 'media:set-category', [{ campaignId, mediaId, category: 'creature' }]],
    ['no Media id', 'media:set-category', [{ campaignId, category: 'scenery' }]],
  ] as const)('reject %s', (_label, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});

describe('Scene channels', () => {
  const campaignId = 'star-wars';
  const edit = {
    campaignId,
    sceneId: 'cantina',
    edit: { kind: 'set-visible', placementId: 'b1', visible: true },
  };

  it('are for the Control window only', () => {
    for (const [channel, args] of [
      ['scenes:list', [{ campaignId }]],
      ['scenes:create', [{ campaignId, name: 'X' }]],
      ['scenes:edit', [edit]],
    ] as const) {
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
    }
  });

  it('accept an edit command, keeping only contract fields', () => {
    const padded = { ...edit, extra: 1, edit: { ...edit.edit, scene: {} } };
    expect(checkInvoke('scenes:edit', 'control', [padded])).toEqual({ ok: true, payload: edit });
  });

  it('accept a name to create, keeping only contract fields', () => {
    expect(checkInvoke('scenes:create', 'control', [{ campaignId, name: 'X', id: 'y' }])).toEqual({
      ok: true,
      payload: { campaignId, name: 'X' },
    });
  });

  it.each([
    ['a Campaign id that is a path', 'scenes:list', [{ campaignId: '../..' }]],
    ['no name', 'scenes:create', [{ campaignId }]],
    ['an edit with no Scene', 'scenes:edit', [{ ...edit, sceneId: undefined }]],
    ['an edit with no Campaign', 'scenes:edit', [{ ...edit, campaignId: undefined }]],
    ['an unknown edit', 'scenes:edit', [{ ...edit, edit: { kind: 'replace-scene' } }]],
  ] as const)('reject %s', (_label, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});

describe('Broadcast window channels', () => {
  it('are for the Control window only, with no payload', () => {
    for (const channel of ['broadcast:open', 'broadcast:toggle-fullscreen'] as const) {
      expect(checkInvoke(channel, 'control', [])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [])).toMatchObject({ ok: false });
      expect(checkInvoke(channel, 'control', [true])).toMatchObject({ ok: false });
    }
  });
});

describe('Settings channels', () => {
  it('are for the Control window only', () => {
    for (const [channel, args] of [
      ['settings:get', []],
      ['settings:set-theme', [{ theme: 'retro' }]],
    ] as const) {
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
    }
  });

  it('accept a known home theme, keeping only contract fields', () => {
    expect(checkInvoke('settings:set-theme', 'control', [{ theme: 'fantasy', x: 1 }])).toEqual({
      ok: true,
      payload: { theme: 'fantasy' },
    });
  });

  it.each([
    ['an unknown theme', [{ theme: 'neon' }]],
    ['no theme', [{}]],
    ['a bare string', ['retro']],
  ] as const)('reject %s', (_label, args) => {
    expect(checkInvoke('settings:set-theme', 'control', [...args])).toMatchObject({ ok: false });
  });
});
