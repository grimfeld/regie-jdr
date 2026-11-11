/**
 * Campaign transfers: the one Export or Import the Control window runs at a time, its Cancel,
 * and its progress, throttled so that a multi-gigabyte Campaign sends a few updates a second,
 * not one message per chunk read. Export and Import themselves (core/campaignExport.ts,
 * core/campaignImport.ts) clean up after a cancel or a failure; this module only drives them.
 */
import type { CampaignTransferProgress } from '../shared/contract.js';
import type { CampaignId } from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { isSameCampaignId } from './storage/index.js';

export type TransferKind = CampaignTransferProgress['kind'];

/** Bytes done out of a total, as Export and Import report them. */
export interface ByteProgress {
  doneBytes: number;
  totalBytes: number;
}

/** How a transfer ended, when it did not fail. */
export type TransferOutcome<T> = { status: 'done'; value: T } | { status: 'cancelled' };

/** At most one progress message per this many milliseconds, besides the first and the last. */
export const PROGRESS_INTERVAL_MS = 100;

/**
 * Wraps `send` so that it gets the first update, then at most one per `intervalMs`, and always
 * the one that completes the total. An update equal to the last one sent is dropped.
 */
export function throttleProgress(
  send: (progress: ByteProgress) => void,
  options: { intervalMs: number; now: () => number },
): (progress: ByteProgress) => void {
  let lastSentAt: number | undefined;
  let lastSent: ByteProgress | undefined;
  return (progress) => {
    const same =
      lastSent?.doneBytes === progress.doneBytes && lastSent.totalBytes === progress.totalBytes;
    if (same) return;
    const time = options.now();
    const complete = progress.doneBytes >= progress.totalBytes;
    if (lastSentAt !== undefined && !complete && time - lastSentAt < options.intervalMs) return;
    lastSentAt = time;
    lastSent = progress;
    send(progress);
  };
}

export interface CampaignTransfers {
  /**
   * Runs `task`, the whole Export or Import (its dialog included), with a signal that Cancel
   * aborts and a throttled progress reporter. Resolves `cancelled` when Cancel stopped it;
   * rethrows any other failure. Throws CampaignError while another transfer runs. `campaignId`
   * names the Campaign an Export reads, which may not be deleted meanwhile (isRunningFor).
   */
  run<T>(
    kind: TransferKind,
    task: (signal: AbortSignal, onProgress: (progress: ByteProgress) => void) => Promise<T>,
    campaignId?: CampaignId,
  ): Promise<TransferOutcome<T>>;
  /** Whether the running transfer reads that Campaign (letter case ignored, isSameCampaignId). */
  isRunningFor(campaignId: CampaignId): boolean;
  /** Cancels the running transfer; false when none runs. */
  cancel(): boolean;
}

export function createCampaignTransfers(options: {
  send: (progress: CampaignTransferProgress) => void;
  intervalMs?: number;
  now?: () => number;
}): CampaignTransfers {
  let running: AbortController | undefined;
  let runningFor: CampaignId | null = null;
  return {
    async run(kind, task, campaignId) {
      if (running) {
        throw new CampaignError(
          'Un export ou un import de campagne est déjà en cours : attendez sa fin ou annulez-le.',
        );
      }
      const controller = new AbortController();
      running = controller;
      runningFor = campaignId ?? null;
      const report = throttleProgress((progress) => options.send({ kind, ...progress }), {
        intervalMs: options.intervalMs ?? PROGRESS_INTERVAL_MS,
        now: options.now ?? Date.now,
      });
      try {
        return { status: 'done', value: await task(controller.signal, report) };
      } catch (error) {
        if (controller.signal.aborted) return { status: 'cancelled' };
        throw error;
      } finally {
        running = undefined;
        runningFor = null;
      }
    },
    isRunningFor: (id) => isSameCampaignId(runningFor, id),
    cancel() {
      if (!running) return false;
      running.abort();
      return true;
    },
  };
}
