/**
 * A Campaign's running order: the one ordered list of its Scenes, in the order the Game Master
 * plays them. It is the order of the Scenes in the Campaign's `scenes.json` (new Scenes go last),
 * so Campaigns made before Milestone 3 start with their creation order unchanged.
 *
 * Reordering is a Campaign-level command, not a Scene edit: it changes no Scene, so it stays out
 * of each Scene's undo history and cannot break it.
 *
 * Pure and free of Node: the Control window runs it to show a reorder at once.
 */
import type { SceneDirection } from '../shared/contract.js';
import type { SceneId } from '../shared/domain.js';

/**
 * `scenes` with the Scene `sceneId` moved to `toIndex` (past the end means last): a Scene dropped
 * on another takes its place. Unchanged for an unknown Scene. Returns a new list of the same
 * Scenes.
 */
export function moveInRunningOrder<T extends { id: SceneId }>(
  scenes: readonly T[],
  sceneId: SceneId,
  toIndex: number,
): T[] {
  const from = scenes.findIndex((scene) => scene.id === sceneId);
  if (from < 0) return [...scenes];
  const moved = scenes.filter((_scene, index) => index !== from);
  moved.splice(Math.min(Math.max(toIndex, 0), moved.length), 0, scenes[from]);
  return moved;
}

/**
 * The Scene after (`next`) or before (`previous`) `from` in the running order `order`, or
 * undefined past either end (no wrap). With no Scene to start from (`null`, or one no longer in
 * the order), the first Scene either way.
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
