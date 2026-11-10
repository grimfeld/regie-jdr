import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStorage } from '../../core/storage';
import { CampaignError, createCampaign, updateCampaign } from '../../core/campaigns';
import { useTempDir } from './tempDir';

const clock = (iso: string) => () => new Date(iso);

describe('campaigns', () => {
  const dir = useTempDir();

  it('start with an empty list: no hidden default Campaign', async () => {
    const storage = openStorage(dir.path);
    expect(await storage.campaigns.list()).toEqual([]);
  });

  it('are created with a name and the default theme, and survive reopening the storage', async () => {
    const created = await createCampaign(openStorage(dir.path).campaigns, '  Les Ombres  ', {
      now: clock('2026-11-10T20:00:00.000Z'),
    });

    expect(created).toMatchObject({
      name: 'Les Ombres',
      theme: 'imperium',
      createdAt: '2026-11-10T20:00:00.000Z',
      updatedAt: '2026-11-10T20:00:00.000Z',
    });
    expect(await openStorage(dir.path).campaigns.list()).toEqual([created]);
    expect(await openStorage(dir.path).campaigns.get(created.id)).toEqual(created);
  });

  it('each live in their own folder, storing their theme', async () => {
    const storage = openStorage(dir.path);
    const first = await createCampaign(storage.campaigns, 'Star Wars');
    const second = await createCampaign(storage.campaigns, 'Warhammer');

    expect(storage.campaignFolder(first.id)).not.toBe(storage.campaignFolder(second.id));
    const onDisk: unknown = JSON.parse(
      await fs.readFile(path.join(storage.campaignFolder(second.id), 'campaign.json'), 'utf8'),
    );
    expect(onDisk).toMatchObject({ schemaVersion: 1, name: 'Warhammer', theme: 'imperium' });
  });

  it('are listed by name', async () => {
    const storage = openStorage(dir.path);
    await createCampaign(storage.campaigns, 'Warhammer');
    await createCampaign(storage.campaigns, 'écume');
    await createCampaign(storage.campaigns, 'Star Wars');

    const names = (await openStorage(dir.path).campaigns.list()).map((c) => c.name);
    expect(names).toEqual(['écume', 'Star Wars', 'Warhammer']);
  });

  it('can be renamed and change theme, which survives reopening', async () => {
    const storage = openStorage(dir.path);
    const created = await createCampaign(storage.campaigns, 'Star Wras', {
      now: clock('2026-11-10T20:00:00.000Z'),
    });

    const renamed = await updateCampaign(
      storage.campaigns,
      created.id,
      { name: 'Star Wars', theme: 'retro' },
      { now: clock('2026-11-11T09:30:00.000Z') },
    );

    expect(renamed).toEqual({
      ...created,
      name: 'Star Wars',
      theme: 'retro',
      updatedAt: '2026-11-11T09:30:00.000Z',
    });
    expect(await openStorage(dir.path).campaigns.get(created.id)).toEqual(renamed);
  });

  it('refuse an empty name, in French', async () => {
    const storage = openStorage(dir.path);
    await expect(createCampaign(storage.campaigns, '   ')).rejects.toThrow(CampaignError);
    const created = await createCampaign(storage.campaigns, 'Star Wars');
    await expect(updateCampaign(storage.campaigns, created.id, { name: '' })).rejects.toThrow(
      /nom/,
    );
    expect(await storage.campaigns.list()).toEqual([created]);
  });

  it('refuse to update a Campaign that does not exist', async () => {
    const storage = openStorage(dir.path);
    await expect(updateCampaign(storage.campaigns, 'missing', { name: 'X' })).rejects.toThrow(
      CampaignError,
    );
  });

  it('never resolve a folder outside the campaigns folder', async () => {
    const storage = openStorage(dir.path);
    await createCampaign(storage.campaigns, 'Star Wars');
    expect(await storage.campaigns.get('..')).toBeUndefined();
    expect(await storage.campaigns.get('../..')).toBeUndefined();
    expect(() => storage.campaignFolder('../escape')).toThrow();
  });

  it('take their id from their folder, so a copied folder is a separate Campaign', async () => {
    const storage = openStorage(dir.path);
    const original = await createCampaign(storage.campaigns, 'Star Wars');
    await fs.cp(storage.campaignFolder(original.id), path.join(dir.path, 'campaigns', 'copie'), {
      recursive: true,
    });

    const ids = (await openStorage(dir.path).campaigns.list()).map((c) => c.id).sort();
    expect(ids).toEqual([original.id, 'copie'].sort());
  });

  it('recover a corrupt Campaign from its backup and tell the Game Master', async () => {
    const storage = openStorage(dir.path);
    const created = await createCampaign(storage.campaigns, 'Star Wars');
    await updateCampaign(storage.campaigns, created.id, { name: 'Star Wars : Rébellion' });
    const file = path.join(storage.campaignFolder(created.id), 'campaign.json');
    await fs.writeFile(file, '{ "schemaVers');

    const notices: string[] = [];
    const reopened = openStorage(dir.path, { notify: (message) => notices.push(message) });

    expect((await reopened.campaigns.list()).map((c) => c.name)).toEqual(['Star Wars']);
    expect(notices).toEqual([expect.stringContaining('sauvegarde')]);
  });

  it('list the readable Campaigns and report one that cannot be recovered', async () => {
    const storage = openStorage(dir.path);
    await createCampaign(storage.campaigns, 'Star Wars');
    const broken = await createCampaign(storage.campaigns, 'Warhammer');
    await fs.writeFile(path.join(storage.campaignFolder(broken.id), 'campaign.json'), 'garbage');

    const notices: string[] = [];
    const reopened = openStorage(dir.path, { notify: (message) => notices.push(message) });

    expect((await reopened.campaigns.list()).map((c) => c.name)).toEqual(['Star Wars']);
    expect(notices).toEqual([expect.stringContaining(broken.id)]);
  });
});
