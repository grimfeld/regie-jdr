/**
 * Creating and editing Campaigns. Errors are CampaignError with a French message for the
 * Game Master.
 */
import { randomUUID } from 'node:crypto';
import type { Campaign, CampaignId, ThemeId } from '../shared/domain.js';
import type { CampaignChanges } from '../shared/contract.js';
import type { CampaignRepository } from './storage/campaigns.js';

export class CampaignError extends Error {}

/** Theme of a new Campaign until the theme picker lets the Game Master choose. */
export const DEFAULT_CAMPAIGN_THEME: ThemeId = 'imperium';
export const MAX_CAMPAIGN_NAME_LENGTH = 100;

interface Clock {
  now?: () => Date;
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
  { now = () => new Date() }: Clock = {},
): Promise<Campaign> {
  const timestamp = now().toISOString();
  const campaign: Campaign = {
    id: randomUUID(),
    name: cleanName(name),
    theme: DEFAULT_CAMPAIGN_THEME,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repository.save(campaign);
  return campaign;
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
