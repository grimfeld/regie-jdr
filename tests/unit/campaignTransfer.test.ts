import { describe, expect, it } from 'vitest';
import { CampaignError } from '../../core/campaigns';
import { createCampaignTransfers, throttleProgress } from '../../core/campaignTransfer';
import type { CampaignTransferProgress } from '../../shared/contract';

/** A clock the test moves by hand. */
function manualClock() {
  let time = 0;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe('throttleProgress', () => {
  it('sends the first update, then at most one per interval, and always the last', () => {
    const clock = manualClock();
    const sent: number[] = [];
    const report = throttleProgress(({ doneBytes }) => sent.push(doneBytes), {
      intervalMs: 100,
      now: clock.now,
    });

    report({ doneBytes: 0, totalBytes: 1000 });
    for (let done = 10; done < 1000; done += 10) {
      clock.advance(5);
      report({ doneBytes: done, totalBytes: 1000 });
    }
    report({ doneBytes: 1000, totalBytes: 1000 });

    // ~500 ms of chunks every 5 ms: about 5 updates, not 100.
    expect(sent.length).toBeLessThanOrEqual(7);
    expect(sent[0]).toBe(0);
    expect(sent.at(-1)).toBe(1000);
  });

  it('never sends the same progress twice', () => {
    const clock = manualClock();
    const sent: number[] = [];
    const report = throttleProgress(({ doneBytes }) => sent.push(doneBytes), {
      intervalMs: 100,
      now: clock.now,
    });
    report({ doneBytes: 5, totalBytes: 5 });
    clock.advance(500);
    report({ doneBytes: 5, totalBytes: 5 });
    expect(sent).toEqual([5]);
  });
});

describe('createCampaignTransfers', () => {
  function transfers() {
    const sent: CampaignTransferProgress[] = [];
    const clock = manualClock();
    return {
      sent,
      clock,
      transfers: createCampaignTransfers({
        send: (progress) => sent.push(progress),
        intervalMs: 100,
        now: clock.now,
      }),
    };
  }

  it('runs a transfer and sends its progress, tagged with its kind', async () => {
    const { transfers: t, sent } = transfers();
    const outcome = await t.run('export', (_signal, onProgress) => {
      onProgress({ doneBytes: 0, totalBytes: 10 });
      onProgress({ doneBytes: 10, totalBytes: 10 });
      return Promise.resolve('done');
    });
    expect(outcome).toEqual({ status: 'done', value: 'done' });
    expect(sent).toEqual([
      { kind: 'export', doneBytes: 0, totalBytes: 10 },
      { kind: 'export', doneBytes: 10, totalBytes: 10 },
    ]);
  });

  it('cancels the running transfer through its signal and says it was cancelled', async () => {
    const { transfers: t } = transfers();
    const running = t.run('import', (signal) => {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error));
      });
    });
    expect(t.cancel()).toBe(true);
    await expect(running).resolves.toEqual({ status: 'cancelled' });
  });

  it('passes a failure on, when nothing cancelled it', async () => {
    const { transfers: t } = transfers();
    const failure = new CampaignError('Le fichier est endommagé.');
    await expect(t.run('import', () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it('refuses a second transfer while one runs, and accepts one after', async () => {
    const { transfers: t } = transfers();
    const finishers: (() => void)[] = [];
    const first = t.run('export', () => new Promise<void>((resolve) => finishers.push(resolve)));
    await expect(t.run('import', () => Promise.resolve())).rejects.toThrow(CampaignError);
    finishers.forEach((finish) => finish());
    await first;
    await expect(t.run('import', () => Promise.resolve(1))).resolves.toEqual({
      status: 'done',
      value: 1,
    });
  });

  it('tells which Campaign an Export runs for, until it ends, whatever its letter case', async () => {
    const { transfers: t } = transfers();
    const finishers: (() => void)[] = [];
    const running = t.run(
      'export',
      () => new Promise<void>((resolve) => finishers.push(resolve)),
      'star-wars',
    );
    expect(t.isRunningFor('star-wars')).toBe(true);
    expect(t.isRunningFor('Star-Wars')).toBe(true);
    expect(t.isRunningFor('warhammer')).toBe(false);
    finishers.forEach((finish) => finish());
    await running;
    expect(t.isRunningFor('star-wars')).toBe(false);
  });

  it('has nothing to cancel when no transfer runs', async () => {
    const { transfers: t } = transfers();
    expect(t.cancel()).toBe(false);
    await t.run('export', () => Promise.resolve());
    expect(t.cancel()).toBe(false);
  });

  it('frees the slot after a failure', async () => {
    const { transfers: t } = transfers();
    await expect(t.run('export', () => Promise.reject(new Error('disk')))).rejects.toThrow();
    await expect(t.run('export', () => Promise.resolve(2))).resolves.toEqual({
      status: 'done',
      value: 2,
    });
  });
});
