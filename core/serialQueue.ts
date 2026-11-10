/**
 * Serialising queues: tasks run one at a time, in the order they arrive, so read-modify-writes
 * never overlap. A failed task rejects its own promise but never blocks the tasks after it.
 */

/** Runs tasks one at a time per key; tasks with different keys run independently. */
export type KeyedSerialQueue<K> = <T>(key: K, task: () => T | Promise<T>) => Promise<T>;

/** Runs tasks one at a time. */
export type SerialQueue = <T>(task: () => T | Promise<T>) => Promise<T>;

export function createKeyedSerialQueue<K>(): KeyedSerialQueue<K> {
  const tails = new Map<K, Promise<unknown>>();
  return (key, task) => {
    const next = (tails.get(key) ?? Promise.resolve()).then(task, task);
    const settled = next.catch(() => undefined);
    tails.set(key, settled);
    // Forget idle keys, so the map does not grow with every key ever used.
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });
    return next;
  };
}

export function createSerialQueue(): SerialQueue {
  const keyed = createKeyedSerialQueue<null>();
  return (task) => keyed(null, task);
}
