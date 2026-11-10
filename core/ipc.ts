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
import type { InvokeChannel, InvokeChannels, Payload } from '../shared/contract.js';

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

/** For a payload `{ [key]: non-empty string }`, e.g. `{ campaignId }`. */
function idOf<K extends string>(key: K) {
  return (value: unknown): Parsed<Record<K, string>> => {
    if (!isRecord(value)) return INVALID;
    const id = value[key];
    if (typeof id !== 'string' || id === '') return INVALID;
    return { [key]: id } as Record<K, string>;
  };
}

// Rules --------------------------------------------------------------------

const rules: { [C in InvokeChannel]: Rule<C> } = {
  'onAir:get': { from: anyWindow, parse: noPayload },
  'onAir:open-campaign': { from: controlOnly, parse: onePayload(idOf('campaignId')) },
  'onAir:close-campaign': { from: controlOnly, parse: noPayload },
  'onAir:activate-scene': { from: controlOnly, parse: onePayload(idOf('sceneId')) },
  'broadcast:open': { from: controlOnly, parse: noPayload },
  'media:import-images': { from: controlOnly, parse: noPayload },
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
