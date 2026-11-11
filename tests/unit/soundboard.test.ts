import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../core/campaigns';
import { MediaError } from '../../core/media';
import {
  applySoundboardEdit,
  createSoundboardStore,
  parseSoundboardEdit,
  SoundboardError,
} from '../../core/soundboard';
import { openStorage } from '../../core/storage';
import type { SoundboardEdit } from '../../shared/contract';
import type { AudioMedia, ImageMedia, Media, Soundboard } from '../../shared/domain';
import { useTempDir } from './tempDir';

function sound(id: string, role: AudioMedia['role'] = 'soundEffect'): AudioMedia {
  return {
    id,
    campaignId: 'c1',
    contentHash: id.padEnd(64, '0'),
    originalName: id,
    name: `Nom ${id}`,
    extension: '.wav',
    favourite: false,
    kind: 'audio',
    role,
    durationSeconds: 1,
  };
}

const image: ImageMedia = {
  id: 'i1',
  campaignId: 'c1',
  contentHash: 'i1'.padEnd(64, '0'),
  originalName: 'i1',
  name: 'Carte',
  extension: '.png',
  favourite: false,
  kind: 'image',
  category: 'scenery',
};

function board(pads: Soundboard['pads'] = [], volume = 1): Soundboard {
  return { campaignId: 'c1', pads, volume };
}

const pad = (id: string, changes: Partial<Soundboard['pads'][number]> = {}) => ({
  id,
  mediaId: `m-${id}`,
  volume: 1,
  ...changes,
});

function counter() {
  let n = 0;
  return () => {
    n += 1;
    return `pad${n}`;
  };
}

describe('Soundboard edits', () => {
  const apply = (from: Soundboard, edit: SoundboardEdit) =>
    applySoundboardEdit(from, edit, counter());

  it('adds a pad after the others, at full volume, with no name of its own', () => {
    expect(apply(board([pad('a')]), { kind: 'add-pad', mediaId: 's1' }).pads).toEqual([
      pad('a'),
      { id: 'pad1', mediaId: 's1', volume: 1 },
    ]);
  });

  it('names a pad, trimmed; an empty name gives back the Sound effect’s', () => {
    const named = apply(board([pad('a')]), { kind: 'rename-pad', padId: 'a', label: ' Épée ' });
    expect(named.pads).toEqual([pad('a', { label: 'Épée' })]);
    expect(apply(named, { kind: 'rename-pad', padId: 'a', label: '  ' }).pads).toEqual([pad('a')]);
  });

  it('refuses a pad name that is too long', () => {
    expect(() =>
      apply(board([pad('a')]), { kind: 'rename-pad', padId: 'a', label: 'x'.repeat(61) }),
    ).toThrow(SoundboardError);
  });

  it('reorders pads; past the end goes last', () => {
    const from = board([pad('a'), pad('b'), pad('c')]);
    const ids = (edited: Soundboard) => edited.pads.map((item) => item.id);
    expect(ids(apply(from, { kind: 'move-pad', padId: 'c', toIndex: 0 }))).toEqual(['c', 'a', 'b']);
    expect(ids(apply(from, { kind: 'move-pad', padId: 'a', toIndex: 1 }))).toEqual(['b', 'a', 'c']);
    expect(ids(apply(from, { kind: 'move-pad', padId: 'a', toIndex: 9 }))).toEqual(['b', 'c', 'a']);
  });

  it('removes a pad', () => {
    expect(apply(board([pad('a'), pad('b')]), { kind: 'remove-pad', padId: 'a' }).pads).toEqual([
      pad('b'),
    ]);
  });

  it('sets a pad’s volume and the Soundboard level', () => {
    const from = board([pad('a')]);
    expect(apply(from, { kind: 'set-pad-volume', padId: 'a', volume: 0.3 }).pads).toEqual([
      pad('a', { volume: 0.3 }),
    ]);
    expect(apply(from, { kind: 'set-level', volume: 0.4 }).volume).toBe(0.4);
  });

  it('refuses an edit of a pad that is gone', () => {
    expect(() => apply(board(), { kind: 'remove-pad', padId: 'a' })).toThrow(SoundboardError);
  });
});

