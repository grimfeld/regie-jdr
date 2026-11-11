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
  SoundboardEdit,
  SoundboardLevel,
  TransientEdit,
} from '../shared/contract.js';
import path from 'node:path';
import type {
  AudioEngineReport,
  CampaignId,
  ImageCategory,
  MediaId,
  MusicPlayback,
  PadReport,
  SceneId,
  ThemeId,
} from '../shared/domain.js';
import { isAudioRole, isImageCategory } from './media.js';
import { MAX_PASTED_IMAGE_BYTES } from './mediaAddress.js';
import { parseSceneEdit, parseTransientEdit } from './sceneEdits.js';
import { isThemeId } from './storage/campaigns.js';
import { isCampaignId } from './storage/index.js';
import { parseFadeDuration } from './fades.js';
import { parseAudioEngineReport } from './audioMix.js';
import { parsePadReport } from './padVoices.js';
import { parseSoundboardEdit } from './soundboard.js';
import { parseVolume } from './settings.js';
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

function campaignIdOf(value: unknown): Parsed<{ id: CampaignId }> {
  if (!isRecord(value) || !isCampaignId(value.id)) return INVALID;
  return { id: value.id };
}

function themeOf(value: unknown): Parsed<{ theme: ThemeId }> {
  if (!isRecord(value) || !isThemeId(value.theme)) return INVALID;
  return { theme: value.theme };
}

function fadeDurationOf(value: unknown): Parsed<{ fadeDurationMs: number }> {
  const fadeDurationMs = isRecord(value) ? parseFadeDuration(value.fadeDurationMs) : undefined;
  return fadeDurationMs === undefined ? INVALID : { fadeDurationMs };
}

function masterVolumeOf(value: unknown): Parsed<{ masterVolume: number }> {
  const masterVolume = isRecord(value) ? parseVolume(value.masterVolume) : undefined;
  return masterVolume === undefined ? INVALID : { masterVolume };
}

function engineReport(value: unknown): Parsed<AudioEngineReport> {
  return parseAudioEngineReport(value) ?? INVALID;
}

function musicPick(value: unknown): Parsed<{ mediaId: MediaId }> {
  if (!isRecord(value)) return INVALID;
  const { mediaId } = value;
  return typeof mediaId === 'string' && mediaId !== '' ? { mediaId } : INVALID;
}

const MUSIC_PLAYBACKS: readonly MusicPlayback[] = ['playing', 'paused', 'stopped'];

function musicPlayback(value: unknown): Parsed<{ playback: MusicPlayback }> {
  if (!isRecord(value)) return INVALID;
  const playback = MUSIC_PLAYBACKS.find((known) => known === value.playback);
  return playback === undefined ? INVALID : { playback };
}

function campaignOf(value: unknown): Parsed<{ campaignId: CampaignId }> {
  if (!isRecord(value) || !isCampaignId(value.campaignId)) return INVALID;
  return { campaignId: value.campaignId };
}

function padReport(value: unknown): Parsed<PadReport> {
  return parsePadReport(value) ?? INVALID;
}

function soundboardEdit(value: unknown): Parsed<{ campaignId: CampaignId; edit: SoundboardEdit }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const edit = parseSoundboardEdit(value.edit);
  return edit ? { ...campaign, edit } : INVALID;
}

function soundboardLevel(
  value: unknown,
): Parsed<{ campaignId: CampaignId; edit: SoundboardLevel }> {
  const parsed = soundboardEdit(value);
  if (parsed === INVALID) return INVALID;
  const { campaignId, edit } = parsed;
  return edit.kind === 'set-level' || edit.kind === 'set-pad-volume'
    ? { campaignId, edit }
    : INVALID;
}

function padPress(value: unknown): Parsed<{ campaignId: CampaignId; padId: string }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { padId } = value;
  if (typeof padId !== 'string' || padId === '' || padId.length > MAX_NAME_PAYLOAD) return INVALID;
  return { ...campaign, padId };
}

function importKindOf(value: Record<string, unknown>): Parsed<MediaImportKind> {
  if (value.accept === 'image') {
    const { category } = value;
    if (category === undefined) return { accept: 'image' };
    return isImageCategory(category) ? { accept: 'image', category } : INVALID;
  }
  if (value.accept === 'audio' && isAudioRole(value.role)) {
    return { accept: 'audio', role: value.role };
  }
  return INVALID;
}

function mediaImport(value: unknown): Parsed<{ campaignId: CampaignId } & MediaImportKind> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const kind = importKindOf(value);
  return kind === INVALID ? INVALID : { ...campaign, ...kind };
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

function droppedImport(
  value: unknown,
): Parsed<{ campaignId: CampaignId; files: string[] } & MediaImportKind> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const kind = importKindOf(value);
  if (kind === INVALID) return INVALID;
  const { files } = value;
  if (!Array.isArray(files) || files.length > MAX_DROPPED_FILES) return INVALID;
  if (!files.every(isDroppedPath)) return INVALID;
  return { ...campaign, files: [...files], ...kind };
}

/** A dropped Export to Import: one file, with the same path checks as dropped Media. */
function droppedExport(value: unknown): Parsed<{ file: string }> {
  if (!isRecord(value) || !isDroppedPath(value.file)) return INVALID;
  return { file: value.file };
}

/**
 * Pasted image content: bytes (not a list or text), at most MAX_PASTED_IMAGE_BYTES, with a name.
 * Whether the bytes are an image is the import's check (core/media.ts).
 */
