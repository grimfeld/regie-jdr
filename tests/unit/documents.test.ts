import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDocumentStore,
  nodeFileSystem,
  type DocumentType,
  type FileSystem,
  type Recovery,
} from '../../core/storage/documents';
import { useTempDir } from './tempDir';

interface Note {
  title: string;
  body: string;
}

const noteV1: DocumentType<Note> = {
  name: 'note',
  version: 1,
  migrations: {},
  parse: (value) =>
    typeof value.title === 'string' && typeof value.body === 'string'
      ? { title: value.title, body: value.body }
      : undefined,
};

describe('document store', () => {
  const dir = useTempDir();
  const file = () => path.join(dir.path, 'folder', 'note.json');

  it('reads back what it wrote, and nothing for a document never written', async () => {
    const store = createDocumentStore();
    expect(await store.read(file(), noteV1)).toBeUndefined();

    await store.write(file(), noteV1, { title: 'Taverne', body: 'Ambiance' });

    expect(await store.read(file(), noteV1)).toEqual({ title: 'Taverne', body: 'Ambiance' });
    expect(await createDocumentStore().read(file(), noteV1)).toEqual({
      title: 'Taverne',
      body: 'Ambiance',
    });
  });

  it('writes human-readable JSON carrying the schema version', async () => {
    await createDocumentStore().write(file(), noteV1, { title: 'Taverne', body: '' });

    const onDisk: unknown = JSON.parse(await fs.readFile(file(), 'utf8'));
    expect(onDisk).toEqual({ schemaVersion: 1, title: 'Taverne', body: '' });
  });

  it('keeps the previous version when a write is interrupted', async () => {
    await createDocumentStore().write(file(), noteV1, { title: 'Avant', body: '' });

    // A disk that dies halfway through writing the new version of the document.
    const failing: FileSystem = {
      ...nodeFileSystem,
      async writeFile(target, data) {
        if (!target.startsWith(file())) return nodeFileSystem.writeFile(target, data);
        if (target.endsWith('.bak') || target.endsWith('.bak.tmp')) {
          return nodeFileSystem.writeFile(target, data);
        }
        await nodeFileSystem.writeFile(target, data.slice(0, data.length / 2));
        throw new Error('disk unplugged');
      },
    };
    await expect(
      createDocumentStore({ fileSystem: failing }).write(file(), noteV1, {
        title: 'Après',
        body: 'x'.repeat(1000),
      }),
    ).rejects.toThrow('disk unplugged');

    expect(await createDocumentStore().read(file(), noteV1)).toEqual({ title: 'Avant', body: '' });
  });

  it('recovers a corrupt document from its backup and reports it', async () => {
    const store = createDocumentStore();
    await store.write(file(), noteV1, { title: 'Première', body: '' });
    await store.write(file(), noteV1, { title: 'Seconde', body: '' });
    await fs.writeFile(file(), '{"schemaVersion": 1, "title": "Sec');

    const recoveries: Recovery[] = [];
    const recovering = createDocumentStore({ onRecovered: (r) => recoveries.push(r) });

    expect(await recovering.read(file(), noteV1)).toEqual({ title: 'Première', body: '' });
    expect(recoveries).toEqual([{ file: file(), documentType: 'note' }]);
    // The good copy is put back: the next read needs no recovery.
    expect(await recovering.read(file(), noteV1)).toEqual({ title: 'Première', body: '' });
    expect(recoveries).toHaveLength(1);
  });

  it('treats a document that does not match its type as corrupt', async () => {
    const store = createDocumentStore();
    await store.write(file(), noteV1, { title: 'Bonne', body: '' });
    await store.write(file(), noteV1, { title: 'Suivante', body: '' });
    await fs.writeFile(file(), JSON.stringify({ schemaVersion: 1, title: 42 }));

    const recoveries: Recovery[] = [];
    const read = await createDocumentStore({ onRecovered: (r) => recoveries.push(r) }).read(
      file(),
      noteV1,
    );
    expect(read).toEqual({ title: 'Bonne', body: '' });
    expect(recoveries).toHaveLength(1);
  });

  it('fails clearly when a corrupt document has no usable backup', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), 'not json');

    await expect(createDocumentStore().read(file(), noteV1)).rejects.toThrow(/note/);
  });

  it('does not let a corrupt current file overwrite a good backup', async () => {
    const store = createDocumentStore();
    await store.write(file(), noteV1, { title: 'Bonne', body: '' });
    await store.write(file(), noteV1, { title: 'Suivante', body: '' });
    await fs.writeFile(file(), 'garbage');
    // Writing over the corrupt file must keep "Bonne" as the backup...
    await store.write(file(), noteV1, { title: 'Nouvelle', body: '' });
    await fs.writeFile(file(), 'garbage again');

    // ...so the next corruption still recovers a good version, never the garbage.
    expect(await store.read(file(), noteV1)).toEqual({ title: 'Bonne', body: '' });
  });

  it('migrates older documents to the current schema version on load', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), JSON.stringify({ schemaVersion: 1, text: 'Taverne' }));

    const noteV3: DocumentType<Note & { tags: string[] }> = {
      name: 'note',
      version: 3,
      migrations: {
        1: ({ text, ...rest }) => ({ ...rest, title: text, body: '' }),
        2: (doc) => ({ ...doc, tags: [] }),
      },
      parse: (value) =>
        typeof value.title === 'string' &&
        typeof value.body === 'string' &&
        Array.isArray(value.tags)
          ? { title: value.title, body: value.body, tags: value.tags as string[] }
          : undefined,
    };
    const store = createDocumentStore();
    expect(await store.read(file(), noteV3)).toEqual({ title: 'Taverne', body: '', tags: [] });

    await store.write(file(), noteV3, { title: 'Taverne', body: '', tags: ['nuit'] });
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toMatchObject({ schemaVersion: 3 });
  });

  it('refuses a document written by a newer version of the app, without touching it', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    const future = JSON.stringify({ schemaVersion: 9, title: 'Futur', body: '' });
    await fs.writeFile(file(), future);

    await expect(createDocumentStore().read(file(), noteV1)).rejects.toThrow(/newer/);
    expect(await fs.readFile(file(), 'utf8')).toBe(future);
  });

  it('keeps every write when several are made at once', async () => {
    const store = createDocumentStore();
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((title) => store.write(file(), noteV1, { title, body: '' })),
    );
    expect(await store.read(file(), noteV1)).toEqual({ title: 'd', body: '' });
  });
});
