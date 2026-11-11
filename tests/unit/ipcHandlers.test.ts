import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

type Listener = (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>;
const listeners = new Map<string, Listener>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Listener) => listeners.set(channel, listener),
  },
}));

const { registerHandlers } = await import('../../electron/ipc');
type Handlers = Parameters<typeof registerHandlers>[0];

const control = {};
const log = { warn: vi.fn(), error: vi.fn() };

/** Handlers for every channel: `campaigns:list` runs `listCampaigns`, the others fail. */
function handlersWith(listCampaigns: () => Promise<unknown>): Handlers {
  return new Proxy({} as Handlers, {
    get: (_target, channel) =>
      channel === 'campaigns:list' ? listCampaigns : () => Promise.reject(new Error('unused')),
  });
}

describe('registering the window handlers', () => {
  beforeEach(() => listeners.clear());

  it('hands each call that runs to the tracker, which settles once the call is done', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const tracked: Promise<unknown>[] = [];
    registerHandlers(
      handlersWith(() => new Promise((resolve) => (finish = resolve))),
      (sender) => (sender === (control as WebContents) ? 'control' : undefined),
      log,
      (call) => tracked.push(call),
    );
    const listen = listeners.get('campaigns:list');
    if (!listen) throw new Error('campaigns:list is not registered');

    const answer = listen({ sender: control });
    await Promise.resolve();
    expect(tracked).toHaveLength(1);
    let settled = false;
    void tracked[0]?.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    finish([]);
    await expect(answer).resolves.toEqual([]);
    await tracked[0];
    expect(settled).toBe(true);
  });

  it('tracks a failing call without failing, and tracks no refused message', async () => {
    const tracked: Promise<unknown>[] = [];
    registerHandlers(
      handlersWith(() => Promise.reject(new Error('disque plein'))),
      (sender) => (sender === (control as WebContents) ? 'control' : undefined),
      log,
      (call) => tracked.push(call),
    );
    const listen = listeners.get('campaigns:list');
    if (!listen) throw new Error('campaigns:list is not registered');

    await expect(listen({ sender: {} })).rejects.toThrow('rejected');
    expect(tracked).toHaveLength(0);

    await expect(listen({ sender: control })).rejects.toThrow('disque plein');
    expect(tracked).toHaveLength(1);
    await expect(tracked[0]).resolves.toBeUndefined();
  });
});
