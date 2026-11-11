/**
 * Creating and editing Campaigns. Errors are CampaignError with a French message for the
 * Game Master.
 */
import { randomUUID } from 'node:crypto';
import type { Campaign, CampaignId, ThemeId } from '../shared/domain.js';
import type { CampaignChanges } from '../shared/contract.js';
import type { CampaignRepository } from './storage/campaigns.js';
import { DEFAULT_HOME_THEME, type SettingsStore } from './settings.js';

export class CampaignError extends Error {}

export const MAX_CAMPAIGN_NAME_LENGTH = 100;

interface Clock {
  now?: () => Date;
}

interface NewCampaignOptions extends Clock {
  /** Its theme; the app passes the home page's (createCampaignInHomeTheme). */
  theme?: ThemeId;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CampaignError('Donnez un nom à la campagne.');
  if (trimmed.length > MAX_CAMPAIGN_NAME_LENGTH) {
    throw new CampaignError(
      `Le nom de la campagne est trop long (${MAX_CAMPAIGN_NAME_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

export async function createCampaign(
  repository: CampaignRepository,
  name: string,
  { theme = DEFAULT_HOME_THEME, now = () => new Date() }: NewCampaignOptions = {},
): Promise<Campaign> {
  const timestamp = now().toISOString();
  const campaign: Campaign = {
    id: randomUUID(),
    name: cleanName(name),
    theme,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repository.save(campaign);
  return campaign;
}

/**
 * A new Campaign in the home page's current theme (Settings), so the Game Master need not
 * change it each time (spec #58, story 49). Changing either theme later leaves the other alone.
 */
export async function createCampaignInHomeTheme(
  repository: CampaignRepository,
  settings: Pick<SettingsStore, 'get'>,
  name: string,
): Promise<Campaign> {
  const { theme } = await settings.get();
  return createCampaign(repository, name, { theme });
}

export async function updateCampaign(
  repository: CampaignRepository,
  id: CampaignId,
  changes: CampaignChanges,
  { now = () => new Date() }: Clock = {},
): Promise<Campaign> {
  const current = await repository.get(id);
  if (!current) throw new CampaignError('Cette campagne n’existe plus.');
  const updated: Campaign = {
    ...current,
    ...(changes.name !== undefined && { name: cleanName(changes.name) }),
    ...(changes.theme !== undefined && { theme: changes.theme }),
    updatedAt: now().toISOString(),
  };
  await repository.save(updated);
  return updated;
}
