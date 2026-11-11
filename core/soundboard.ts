/**
 * A Campaign's Soundboard: its pads (each a Sound effect, in the Game Master's order) and its
 * level. One per Campaign, whichever Scene is active, or none. Edits are saved at once and never
 * enter an undo history. No Electron dependency.
 *
 * On disk, in the Campaign's folder: `soundboard.json` ({ pads, volume }, versioned document),
 * stored without its Campaign id (the folder gives it). None until the first edit.
 * Errors meant for the Game Master are SoundboardError (or MediaError) with a French message.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SoundboardEdit } from '../shared/contract.js';
import type { CampaignId, Media, MediaId, Soundboard, SoundboardPad } from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { isRecord } from './guards.js';
import { MediaError, type MediaLibrary } from './media.js';
import { mediaAddress } from './mediaAddress.js';
import { padGain, type PadPress } from './padVoices.js';
import { createKeyedSerialQueue } from './serialQueue.js';
import { parseVolume } from './settings.js';
import type { DocumentType, Storage } from './storage/index.js';

/** A Soundboard edit or press refused, with a message the Game Master can read. */
export class SoundboardError extends Error {}

export const MAX_PAD_LABEL_LENGTH = 60;
/** Texts longer than this are malformed messages; MAX_PAD_LABEL_LENGTH is the real limit. */
const MAX_TEXT_PAYLOAD = 1000;
/** A Soundboard level, until the Game Master changes it: full. */
const DEFAULT_LEVEL = 1;

// Edits --------------------------------------------------------------------

