import { ipcMain, type WebContents } from 'electron';
import { checkInvoke, invokeChannels, type WindowRole } from '../core/ipc.js';
import type { Logger } from '../core/logger.js';
import type {
  EventChannel,
  EventChannels,
  InvokeChannel,
  IpcFailureCode,
  Payload,
  Result,
} from '../shared/contract.js';

/** One handler per channel of the contract; the payload has already been validated. */
export type Handlers = {
  [C in InvokeChannel]: (payload: Payload<C>) => Result<C> | Promise<Result<C>>;
};

/**
 * Start of the error message a failed call carries back to the window, by failure code.
 * The preloads read it to hand the caller an IpcFailure (shared/contract.ts); keep in sync
 * with `failureOf` in electron/preload-*.ts.
 */
const failurePrefix: Record<IpcFailureCode, string> = {
  rejected: 'IPC message rejected',
  failed: 'IPC call failed',
};

/**
 * Registers every channel of the contract on ipcMain. Each message goes through the sender
 * policy and payload guards of core/ipc.ts first; rejects are logged as warnings and the
 * caller's promise fails with an error mentioning "rejected". A handler that throws is logged
 * with its stack, which stays in the main process: the caller gets the error's message only.
 * Each handler call that runs is handed to `track` (settled, never failing), so the app can
 * finish it before quitting: a window's last message, sent as it closes, still gets saved.
 */
export function registerHandlers(
  handlers: Handlers,
  roleOf: (sender: WebContents) => WindowRole | undefined,
  log: Pick<Logger, 'warn' | 'error'>,
  track: (call: Promise<unknown>) => void = () => undefined,
): void {
  for (const channel of invokeChannels) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const verdict = checkInvoke(channel, roleOf(event.sender), args);
      if (!verdict.ok) {
        const message = `${failurePrefix.rejected}: ${verdict.reason}`;
        log.warn(message);
        throw new Error(message);
      }
      const handler = handlers[channel] as (payload: unknown) => unknown;
      const call = Promise.resolve().then(() => handler(verdict.payload));
      track(call.catch(() => undefined));
      try {
        return await call;
      } catch (error) {
        const message = `${failurePrefix.failed}: "${channel}"`;
        log.error(message, error);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}: ${reason}`, { cause: error });
      }
    });
  }
}

/** Sends an event of the contract to a window, if it is still open. */
export function sendEvent<E extends EventChannel>(
  contents: WebContents | undefined,
  channel: E,
  payload: EventChannels[E],
): void {
  if (contents && !contents.isDestroyed()) contents.send(channel, payload);
}
