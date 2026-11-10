/**
 * Sends the transient updates of a live drag: at most one per animation frame, and never a new
 * one while the last is still on its way, so a slow main process is not flooded. Only the
 * latest update counts: one that a newer update replaces before it is sent is never sent.
 */
export interface TransientSender<T> {
  /** Queues `update`, replacing any update not sent yet. */
  push: (update: T) => void;
  /** Forgets the update not sent yet: called when the drag is committed or cancelled. */
  drop: () => void;
}

export function createTransientSender<T>(
  send: (update: T) => Promise<void>,
  requestFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
): TransientSender<T> {
  let pending: { update: T } | undefined;
  let frameRequested = false;
  let inFlight = false;

  function schedule() {
    if (frameRequested || inFlight || !pending) return;
    frameRequested = true;
    requestFrame(flush);
  }

  function flush() {
    frameRequested = false;
    if (inFlight || !pending) return;
    const { update } = pending;
    pending = undefined;
    inFlight = true;
    send(update)
      .catch((error: unknown) => {
        // The drag's committed edit reports failures; a lost transient update only skips a frame.
        console.warn('A transient update of a live drag failed', error);
      })
      .finally(() => {
        inFlight = false;
        schedule();
      });
  }

  return {
    push(update) {
      pending = { update };
      schedule();
    },
    drop() {
      pending = undefined;
    },
  };
}
