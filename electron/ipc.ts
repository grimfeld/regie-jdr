import { ipcMain, type WebContents } from 'electron';
import { checkInvoke, invokeChannels, type WindowRole } from '../core/ipc.js';
import type {
  EventChannel,
  EventChannels,
  InvokeChannel,
  Payload,
  Result,
} from '../shared/contract.js';

/** One handler per channel of the contract; the payload has already been validated. */
export type Handlers = {
  [C in InvokeChannel]: (payload: Payload<C>) => Result<C> | Promise<Result<C>>;
};

/**
 * Registers every channel of the contract on ipcMain. Each message goes through the sender
 * policy and payload guards of core/ipc.ts first; rejects are logged and the caller's promise
 * fails with an error mentioning "rejected".
 */
export function registerHandlers(
  handlers: Handlers,
  roleOf: (sender: WebContents) => WindowRole | undefined,
  logRejection: (message: string) => void,
): void {
  for (const channel of invokeChannels) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const verdict = checkInvoke(channel, roleOf(event.sender), args);
      if (!verdict.ok) {
        const message = `IPC message rejected: ${verdict.reason}`;
        logRejection(message);
        throw new Error(message);
      }
      const handler = handlers[channel] as (payload: unknown) => unknown;
      return handler(verdict.payload);
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
