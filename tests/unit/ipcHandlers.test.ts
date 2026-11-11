import fsp from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { CampaignError } from '../../core/campaigns';
import { ImportError } from '../../core/campaignImport';
import { useTempDir } from './tempDir';

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
      handlersWith(() => Promise.reject(new CampaignError('disque plein'))),
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

/** A message that names a system error code or a stack frame: never for the Game Master. */
const TECHNICAL =
  /\bE[A-Z]+:|\n\s+at |Maximum call stack|\.[cm]?[jt]s:\d+|operation not permitted/i;

describe('what a window is told when a call fails', () => {
  const dir = useTempDir();
  beforeEach(() => listeners.clear());

  /** The error message the window's call fails with, when `campaigns:list` throws `thrown`. */
  async function toldWindow(thrown: () => Promise<unknown>): Promise<string> {
    const logged = { warn: vi.fn(), error: vi.fn() };
    registerHandlers(
      handlersWith(thrown),
      (sender) => (sender === (control as WebContents) ? 'control' : undefined),
      logged,
    );
    const listen = listeners.get('campaigns:list');
    if (!listen) throw new Error('campaigns:list is not registered');
    const failure: unknown = await listen({ sender: control }).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(failure instanceof Error)) throw new Error('the call did not fail');
    // The technical detail is kept for the developer.
    expect(logged.error).toHaveBeenCalledOnce();
    return failure.message;
  }

  /** A real file system error: renaming a file that does not exist, over a folder. */
  async function fileSystemError(): Promise<Error> {
    await fsp.mkdir(path.join(dir.path, 'folder'), { recursive: true });
    const error: unknown = await fsp
      .rename(path.join(dir.path, 'missing'), path.join(dir.path, 'folder'))
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    if (!(error instanceof Error)) throw new Error('the rename did not fail');
    return error;
  }

  function overflow(depth: number): number {
    return depth > 1e9 ? depth : overflow(depth + 1) + 1;
  }

  it('is never a system error code, a stack frame or an engine message', async () => {
    const fsError = await fileSystemError();
    const thrown: (() => Promise<unknown>)[] = [
      () => Promise.reject(fsError),
      () =>
        Promise.reject(
          Object.assign(new Error("EPERM: operation not permitted, rename 'C:\\a' -> 'C:\\b'"), {
            code: 'EPERM',
            syscall: 'rename',
          }),
        ),
      () => Promise.reject(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })),
      () => Promise.resolve(overflow(0)),
      () => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'id')")),
      () => Promise.reject(new Error('Invalid Campaign id: "x"')),
      () => Promise.reject(new DOMException('This operation was aborted', 'AbortError')),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error is what is tested
      () => Promise.reject('ENOENT: no such file'),
    ];
    for (const thrower of thrown) {
      const message = await toldWindow(thrower);
      expect(message).not.toMatch(TECHNICAL);
      expect(message).toMatch(/IPC call failed: "campaigns:list": \S/);
    }
  });

  it('words file system refusals in French', async () => {
    const message = await toldWindow(() =>
      Promise.reject(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })),
    );
    expect(message).toContain('Windows a refusé l’accès à un fichier');
  });

  it('keeps the French message of the app core’s own errors', async () => {
    expect(await toldWindow(() => Promise.reject(new CampaignError('Donnez un nom.')))).toBe(
      'IPC call failed: "campaigns:list": Donnez un nom.',
    );
    const unreadable = new ImportError('Ce fichier n’a pas pu être lu.', {
      cause: Object.assign(new Error('EPERM: x'), { code: 'EPERM' }),
    });
    expect(await toldWindow(() => Promise.reject(unreadable))).toBe(
      'IPC call failed: "campaigns:list": Ce fichier n’a pas pu être lu.',
    );
  });
});
