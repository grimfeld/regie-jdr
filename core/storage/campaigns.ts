import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Campaign, CampaignId, ThemeId } from '../../shared/domain.js';
import type { DocumentStore, DocumentType } from './documents.js';

/** Persistence of Campaigns. The rest of the app only goes through this interface. */
export interface CampaignRepository {
  /** Every readable Campaign, sorted by name. */
  list(): Promise<Campaign[]>;
  get(id: CampaignId): Promise<Campaign | undefined>;
  /** Creates the Campaign's folder if needed. */
  save(campaign: Campaign): Promise<void>;
  /** Removes the Campaign's folder and everything in it. */
  delete(id: CampaignId): Promise<void>;
}

export const THEME_IDS: readonly ThemeId[] = ['retro', 'imperium', 'fantasy'];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** The id is not stored: it is the folder's name, so a copied folder is a separate Campaign. */
type CampaignFields = Omit<Campaign, 'id'>;

export const campaignDocument: DocumentType<CampaignFields> = {
  name: 'campaign',
  version: 1,
  migrations: {},
  parse({ name, theme, createdAt, updatedAt }) {
    if (typeof name !== 'string' || !isThemeId(theme)) return undefined;
    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return undefined;
    return { name, theme, createdAt, updatedAt };
  },
};

const CAMPAIGN_FILE = 'campaign.json';

export function createCampaignRepository(deps: {
  documents: DocumentStore;
  campaignsFolder: string;
  campaignFolder: (id: CampaignId) => string;
  notify: (message: string) => void;
}): CampaignRepository {
  const { documents, campaignsFolder, campaignFolder, notify } = deps;
  const fileOf = (id: CampaignId) => path.join(campaignFolder(id), CAMPAIGN_FILE);

  async function get(id: CampaignId): Promise<Campaign | undefined> {
    let file: string;
    try {
      file = fileOf(id);
    } catch {
      return undefined;
    }
    const fields = await documents.read(file, campaignDocument);
    return fields && { id, ...fields };
  }

  return {
    async list() {
      let entries: Dirent[];
      try {
        entries = await fsp.readdir(campaignsFolder, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      const campaigns: Campaign[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const campaign = await get(entry.name);
          if (campaign) campaigns.push(campaign);
        } catch {
          notify(
            `La campagne du dossier « ${entry.name} » est illisible et n’a pas pu être ouverte.`,
          );
        }
      }
      return campaigns.sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
      );
    },
    get,
    async save({ id, ...fields }) {
      await documents.write(fileOf(id), campaignDocument, fields);
    },
    async delete(id) {
      await fsp.rm(campaignFolder(id), { recursive: true, force: true });
    },
  };
}
