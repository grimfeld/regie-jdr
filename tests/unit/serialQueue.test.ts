import { describe, expect, it } from 'vitest';
import { createKeyedSerialQueue, createSerialQueue } from '../../core/serialQueue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('serial queue', () => {
  it('runs tasks one at a time, in arrival order, even when an earlier one fails', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, fail = false) => async () => {
      log.push(`start ${name}`);
      await tick();
      log.push(`end ${name}`);
      if (fail) throw new Error(name);
      return name;
    };

    const results = await Promise.allSettled([
      queue(task('a')),
      queue(task('b', true)),
      queue(task('c')),
    ]);

    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('runs tasks of different keys side by side', async () => {
    const queue = createKeyedSerialQueue<string>();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`start ${name}`);
      await tick();
      log.push(`end ${name}`);
    };

    await Promise.all([queue('x', task('x1')), queue('y', task('y1')), queue('x', task('x2'))]);

    expect(log.slice(0, 2)).toEqual(['start x1', 'start y1']);
    expect(log.indexOf('start x2')).toBeGreaterThan(log.indexOf('end x1'));
  });
});
