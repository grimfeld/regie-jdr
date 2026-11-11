import { describe, expect, it } from 'vitest';
import { createTransientSender } from '../../src/transientUpdates';

/** A sender whose frames and sends the test runs by hand. */
function setup() {
  const frames: (() => void)[] = [];
  const sent: number[] = [];
  const replies: (() => void)[] = [];
  const sender = createTransientSender<number>(
    (update) => {
      sent.push(update);
      return new Promise<void>((resolve) => replies.push(resolve));
    },
    (callback) => frames.push(callback),
  );
  const nextFrame = () => frames.splice(0).forEach((callback) => callback());
  const reply = async () => {
    replies.splice(0).forEach((resolve) => resolve());
    // Let the reply's promise callbacks run.
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  return { sender, sent, nextFrame, reply, frames };
}

describe('transient updates of a live drag', () => {
  it('sends at most one per animation frame, the latest', () => {
    const { sender, sent, nextFrame } = setup();
    sender.push(1);
    sender.push(2);
    sender.push(3);
    expect(sent).toEqual([]);
    nextFrame();
    expect(sent).toEqual([3]);
  });

  it('waits for the update on its way before sending the next', async () => {
    const { sender, sent, nextFrame, reply, frames } = setup();
    sender.push(1);
    nextFrame();
    sender.push(2);
    sender.push(3);
    nextFrame();
    expect(sent).toEqual([1]);
    expect(frames).toHaveLength(0);

    await reply();
    nextFrame();
    expect(sent).toEqual([1, 3]);
  });

  it('never sends an update dropped before its frame', async () => {
    const { sender, sent, nextFrame, reply } = setup();
    sender.push(1);
    sender.drop();
    nextFrame();
    expect(sent).toEqual([]);

    sender.push(2);
    nextFrame();
    sender.push(3);
    sender.drop();
    await reply();
    nextFrame();
    expect(sent).toEqual([2]);
  });
});
