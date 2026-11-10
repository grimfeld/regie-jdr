import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../core/campaigns';
import { createMediaLibrary } from '../../core/media';
import { mediaAddress } from '../../core/mediaAddress';
import { openStorage } from '../../core/storage';
import { useTempDir } from './tempDir';

// SHA-256 of the three bytes "abc" (FIPS 180-2 test vector).
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('media library', () => {
  const dir = useTempDir();

  async function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const library = createMediaLibrary(storage);
    return { storage, campaign, library };
  }

  /** Writes a file to pick, outside the data folder. */
  async function sourceFile(name: string, content = 'abc'): Promise<string> {
    const folder = path.join(dir.path, 'picked');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, name);
    await fs.writeFile(file, content);
    return file;
  }

  it('imports an image into the Campaign media folder, named by its content hash', async () => {
    const { storage, campaign, library } = await setup();

    const result = await library.import(campaign.id, [await sourceFile('Cantina.png')], {
      accept: 'image',
    });

    expect(result.refused).toEqual([]);
    expect(result.imported).toEqual([
      expect.objectContaining({
        campaignId: campaign.id,
        kind: 'image',
        category: 'scenery',
        contentHash: ABC_SHA256,
        originalName: 'Cantina',
        name: 'Cantina',
        extension: '.png',
      }),
    ]);
    const mediaFolder = path.join(storage.campaignFolder(campaign.id), 'media');
    expect(await fs.readdir(mediaFolder)).toEqual([`${ABC_SHA256}.png`]);
    expect(await fs.readFile(path.join(mediaFolder, `${ABC_SHA256}.png`), 'utf8')).toBe('abc');
  });

  it('keeps the library after the storage is reopened (restart)', async () => {
    const { campaign, library } = await setup();
    const { imported } = await library.import(campaign.id, [await sourceFile('Cantina.png')], {
      accept: 'image',
    });

    const reopened = createMediaLibrary(openStorage(path.join(dir.path, 'data')));
    expect(await reopened.list(campaign.id)).toEqual(imported);
  });

  it('keeps one Media and one file when the same content is imported twice into a Campaign', async () => {
    const { storage, campaign, library } = await setup();
    const first = await library.import(campaign.id, [await sourceFile('Cantina.png')], {
      accept: 'image',
    });
    // Same bytes under another name: still the same Media, under its first name.
    const second = await library.import(campaign.id, [await sourceFile('copie.PNG')], {
      accept: 'image',
    });

    expect(second.imported).toEqual(first.imported);
    expect(await library.list(campaign.id)).toEqual(first.imported);
    const mediaFolder = path.join(storage.campaignFolder(campaign.id), 'media');
    expect(await fs.readdir(mediaFolder)).toEqual([`${ABC_SHA256}.png`]);
  });

  it('stores the same file in each Campaign it is imported into', async () => {
    const { storage, campaign, library } = await setup();
    const other = await createCampaign(storage.campaigns, 'Warhammer');
    const file = await sourceFile('Cantina.png');

    const [first] = (await library.import(campaign.id, [file], { accept: 'image' })).imported;
    const [second] = (await library.import(other.id, [file], { accept: 'image' })).imported;

    expect(second.id).not.toBe(first.id);
    expect(second.campaignId).toBe(other.id);
    for (const id of [campaign.id, other.id]) {
      expect(await library.list(id)).toHaveLength(1);
      expect(await fs.readdir(path.join(storage.campaignFolder(id), 'media'))).toEqual([
        `${ABC_SHA256}.png`,
      ]);
    }
  });

  it('puts the file back when content whose file went missing is imported again', async () => {
    const { storage, campaign, library } = await setup();
    const file = await sourceFile('Cantina.png');
    await library.import(campaign.id, [file], { accept: 'image' });
    const stored = path.join(storage.campaignFolder(campaign.id), 'media', `${ABC_SHA256}.png`);
    await fs.rm(stored);

    await library.import(campaign.id, [file], { accept: 'image' });

    expect(await fs.readFile(stored, 'utf8')).toBe('abc');
    expect(await library.list(campaign.id)).toHaveLength(1);
  });

  it('accepts every allowlisted type, whatever the case of its extension', async () => {
    const { campaign, library } = await setup();
    const images = ['a.png', 'b.JPG', 'c.jpeg', 'd.webp'];
    const sounds = ['e.mp3', 'f.wav', 'g.ogg', 'h.flac', 'i.M4A'];

    const imageResult = await library.import(
      campaign.id,
      await Promise.all(images.map((name) => sourceFile(name, name))),
      { accept: 'image' },
    );
    const soundResult = await library.import(
      campaign.id,
      await Promise.all(sounds.map((name) => sourceFile(name, name))),
      { accept: 'audio', role: 'ambience' },
    );

    expect(imageResult.refused).toEqual([]);
    expect(soundResult.refused).toEqual([]);
    expect(imageResult.imported.map((m) => m.extension)).toEqual([
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
    ]);
    expect(soundResult.imported.map((m) => [m.extension, m.kind])).toEqual([
      ['.mp3', 'audio'],
      ['.wav', 'audio'],
      ['.ogg', 'audio'],
      ['.flac', 'audio'],
      ['.m4a', 'audio'],
    ]);
  });

  it('refuses other types with a message and stores nothing for them', async () => {
    const { storage, campaign, library } = await setup();

    const result = await library.import(
      campaign.id,
      [await sourceFile('anim.gif', 'gif'), await sourceFile('notes.txt', 'txt')],
      { accept: 'image' },
    );

    expect(result.imported).toEqual([]);
    expect(result.refused).toEqual([
      expect.stringContaining('« anim.gif » n’a pas été importé'),
      expect.stringContaining('« notes.txt » n’a pas été importé'),
    ]);
    expect(await library.list(campaign.id)).toEqual([]);
    await expect(
      fs.readdir(path.join(storage.campaignFolder(campaign.id), 'media')),
    ).rejects.toThrow();
  });

  it('refuses a sound in an image import and an image in a sound import', async () => {
    const { campaign, library } = await setup();

    const images = await library.import(campaign.id, [await sourceFile('pluie.mp3', '1')], {
      accept: 'image',
    });
    const sounds = await library.import(campaign.id, [await sourceFile('carte.png', '2')], {
      accept: 'audio',
      role: 'music',
    });

    expect(images.refused).toEqual([expect.stringContaining('ce n’est pas une image')]);
    expect(sounds.refused).toEqual([expect.stringContaining('ce n’est pas un son')]);
    expect(await library.list(campaign.id)).toEqual([]);
  });

  it('imports the other files of a selection when one is refused', async () => {
    const { campaign, library } = await setup();

    const result = await library.import(
      campaign.id,
      [await sourceFile('anim.gif', 'gif'), await sourceFile('Cantina.png')],
      { accept: 'image' },
    );

    expect(result.imported.map((m) => m.name)).toEqual(['Cantina']);
    expect(result.refused).toHaveLength(1);
  });

  it('gives imported audio the role chosen at import: Music, Sound effect or Ambience', async () => {
    const { campaign, library } = await setup();

    for (const role of ['music', 'soundEffect', 'ambience'] as const) {
      const { imported } = await library.import(
        campaign.id,
        [await sourceFile(`${role}.ogg`, role)],
        { accept: 'audio', role },
      );
      expect(imported).toEqual([
        expect.objectContaining({ kind: 'audio', role, name: role, extension: '.ogg' }),
      ]);
    }
    expect((await library.list(campaign.id)).map((m) => m.kind === 'audio' && m.role)).toEqual([
      'music',
      'soundEffect',
      'ambience',
    ]);
  });

  it('changes an image category at any time, and keeps the change after a restart', async () => {
    const { campaign, library } = await setup();
    const [image] = (
      await library.import(campaign.id, [await sourceFile('Vador.webp')], { accept: 'image' })
    ).imported;

    const character = await library.setImageCategory(campaign.id, image.id, 'character');
    expect(character).toEqual({ ...image, category: 'character' });

    const reopened = createMediaLibrary(openStorage(path.join(dir.path, 'data')));
    expect(await reopened.list(campaign.id)).toEqual([character]);
    expect(await reopened.setImageCategory(campaign.id, image.id, 'scenery')).toEqual(image);
  });

  it('never changes the role of audio', async () => {
    const { campaign, library } = await setup();
    const [sound] = (
      await library.import(campaign.id, [await sourceFile('pluie.mp3')], {
        accept: 'audio',
        role: 'ambience',
      })
    ).imported;

    await expect(library.setImageCategory(campaign.id, sound.id, 'character')).rejects.toThrow(
      'Seules les images ont une catégorie',
    );
    expect(await library.list(campaign.id)).toEqual([sound]);
  });

  it('refuses to import into a Campaign that does not exist', async () => {
    const { library } = await setup();

    await expect(
      library.import('inconnue', [await sourceFile('Cantina.png')], { accept: 'image' }),
    ).rejects.toThrow('Cette campagne n’existe plus.');
  });

  it('keeps every Media when imports into a Campaign overlap', async () => {
    const { campaign, library } = await setup();
    const files = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => sourceFile(`${name}.png`, name)),
    );

    await Promise.all(
      files.map((file) => library.import(campaign.id, [file], { accept: 'image' })),
    );

    expect((await library.list(campaign.id)).map((m) => m.name).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('lists files in the media folder that no Media refers to', async () => {
    const { storage, campaign, library } = await setup();
    await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' });
    const mediaFolder = path.join(storage.campaignFolder(campaign.id), 'media');
    await fs.writeFile(path.join(mediaFolder, 'oublié.png'), 'x');
    await fs.writeFile(path.join(mediaFolder, `${'0'.repeat(64)}.mp3`), 'y');

    expect(await library.listOrphanFiles(campaign.id)).toEqual([
      `${'0'.repeat(64)}.mp3`,
      'oublié.png',
    ]);
  });

  it('deletes a Media and its file, also after a restart', async () => {
    const { storage, campaign, library } = await setup();
    const [cantina] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;
    const theme = (
      await library.import(campaign.id, [await sourceFile('Theme.mp3', 'other')], {
        accept: 'audio',
        role: 'music',
      })
    ).imported[0];

    await library.delete(campaign.id, cantina.id);

    expect(await library.list(campaign.id)).toEqual([theme]);
    const reopened = createMediaLibrary(openStorage(path.join(dir.path, 'data')));
    expect(await reopened.list(campaign.id)).toEqual([theme]);
    const mediaFolder = path.join(storage.campaignFolder(campaign.id), 'media');
    expect(await fs.readdir(mediaFolder)).toEqual([`${theme.contentHash}.mp3`]);
    expect(await library.listOrphanFiles(campaign.id)).toEqual([]);
  });

  it('deletes a Media whose file is already missing', async () => {
    const { storage, campaign, library } = await setup();
    const [cantina] = (
      await library.import(campaign.id, [await sourceFile('Cantina.png')], { accept: 'image' })
    ).imported;
    await fs.rm(path.join(storage.campaignFolder(campaign.id), 'media', `${ABC_SHA256}.png`));

    await library.delete(campaign.id, cantina.id);

    expect(await library.list(campaign.id)).toEqual([]);
  });

  it('refuses to delete a Media that no longer exists', async () => {
    const { campaign, library } = await setup();

    await expect(library.delete(campaign.id, 'gone')).rejects.toThrow('Ce média n’existe plus.');
  });

  it('lists no orphan files before anything is imported', async () => {
    const { campaign, library } = await setup();
    expect(await library.listOrphanFiles(campaign.id)).toEqual([]);
  });
});

