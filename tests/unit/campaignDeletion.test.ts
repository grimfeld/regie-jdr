import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignError, createCampaign } from '../../core/campaigns';
import { createCampaignDeletion, type Trash } from '../../core/campaignDeletion';
import { createMediaLibrary } from '../../core/media';
import { createSceneLibrary } from '../../core/scenes';
import { createSettingsStore } from '../../core/settings';
import { openStorage } from '../../core/storage';
import type { CampaignId } from '../../shared/domain';
import { fakeResizer } from './fakeResizer';
import { useTempDir } from './tempDir';

/**
 * A Recycle Bin standing in for Windows': it moves folders into `bin` (inside the test's temp
 * folder), or refuses every folder with `refusal`. It records every folder it was given.
 */
function fakeTrash(bin: string, refusal?: Error) {
  const received: string[] = [];
  const trash: Trash = {
    async moveToTrash(folder) {
      received.push(folder);
      if (refusal) throw refusal;
      await fs.mkdir(bin, { recursive: true });
      await fs.rename(folder, path.join(bin, path.basename(folder)));
    },
  };
  return { trash, received };
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

describe('deleting a Campaign', () => {
  const dir = useTempDir();

  async function setup({
    refusal,
    open = null,
  }: { refusal?: Error; open?: CampaignId | null } = {}) {
    const root = path.join(dir.path, 'data');
    const storage = openStorage(root);
    const scenes = createSceneLibrary(storage);
    const library = createMediaLibrary(storage, fakeResizer().resizer);
    const settings = createSettingsStore(storage);
    const { trash, received } = fakeTrash(path.join(dir.path, 'bin'), refusal);
    let openId: CampaignId | null = open;
    const deletion = createCampaignDeletion({
      storage,
      countScenes: async (id) => (await scenes.list(id)).length,
      countMedia: async (id) => (await library.list(id)).length,
      settings,
      trash,
      openCampaignId: () => openId,
    });
    const campaign = await createCampaign(storage.campaigns, 'Les Ombres');
    return {
      root,
      storage,
      scenes,
      library,
      settings,
      deletion,
      received,
      campaign,
      folder: storage.campaignFolder(campaign.id),
      setOpen: (id: CampaignId | null) => {
        openId = id;
      },
    };
  }

  async function sourceFile(name: string, content: string): Promise<string> {
    const folder = path.join(dir.path, 'picked');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, name);
    await fs.writeFile(file, content);
    return file;
  }

  it('summarises the Campaign: name, Scene and Media counts, size on disk', async () => {
    const { deletion, campaign, scenes, library, folder } = await setup();
    await scenes.create(campaign.id, 'Cantina');
    await scenes.create(campaign.id, 'Hangar');
    await library.import(
      campaign.id,
      [await sourceFile('a.png', 'aaaa'), await sourceFile('b.png', 'bbbbbb')],
      { accept: 'image' },
    );

    const summary = await deletion.summary(campaign.id);

    let size = 0;
    const walk = async (at: string): Promise<void> => {
      for (const entry of await fs.readdir(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) await walk(full);
        else size += (await fs.stat(full)).size;
      }
    };
    await walk(folder);
    expect(summary).toEqual({
      id: campaign.id,
      name: 'Les Ombres',
      sceneCount: 2,
      mediaCount: 2,
      sizeBytes: size,
    });
    expect(size).toBeGreaterThan(10);
  });

  it('moves the Campaign folder to the Recycle Bin: gone from the list, nothing else touched', async () => {
    const { deletion, campaign, storage, received, folder, root } = await setup();
    const other = await createCampaign(storage.campaigns, 'Warhammer');

    expect(await deletion.moveToTrash(campaign.id)).toEqual({ deleted: true });

    expect(received).toEqual([folder]);
    expect(await exists(folder)).toBe(false);
    expect(await exists(path.join(dir.path, 'bin', campaign.id, 'campaign.json'))).toBe(true);
    expect(await openStorage(root).campaigns.list()).toEqual([other]);
  });

  it('removes the Campaign’s Settings entry (its last Active Scene), keeping the others', async () => {
    const { deletion, campaign, settings } = await setup();
    await settings.setLastActiveScene(campaign.id, 'cantina');
    await settings.setLastActiveScene('other-campaign', 'hangar');

    await deletion.moveToTrash(campaign.id);

    expect((await settings.get()).lastActiveSceneByCampaign).toEqual({
      'other-campaign': 'hangar',
    });
  });

  it('deletes nothing when the Recycle Bin refuses, and says why in French', async () => {
    const { deletion, campaign, settings, folder, root } = await setup({
      refusal: new Error('Failed to move item to trash'),
    });
    await settings.setLastActiveScene(campaign.id, 'cantina');

    const outcome = await deletion.moveToTrash(campaign.id);

    expect(outcome).toEqual({ deleted: false, reason: expect.stringContaining('corbeille') });
    expect(await exists(path.join(folder, 'campaign.json'))).toBe(true);
    expect(await openStorage(root).campaigns.list()).toEqual([campaign]);
    expect((await settings.get()).lastActiveSceneByCampaign).toEqual({ [campaign.id]: 'cantina' });
  });

  it('counts a folder still there after the Recycle Bin answered as refused', async () => {
    const { campaign, folder, storage, settings } = await setup();
    const deletion = createCampaignDeletion({
      storage,
      countScenes: () => Promise.resolve(0),
      countMedia: () => Promise.resolve(0),
      settings,
      trash: { moveToTrash: () => Promise.resolve() },
      openCampaignId: () => null,
    });

    expect(await deletion.moveToTrash(campaign.id)).toMatchObject({ deleted: false });
    expect(await exists(folder)).toBe(true);
  });

  it('deletes permanently only after the Recycle Bin refused that Campaign', async () => {
    const { deletion, campaign, storage, folder } = await setup({
      refusal: new Error('locked'),
    });
    const other = await createCampaign(storage.campaigns, 'Warhammer');

    // Never asked for the Recycle Bin first: refused, nothing deleted.
    await expect(deletion.deletePermanently(campaign.id)).rejects.toThrow(CampaignError);
    expect(await exists(folder)).toBe(true);

    await deletion.moveToTrash(campaign.id);
    // The refusal was for this Campaign only.
    await expect(deletion.deletePermanently(other.id)).rejects.toThrow(CampaignError);

    await deletion.deletePermanently(campaign.id);
    expect(await exists(folder)).toBe(false);
    expect(await storage.campaigns.list()).toEqual([other]);
  });

  it('cleans up the Settings entry on a permanent delete too', async () => {
    const { deletion, campaign, settings } = await setup({ refusal: new Error('locked') });
    await settings.setLastActiveScene(campaign.id, 'cantina');
    await deletion.moveToTrash(campaign.id);

    await deletion.deletePermanently(campaign.id);

    expect((await settings.get()).lastActiveSceneByCampaign).toEqual({});
  });

  it('refuses to delete the open Campaign, in any way', async () => {
    const { deletion, campaign, received, folder, setOpen } = await setup({
      refusal: new Error('locked'),
    });
    await deletion.moveToTrash(campaign.id);
    setOpen(campaign.id);

    await expect(deletion.summary(campaign.id)).rejects.toThrow(/Fermez/);
    await expect(deletion.moveToTrash(campaign.id)).rejects.toThrow(CampaignError);
    await expect(deletion.deletePermanently(campaign.id)).rejects.toThrow(CampaignError);
    expect(received).toHaveLength(1);
    expect(await exists(folder)).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'refuses the open Campaign named with other letter cases (one folder on Windows)',
    async () => {
      const { deletion, campaign, received, folder, setOpen } = await setup({
        refusal: new Error('locked'),
      });
      const shouted = campaign.id.toUpperCase();
      await deletion.moveToTrash(shouted);
      setOpen(campaign.id);

      await expect(deletion.summary(shouted)).rejects.toThrow(/Fermez/);
      await expect(deletion.moveToTrash(shouted)).rejects.toThrow(/Fermez/);
      await expect(deletion.deletePermanently(shouted)).rejects.toThrow(/Fermez/);
      setOpen(shouted);
      await expect(deletion.moveToTrash(campaign.id)).rejects.toThrow(/Fermez/);
      expect(received).toHaveLength(1);
      expect(await exists(folder)).toBe(true);
    },
  );

  it.runIf(process.platform === 'win32')(
    'forgets the Campaign’s Settings entry when it is deleted under another letter case',
    async () => {
      const { deletion, campaign, settings } = await setup();
      await settings.setLastActiveScene(campaign.id, 'cantina');

      expect(await deletion.moveToTrash(campaign.id.toUpperCase())).toEqual({ deleted: true });

      expect((await settings.get()).lastActiveSceneByCampaign).toEqual({});
    },
  );

  it('refuses ids that are not a Campaign of the campaigns folder, touching nothing', async () => {
    const { deletion, received, root } = await setup();
    await fs.mkdir(path.join(root, 'campaigns', 'not-a-campaign'), { recursive: true });
    await fs.writeFile(path.join(root, 'campaigns', 'not-a-campaign', 'keep.txt'), 'x');

    for (const id of ['..', '../..', '../data', 'missing', 'not-a-campaign', '', 'a/b', 'C:\\x']) {
      await expect(deletion.moveToTrash(id)).rejects.toThrow(CampaignError);
      await expect(deletion.summary(id)).rejects.toThrow(CampaignError);
    }
    expect(received).toEqual([]);
    expect(await exists(path.join(root, 'campaigns', 'not-a-campaign', 'keep.txt'))).toBe(true);
    expect(await exists(path.join(root, 'settings.json'))).toBe(false);
  });

  it('refuses a Campaign folder that is a link to somewhere else', async () => {
    const { deletion, received, root, campaign, folder } = await setup();
    // A real Campaign elsewhere, reached through a junction inside the campaigns folder.
    const outside = path.join(dir.path, 'outside');
    await fs.cp(folder, outside, { recursive: true });
    const linked = path.join(root, 'campaigns', 'linked');
    await fs.symlink(outside, linked, 'junction');

    await expect(deletion.moveToTrash('linked')).rejects.toThrow(CampaignError);
    expect(received).toEqual([]);
    expect(await exists(path.join(outside, 'campaign.json'))).toBe(true);
    // The real one is still deletable.
    expect(await deletion.moveToTrash(campaign.id)).toEqual({ deleted: true });
  });
});
