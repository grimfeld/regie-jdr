/**
 * A Campaign's running order: the one ordered list of its Scenes, in the order the Game Master
 * plays them, grouped into Chapters (one level). The Scenes of each Chapter come Chapter by
 * Chapter, then the Scenes in no Chapter. It is the order of the Scenes in the Campaign's
 * `scenes.json`, beside its Chapters, so Campaigns made before Milestone 3 start with their
 * creation order unchanged, and those made before Chapters start with none.
 *
 * Reordering and every Chapter change are Campaign-level commands, not Scene edits: they change
 * no Scene, so they stay out of each Scene's undo history and cannot break it.
 *
 * Pure and free of Node: the Control window runs it to show a change at once.
 */
import type { RunningOrder, RunningOrderEdit, SceneDirection } from '../shared/contract.js';
import type { Chapter, ChapterId, SceneId } from '../shared/domain.js';
import { isRecord } from './guards.js';
import { SceneError } from './sceneEdits.js';

/** The Scenes of a Campaign, in running order, and its Chapters. */
export interface ScenesInOrder<T extends { id: SceneId }> {
  scenes: T[];
  chapters: Chapter[];
}

export const MAX_CHAPTER_NAME_LENGTH = 100;

/** A Chapter name as saved: trimmed; throws a SceneError when empty or too long. */
export function cleanChapterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new SceneError('Donnez un nom au chapitre.');
  if (trimmed.length > MAX_CHAPTER_NAME_LENGTH) {
    throw new SceneError(
      `Le nom du chapitre est trop long (${MAX_CHAPTER_NAME_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

/**
 * `scenes` and `chapters` made consistent: a Chapter keeps only Scenes that exist and that no
 * Chapter before it holds; the Scenes are put in running order (each Chapter's, then the others
 * in their given order).
 */
export function inRunningOrder<T extends { id: SceneId }>(
  scenes: readonly T[],
  chapters: readonly Chapter[],
): ScenesInOrder<T> {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const grouped = new Set<SceneId>();
  const ordered: T[] = [];
  const kept = chapters.map((chapter) => {
    const sceneIds: SceneId[] = [];
    for (const sceneId of chapter.sceneIds) {
      const scene = byId.get(sceneId);
      if (!scene || grouped.has(sceneId)) continue;
      grouped.add(sceneId);
      sceneIds.push(sceneId);
      ordered.push(scene);
    }
    return { ...chapter, sceneIds };
  });
  return {
    scenes: [...ordered, ...scenes.filter((scene) => !grouped.has(scene.id))],
    chapters: kept,
  };
}

/** The running order as the windows get it: Scene ids in order, and the Chapters. */
export function runningOrderOf(order: ScenesInOrder<{ id: SceneId }>): RunningOrder {
  return { sceneIds: order.scenes.map((scene) => scene.id), chapters: order.chapters };
}

/** The Chapter holding the Scene `sceneId`, if any. */
export function chapterOf(
  chapters: readonly Chapter[],
  sceneId: SceneId | undefined,
): Chapter | undefined {
  return sceneId === undefined
    ? undefined
    : chapters.find((chapter) => chapter.sceneIds.includes(sceneId));
}

/** The ids of the Scenes in no Chapter, in running order. */
export function looseOf(order: ScenesInOrder<{ id: SceneId }>): SceneId[] {
  return order.scenes
    .map((scene) => scene.id)
    .filter((sceneId) => !chapterOf(order.chapters, sceneId));
}

/**
 * `scenes` put in the running order `saved` (as the main process saved it), with its Chapters.
 * A Scene `saved` does not list goes last.
 */
export function withRunningOrder<T extends { id: SceneId }>(
  scenes: readonly T[],
  saved: RunningOrder,
): ScenesInOrder<T> {
  const place = new Map(saved.sceneIds.map((id, index) => [id, index]));
  const sorted = [...scenes].sort(
    (a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity),
  );
  return inRunningOrder(sorted, saved.chapters);
}

/**
 * The order with its Scenes put as `chapters` and `loose` (the ids of the Scenes in no Chapter)
 * say. Every Scene of `order` must be in exactly one of them.
 */
function regrouped<T extends { id: SceneId }>(
  order: ScenesInOrder<T>,
  chapters: Chapter[],
  loose: readonly SceneId[],
): ScenesInOrder<T> {
  const sceneIds = [...chapters.flatMap((chapter) => chapter.sceneIds), ...loose];
  return withRunningOrder(order.scenes, { sceneIds, chapters });
}

/**
 * The order with a new Scene added: last in the Chapter of the Selected Scene `selectedSceneId`,
 * or last in no Chapter when it has none.
 */
export function withNewScene<T extends { id: SceneId }>(
  order: ScenesInOrder<T>,
  scene: T,
  selectedSceneId?: SceneId,
): ScenesInOrder<T> {
  const home = chapterOf(order.chapters, selectedSceneId);
  const chapters = order.chapters.map((chapter) =>
    chapter === home ? { ...chapter, sceneIds: [...chapter.sceneIds, scene.id] } : chapter,
  );
  return inRunningOrder([...order.scenes, scene], chapters);
}

/** The order with `copy` right after the Scene `sourceId`, in the same Chapter. */
export function withCopy<T extends { id: SceneId }>(
  order: ScenesInOrder<T>,
  copy: T,
  sourceId: SceneId,
): ScenesInOrder<T> {
  const index = order.scenes.findIndex((scene) => scene.id === sourceId);
  if (index < 0) return withNewScene(order, copy);
  const scenes = [...order.scenes.slice(0, index + 1), copy, ...order.scenes.slice(index + 1)];
  const chapters = order.chapters.map((chapter) => {
    const at = chapter.sceneIds.indexOf(sourceId);
    if (at < 0) return chapter;
    const sceneIds = [...chapter.sceneIds];
    sceneIds.splice(at + 1, 0, copy.id);
    return { ...chapter, sceneIds };
  });
  return inRunningOrder(scenes, chapters);
}

/**
 * `items` with the one `id` moved to `toIndex` (past the end means last): an item dropped on
 * another takes its place. Unchanged for an unknown id. Returns a new list of the same items.
 */
export function moveInRunningOrder<T extends { id: string }>(
  items: readonly T[],
  id: string,
  toIndex: number,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return [...items];
  const moved = items.filter((_item, index) => index !== from);
  moved.splice(Math.min(Math.max(toIndex, 0), moved.length), 0, items[from]);
  return moved;
}

/** `ids` without `id`, then `id` put at `toIndex` (clamped). */
function placed(ids: readonly SceneId[], id: SceneId, toIndex: number): SceneId[] {
  const others = ids.filter((other) => other !== id);
  others.splice(Math.min(Math.max(toIndex, 0), others.length), 0, id);
  return others;
}

function chapterNamed(order: ScenesInOrder<{ id: SceneId }>, chapterId: ChapterId): Chapter {
  const chapter = order.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new SceneError('Ce chapitre n’existe plus.');
  return chapter;
}

/**
 * The order with one running order command applied. `newId` names a new Chapter. Throws a
 * SceneError (French) for an unknown Scene or Chapter or a wrong Chapter name.
 */
export function applyRunningOrderEdit<T extends { id: SceneId }>(
  order: ScenesInOrder<T>,
  edit: RunningOrderEdit,
  newId: () => string,
): ScenesInOrder<T> {
  switch (edit.kind) {
    case 'create-chapter': {
      const chapter: Chapter = {
        id: newId(),
        name: cleanChapterName(edit.name),
        collapsed: false,
        sceneIds: [],
      };
      return { scenes: order.scenes, chapters: [...order.chapters, chapter] };
    }
    case 'rename-chapter': {
      const name = cleanChapterName(edit.name);
      const renamed = chapterNamed(order, edit.chapterId);
      return {
        scenes: order.scenes,
        chapters: order.chapters.map((chapter) =>
          chapter === renamed ? { ...chapter, name } : chapter,
        ),
      };
    }
    case 'set-chapter-collapsed': {
      const { collapsed } = edit;
      const changed = chapterNamed(order, edit.chapterId);
      return {
        scenes: order.scenes,
        chapters: order.chapters.map((chapter) =>
          chapter === changed ? { ...chapter, collapsed } : chapter,
        ),
      };
    }
    case 'move-chapter': {
      chapterNamed(order, edit.chapterId);
      const chapters = moveInRunningOrder(order.chapters, edit.chapterId, edit.toIndex);
      return regrouped(order, chapters, looseOf(order));
    }
    case 'delete-chapter': {
      const deleted = chapterNamed(order, edit.chapterId);
      const chapters = order.chapters.filter((chapter) => chapter !== deleted);
      return regrouped(order, chapters, [...deleted.sceneIds, ...looseOf(order)]);
    }
    case 'move-scene': {
      const { sceneId, chapterId, toIndex } = edit;
      if (!order.scenes.some((scene) => scene.id === sceneId)) {
        throw new SceneError('Cette scène n’existe plus.');
      }
      if (chapterId !== null) chapterNamed(order, chapterId);
      const chapters = order.chapters.map((chapter) => ({
        ...chapter,
        sceneIds:
          chapter.id === chapterId
            ? placed(chapter.sceneIds, sceneId, toIndex)
            : chapter.sceneIds.filter((id) => id !== sceneId),
      }));
      const loose = looseOf(order).filter((id) => id !== sceneId);
      return regrouped(
        order,
        chapters,
        chapterId === null ? placed(loose, sceneId, toIndex) : loose,
      );
    }
  }
}

/** Where a Scene goes: into the Chapter `chapterId` (null: no Chapter), at `toIndex` there. */
export interface ScenePlace {
  chapterId: ChapterId | null;
  toIndex: number;
}

/**
 * Where the running order shortcuts (Alt+Up, Alt+Down) move the Scene `sceneId`: one place up
 * or down among the Scenes the list shows. Within its group it swaps with its neighbour; at the
 * group's edge it goes to the near end of the next group shown (a Chapter, or the Scenes in no
 * Chapter, which come last). A collapsed Chapter is stepped over, so the Scene never disappears
 * into it. Undefined when it can go no further, or for an unknown Scene.
 */
export function sceneStep(
  order: ScenesInOrder<{ id: SceneId }>,
  sceneId: SceneId,
  direction: 'up' | 'down',
): ScenePlace | undefined {
  const groups: { chapterId: ChapterId | null; sceneIds: readonly SceneId[]; shown: boolean }[] = [
    ...order.chapters.map((chapter) => ({
      chapterId: chapter.id,
      sceneIds: chapter.sceneIds,
      shown: !chapter.collapsed,
    })),
    { chapterId: null, sceneIds: looseOf(order), shown: true },
  ];
  const at = groups.findIndex((group) => group.sceneIds.includes(sceneId));
  if (at < 0) return undefined;
  const { chapterId, sceneIds } = groups[at];
  const index = sceneIds.indexOf(sceneId);
  if (direction === 'up' && index > 0) return { chapterId, toIndex: index - 1 };
  if (direction === 'down' && index < sceneIds.length - 1) return { chapterId, toIndex: index + 1 };
  const step = direction === 'up' ? -1 : 1;
  for (let next = at + step; next >= 0 && next < groups.length; next += step) {
    const group = groups[next];
    if (!group.shown) continue;
    return { chapterId: group.chapterId, toIndex: direction === 'up' ? group.sceneIds.length : 0 };
  }
  return undefined;
}

/**
 * The Scene after (`next`) or before (`previous`) `from` in the running order `order` (every
 * Scene, collapsed Chapters included), or undefined past either end (no wrap). With no Scene to
 * start from (`null`, or one no longer in the order), the first Scene either way.
 */
export function sceneNextTo(
  order: readonly SceneId[],
  from: SceneId | null,
  direction: SceneDirection,
): SceneId | undefined {
  const index = from === null ? -1 : order.indexOf(from);
  if (index < 0) return order[0];
  return order[direction === 'next' ? index + 1 : index - 1];
}

// Untrusted data -------------------------------------------------------------

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A Chapter from untrusted data (a stored document), keeping only Chapter fields. */
export function parseChapter(value: unknown): Chapter | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, collapsed, sceneIds } = value;
  if (!isId(id) || typeof name !== 'string' || typeof collapsed !== 'boolean') return undefined;
  if (!Array.isArray(sceneIds) || !sceneIds.every(isId)) return undefined;
  return { id, name, collapsed, sceneIds: [...sceneIds] };
}

/** A running order command from a window, keeping only its fields, or undefined. */
export function parseRunningOrderEdit(value: unknown): RunningOrderEdit | undefined {
  if (!isRecord(value)) return undefined;
  const { chapterId, name, toIndex } = value;
  switch (value.kind) {
    case 'create-chapter':
      return typeof name === 'string' ? { kind: 'create-chapter', name } : undefined;
    case 'rename-chapter':
      return isId(chapterId) && typeof name === 'string'
        ? { kind: 'rename-chapter', chapterId, name }
        : undefined;
    case 'move-chapter':
      return isId(chapterId) && isIndex(toIndex)
        ? { kind: 'move-chapter', chapterId, toIndex }
        : undefined;
    case 'delete-chapter':
      return isId(chapterId) ? { kind: 'delete-chapter', chapterId } : undefined;
    case 'set-chapter-collapsed':
      return isId(chapterId) && typeof value.collapsed === 'boolean'
        ? { kind: 'set-chapter-collapsed', chapterId, collapsed: value.collapsed }
        : undefined;
    case 'move-scene': {
      const { sceneId } = value;
      if (!isId(sceneId) || !isIndex(toIndex)) return undefined;
      if (chapterId !== null && !isId(chapterId)) return undefined;
      return { kind: 'move-scene', sceneId, chapterId, toIndex };
    }
    default:
      return undefined;
  }
}