function pastedImport(
  value: unknown,
): Parsed<{ campaignId: CampaignId; data: Uint8Array; name: string }> {
  const campaign = campaignOf(value);
  if (campaign === INVALID || !isRecord(value)) return INVALID;
  const { data, name } = value;
  if (!(data instanceof Uint8Array) || !isName(name)) return INVALID;
  if (data.byteLength === 0 || data.byteLength > MAX_PASTED_IMAGE_BYTES) return INVALID;
  return { ...campaign, data, name };
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

/** A flag turning an on-air state on or off: Blackout, Silence. */
function onOffOf(value: unknown): Parsed<{ on: boolean }> {
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

function sceneMove(
  value: unknown,
): Parsed<{ campaignId: CampaignId; sceneId: SceneId; toIndex: number }> {
  const scene = sceneOf(value);
  if (scene === INVALID || !isRecord(value)) return INVALID;
  const { toIndex } = value;
  if (typeof toIndex !== 'number' || !Number.isSafeInteger(toIndex) || toIndex < 0) return INVALID;
  return { ...scene, toIndex };
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

function transientEdit(
  value: unknown,
): Parsed<{ campaignId: CampaignId; sceneId: SceneId; edit: TransientEdit }> {
  const scene = sceneOf(value);
  if (scene === INVALID || !isRecord(value)) return INVALID;
  const edit = parseTransientEdit(value.edit);
  return edit ? { ...scene, edit } : INVALID;
}

// Rules --------------------------------------------------------------------

const rules: { [C in InvokeChannel]: Rule<C> } = {
  'onAir:get': { from: anyWindow, parse: noPayload },
  'onAir:open-campaign': { from: controlOnly, parse: onePayload(idOf('campaignId')) },
  'onAir:close-campaign': { from: controlOnly, parse: noPayload },
  'onAir:activate-scene': { from: controlOnly, parse: onePayload(idOf('sceneId')) },
  'onAir:set-blackout': { from: controlOnly, parse: onePayload(onOffOf) },
  'scenes:list': { from: controlOnly, parse: onePayload(campaignOf) },
  'scenes:create': { from: controlOnly, parse: onePayload(newScene) },
  'scenes:edit': { from: controlOnly, parse: onePayload(sceneEdit) },
  'scenes:show-transient': { from: controlOnly, parse: onePayload(transientEdit) },
  'scenes:undo-state': { from: controlOnly, parse: onePayload(sceneOf) },
  'scenes:undo': { from: controlOnly, parse: onePayload(sceneOf) },
  'scenes:redo': { from: controlOnly, parse: onePayload(sceneOf) },
  'scenes:delete': { from: controlOnly, parse: onePayload(sceneOf) },
  'scenes:move': { from: controlOnly, parse: onePayload(sceneMove) },
  'scenes:duplicate': { from: controlOnly, parse: onePayload(sceneOf) },
  'broadcast:open': { from: controlOnly, parse: noPayload },
  'broadcast:toggle-fullscreen': { from: controlOnly, parse: noPayload },
  'media:list': { from: controlOnly, parse: onePayload(campaignOf) },
  'media:import': { from: controlOnly, parse: onePayload(mediaImport) },
  'media:import-dropped': { from: controlOnly, parse: onePayload(droppedImport) },
  'media:import-pasted': { from: controlOnly, parse: onePayload(pastedImport) },
  'media:set-category': { from: controlOnly, parse: onePayload(categoryChange) },
  'media:rename': { from: controlOnly, parse: onePayload(mediaRename) },
  'media:delete': { from: controlOnly, parse: onePayload(mediaDelete) },
  'campaigns:list': { from: controlOnly, parse: noPayload },
  'campaigns:create': { from: controlOnly, parse: onePayload(newCampaign) },
  'campaigns:update': { from: controlOnly, parse: onePayload(campaignUpdate) },
  'campaigns:deletion-summary': { from: controlOnly, parse: onePayload(campaignIdOf) },
  'campaigns:move-to-trash': { from: controlOnly, parse: onePayload(campaignIdOf) },
  'campaigns:delete-permanently': { from: controlOnly, parse: onePayload(campaignIdOf) },
  'campaigns:export': { from: controlOnly, parse: onePayload(campaignIdOf) },
  'campaigns:import': { from: controlOnly, parse: noPayload },
  'campaigns:import-dropped': { from: controlOnly, parse: onePayload(droppedExport) },
  'notices:take': { from: controlOnly, parse: noPayload },
  'settings:get': { from: controlOnly, parse: noPayload },
  'settings:set-theme': { from: controlOnly, parse: onePayload(themeOf) },
  'settings:set-fade-duration': { from: controlOnly, parse: onePayload(fadeDurationOf) },
  'settings:set-master-volume': { from: controlOnly, parse: onePayload(masterVolumeOf) },
  // The audio engine runs in the Control window (ADR-0002): the Broadcast window gets no audio.
  'audio:get-mix': { from: controlOnly, parse: noPayload },
  'audio:report': { from: controlOnly, parse: onePayload(engineReport) },
  'audio:get-sounding': { from: controlOnly, parse: noPayload },
  'audio:set-silence': { from: controlOnly, parse: onePayload(onOffOf) },
  'audio:toggle-silence': { from: controlOnly, parse: noPayload },
  'audio:report-pads': { from: controlOnly, parse: onePayload(padReport) },
  'soundboard:get': { from: controlOnly, parse: onePayload(campaignOf) },
  'soundboard:edit': { from: controlOnly, parse: onePayload(soundboardEdit) },
  'soundboard:press': { from: controlOnly, parse: onePayload(padPress) },
  'soundboard:show-transient': { from: controlOnly, parse: onePayload(soundboardLevel) },
  'audio:pick-music': { from: controlOnly, parse: onePayload(musicPick) },
  'audio:set-music-playback': { from: controlOnly, parse: onePayload(musicPlayback) },
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
