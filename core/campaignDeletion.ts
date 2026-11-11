/**
 * Deleting a Campaign (ADR-0005): its folder goes to the Recycle Bin, through a Trash the main
 * process provides (Windows' Recycle Bin) and tests fake. When the Recycle Bin refuses it,
 * nothing is deleted; a permanent delete is then allowed for that Campaign only, once the
 * Game Master confirms again. Never the open Campaign (delete is offered on the Campaign list),
 * nor one being exported.
 *
 * The id comes from a window, so it is never trusted to name a folder: before anything is
 * deleted, the folder must be a real folder (not a link) directly inside the campaigns folder,
 * holding a readable Campaign.
 */
import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CampaignDeletionSummary, CampaignTrashing } from '../shared/contract.js';
import type { Campaign, CampaignId } from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { createKeyedSerialQueue } from './serialQueue.js';
import type { SettingsStore } from './settings.js';
import { isCampaignId, isSameCampaignId, type Storage } from './storage/index.js';

/** The system's recycle bin. */
export interface Trash {
  /** Moves a folder, with everything in it, to the recycle bin; throws when it refuses. */
  moveToTrash(folder: string): Promise<void>;
}

export interface CampaignDeletion {
  /** What deleting the Campaign takes away, for the confirmation. */
  summary(id: CampaignId): Promise<CampaignDeletionSummary>;
  /** Moves the Campaign to the Recycle Bin; reports a refusal without deleting anything. */
  moveToTrash(id: CampaignId): Promise<CampaignTrashing>;
  /** Deletes the Campaign for good; refused unless the Recycle Bin refused it just before. */
  deletePermanently(id: CampaignId): Promise<void>;
}

export interface CampaignDeletionDeps {
  storage: Pick<Storage, 'campaigns' | 'campaignsFolder' | 'campaignFolder'>;
  countScenes(id: CampaignId): Promise<number>;
  countMedia(id: CampaignId): Promise<number>;
  settings: Pick<SettingsStore, 'forgetCampaign'>;
  trash: Trash;
  /** The Campaign open in the Control window, which may not be deleted. */
  openCampaignId(): CampaignId | null;
  /** Whether an Export of this Campaign runs (core/campaignTransfer.ts): it reads the folder. */
  isTransferring(id: CampaignId): boolean;
}

const NOT_A_CAMPAIGN = 'Cette campagne n’existe plus.';

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Total size of the files in a folder, its subfolders included; links are not followed. */
async function sizeOf(folder: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await sizeOf(full);
    else if (entry.isFile()) total += (await fsp.lstat(full)).size;
  }
  return total;
}

export function createCampaignDeletion(deps: CampaignDeletionDeps): CampaignDeletion {
  const { storage, settings, trash } = deps;
  /** Campaigns the Recycle Bin refused last time: the only ones that may be deleted for good. */
  /** Keyed by lowercase id, like the queue: `ABC` and `abc` are one folder on Windows. */
  const refusedByTrash = new Set<string>();
  const queue = createKeyedSerialQueue<string>();
  const serialized = <T>(id: CampaignId, task: () => Promise<T>) => queue(id.toLowerCase(), task);

  /**
   * The Campaign and its folder, once checked: a closed Campaign, whose folder is a real folder
   * directly inside the campaigns folder (links resolved) and holds a readable Campaign.
   */
  async function checked(id: unknown): Promise<{ campaign: Campaign; folder: string }> {
    if (!isCampaignId(id)) throw new CampaignError(NOT_A_CAMPAIGN);
    if (isSameCampaignId(deps.openCampaignId(), id)) {
      throw new CampaignError('Fermez cette campagne avant de la supprimer.');
    }
    if (deps.isTransferring(id)) {
      throw new CampaignError(
        'Cette campagne est en cours d’export : attendez sa fin ou annulez-le avant de la supprimer.',
      );
    }
    const folder = storage.campaignFolder(id);
    let stats;
    try {
      stats = await fsp.lstat(folder);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new CampaignError(NOT_A_CAMPAIGN);
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new CampaignError(NOT_A_CAMPAIGN);
    const [realRoot, realFolder] = await Promise.all([
      fsp.realpath(storage.campaignsFolder),
      fsp.realpath(folder),
    ]);
    const relative = path.relative(realRoot, realFolder);
    if (!relative || relative !== path.basename(realFolder) || path.isAbsolute(relative)) {
      throw new CampaignError(NOT_A_CAMPAIGN);
    }
    let campaign: Campaign | undefined;
    try {
      campaign = await storage.campaigns.get(id);
    } catch {
      campaign = undefined;
    }
    if (!campaign) throw new CampaignError(NOT_A_CAMPAIGN);
    return { campaign, folder };
  }

  return {
    summary: (id) =>
      serialized(id, async () => {
        const { campaign, folder } = await checked(id);
        const [sceneCount, mediaCount, sizeBytes] = await Promise.all([
          deps.countScenes(id),
          deps.countMedia(id),
          sizeOf(folder),
        ]);
        return { id, name: campaign.name, sceneCount, mediaCount, sizeBytes };
      }),

    moveToTrash: (id) =>
      serialized(id, async () => {
        const { campaign, folder } = await checked(id);
        let refused = false;
        try {
          await trash.moveToTrash(folder);
        } catch {
          refused = true;
        }
        // A Recycle Bin that answered but left the folder has not taken it either.
        if (refused || (await exists(folder))) {
          refusedByTrash.add(id.toLowerCase());
          return {
            deleted: false,
            reason:
              `La corbeille de Windows n’a pas accepté la campagne « ${campaign.name} » ` +
              '(lecteur réseau, fichier ouvert dans un autre programme…). Rien n’a été supprimé.',
          };
        }
        refusedByTrash.delete(id.toLowerCase());
        await settings.forgetCampaign(id);
        return { deleted: true };
      }),

    deletePermanently: (id) =>
      serialized(id, async () => {
        await checked(id);
        if (!refusedByTrash.has(id.toLowerCase())) {
          throw new CampaignError(
            'Une campagne n’est supprimée définitivement que si la corbeille l’a refusée.',
          );
        }
        await storage.campaigns.delete(id);
        refusedByTrash.delete(id.toLowerCase());
        await settings.forgetCampaign(id);
      }),
  };
}
