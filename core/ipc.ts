/**
 * Message validation for the window contract: which window may call each channel
 * (sender policy) and what its payload must look like (hand-written guards).
 * No Electron dependency; electron/ipc.ts wires this to ipcMain.
 *
 * Adding a channel:
 *  1. shared/contract.ts: add it to InvokeChannels (or EventChannels) with payload and result.
 *  2. Here: add its rule to `rules` (who may call it, how to parse its payload).
 *     The compiler refuses a channel without a rule.
 *  3. electron/main.ts: add its handler to `registerHandlers` (also compiler-enforced).
 *  4. electron/preload-control.ts (and preload-broadcast.ts only if it is a read or a
 *     subscription), plus the bridge interface in shared/contract.ts.
 */
import type {
  CampaignChanges,
  InvokeChannel,
  InvokeChannels,
  MediaImportKind,
  Payload,
  SceneEdit,
} from '../shared/contract.js';
import path from 'node:path';
import type { CampaignId, ImageCategory, MediaId, SceneId, ThemeId } from '../shared/domain.js';
import { isAudioRole, isImageCategory } from './media.js';
import { parseSceneEdit } from './sceneEdits.js';
import { isThemeId } from './storage/campaigns.js';
import { isCampaignId } from './storage/index.js';
import { isRecord } from './guards.js';

/** The windows that can send messages. */
export type WindowRole = 'control' | 'broadcast';

const INVALID = Symbol('invalid');
type Parsed<T> = T | typeof INVALID;

interface Rule<C extends InvokeChannel> {
  /** Windows allowed to call the channel. Mutations: Control window only. */
  from: readonly WindowRole[];
  /** Returns the payload, keeping only contract fields, or INVALID. */
  parse(args: readonly unknown[]): Parsed<Payload<C>>;
}

const controlOnly: readonly WindowRole[] = ['control'];
const anyWindow: readonly WindowRole[] = ['control', 'broadcast'];

// Guards -------------------------------------------------------------------

/** For channels that take no argument. */
function noPayload(args: readonly unknown[]): Parsed<void> {
  return args.length === 0 ? undefined : INVALID;
}

/** For channels that take exactly one argument. */
function onePayload<T>(guard: (value: unknown) => Parsed<T>) {
  return (args: readonly unknown[]): Parsed<T> => (args.length === 1 ? guard(args[0]) : INVALID);
}

/** For a payload `{ [key]: non-empty string }`, e.g. `{ campaignId }`. */
function idOf<K extends string>(key: K) {
  return (value: unknown): Parsed<Record<K, string>> => {
    if (!isRecord(value)) return INVALID;
    const id = value[key];
    if (typeof id !== 'string' || id === '') return INVALID;
    return { [key]: id } as Record<K, string>;
  };
}

/** Names longer than this are malformed messages; core/campaigns.ts has the real limit. */
const MAX_NAME_PAYLOAD = 1000;

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_NAME_PAYLOAD;
}

function newCampaign(value: unknown): Parsed<{ name: string }> {
  if (!isRecord(value) || !isName(value.name)) return INVALID;
  return { name: value.name };
}

function campaignChanges(value: unknown): Parsed<CampaignChanges> {
  if (!isRecord(value)) return INVALID;
  const { name, theme } = value;
  const changes: CampaignChanges = {};
  if (name !== undefined) {
    if (!isName(name)) return INVALID;
    changes.name = name;
  }
  if (theme !== undefined) {
    if (!isThemeId(theme)) return INVALID;
    changes.theme = theme;
  }
  return changes;
}

function campaignUpdate(value: unknown): Parsed<{ id: CampaignId; changes: CampaignChanges }> {
  if (!isRecord(value) || !isCampaignId(value.id)) return INVALID;
  const changes = campaignChanges(value.changes);
  if (changes === INVALID) return INVALID;
  return { id: value.id, changes };
}

function themeOf(value: unknown): Parsed<{ theme: ThemeId }> {
  if (!isRecord(value) || !isThemeId(value.theme)) return INVALID;
  return { theme: value.theme };
}

function campaignOf(value: unknown): Parsed<{ campaignId: CampaignId }> {
  if (!isRecord(value) || !isCampaignId(value.campaignId)) return INVALID;
  return { campaignId: value.campaignId };
}

function mediaImport(value: unknown): Parsed<{ campaignId: CampaignId } & MediaImportKind> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  if (value.accept === 'image') return { ...campaign, accept: 'image' };
  if (value.accept === 'audio' && isAudioRole(value.role)) {
    return { ...campaign, accept: 'audio', role: value.role };
  }
  return INVALID;
}

/** More dropped files than this in one message is a malformed message. */
export const MAX_DROPPED_FILES = 1000;
/** Longest path Windows accepts (with the long-path prefix); longer ones are malformed. */
const MAX_PATH_LENGTH = 32767;

/**
 * A dropped file's path: absolute, on a local drive. Paths on a network share (`\\server\...`)
 * and device paths are refused, so a message can never make the app reach out to another host.
 */
function isDroppedPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0') &&
    !/^[\\/]{2}/.test(value) &&
    path.isAbsolute(value)
  );
}

function droppedImport(value: unknown): Parsed<{ campaignId: CampaignId; files: string[] }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { files } = value;
  if (!Array.isArray(files) || files.length > MAX_DROPPED_FILES) return INVALID;
  if (!files.every(isDroppedPath)) return INVALID;
  return { ...campaign, files: [...files] };
}

