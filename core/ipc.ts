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
  BroadcastDisplay,
  CampaignChanges,
  InvokeChannel,
  InvokeChannels,
  Payload,
} from '../shared/contract.js';
import type { CampaignId } from '../shared/domain.js';
import { isThemeId } from './storage/campaigns.js';
import { isCampaignId } from './storage/index.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** For channels that take no argument. */
function noPayload(args: readonly unknown[]): Parsed<void> {
  return args.length === 0 ? undefined : INVALID;
}

/** For channels that take exactly one argument. */
function onePayload<T>(guard: (value: unknown) => Parsed<T>) {
  return (args: readonly unknown[]): Parsed<T> => (args.length === 1 ? guard(args[0]) : INVALID);
}

function broadcastDisplay(value: unknown): Parsed<BroadcastDisplay> {
  if (!isRecord(value)) return INVALID;
  const { title, background, description } = value;
  if (typeof title !== 'string' || typeof background !== 'string') return INVALID;
  if (typeof description !== 'string') return INVALID;
  return { title, background, description };
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

// Rules --------------------------------------------------------------------

const rules: { [C in InvokeChannel]: Rule<C> } = {
  'display:get': { from: anyWindow, parse: noPayload },
  'display:set': { from: controlOnly, parse: onePayload(broadcastDisplay) },
  'broadcast:open': { from: controlOnly, parse: noPayload },
  'media:import-images': { from: controlOnly, parse: noPayload },
  'campaigns:list': { from: controlOnly, parse: noPayload },
  'campaigns:create': { from: controlOnly, parse: onePayload(newCampaign) },
  'campaigns:update': { from: controlOnly, parse: onePayload(campaignUpdate) },
  'notices:take': { from: controlOnly, parse: noPayload },
};

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return Object.prototype.hasOwnProperty.call(rules, channel);
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
