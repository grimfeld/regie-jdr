/**
 * Saves of changes a window shows at once, before the main process answers (a running order
 * move). Their answers are not shown: an older answer arriving after a quicker key press would
 * put the list back a step. When a save fails, the window reads the saved state again and shows
 * it, but only once every save sent has settled and none was sent during that read, so the list
 * ends as it is saved, never on a state a newer change has already passed.
 */
export interface OptimisticSaves {
  /** Runs `save`, a change already shown; settles once any recovery it caused is done. */
  run: (save: () => Promise<unknown>) => Promise<void>;
}

export function createOptimisticSaves<T>(options: {
  /** Reads the state as saved. */
  reread: () => Promise<T>;
  /** Shows the state as saved, in place of the changes shown. */
  show: (saved: T) => void;
  /** Reports a failure: the first failed save of a burst, or a failed read. */
  onFailure: (error: unknown) => void;
}): OptimisticSaves {
  const { reread, show, onFailure } = options;
  /** Saves sent and not yet settled. */
  let pending = 0;
  /** Saves sent so far: a read is stale if one was sent while it ran. */
  let sent = 0;
  /** Whether a save failed since the saved state was last shown. */
  let failed = false;
  /** Whether that failure was reported (once per burst). */
  let reported = false;
  let reading = false;

  /** Whether no save was sent, failed or is on its way since `mark` saves had been sent. */
  function unchangedSince(mark: number) {
    return pending === 0 && !failed && sent === mark;
  }

  async function recover() {
    if (reading) return; // The read on its way checks again when it ends.
    while (pending === 0 && failed) {
      failed = false;
      reading = true;
      const sentBefore = sent;
      let saved: T;
      try {
        saved = await reread();
      } catch (error) {
        reported = false;
        onFailure(error);
        return;
      } finally {
        reading = false;
      }
      if (unchangedSince(sentBefore)) {
        reported = false;
        show(saved);
        return;
      }
      // A newer change went out during the read: read again once it has settled.
      failed = true;
    }
  }

  return {
    async run(save) {
      pending++;
      sent++;
      try {
        await save();
      } catch (error) {
        failed = true;
        if (!reported) {
          reported = true;
          onFailure(error);
        }
      } finally {
        pending--;
      }
      await recover();
    },
  };
}
