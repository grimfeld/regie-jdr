import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkInvoke } from '../../core/ipc';
import { MAX_PASTED_IMAGE_BYTES } from '../../core/mediaAddress';

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

  it('keeps every audio channel from the Broadcast window: it gets no audio', () => {
    for (const [channel, args] of [
      ['audio:get-mix', []],
      ['audio:report', [{ voices: [] }]],
      ['audio:get-sounding', []],
      ['audio:set-silence', [{ on: true }]],
      ['audio:toggle-silence', []],
      ['settings:set-master-volume', [{ masterVolume: 0.5 }]],
      ['audio:pick-music', [{ mediaId: 'm1' }]],
      ['audio:set-music-playback', [{ playback: 'paused' }]],
    ] as const) {
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
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
      ['campaigns:deletion-summary', [{ id }]],
      ['campaigns:move-to-trash', [{ id }]],
      ['campaigns:delete-permanently', [{ id }]],
      ['campaigns:export', [{ id }]],
      ['campaigns:import', []],
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

  it('accept a Campaign id to delete, keeping only that field', () => {
    for (const channel of [
      'campaigns:deletion-summary',
      'campaigns:move-to-trash',
      'campaigns:delete-permanently',
    ] as const) {
      expect(checkInvoke(channel, 'control', [{ id, permanently: true }])).toEqual({
        ok: true,
        payload: { id },
      });
    }
  });

  it.each([
    ['no name', 'campaigns:create', [{}]],
    ['a name that is not text', 'campaigns:create', [{ name: 42 }]],
    ['a huge name', 'campaigns:create', [{ name: 'x'.repeat(10_000) }]],
    ['an id that is a path', 'campaigns:update', [{ id: '../..', changes: { name: 'X' } }]],
    ['an exported id that is a path', 'campaigns:export', [{ id: '../..' }]],
    ['an unknown theme', 'campaigns:update', [{ id, changes: { theme: 'neon' } }]],
    ['no changes object', 'campaigns:update', [{ id }]],
    ['a name of the wrong type', 'campaigns:update', [{ id, changes: { name: null } }]],
    ['a path to move to the Recycle Bin', 'campaigns:move-to-trash', [{ id: '..' }]],
    ['an absolute path to delete', 'campaigns:delete-permanently', [{ id: 'C:\\Windows' }]],
    ['a nested path to summarise', 'campaigns:deletion-summary', [{ id: 'a/../b' }]],
    ['no id to delete', 'campaigns:move-to-trash', [{}]],
    ['two payloads to delete', 'campaigns:move-to-trash', [{ id }, { id }]],
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
      ['media:import-dropped', [{ campaignId, files: [], accept: 'image' }]],
      ['media:import-pasted', [{ campaignId, data: new Uint8Array([1]), name: 'capture.png' }]],
      ['media:set-category', [{ campaignId, mediaId, category: 'character' }]],
      ['media:rename', [{ campaignId, mediaId, name: 'Port de nuit' }]],
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

  it('accept dropped files as absolute paths, as images or as audio with a role, keeping only contract fields', () => {
    const files = [path.resolve('Cantina.png'), path.resolve('Orc.webp')];
    expect(
      checkInvoke('media:import-dropped', 'control', [
        { campaignId, files, accept: 'image', role: 'music' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, files, accept: 'image' } });
    expect(
      checkInvoke('media:import-dropped', 'control', [
        { campaignId, files: [], accept: 'audio', role: 'ambience', x: 1 },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, files: [], accept: 'audio', role: 'ambience' } });
  });

  it('accept an image import with a category for the new images', () => {
    for (const category of ['scenery', 'character', 'reference']) {
      expect(
        checkInvoke('media:import', 'control', [{ campaignId, accept: 'image', category }]),
      ).toEqual({
        ok: true,
        payload: { campaignId, accept: 'image', category },
      });
    }
    const files = [path.resolve('Plan.png')];
    expect(
      checkInvoke('media:import-dropped', 'control', [
        { campaignId, files, accept: 'image', category: 'reference' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, files, accept: 'image', category: 'reference' } });
  });

  it('accept pasted image content with its name, keeping only contract fields', () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(
      checkInvoke('media:import-pasted', 'control', [
        { campaignId, data, name: 'image.png', category: 'scenery', path: 'C:/x.png' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, data, name: 'image.png' } });
  });

  it('accept a category change to Reference', () => {
    expect(
      checkInvoke('media:set-category', 'control', [
        { campaignId, mediaId, category: 'reference' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, mediaId, category: 'reference' } });
  });

  it('accept a category change, keeping only contract fields', () => {
    expect(
      checkInvoke('media:set-category', 'control', [
        { campaignId, mediaId, category: 'scenery', role: 'music' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, mediaId, category: 'scenery' } });
  });

  it('accept a rename, keeping only contract fields', () => {
    expect(
      checkInvoke('media:rename', 'control', [
        { campaignId, mediaId, name: 'Port de nuit', originalName: 'x' },
      ]),
    ).toEqual({ ok: true, payload: { campaignId, mediaId, name: 'Port de nuit' } });
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
    [
      'an image import with an unknown category',
      'media:import',
      [{ campaignId, accept: 'image', category: 'handout' }],
    ],
    [
      'dropped images with an unknown category',
      'media:import-dropped',
      [{ campaignId, files: [], accept: 'image', category: 'secret' }],
    ],
    [
      'pasted content that is not bytes',
      'media:import-pasted',
      [{ campaignId, data: [1, 2], name: 'x.png' }],
    ],
    [
      'pasted content as text',
      'media:import-pasted',
      [{ campaignId, data: 'iVBORw0KGgo=', name: 'x.png' }],
    ],
    [
      'empty pasted content',
      'media:import-pasted',
      [{ campaignId, data: new Uint8Array(0), name: 'x.png' }],
    ],
    [
      'pasted content larger than the limit',
      'media:import-pasted',
      [{ campaignId, data: new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1), name: 'x.png' }],
    ],
    [
      'pasted content with no name',
      'media:import-pasted',
      [{ campaignId, data: new Uint8Array([1]) }],
    ],
    [
      'pasted content with a very long name',
      'media:import-pasted',
      [{ campaignId, data: new Uint8Array([1]), name: 'x'.repeat(5000) }],
    ],
    [
      'pasted content for no Campaign',
      'media:import-pasted',
      [{ data: new Uint8Array([1]), name: 'x' }],
    ],
    ['audio with no role', 'media:import', [{ campaignId, accept: 'audio' }]],
    ['audio with an unknown role', 'media:import', [{ campaignId, accept: 'audio', role: 'loop' }]],
    [
      'source files chosen by the window',
      'media:import',
      [{ campaignId, accept: 'image' }, ['C:/x.png']],
    ],
    [
      'dropped files that are not a list',
      'media:import-dropped',
      [{ campaignId, files: 'x', accept: 'image' }],
    ],
    [
      'a dropped file that is not text',
      'media:import-dropped',
      [{ campaignId, files: [7], accept: 'image' }],
    ],
    [
      'a dropped file with an empty path',
      'media:import-dropped',
      [{ campaignId, files: [''], accept: 'image' }],
    ],
    [
      'a dropped file with a relative path',
      'media:import-dropped',
      [{ campaignId, files: ['x.png'], accept: 'image' }],
    ],
    [
      'a dropped file up the folder tree',
      'media:import-dropped',
      [{ campaignId, files: ['../../x.png'], accept: 'image' }],
    ],
    [
      'a dropped file on a network share',
      'media:import-dropped',
      [{ campaignId, files: ['\\\\serveur\\partage\\x.png'], accept: 'image' }],
    ],
    [
      'a dropped file on a network share, forward slashes',
      'media:import-dropped',
      [{ campaignId, files: ['//serveur/partage/x.png'], accept: 'image' }],
    ],
    [
      'a dropped file with a NUL character',
      'media:import-dropped',
      [{ campaignId, files: [`${path.resolve('x.png')}\0.txt`], accept: 'image' }],
    ],
    [
      'a dropped file with a huge path',
      'media:import-dropped',
      [{ campaignId, files: [path.resolve('x'.repeat(40000))], accept: 'image' }],
    ],
    [
      'too many dropped files',
      'media:import-dropped',
      [
        {
          campaignId,
          files: Array.from({ length: 1001 }, (_, i) => path.resolve(`${i}.png`)),
          accept: 'image',
        },
      ],
    ],
    ['dropped files with no Campaign id', 'media:import-dropped', [{ files: [], accept: 'image' }]],
    ['dropped files with no kind', 'media:import-dropped', [{ campaignId, files: [] }]],
    [
      'dropped audio with no role',
      'media:import-dropped',
      [{ campaignId, files: [], accept: 'audio' }],
    ],
    ['an unknown category', 'media:set-category', [{ campaignId, mediaId, category: 'creature' }]],
    ['no Media id', 'media:set-category', [{ campaignId, category: 'scenery' }]],
    ['a rename with no name', 'media:rename', [{ campaignId, mediaId }]],
    ['a rename with a name that is not text', 'media:rename', [{ campaignId, mediaId, name: 7 }]],
    ['a rename with no Media id', 'media:rename', [{ campaignId, name: 'Orc' }]],
    [
      'a rename with a huge name',
      'media:rename',
      [{ campaignId, mediaId, name: 'x'.repeat(5000) }],
    ],
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
  const transient = {
    campaignId,
    sceneId: 'cantina',
    edit: { kind: 'transform-overlay', placementId: 'o1', position: { x: 0.2, y: 0.3 } },
  };

  it('are for the Control window only', () => {
    for (const [channel, args] of [
      ['scenes:list', [{ campaignId }]],
      ['scenes:create', [{ campaignId, name: 'X' }]],
      ['scenes:edit', [edit]],
      ['scenes:delete', [{ campaignId, sceneId: 'cantina' }]],
      ['scenes:move', [{ campaignId, sceneId: 'cantina', toIndex: 0 }]],
      ['scenes:duplicate', [{ campaignId, sceneId: 'cantina' }]],
      ['scenes:show-transient', [transient]],
      ['scenes:undo-state', [{ campaignId, sceneId: 'cantina' }]],
      ['scenes:undo', [{ campaignId, sceneId: 'cantina' }]],
      ['scenes:redo', [{ campaignId, sceneId: 'cantina' }]],
    ] as const) {
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
    }
  });

  it('accept a transient update of a live drag, keeping only contract fields', () => {
    const padded = { ...transient, extra: 1, edit: { ...transient.edit, toIndex: 1 } };
    expect(checkInvoke('scenes:show-transient', 'control', [padded])).toEqual({
      ok: true,
      payload: transient,
    });
    const framing = {
      ...transient,
      edit: { kind: 'frame-background', placementId: 'b1', zoom: 2 },
    };
    expect(checkInvoke('scenes:show-transient', 'control', [framing])).toEqual({
      ok: true,
      payload: framing,
    });
    const level = { ...transient, edit: { kind: 'set-music-level', level: 0.5 } };
    expect(checkInvoke('scenes:show-transient', 'control', [level])).toEqual({
      ok: true,
      payload: level,
    });
    const ambienceLevel = { ...transient, edit: { kind: 'set-ambience-level', level: 0.5 } };
    expect(checkInvoke('scenes:show-transient', 'control', [ambienceLevel])).toEqual({
      ok: true,
      payload: ambienceLevel,
    });
    const volume = {
      ...transient,
      edit: { kind: 'set-ambience-volume', mediaId: 'm1', volume: 0.5 },
    };
    expect(checkInvoke('scenes:show-transient', 'control', [volume])).toEqual({
      ok: true,
      payload: volume,
    });
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

  it('accept a Scene to delete, keeping only contract fields', () => {
    const target = { campaignId, sceneId: 'cantina' };
    expect(checkInvoke('scenes:delete', 'control', [{ ...target, confirmed: true }])).toEqual({
      ok: true,
      payload: target,
    });
  });

  it('accept a Scene to move in the running order, keeping only contract fields', () => {
    const move = { campaignId, sceneId: 'cantina', toIndex: 2 };
    expect(checkInvoke('scenes:move', 'control', [{ ...move, order: [] }])).toEqual({
      ok: true,
      payload: move,
    });
  });

  it('accept a Scene to undo or redo on, or to duplicate, keeping only contract fields', () => {
    const target = { campaignId, sceneId: 'cantina' };
    for (const channel of [
      'scenes:undo-state',
      'scenes:undo',
      'scenes:redo',
      'scenes:duplicate',
    ] as const) {
      expect(checkInvoke(channel, 'control', [{ ...target, edit: {} }])).toEqual({
        ok: true,
        payload: target,
      });
    }
  });

  it.each([
    ['a Campaign id that is a path', 'scenes:list', [{ campaignId: '../..' }]],
    ['an undo with no Scene', 'scenes:undo', [{ campaignId }]],
    ['a redo with no Campaign', 'scenes:redo', [{ sceneId: 'cantina' }]],
    ['an undo state with an empty Scene id', 'scenes:undo-state', [{ campaignId, sceneId: '' }]],
    ['a delete with no Scene', 'scenes:delete', [{ campaignId }]],
    ['a delete with no Campaign', 'scenes:delete', [{ sceneId: 'cantina' }]],
    ['no name', 'scenes:create', [{ campaignId }]],
    ['a move with no place', 'scenes:move', [{ campaignId, sceneId: 'cantina' }]],
    [
      'a move to a negative place',
      'scenes:move',
      [{ campaignId, sceneId: 'cantina', toIndex: -1 }],
    ],
    [
      'a move to a fractional place',
      'scenes:move',
      [{ campaignId, sceneId: 'cantina', toIndex: 0.5 }],
    ],
    ['a move with no Scene', 'scenes:move', [{ campaignId, toIndex: 0 }]],
    ['a duplicate with no Scene', 'scenes:duplicate', [{ campaignId }]],
    ['an edit with no Scene', 'scenes:edit', [{ ...edit, sceneId: undefined }]],
    ['an edit with no Campaign', 'scenes:edit', [{ ...edit, campaignId: undefined }]],
    ['an unknown edit', 'scenes:edit', [{ ...edit, edit: { kind: 'replace-scene' } }]],
    ['a transient update that is not a move, resize or framing', 'scenes:show-transient', [edit]],
    ['a transient update with no Scene', 'scenes:show-transient', [{ ...transient, sceneId: '' }]],
  ] as const)('reject %s', (_label, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});

describe('Blackout channel', () => {
  it('is for the Control window only', () => {
    expect(checkInvoke('onAir:set-blackout', 'control', [{ on: true }])).toEqual({
      ok: true,
      payload: { on: true },
    });
    expect(checkInvoke('onAir:set-blackout', 'broadcast', [{ on: true }])).toMatchObject({
      ok: false,
    });
  });

  it('keeps only the contract fields', () => {
    expect(checkInvoke('onAir:set-blackout', 'control', [{ on: false, scene: 'x' }])).toEqual({
      ok: true,
      payload: { on: false },
    });
  });

  it.each([
    ['nothing', []],
    ['a bare boolean', [true]],
    ['a missing flag', [{}]],
    ['a flag of the wrong type', [{ on: 'true' }]],
  ])('rejects a Blackout given as %s', (_label, args) => {
    expect(checkInvoke('onAir:set-blackout', 'control', args)).toMatchObject({ ok: false });
  });
});

describe('Silence channel', () => {
  it('keeps only the flag, and rejects anything else', () => {
    expect(checkInvoke('audio:set-silence', 'control', [{ on: true, scene: 'x' }])).toEqual({
      ok: true,
      payload: { on: true },
    });
    for (const args of [[], [true], [{}], [{ on: 'true' }]]) {
      expect(checkInvoke('audio:set-silence', 'control', args)).toMatchObject({ ok: false });
    }
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
      ['settings:set-fade-duration', [{ fadeDurationMs: 600 }]],
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

  it('accept a fade duration in bounds, keeping only contract fields', () => {
    expect(
      checkInvoke('settings:set-fade-duration', 'control', [{ fadeDurationMs: 0, x: 1 }]),
    ).toEqual({ ok: true, payload: { fadeDurationMs: 0 } });
  });

  it.each([
    ['a negative fade duration', [{ fadeDurationMs: -100 }]],
    ['a fade duration above the maximum', [{ fadeDurationMs: 3001 }]],
    ['a fade duration in seconds as text', [{ fadeDurationMs: '0.6' }]],
    ['no fade duration', [{}]],
    ['a bare number', [600]],
  ] as const)('reject %s', (_label, args) => {
    expect(checkInvoke('settings:set-fade-duration', 'control', [...args])).toMatchObject({
      ok: false,
    });
  });
});

describe('audio payload guards', () => {
  it('keep only the fields of a Music pick and a Music playback', () => {
    expect(checkInvoke('audio:pick-music', 'control', [{ mediaId: 'm1', toIndex: 0 }])).toEqual({
      ok: true,
      payload: { mediaId: 'm1' },
    });
    for (const playback of ['playing', 'paused', 'stopped']) {
      expect(checkInvoke('audio:set-music-playback', 'control', [{ playback, x: 1 }])).toEqual({
        ok: true,
        payload: { playback },
      });
    }
  });

  it('keep only the fields of an engine report and a Master volume', () => {
    expect(
      checkInvoke('audio:report', 'control', [
        { voices: [{ mediaId: 'm1', state: 'playing', src: 'x' }], extra: 1 },
      ]),
    ).toEqual({ ok: true, payload: { voices: [{ mediaId: 'm1', state: 'playing' }] } });
    expect(
      checkInvoke('settings:set-master-volume', 'control', [{ masterVolume: 0.5, x: 1 }]),
    ).toEqual({ ok: true, payload: { masterVolume: 0.5 } });
  });

  it.each([
    [
      'a report with an unknown state',
      'audio:report',
      [{ voices: [{ mediaId: 'm', state: 'x' }] }],
    ],
    ['a report with no voices', 'audio:report', [{}]],
    ['two reports', 'audio:report', [{ voices: [] }, { voices: [] }]],
    ['a Master volume above 1', 'settings:set-master-volume', [{ masterVolume: 2 }]],
    ['a Master volume as text', 'settings:set-master-volume', [{ masterVolume: '1' }]],
    ['an argument to get the mix', 'audio:get-mix', [{}]],
    ['a pick of no Music', 'audio:pick-music', [{ mediaId: '' }]],
    ['a pick of a number', 'audio:pick-music', [{ mediaId: 1 }]],
    ['an unknown playback', 'audio:set-music-playback', [{ playback: 'louder' }]],
    ['no playback', 'audio:set-music-playback', [{}]],
  ] as const)('reject %s', (_case, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});

describe('Soundboard payload guards', () => {
  it('keep the Soundboard and pad sounds from the Broadcast window', () => {
    for (const [channel, args] of [
      ['soundboard:get', [{ campaignId: 'star-wars' }]],
      ['soundboard:edit', [{ campaignId: 'star-wars', edit: { kind: 'remove-pad', padId: 'p' } }]],
      ['soundboard:press', [{ campaignId: 'star-wars', padId: 'p' }]],
      [
        'soundboard:show-transient',
        [{ campaignId: 'star-wars', edit: { kind: 'set-level', volume: 0 } }],
      ],
      ['audio:report-pads', [{ voices: [], upTo: 0 }]],
    ] as const) {
      expect(checkInvoke(channel, 'broadcast', [...args])).toMatchObject({ ok: false });
      expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: true });
    }
  });

  it('keep only the fields of an edit, a press and a pad report', () => {
    expect(
      checkInvoke('soundboard:edit', 'control', [
        { campaignId: 'star-wars', edit: { kind: 'set-level', volume: 0.5, loop: true }, x: 1 },
      ]),
    ).toEqual({
      ok: true,
      payload: { campaignId: 'star-wars', edit: { kind: 'set-level', volume: 0.5 } },
    });
    expect(
      checkInvoke('soundboard:press', 'control', [{ campaignId: 'star-wars', padId: 'p', x: 1 }]),
    ).toEqual({ ok: true, payload: { campaignId: 'star-wars', padId: 'p' } });
    expect(
      checkInvoke('soundboard:show-transient', 'control', [
        {
          campaignId: 'star-wars',
          edit: { kind: 'set-pad-volume', padId: 'p', volume: 0.5, x: 1 },
        },
      ]),
    ).toEqual({
      ok: true,
      payload: {
        campaignId: 'star-wars',
        edit: { kind: 'set-pad-volume', padId: 'p', volume: 0.5 },
      },
    });
    expect(
      checkInvoke('audio:report-pads', 'control', [
        { voices: [{ voiceId: 2, state: 'playing', src: 'x' }], upTo: 2, extra: 1 },
      ]),
    ).toEqual({ ok: true, payload: { voices: [{ voiceId: 2, state: 'playing' }], upTo: 2 } });
  });

  it.each([
    ['an edit for a bad Campaign id', 'soundboard:edit', [{ campaignId: '../x', edit: {} }]],
    [
      'a pad volume above 1',
      'soundboard:edit',
      [{ campaignId: 'star-wars', edit: { kind: 'set-pad-volume', padId: 'p', volume: 2 } }],
    ],
    ['a press with no pad', 'soundboard:press', [{ campaignId: 'star-wars' }]],
    [
      'a transient update that is not a level',
      'soundboard:show-transient',
      [{ campaignId: 'star-wars', edit: { kind: 'remove-pad', padId: 'p' } }],
    ],
    ['a pad report with no upTo', 'audio:report-pads', [{ voices: [] }]],
  ] as const)('reject %s', (_case, channel, args) => {
    expect(checkInvoke(channel, 'control', [...args])).toMatchObject({ ok: false });
  });
});
