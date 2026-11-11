/**
 * The app's storage (ADR-0001): one folder per Campaign under `<root>/campaigns/`, each holding
 * versioned JSON documents. See core/storage/documents.ts for atomic writes, backups, corruption
 * recovery and migrations.
 *
 * On-disk layout:
 *   <root>/campaigns/<campaignId>/campaign.json   Campaign (name, theme, timestamps)
 *   <root>/campaigns/<campaignId>/media.json      Media index (core/media.ts)
 *   <root>/campaigns/<campaignId>/media/          Media files, named <sha256><extension>
 *   <root>/campaigns/<campaignId>/scenes.json     Scenes (core/scenes.ts)
 *   <root>/campaigns/<campaignId>/soundboard.json Soundboard (core/soundboard.ts)
 *   <root>/settings.json                          global Settings (core/settings.ts)
 *   <root>/imports/                               Imports being checked (core/campaignImport.ts)
 * Every document has a `<file>.bak` (previous good version) next to it once rewritten.
 */
import path from 'node:path';
import type { CampaignId } from '../../shared/domain.js';
import { createCampaignRepository, type CampaignRepository } from './campaigns.js';
import { createDocumentStore, type DocumentStore, type FileSystem } from './documents.js';

export type { CampaignRepository } from './campaigns.js';
export type { DocumentStore, DocumentType, Recovery } from './documents.js';

export interface StorageOptions {
  /** Tells the Game Master something went wrong with stored data (plain French sentence). */
  notify?: (message: string) => void;
  fileSystem?: FileSystem;
}

export interface Storage {
  /** Root data folder. */
  root: string;
  /** Generic document store, for documents other than Campaigns (Media, Scenes, Settings). */
  documents: DocumentStore;
  campaigns: CampaignRepository;
  /** Folder holding every Campaign's folder. */
  campaignsFolder: string;
  /** Folder of a Campaign. Throws for an id that is not a plain folder name. */
  campaignFolder(id: CampaignId): string;
  /** File of the global settings document. */
  settingsFile: string;
  /** Where an Import unpacks and checks a zip, beside the campaigns folder (same disk). */
  importsFolder: string;
}

/** Campaign ids are folder names: letters, digits, `-` and `_` only (never `..` or a path). */
export function isCampaignId(value: unknown): value is CampaignId {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * Whether two Campaign ids name the same Campaign folder. Letter case is ignored: Windows'
 * folders ignore it, so `ABC` and `abc` are one Campaign there. Elsewhere this errs towards
 * refusing (the open Campaign check) and the app's ids are lowercase UUIDs anyway.
 */
export function isSameCampaignId(a: CampaignId | null, b: CampaignId | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

export function openStorage(root: string, options: StorageOptions = {}): Storage {
  const notify = options.notify ?? (() => undefined);
  const documents = createDocumentStore({
    fileSystem: options.fileSystem,
    onRecovered: ({ file }) =>
      notify(`Un fichier endommagé a été restauré depuis sa dernière sauvegarde : ${file}`),
  });
  const campaignsFolder = path.join(root, 'campaigns');
  const campaignFolder = (id: CampaignId) => {
    if (!isCampaignId(id)) throw new Error(`Invalid Campaign id: ${JSON.stringify(id)}`);
    return path.join(campaignsFolder, id);
  };
  return {
    root,
    documents,
    campaigns: createCampaignRepository({ documents, campaignsFolder, campaignFolder, notify }),
    campaignsFolder,
    campaignFolder,
    settingsFile: path.join(root, 'settings.json'),
    importsFolder: path.join(root, 'imports'),
  };
}
