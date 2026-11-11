import { describe, expect, it } from 'vitest';
import { moveInRunningOrder, sceneNextTo } from '../../core/runningOrder';

const scenes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map((scene) => scene.id);

describe('moving a Scene in the running order', () => {
  it('puts a Scene dragged down in the place of the one it was dropped on', () => {
    expect(ids(moveInRunningOrder(scenes, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('puts a Scene dragged up in the place of the one it was dropped on', () => {
    expect(ids(moveInRunningOrder(scenes, 'd', 1))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('sends a Scene to the end for an index past the end', () => {
    expect(ids(moveInRunningOrder(scenes, 'b', 99))).toEqual(['a', 'c', 'd', 'b']);
  });

  it('leaves the order and the given list unchanged for an unknown Scene', () => {
    const moved = moveInRunningOrder(scenes, 'z', 0);
    expect(ids(moved)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(scenes)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the Scenes themselves, not copies', () => {
    expect(moveInRunningOrder(scenes, 'c', 0)[0]).toBe(scenes[2]);
  });
});

describe('the Scene next to another in the running order', () => {
  const order = ['a', 'b', 'c'];

  it('is the one after or before it', () => {
    expect(sceneNextTo(order, 'b', 'next')).toBe('c');
    expect(sceneNextTo(order, 'b', 'previous')).toBe('a');
  });

  it('is none past either end: the order does not wrap', () => {
    expect(sceneNextTo(order, 'c', 'next')).toBeUndefined();
    expect(sceneNextTo(order, 'a', 'previous')).toBeUndefined();
  });

  it('is the first Scene when there is none to start from, either way', () => {
    expect(sceneNextTo(order, null, 'next')).toBe('a');
    expect(sceneNextTo(order, null, 'previous')).toBe('a');
  });

  it('is the first Scene when the one to start from is not in the order', () => {
    expect(sceneNextTo(order, 'gone', 'next')).toBe('a');
  });

  it('is none in an empty order', () => {
    expect(sceneNextTo([], null, 'next')).toBeUndefined();
  });
});
