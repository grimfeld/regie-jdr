import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../core/campaigns';
import { createMediaLibrary } from '../../core/media';
import { mediaAddress, thumbnailAddress } from '../../core/mediaAddress';
import { openStorage } from '../../core/storage';
import { THUMBNAIL_MAX_EDGE, thumbnailSize } from '../../core/thumbnails';
import { fakeResizer } from './fakeResizer';
import { useTempDir } from './tempDir';

// SHA-256 of the three bytes "abc" (FIPS 180-2 test vector).
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('library thumbnails', () => {
  const dir = useTempDir();

  async function setup(undecodable: string[] = []) {
    const storage = openStorage(path.join(dir.path, 'data'));
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const fake = fakeResizer(undecodable);
    const library = createMediaLibrary(storage, fake.resizer);
    const folder = storage.campaignFolder(campaign.id);
    const thumbnailFile = path.join(folder, 'thumbnails', `${ABC_SHA256}.png`);
    return { storage, campaign, library, folder, thumbnailFile, calls: fake.calls };
  }

  async function sourceFile(name: string, content = 'abc'): Promise<string> {
    const folder = path.join(dir.path, 'picked');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, name);
    await fs.writeFile(file, content);
    return file;
  }

  it('makes a thumbnail at import, next to the Media files and named by content hash', async () => {
    const { campaign, library, thumbnailFile, calls } = await setup();

    await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' });

    expect(await fs.readFile(thumbnailFile, 'utf8')).toBe('thumbnail of abc');
    expect(calls).toEqual([{ sourceFile: expect.any(String), maxEdge: THUMBNAIL_MAX_EDGE }]);
  });

  it('serves the thumbnail at the thumbnail address, as PNG, after a restart', async () => {
    const { campaign, library, thumbnailFile } = await setup();
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.jpeg')], { accept: 'image' })
    ).imported;

    const { resizer, calls } = fakeResizer();
    const reopened = createMediaLibrary(openStorage(path.join(dir.path, 'data')), resizer);

    expect(thumbnailAddress(media)).toBe(
      `regie-media://thumbnail/${campaign.id}/${ABC_SHA256}.jpeg`,
    );
    expect(await reopened.resolveAddress(thumbnailAddress(media), campaign.id)).toEqual({
      file: thumbnailFile,
      mimeType: 'image/png',
    });
    // Kept on disk: nothing is made again.
    expect(calls).toEqual([]);
  });

  it('makes a deleted thumbnail again when it is asked for', async () => {
    const { campaign, library, thumbnailFile, calls } = await setup();
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;
    await fs.rm(thumbnailFile);

    const resolved = await library.resolveAddress(thumbnailAddress(media), campaign.id);

    expect(resolved).toEqual({ file: thumbnailFile, mimeType: 'image/png' });
    expect(await fs.readFile(thumbnailFile, 'utf8')).toBe('thumbnail of abc');
    expect(calls).toHaveLength(2);
  });

  it('makes a missing thumbnail once when it is asked for several times at once', async () => {
    const { campaign, library, thumbnailFile, calls } = await setup();
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;
    await fs.rm(thumbnailFile);

    await Promise.all(
      [1, 2, 3].map(() => library.resolveAddress(thumbnailAddress(media), campaign.id)),
    );

    expect(calls).toHaveLength(2);
  });

  it('puts a missing thumbnail back when the same content is imported again', async () => {
    const { campaign, library, thumbnailFile } = await setup();
    const file = await sourceFile('Cantina.png');
    await library.import(campaign.id, [file], { accept: 'image' });
    await fs.rm(thumbnailFile);

    await library.import(campaign.id, [file], { accept: 'image' });

    expect(await fs.readFile(thumbnailFile, 'utf8')).toBe('thumbnail of abc');
  });

  it('serves no thumbnail once the Media file itself is missing', async () => {
    const { campaign, library, folder } = await setup();
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;
    await fs.rm(path.join(folder, 'media'), { recursive: true });

    expect(await library.resolveAddress(thumbnailAddress(media), campaign.id)).toBeUndefined();
  });

  it('serves thumbnails of the open Campaign only', async () => {
    const { storage, campaign, library } = await setup();
    const other = await createCampaign(storage.campaigns, 'Dune');
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;

    expect(await library.resolveAddress(thumbnailAddress(media), other.id)).toBeUndefined();
    expect(await library.resolveAddress(thumbnailAddress(media), null)).toBeUndefined();
  });

  it('imports an image it cannot make a thumbnail of, and fails when its thumbnail is asked for', async () => {
    const { campaign, library, thumbnailFile } = await setup(['abc']);

    const { imported, refused } = await library.import(
      campaign.id,
      [await sourceFile('Cantina.png')],
      { accept: 'image' },
    );

    expect(refused).toEqual([]);
    expect(imported).toHaveLength(1);
    await expect(fs.stat(thumbnailFile)).rejects.toThrow();
    await expect(
      library.resolveAddress(thumbnailAddress(imported[0]), campaign.id),
    ).rejects.toThrow('not an image');
  });

  it('makes no thumbnail for audio, and serves none at an audio thumbnail address', async () => {
    const { campaign, library, folder, calls } = await setup();
    const [sound] = (
      await library.import(campaign.id, [await sourceFile('Pluie.ogg')], {
        accept: 'audio',
        role: 'ambience',
      })
    ).imported;

    expect(calls).toEqual([]);
    await expect(fs.readdir(path.join(folder, 'thumbnails'))).rejects.toThrow();
    expect(await library.resolveAddress(thumbnailAddress(sound), campaign.id)).toBeUndefined();
    expect(await library.resolveAddress(mediaAddress(sound), campaign.id)).toBeDefined();
  });

  it('deletes the thumbnail with its Media', async () => {
    const { campaign, library, thumbnailFile } = await setup();
    const [media] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;

    await library.delete(campaign.id, media.id);

    await expect(fs.stat(thumbnailFile)).rejects.toThrow();
  });
});

describe('thumbnail size', () => {
  it.each([
    ['a landscape image', 1920, 1080, { width: 320, height: 180 }],
    ['a portrait image', 600, 1200, { width: 160, height: 320 }],
    ['a square image', 4000, 4000, { width: 320, height: 320 }],
    ['an image already small enough, never enlarged', 16, 9, { width: 16, height: 9 }],
    ['a very thin image, at least one pixel', 10000, 5, { width: 320, height: 1 }],
  ])('fits %s in the square, proportions kept', (_label, width, height, expected) => {
    expect(thumbnailSize(width, height, 320)).toEqual(expected);
  });
});