/** A pad name as saved: trimmed, '' for none. Throws a SoundboardError when too long. */
function cleanPadLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length > MAX_PAD_LABEL_LENGTH) {
    throw new SoundboardError(
      `Le nom du bruitage est trop long (${MAX_PAD_LABEL_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

function padIndex(board: Soundboard, padId: string): number {
  const index = board.pads.findIndex((pad) => pad.id === padId);
  if (index < 0) throw new SoundboardError('Ce bruitage n’est plus sur la table.');
  return index;
}

function withPad(board: Soundboard, padId: string, change: (pad: SoundboardPad) => SoundboardPad) {
  const index = padIndex(board, padId);
  return { ...board, pads: board.pads.map((pad, at) => (at === index ? change(pad) : pad)) };
}

/** `board` with `edit` applied. `newId` names a new pad. Throws a SoundboardError if refused. */
export function applySoundboardEdit(
  board: Soundboard,
  edit: SoundboardEdit,
  newId: () => string,
): Soundboard {
  switch (edit.kind) {
    case 'add-pad':
      return { ...board, pads: [...board.pads, { id: newId(), mediaId: edit.mediaId, volume: 1 }] };
    case 'rename-pad': {
      const label = cleanPadLabel(edit.label);
      return withPad(board, edit.padId, ({ label: _old, ...pad }) =>
        label ? { ...pad, label } : pad,
      );
    }
    case 'move-pad': {
      const pads = [...board.pads];
      const [moved] = pads.splice(padIndex(board, edit.padId), 1);
      pads.splice(Math.min(edit.toIndex, pads.length), 0, moved);
      return { ...board, pads };
    }
    case 'remove-pad':
      padIndex(board, edit.padId);
      return { ...board, pads: board.pads.filter((pad) => pad.id !== edit.padId) };
    case 'set-pad-volume':
      return withPad(board, edit.padId, (pad) => ({ ...pad, volume: edit.volume }));
    case 'set-level':
      return { ...board, volume: edit.volume };
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_TEXT_PAYLOAD;
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A Soundboard edit from untrusted data (a window message), keeping only its fields. */
export function parseSoundboardEdit(value: unknown): SoundboardEdit | undefined {
  if (!isRecord(value)) return undefined;
  const { padId, mediaId, label, toIndex } = value;
  const volume = parseVolume(value.volume);
  switch (value.kind) {
    case 'add-pad':
      return isId(mediaId) ? { kind: 'add-pad', mediaId } : undefined;
    case 'rename-pad':
      return isId(padId) && typeof label === 'string' && label.length <= MAX_TEXT_PAYLOAD
        ? { kind: 'rename-pad', padId, label }
        : undefined;
    case 'move-pad':
      return isId(padId) && isIndex(toIndex) ? { kind: 'move-pad', padId, toIndex } : undefined;
    case 'remove-pad':
      return isId(padId) ? { kind: 'remove-pad', padId } : undefined;
    case 'set-pad-volume':
      return isId(padId) && volume !== undefined
        ? { kind: 'set-pad-volume', padId, volume }
        : undefined;
    case 'set-level':
      return volume === undefined ? undefined : { kind: 'set-level', volume };
    default:
      return undefined;
  }
}

// Storage ------------------------------------------------------------------

type StoredSoundboard = Omit<Soundboard, 'campaignId'>;

function parsePad(value: unknown): SoundboardPad | undefined {
  if (!isRecord(value)) return undefined;
  const { id, mediaId, label } = value;
  const volume = parseVolume(value.volume);
  if (!isId(id) || !isId(mediaId) || volume === undefined) return undefined;
  if (label !== undefined && (typeof label !== 'string' || label === '')) return undefined;
  return { id, mediaId, volume, ...(label !== undefined && { label }) };
}

const soundboardDocument: DocumentType<StoredSoundboard> = {
  name: 'soundboard',
  version: 1,
  migrations: {},
  parse({ pads, volume }) {
    const level = parseVolume(volume);
    if (!Array.isArray(pads) || level === undefined) return undefined;
    const parsed = pads.map(parsePad);
    if (parsed.some((pad) => pad === undefined)) return undefined;
    return { pads: parsed as SoundboardPad[], volume: level };
  },
};

const SOUNDBOARD_FILE = 'soundboard.json';

export interface SoundboardStore {
  /** The Campaign's Soundboard: an empty one at full level until edited. */
  get(campaignId: CampaignId): Promise<Soundboard>;
  /**
   * Applies one edit and saves it; returns the Soundboard as saved. A pad added must be a
   * Sound effect of the Campaign's library (MediaError otherwise).
   */
  edit(campaignId: CampaignId, edit: SoundboardEdit): Promise<Soundboard>;
  /** Removes every pad of a Media (it was deleted from the library). */
  removeMedia(campaignId: CampaignId, mediaId: MediaId): Promise<void>;
  /**
   * Each pad's name and level (padGain at `masterVolume`), for the pad sounds still sounding
   * (core/padVoices.ts `retune`): as saved, or with `unsaved` applied but not saved (a level
   * slider being dragged). Pads whose Media is gone are left out.
   */
  tuning(
    campaignId: CampaignId,
    masterVolume: number,
    unsaved?: SoundboardEdit,
  ): Promise<Map<string, { name: string; gain: number }>>;
  /**
   * What pressing a pad plays, at `masterVolume`. Throws when the pad or its Media is gone, or
   * (a SoundboardError saying so) when its file is missing: deleted or moved outside the app.
   */
  press(campaignId: CampaignId, padId: string, masterVolume: number): Promise<PadPress>;
  /**
   * The Media addresses of the Sound effects on the Campaign's pads, each once, in pad order:
   * what the audio engine keeps decoded (spec #33: preloaded on Campaign open). A pad whose
   * Media left the library is left out.
   */
  sounds(campaignId: CampaignId): Promise<string[]>;
}

export function createSoundboardStore(deps: {
  storage: Storage;
  library: Pick<MediaLibrary, 'list' | 'resolveAddress'>;
  /** Names new pads; random UUIDs unless a test gives its own. */
  newId?: () => string;
}): SoundboardStore {
  const { storage, library, newId = randomUUID } = deps;
  /** Serializes the read-modify-write of each Campaign's Soundboard document. */
  const serialized = createKeyedSerialQueue<CampaignId>();

  async function fileOf(campaignId: CampaignId): Promise<string> {
    if (!(await storage.campaigns.get(campaignId))) {
      throw new CampaignError('Cette campagne n’existe plus.');
    }
    return path.join(storage.campaignFolder(campaignId), SOUNDBOARD_FILE);
  }

  async function read(file: string, campaignId: CampaignId): Promise<Soundboard> {
    const stored = await storage.documents.read(file, soundboardDocument);
    return { campaignId, pads: [], volume: DEFAULT_LEVEL, ...stored };
  }

  async function write(file: string, { campaignId: _campaignId, ...board }: Soundboard) {
    await storage.documents.write(file, soundboardDocument, board);
  }

  function soundEffectOf(media: readonly Media[], mediaId: MediaId) {
    const item = media.find((candidate) => candidate.id === mediaId);
    if (!item) throw new MediaError('Ce média n’existe plus.');
    if (item.kind !== 'audio' || item.role !== 'soundEffect') {
      throw new MediaError('Seul un bruitage peut aller sur la table de bruitages.');
    }
    return item;
  }

  return {
    async get(campaignId) {
      return read(await fileOf(campaignId), campaignId);
    },

    edit(campaignId, edit) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        if (edit.kind === 'add-pad') soundEffectOf(await library.list(campaignId), edit.mediaId);
        const saved = applySoundboardEdit(await read(file, campaignId), edit, newId);
        await write(file, saved);
        return saved;
      });
    },

    removeMedia(campaignId, mediaId) {
      return serialized(campaignId, async () => {
        const file = await fileOf(campaignId);
        const board = await read(file, campaignId);
        const pads = board.pads.filter((pad) => pad.mediaId !== mediaId);
        if (pads.length !== board.pads.length) await write(file, { ...board, pads });
      });
    },

    async tuning(campaignId, masterVolume, unsaved) {
      const saved = await read(await fileOf(campaignId), campaignId);
      const board = unsaved ? applySoundboardEdit(saved, unsaved, newId) : saved;
      const media = await library.list(campaignId);
      const tuned = new Map<string, { name: string; gain: number }>();
      for (const pad of board.pads) {
        const item = media.find((candidate) => candidate.id === pad.mediaId);
        if (!item) continue;
        tuned.set(pad.id, {
          name: pad.label ?? item.name,
          gain: padGain(masterVolume, board.volume, pad.volume),
        });
      }
      return tuned;
    },

    async press(campaignId, padId, masterVolume) {
      const board = await read(await fileOf(campaignId), campaignId);
      const pad = board.pads.find((item) => item.id === padId);
      if (!pad) throw new SoundboardError('Ce bruitage n’est plus sur la table.');
      const media = soundEffectOf(await library.list(campaignId), pad.mediaId);
      const src = mediaAddress(media);
      // The rule the Media protocol serves by: a file it would answer 404 for.
      if (!(await library.resolveAddress(src, campaignId))) {
        throw new SoundboardError(
          `« ${media.name} » est introuvable (fichier supprimé ou déplacé hors de l’application).`,
        );
      }
      return {
        padId,
        name: pad.label ?? media.name,
        src,
        gain: padGain(masterVolume, board.volume, pad.volume),
      };
    },

    async sounds(campaignId) {
      const board = await read(await fileOf(campaignId), campaignId);
      const media = await library.list(campaignId);
      const sounds = new Set<string>();
      for (const pad of board.pads) {
        const item = media.find((candidate) => candidate.id === pad.mediaId);
        if (item?.kind === 'audio' && item.role === 'soundEffect') sounds.add(mediaAddress(item));
      }
      return [...sounds];
    },
  };
}