describe('media addresses', () => {
  const dir = useTempDir();

  async function importedImage() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const campaign = await createCampaign(storage.campaigns, 'Star Wars');
    const library = createMediaLibrary(storage);
    const source = path.join(dir.path, 'Cantina.jpeg');
    await fs.writeFile(source, 'abc');
    const [media] = (await library.import(campaign.id, [source], { accept: 'image' })).imported;
    return { storage, campaign, library, media };
  }

  it('serve an existing Media file with its content type', async () => {
    const { storage, campaign, library, media } = await importedImage();

    expect(mediaAddress(media)).toBe(`regie-asset://media/${campaign.id}/${ABC_SHA256}.jpeg`);
    expect(await library.resolveAddress(mediaAddress(media), campaign.id)).toEqual({
      file: path.join(storage.campaignFolder(campaign.id), 'media', `${ABC_SHA256}.jpeg`),
      mimeType: 'image/jpeg',
    });
  });

  it('serve only the open Campaign media: nothing from another Campaign, nothing when none is open', async () => {
    const { storage, library, media } = await importedImage();
    const other = await createCampaign(storage.campaigns, 'Dune');

    expect(await library.resolveAddress(mediaAddress(media), other.id)).toBeUndefined();
    expect(await library.resolveAddress(mediaAddress(media), null)).toBeUndefined();
  });

  it('serve nothing for a Media whose file is missing', async () => {
    const { storage, campaign, library, media } = await importedImage();
    await fs.rm(path.join(storage.campaignFolder(campaign.id), 'media'), { recursive: true });

    expect(await library.resolveAddress(mediaAddress(media), campaign.id)).toBeUndefined();
  });

  it('serve nothing outside the Campaign media folder or for a disallowed type', async () => {
    const { storage, campaign, library } = await importedImage();
    const folder = storage.campaignFolder(campaign.id);
    // Files that exist, to prove the refusals are not just "file not found".
    await fs.writeFile(path.join(folder, 'media', `${ABC_SHA256}.exe`), 'x');
    await fs.writeFile(path.join(dir.path, 'data', `${ABC_SHA256}.png`), 'x');

    for (const url of [
      `regie-asset://media/${campaign.id}/${ABC_SHA256}.exe`,
      `regie-asset://media/${campaign.id}/campaign.json`,
      `regie-asset://media/${campaign.id}/..%2F..%2F..%2F${ABC_SHA256}.png`,
      `regie-asset://media/${campaign.id}/../../../${ABC_SHA256}.png`,
      `regie-asset://media/..%2F..%2F${campaign.id}/${ABC_SHA256}.jpeg`,
      `regie-asset://media/${campaign.id}/media/${ABC_SHA256}.jpeg`,
      `regie-asset://media/${campaign.id}%2Fmedia/${ABC_SHA256}.jpeg`,
      `regie-asset://other/${campaign.id}/${ABC_SHA256}.jpeg`,
      `regie-asset://media/inconnue/${ABC_SHA256}.jpeg`,
      `file:///${folder}/media/${ABC_SHA256}.jpeg`,
      'not a url',
    ]) {
      expect(await library.resolveAddress(url, campaign.id), url).toBeUndefined();
    }
  });

  it('serve every allowlisted type with an explicit content type, and nothing else', async () => {
    const { storage, campaign, library } = await importedImage();
    const media = path.join(storage.campaignFolder(campaign.id), 'media');
    const served: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
    };
    const refused = ['gif', 'svg', 'html', 'js', 'json', 'txt', 'PNG', 'png.exe', 'exe.png.'];
    for (const extension of [...Object.keys(served), ...refused]) {
      await fs.writeFile(path.join(media, `${'1'.repeat(64)}.${extension}`), 'x');
    }

    for (const [extension, mimeType] of Object.entries(served)) {
      const url = `regie-asset://media/${campaign.id}/${'1'.repeat(64)}.${extension}`;
      expect(await library.resolveAddress(url, campaign.id), url).toMatchObject({ mimeType });
    }
    for (const extension of refused) {
      const url = `regie-asset://media/${campaign.id}/${'1'.repeat(64)}.${extension}`;
      expect(await library.resolveAddress(url, campaign.id), url).toBeUndefined();
    }
  });

  it('serve nothing for Windows-style path escapes', async () => {
    const { storage, campaign, library } = await importedImage();
    const data = path.join(dir.path, 'data');
    await fs.writeFile(path.join(data, `${ABC_SHA256}.png`), 'x');
    const absolute = encodeURIComponent(path.join(data, `${ABC_SHA256}.png`));

    for (const url of [
      `regie-asset://media/${campaign.id}/..%5C..%5C..%5C${ABC_SHA256}.png`,
      `regie-asset://media/${campaign.id}/..\\..\\..\\${ABC_SHA256}.png`,
      `regie-asset://media/..%5C..%5C${campaign.id}/${ABC_SHA256}.jpeg`,
      `regie-asset://media/${campaign.id}/${absolute}`,
      `regie-asset://media/${encodeURIComponent(storage.campaignFolder(campaign.id))}/${ABC_SHA256}.jpeg`,
      `regie-asset://media/${campaign.id}/${ABC_SHA256}.jpeg%00.png`,
    ]) {
      expect(await library.resolveAddress(url, campaign.id), url).toBeUndefined();
    }
  });
});