describe('untrusted Soundboard edits', () => {
  it('keeps only the edit’s fields', () => {
    expect(parseSoundboardEdit({ kind: 'add-pad', mediaId: 's1', extra: 1 })).toEqual({
      kind: 'add-pad',
      mediaId: 's1',
    });
    expect(parseSoundboardEdit({ kind: 'move-pad', padId: 'a', toIndex: 2 })).toEqual({
      kind: 'move-pad',
      padId: 'a',
      toIndex: 2,
    });
  });

  it.each([
    ['an unknown kind', { kind: 'loop-pad', padId: 'a' }],
    ['an empty Media id', { kind: 'add-pad', mediaId: '' }],
    ['a volume above 1', { kind: 'set-pad-volume', padId: 'a', volume: 1.5 }],
    ['a negative level', { kind: 'set-level', volume: -0.1 }],
    ['a fractional index', { kind: 'move-pad', padId: 'a', toIndex: 0.5 }],
    ['a huge name', { kind: 'rename-pad', padId: 'a', label: 'x'.repeat(2000) }],
    ['no pad', { kind: 'remove-pad' }],
  ])('refuses %s', (_name, value) => {
    expect(parseSoundboardEdit(value)).toBeUndefined();
  });
});

describe('Soundboard store', () => {
  const dir = useTempDir();

  async function setup(
    media: Media[] = [sound('s1'), sound('s2'), sound('m1', 'music'), image],
    missing: ReadonlySet<string> = new Set(),
  ) {
    const storage = openStorage(path.join(dir.path, 'data'));
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const library = {
      list: () => Promise.resolve(media),
      /** Every file is there, but those of the `missing` Media ids. */
      resolveAddress: (url: string) =>
        Promise.resolve(
          [...missing].some((id) => url.includes(id))
            ? undefined
            : { file: url, mimeType: 'audio/wav' },
        ),
    };
    const store = createSoundboardStore({ storage, library, newId: counter() });
    return { storage, campaign, store };
  }

  it('gives an empty Soundboard at full level until edited', async () => {
    const { campaign, store } = await setup();
    expect(await store.get(campaign.id)).toEqual({ campaignId: campaign.id, pads: [], volume: 1 });
  });

  it('saves edits per Campaign, kept after the storage is reopened (restart)', async () => {
    const { storage, campaign, store } = await setup();
    const other = await createCampaign(storage.campaigns, 'Warhammer');
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'set-level', volume: 0.5 });

    const reopened = createSoundboardStore({
      storage: openStorage(storage.root),
      library: {
        list: () => Promise.resolve([]),
        resolveAddress: () => Promise.resolve(undefined),
      },
    });
    expect(await reopened.get(campaign.id)).toEqual({
      campaignId: campaign.id,
      pads: [{ id: 'pad1', mediaId: 's1', volume: 1 }],
      volume: 0.5,
    });
    expect((await reopened.get(other.id)).pads).toEqual([]);
    const saved = JSON.parse(
      await fs.readFile(path.join(storage.campaignFolder(campaign.id), 'soundboard.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('campaignId');
  });

  it('accepts only Sound effects as pads', async () => {
    const { campaign, store } = await setup();
    await expect(store.edit(campaign.id, { kind: 'add-pad', mediaId: 'm1' })).rejects.toThrow(
      MediaError,
    );
    await expect(store.edit(campaign.id, { kind: 'add-pad', mediaId: 'i1' })).rejects.toThrow(
      MediaError,
    );
    await expect(store.edit(campaign.id, { kind: 'add-pad', mediaId: 'gone' })).rejects.toThrow(
      'Ce média n’existe plus.',
    );
    expect((await store.get(campaign.id)).pads).toEqual([]);
  });

  it('removes the pads of a deleted Media', async () => {
    const { campaign, store } = await setup();
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's2' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });

    await store.removeMedia(campaign.id, 's1');

    expect((await store.get(campaign.id)).pads).toEqual([{ id: 'pad2', mediaId: 's2', volume: 1 }]);
  });

  it('presses a pad: its Sound effect at Master volume × Soundboard level × pad volume', async () => {
    const { campaign, store } = await setup();
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'set-pad-volume', padId: 'pad1', volume: 0.5 });
    await store.edit(campaign.id, { kind: 'set-level', volume: 0.8 });

    const pressed = await store.press(campaign.id, 'pad1', 0.5);

    expect(pressed).toEqual({
      padId: 'pad1',
      name: 'Nom s1',
      src: expect.stringContaining('regie-media:') as unknown,
      gain: expect.closeTo(0.2) as unknown,
    });
    await store.edit(campaign.id, { kind: 'rename-pad', padId: 'pad1', label: 'Épée' });
    expect((await store.press(campaign.id, 'pad1', 1)).name).toBe('Épée');
  });

  it('lists the Sound effects to preload: each pad’s once, in pad order, none once removed', async () => {
    const { campaign, store } = await setup();
    expect(await store.sounds(campaign.id)).toEqual([]);
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's2' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's2' });
    const [s2, s1] = [
      (await store.press(campaign.id, 'pad1', 1)).src,
      (await store.press(campaign.id, 'pad2', 1)).src,
    ];

    expect(await store.sounds(campaign.id)).toEqual([s2, s1]);

    await store.edit(campaign.id, { kind: 'remove-pad', padId: 'pad2' });
    expect(await store.sounds(campaign.id)).toEqual([s2]);
    await store.removeMedia(campaign.id, 's2');
    expect(await store.sounds(campaign.id)).toEqual([]);
  });

  it('leaves out of the preload a pad whose Media left the library', async () => {
    const media = [sound('s1'), sound('s2')];
    const { campaign, store } = await setup(media);
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's2' });
    const s2 = (await store.press(campaign.id, 'pad2', 1)).src;
    media.shift();

    expect(await store.sounds(campaign.id)).toEqual([s2]);
  });

  it('gives each pad’s name and level, as saved or with an unsaved edit (a slider dragged)', async () => {
    const { campaign, store } = await setup();
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's2' });
    await store.edit(campaign.id, { kind: 'rename-pad', padId: 'pad2', label: 'Épée' });
    await store.edit(campaign.id, { kind: 'set-pad-volume', padId: 'pad1', volume: 0.5 });

    expect(await store.tuning(campaign.id, 0.5)).toEqual(
      new Map([
        ['pad1', { name: 'Nom s1', gain: 0.25 }],
        ['pad2', { name: 'Épée', gain: 0.5 }],
      ]),
    );
    expect(await store.tuning(campaign.id, 1, { kind: 'set-level', volume: 0.5 })).toEqual(
      new Map([
        ['pad1', { name: 'Nom s1', gain: 0.25 }],
        ['pad2', { name: 'Épée', gain: 0.5 }],
      ]),
    );
    // The unsaved edit is not saved.
    expect((await store.get(campaign.id)).volume).toBe(1);
  });

  it('refuses to press a pad whose file is missing, saying so', async () => {
    const { campaign, store } = await setup(undefined, new Set(['s1']));
    await store.edit(campaign.id, { kind: 'add-pad', mediaId: 's1' });

    await expect(store.press(campaign.id, 'pad1', 1)).rejects.toThrow(
      '« Nom s1 » est introuvable (fichier supprimé ou déplacé hors de l’application).',
    );
  });

  it('refuses to press a pad that is gone', async () => {
    const { campaign, store } = await setup();
    await expect(store.press(campaign.id, 'nope', 1)).rejects.toThrow(SoundboardError);
  });
});
