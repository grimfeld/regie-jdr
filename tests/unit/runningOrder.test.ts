import { describe, expect, it } from 'vitest';
import {
  applyRunningOrderEdit,
  inRunningOrder,
  MAX_CHAPTER_NAME_LENGTH,
  moveInRunningOrder,
  parseRunningOrderEdit,
  runningOrderOf,
  sceneNextTo,
  sceneStep,
  withCopy,
  withNewScene,
  type ScenesInOrder,
} from '../../core/runningOrder';
import { SceneError } from '../../core/sceneEdits';
import type { RunningOrderEdit } from '../../shared/contract';
import type { Chapter } from '../../shared/domain';

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

describe('Chapters in the running order', () => {
  const chapter = (id: string, sceneIds: string[], collapsed = false): Chapter => ({
    id,
    name: id.toUpperCase(),
    collapsed,
    sceneIds,
  });
  /** Chapters "un" (a, b) and "deux" (c), then d and e in no Chapter. */
  const order = (collapsed = false): ScenesInOrder<{ id: string }> =>
    inRunningOrder(
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
      [chapter('un', ['a', 'b'], collapsed), chapter('deux', ['c'])],
    );
  const newId = () => 'neuf';
  const apply = (edit: RunningOrderEdit, from = order()) =>
    applyRunningOrderEdit(from, edit, newId);
  const groups = (result: ScenesInOrder<{ id: string }>) => ({
    order: ids(result.scenes),
    chapters: Object.fromEntries(result.chapters.map((item) => [item.id, item.sceneIds])),
  });

  it('puts the Scenes of each Chapter first, Chapter by Chapter, then the Scenes in none', () => {
    const result = inRunningOrder(
      ['d', 'c', 'b', 'a'].map((id) => ({ id })),
      [chapter('un', ['b', 'a', 'gone']), chapter('deux', ['a', 'c'])],
    );

    expect(groups(result)).toEqual({
      order: ['b', 'a', 'c', 'd'],
      chapters: { un: ['b', 'a'], deux: ['c'] },
    });
  });

  it('creates an empty, expanded Chapter after the others, its name trimmed', () => {
    const result = apply({ kind: 'create-chapter', name: '  Épilogue ' });

    expect(result.chapters.at(-1)).toEqual({
      id: 'neuf',
      name: 'Épilogue',
      collapsed: false,
      sceneIds: [],
    });
    expect(ids(result.scenes)).toEqual(ids(order().scenes));
  });

  it('refuses an empty or too long Chapter name', () => {
    expect(() => apply({ kind: 'create-chapter', name: ' ' })).toThrow(SceneError);
    const long = 'x'.repeat(MAX_CHAPTER_NAME_LENGTH + 1);
    expect(() => apply({ kind: 'rename-chapter', chapterId: 'un', name: long })).toThrow(
      SceneError,
    );
  });

  it('renames a Chapter and collapses or expands it', () => {
    const renamed = apply({ kind: 'rename-chapter', chapterId: 'deux', name: 'Acte' });
    const collapsed = apply({ kind: 'set-chapter-collapsed', chapterId: 'un', collapsed: true });

    expect(renamed.chapters[1]).toMatchObject({ id: 'deux', name: 'Acte' });
    expect(collapsed.chapters[0]).toMatchObject({ id: 'un', collapsed: true });
  });

  it('reorders Chapters, their Scenes with them', () => {
    const moved = apply({ kind: 'move-chapter', chapterId: 'deux', toIndex: 0 });

    expect(groups(moved).order).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('deletes a Chapter, its Scenes in their order becoming the first in no Chapter', () => {
    expect(groups(apply({ kind: 'delete-chapter', chapterId: 'un' }))).toEqual({
      order: ['c', 'a', 'b', 'd', 'e'],
      chapters: { deux: ['c'] },
    });
  });

  it('refuses a Chapter or Scene that does not exist', () => {
    expect(() => apply({ kind: 'delete-chapter', chapterId: 'zz' })).toThrow(SceneError);
    expect(() => apply({ kind: 'move-scene', sceneId: 'a', chapterId: 'zz', toIndex: 0 })).toThrow(
      SceneError,
    );
    expect(() => apply({ kind: 'move-scene', sceneId: 'zz', chapterId: null, toIndex: 0 })).toThrow(
      SceneError,
    );
  });

  it('moves a Scene into a Chapter, at a place or last', () => {
    expect(
      groups(apply({ kind: 'move-scene', sceneId: 'e', chapterId: 'un', toIndex: 1 })),
    ).toEqual({ order: ['a', 'e', 'b', 'c', 'd'], chapters: { un: ['a', 'e', 'b'], deux: ['c'] } });
    expect(
      groups(apply({ kind: 'move-scene', sceneId: 'a', chapterId: 'deux', toIndex: 9 })),
    ).toEqual({ order: ['b', 'c', 'a', 'd', 'e'], chapters: { un: ['b'], deux: ['c', 'a'] } });
  });

  it('moves a Scene out of its Chapter, into a place among the Scenes in none', () => {
    expect(
      groups(apply({ kind: 'move-scene', sceneId: 'b', chapterId: null, toIndex: 1 })),
    ).toEqual({ order: ['a', 'c', 'd', 'b', 'e'], chapters: { un: ['a'], deux: ['c'] } });
  });

  it('moves a Scene within its group like a drop on another Scene: it takes that place', () => {
    const down = apply({ kind: 'move-scene', sceneId: 'a', chapterId: 'un', toIndex: 1 });
    const up = apply({ kind: 'move-scene', sceneId: 'e', chapterId: null, toIndex: 0 });

    expect(ids(down.scenes)).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(ids(up.scenes)).toEqual(['a', 'b', 'c', 'e', 'd']);
  });

  it('puts a new Scene last in the Chapter of the Selected Scene, or last in none', () => {
    expect(groups(withNewScene(order(), { id: 'f' }, 'a'))).toEqual({
      order: ['a', 'b', 'f', 'c', 'd', 'e'],
      chapters: { un: ['a', 'b', 'f'], deux: ['c'] },
    });
    const last = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(ids(withNewScene(order(), { id: 'f' }, 'd').scenes)).toEqual(last);
    expect(ids(withNewScene(order(), { id: 'f' }).scenes)).toEqual(last);
    expect(ids(withNewScene(order(), { id: 'f' }, 'gone').scenes)).toEqual(last);
  });

  it('puts a copy right after its source, in the same Chapter', () => {
    expect(groups(withCopy(order(), { id: 'a2' }, 'a'))).toEqual({
      order: ['a', 'a2', 'b', 'c', 'd', 'e'],
      chapters: { un: ['a', 'a2', 'b'], deux: ['c'] },
    });
    expect(ids(withCopy(order(), { id: 'd2' }, 'd').scenes)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'd2',
      'e',
    ]);
  });

  it('lets next and previous walk every Scene, through a collapsed Chapter too', () => {
    const { sceneIds } = runningOrderOf(order(true));

    expect(sceneNextTo(sceneIds, 'a', 'next')).toBe('b');
    expect(sceneNextTo(sceneIds, 'b', 'next')).toBe('c');
    expect(sceneNextTo(sceneIds, 'c', 'previous')).toBe('b');
    expect(sceneNextTo(sceneIds, 'c', 'next')).toBe('d');
  });

  describe('Alt+Up and Alt+Down', () => {
    it('swap a Scene with its neighbour in its group', () => {
      expect(sceneStep(order(), 'a', 'down')).toEqual({ chapterId: 'un', toIndex: 1 });
      expect(sceneStep(order(), 'e', 'up')).toEqual({ chapterId: null, toIndex: 0 });
    });

    it('cross into the near end of the next group shown', () => {
      expect(sceneStep(order(), 'b', 'down')).toEqual({ chapterId: 'deux', toIndex: 0 });
      expect(sceneStep(order(), 'c', 'up')).toEqual({ chapterId: 'un', toIndex: 2 });
      expect(sceneStep(order(), 'c', 'down')).toEqual({ chapterId: null, toIndex: 0 });
      expect(sceneStep(order(), 'd', 'up')).toEqual({ chapterId: 'deux', toIndex: 1 });
    });

    it('step over a collapsed Chapter', () => {
      expect(sceneStep(order(true), 'c', 'up')).toBeUndefined();
      const lastCollapsed = inRunningOrder(order().scenes, [
        chapter('un', ['a', 'b']),
        chapter('deux', ['c'], true),
      ]);
      expect(sceneStep(lastCollapsed, 'b', 'down')).toEqual({ chapterId: null, toIndex: 0 });
      expect(sceneStep(lastCollapsed, 'd', 'up')).toEqual({ chapterId: 'un', toIndex: 2 });
    });

    it('go no further than either end', () => {
      expect(sceneStep(order(), 'a', 'up')).toBeUndefined();
      expect(sceneStep(order(), 'e', 'down')).toBeUndefined();
      expect(sceneStep(order(), 'gone', 'down')).toBeUndefined();
    });
  });

  describe('a running order command from a window', () => {
    it('keeps only its fields', () => {
      const move = { kind: 'move-scene', sceneId: 'a', chapterId: null, toIndex: 0 };
      expect(parseRunningOrderEdit({ ...move, extra: 1 })).toEqual(move);
      const collapse = { kind: 'set-chapter-collapsed', chapterId: 'un', collapsed: true };
      expect(parseRunningOrderEdit(collapse)).toEqual(collapse);
    });

    it('is refused when malformed', () => {
      for (const edit of [
        null,
        { kind: 'nope' },
        { kind: 'create-chapter' },
        { kind: 'rename-chapter', chapterId: '', name: 'x' },
        { kind: 'move-chapter', chapterId: 'un', toIndex: -1 },
        { kind: 'delete-chapter' },
        { kind: 'set-chapter-collapsed', chapterId: 'un', collapsed: 'yes' },
        { kind: 'move-scene', sceneId: 'a', toIndex: 0 },
        { kind: 'move-scene', sceneId: 'a', chapterId: null, toIndex: 0.5 },
      ]) {
        expect(parseRunningOrderEdit(edit)).toBeUndefined();
      }
    });
  });
});
