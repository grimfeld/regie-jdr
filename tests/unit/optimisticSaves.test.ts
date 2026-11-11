import { describe, expect, it } from 'vitest';
import { createOptimisticSaves } from '../../src/optimisticSaves';

/** A save or a read the test answers by hand. */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets every promise callback queued so far run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Optimistic saves of a list whose saved state the test hands out by hand. */
function setup() {
  const reads: ReturnType<typeof deferred<string>>[] = [];
  const shown: string[] = [];
  const failures: unknown[] = [];
  const saves = createOptimisticSaves<string>({
    reread: () => {
      const read = deferred<string>();
      reads.push(read);
      return read.promise;
    },
    show: (saved) => shown.push(saved),
    onFailure: (error) => failures.push(error),
  });
  return { saves, reads, shown, failures };
}

describe('optimistic saves', () => {
  it('shows nothing from a save that succeeds: the change is already shown', async () => {
    const { saves, reads, shown, failures } = setup();
    await saves.run(() => Promise.resolve());
    expect(reads).toHaveLength(0);
    expect(shown).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('reports a failed save once and shows the state saved', async () => {
    const { saves, reads, shown, failures } = setup();
    const running = saves.run(() => Promise.reject(new Error('disk full')));
    await settle();
    expect(failures).toEqual([new Error('disk full')]);
    expect(reads).toHaveLength(1);
    reads[0]?.resolve('saved');
    await running;
    expect(shown).toEqual(['saved']);
  });

  it('waits for every save on its way before reading the saved state again', async () => {
    const { saves, reads, shown, failures } = setup();
    const later = deferred();
    const first = saves.run(() => Promise.reject(new Error('gone')));
    const second = saves.run(() => later.promise);
    await first;
    expect(failures).toHaveLength(1);
    // The second save is still on its way: what is saved will change again.
    expect(reads).toHaveLength(0);
    later.resolve();
    await settle();
    expect(reads).toHaveLength(1);
    reads[0]?.resolve('after both');
    await second;
    expect(shown).toEqual(['after both']);
  });

  it('does not show a state read while a newer change was on its way; reads again after it', async () => {
    const { saves, reads, shown } = setup();
    const failing = saves.run(() => Promise.reject(new Error('gone')));
    await settle();
    expect(reads).toHaveLength(1);
    // A quicker key press, already shown, goes out while the saved state is read.
    const press = deferred();
    const pressing = saves.run(() => press.promise);
    reads[0]?.resolve('before the press');
    await failing;
    expect(shown).toEqual([]);
    press.resolve();
    await settle();
    expect(reads).toHaveLength(2);
    reads[1]?.resolve('with the press');
    await pressing;
    expect(shown).toEqual(['with the press']);
  });

  it('reports a failed read of the saved state too', async () => {
    const { saves, reads, shown, failures } = setup();
    const running = saves.run(() => Promise.reject(new Error('gone')));
    await settle();
    reads[0]?.reject(new Error('unreadable'));
    await running;
    expect(failures).toEqual([new Error('gone'), new Error('unreadable')]);
    expect(shown).toEqual([]);
  });

  it('reports a burst of failed saves once', async () => {
    const { saves, reads, failures } = setup();
    const both = Promise.all([
      saves.run(() => Promise.reject(new Error('one'))),
      saves.run(() => Promise.reject(new Error('two'))),
    ]);
    await settle();
    expect(failures).toEqual([new Error('one')]);
    expect(reads).toHaveLength(1);
    reads[0]?.resolve('saved');
    await both;
  });
});