function categoryChange(
  value: unknown,
): Parsed<{ campaignId: CampaignId; mediaId: MediaId; category: ImageCategory }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { mediaId, category } = value;
  if (typeof mediaId !== 'string' || mediaId === '' || !isImageCategory(category)) return INVALID;
  return { ...campaign, mediaId, category };
}

function mediaRename(
  value: unknown,
): Parsed<{ campaignId: CampaignId; mediaId: MediaId; name: string }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { mediaId, name } = value;
  if (typeof mediaId !== 'string' || mediaId === '' || !isName(name)) return INVALID;
  return { ...campaign, mediaId, name };
}

function mediaDelete(
  value: unknown,
): Parsed<{ campaignId: CampaignId; mediaId: MediaId; confirmed: boolean }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { mediaId, confirmed } = value;
  if (typeof mediaId !== 'string' || mediaId === '' || typeof confirmed !== 'boolean') {
    return INVALID;
  }
  return { ...campaign, mediaId, confirmed };
}

function blackoutOf(value: unknown): Parsed<{ on: boolean }> {
  if (!isRecord(value) || typeof value.on !== 'boolean') return INVALID;
  return { on: value.on };
}

function newScene(value: unknown): Parsed<{ campaignId: CampaignId; name: string }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value) || !isName(value.name)) return INVALID;
  return { ...campaign, name: value.name };
}

function sceneOf(value: unknown): Parsed<{ campaignId: CampaignId; sceneId: SceneId }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { sceneId } = value;
  if (typeof sceneId !== 'string' || sceneId === '') return INVALID;
  return { ...campaign, sceneId };
}

function sceneEdit(
  value: unknown,
): Parsed<{ campaignId: CampaignId; sceneId: SceneId; edit: SceneEdit }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { sceneId } = value;
  const edit = parseSceneEdit(value.edit);
  if (typeof sceneId !== 'string' || sceneId === '' || !edit) return INVALID;
  return { ...campaign, sceneId, edit };
}

// Rules --------------------------------------------------------------------

const rules: { [C in InvokeChannel]: Rule<C> } = {
  'onAir:get': { from: anyWindow, parse: noPayload },
  'onAir:open-campaign': { from: controlOnly, parse: onePayload(idOf('campaignId')) },
  'onAir:close-campaign': { from: controlOnly, parse: noPayload },
  'onAir:activate-scene': { from: controlOnly, parse: onePayload(idOf('sceneId')) },
  'onAir:set-blackout': { from: controlOnly, parse: onePayload(blackoutOf) },
  'scenes:list': { from: controlOnly, parse: onePayload(campaignOf) },
  'scenes:create': { from: controlOnly, parse: onePayload(newScene) },
  'scenes:edit': { from: controlOnly, parse: onePayload(sceneEdit) },
  'scenes:delete': { from: controlOnly, parse: onePayload(sceneOf) },
  'broadcast:open': { from: controlOnly, parse: noPayload },
  'broadcast:toggle-fullscreen': { from: controlOnly, parse: noPayload },
  'media:list': { from: controlOnly, parse: onePayload(campaignOf) },
  'media:import': { from: controlOnly, parse: onePayload(mediaImport) },
  'media:import-dropped': { from: controlOnly, parse: onePayload(droppedImport) },
  'media:set-category': { from: controlOnly, parse: onePayload(categoryChange) },
  'media:rename': { from: controlOnly, parse: onePayload(mediaRename) },
  'media:delete': { from: controlOnly, parse: onePayload(mediaDelete) },
  'campaigns:list': { from: controlOnly, parse: noPayload },
  'campaigns:create': { from: controlOnly, parse: onePayload(newCampaign) },
  'campaigns:update': { from: controlOnly, parse: onePayload(campaignUpdate) },
  'notices:take': { from: controlOnly, parse: noPayload },
  'settings:get': { from: controlOnly, parse: noPayload },
  'settings:set-theme': { from: controlOnly, parse: onePayload(themeOf) },
};

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return Object.prototype.hasOwnProperty.call(rules, channel);
}

/** The windows allowed to call `channel` (its sender rule). */
export function sendersOf(channel: InvokeChannel): readonly WindowRole[] {
  return rules[channel].from;
}

/** Every channel of the contract, for wiring. */
export const invokeChannels = Object.keys(rules) as InvokeChannel[];

export type Verdict<C extends InvokeChannel = InvokeChannel> =
  { ok: true; payload: InvokeChannels[C]['payload'] } | { ok: false; reason: string };

/**
 * Checks a message: `sender` is the role of the window that sent it (undefined for any
 * other web contents), `args` the arguments it was sent with.
 */
export function checkInvoke<C extends InvokeChannel>(
  channel: C,
  sender: WindowRole | undefined,
  args: readonly unknown[],
): Verdict<C>;
export function checkInvoke(
  channel: string,
  sender: WindowRole | undefined,
  args: readonly unknown[],
): Verdict;
export function checkInvoke(
  channel: string,
  sender: WindowRole | undefined,
  args: readonly unknown[],
): Verdict {
  if (!isInvokeChannel(channel)) return { ok: false, reason: `unknown channel "${channel}"` };
  const rule = rules[channel] as Rule<InvokeChannel>;
  if (sender === undefined) return { ok: false, reason: `"${channel}" from an unknown window` };
  if (!rule.from.includes(sender)) {
    return { ok: false, reason: `"${channel}" is not allowed from the ${sender} window` };
  }
  const payload = rule.parse(args);
  if (payload === INVALID) return { ok: false, reason: `malformed payload for "${channel}"` };
  return { ok: true, payload };
}
