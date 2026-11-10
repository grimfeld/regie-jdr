import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { OverlayTransform } from '../shared/contract';
import type { Scene } from '../shared/domain';
import { nudgedPosition, resizedOverlay, type OverlayBox } from '../core/sceneEdits';
import { createTransientSender, type TransientSender } from './transientUpdates';

/** A burst of arrow-key nudges ends (and is saved as one edit) after this quiet time. */
const NUDGE_BURST_END_MS = 500;

/** Which part of an Overlay a pointer was pressed on: its body moves it, its handle resizes it. */
export type OverlayPart = 'move' | 'resize';

/** An Overlay being moved or resized, as shown until its edit is saved. */
interface Gesture {
  placementId: string;
  /** Whether the height changed too: only then is it sent. */
  resized: boolean;
  box: OverlayBox;
}

function editOf({ placementId, resized, box }: Gesture): OverlayTransform {
  const kind = 'transform-overlay';
  return resized
    ? { kind, placementId, position: box.position, height: box.height }
    : { kind, placementId, position: box.position };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

interface Options {
  scene: Scene;
  /** Whether the Scene is the Active Scene: only then do transient updates go out. */
  active: boolean;
  /** Saves an edit (one undo step). Never rejects: a failure is shown and the Scene reloaded. */
  onCommit: (edit: OverlayTransform) => Promise<void>;
  /** Shows a transient update on air, unsaved. */
  onTransient: (edit: OverlayTransform) => Promise<void>;
}

/**
 * Moving, resizing and nudging Overlays in the editor. The Overlay follows the pointer (or the
 * arrow keys) locally; on the Active Scene each change also goes on air as a transient update,
 * at most one per animation frame, unsaved. One committed edit saves the result: on release of
 * a drag, or once a burst of arrow-key nudges has been quiet for half a second (or the canvas
 * loses focus). So a whole drag, resize or nudge burst is one Scene edit, hence one undo step.
 */
export function useOverlayTransforms({ scene, active, onCommit, onTransient }: Options) {
  const [selectedId, setSelectedId] = useState<string>();
  const [gesture, setGesture] = useState<Gesture>();
  const current = useRef<Gesture | undefined>(undefined);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest props, for the window listeners and timers of a gesture under way.
  const latest = useRef({ active, onCommit, onTransient });
  const senderRef = useRef<TransientSender<OverlayTransform> | undefined>(undefined);

  /** The sender of transient updates, created on first use (in an event, not in render). */
  function sender() {
    senderRef.current ??= createTransientSender((edit) => latest.current.onTransient(edit));
    return senderRef.current;
  }

  function show(next: Gesture | undefined) {
    current.current = next;
    setGesture(next);
  }

  function update(next: Gesture) {
    show(next);
    if (latest.current.active) sender().push(editOf(next));
  }

  /** Saves the gesture shown, as one edit; it stays shown until the saved Scene replaces it. */
  function commit() {
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = undefined;
    const done = current.current;
    if (!done) return;
    sender().drop();
    const settle = () => {
      if (current.current === done) show(undefined);
    };
    latest.current.onCommit(editOf(done)).then(settle, settle);
  }

  const commitOnClose = useRef(commit);
  useEffect(() => {
    latest.current = { active, onCommit, onTransient };
    commitOnClose.current = commit;
  });
  // A nudge burst still waiting is saved when the editor closes.
  useEffect(() => () => commitOnClose.current(), []);

  function boxOf(placementId: string): OverlayBox | undefined {
    if (current.current?.placementId === placementId) return current.current.box;
    const overlay = scene.overlays.find((item) => item.id === placementId);
    return overlay && { position: overlay.position, height: overlay.height };
  }

  function onOverlayPointerDown(
    placementId: string,
    event: PointerEvent<HTMLElement>,
    part: OverlayPart,
  ) {
    if (event.button !== 0) return;
    const element = event.currentTarget.closest<HTMLElement>('.canvas-overlay');
    const stage = element?.parentElement;
    const start = boxOf(placementId);
    if (!element || !stage || !start) return;
    event.preventDefault();
    event.stopPropagation();
    if (nudgeTimer.current !== undefined) commit();
    setSelectedId(placementId);
    element.closest<HTMLElement>('[tabindex]')?.focus();

    const canvas = stage.getBoundingClientRect();
    const drawn = element.getBoundingClientRect();
    const aspect = drawn.height > 0 ? drawn.width / drawn.height : 1;
    const from = { x: event.clientX, y: event.clientY };
    let moved = false;

    const onMove = (move: globalThis.PointerEvent) => {
      if (canvas.width <= 0 || canvas.height <= 0) return;
      moved = true;
      if (part === 'move') {
        const position = {
          x: clampUnit(start.position.x + (move.clientX - from.x) / canvas.width),
          y: clampUnit(start.position.y + (move.clientY - from.y) / canvas.height),
        };
        update({ placementId, resized: false, box: { ...start, position } });
      } else {
        const corner = {
          x: (move.clientX - canvas.left) / canvas.width,
          y: (move.clientY - canvas.top) / canvas.height,
        };
        const box = resizedOverlay(start, aspect, corner);
        update({ placementId, resized: true, box });
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = () => {
      stop();
      if (moved) commit();
    };
    const onCancel = () => {
      stop();
      if (!moved) return;
      // Put it back where it was, on air too.
      sender().drop();
      update({ placementId, resized: true, box: start });
      show(undefined);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  /** Arrow keys nudge the selected Overlay (Shift: further); Escape deselects it. */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (selectedId === undefined) return;
    if (event.key === 'Escape') {
      commit();
      setSelectedId(undefined);
      return;
    }
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown'
    ) {
      return;
    }
    const box = boxOf(selectedId);
    if (!box) return;
    event.preventDefault();
    const position = nudgedPosition(box.position, event.key, event.shiftKey);
    update({ placementId: selectedId, resized: false, box: { ...box, position } });
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(commit, NUDGE_BURST_END_MS);
  }

  function onBlur(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    if (nudgeTimer.current !== undefined) commit();
  }

  /** A press on the canvas outside every Overlay deselects. */
  function onPointerDown() {
    setSelectedId(undefined);
  }

  const shownScene = gesture
    ? {
        ...scene,
        overlays: scene.overlays.map((item) =>
          item.id === gesture.placementId ? { ...item, ...gesture.box } : item,
        ),
      }
    : scene;

  return {
    /** The Scene as the editor shows it: with the Overlay being moved or resized where it is. */
    scene: shownScene,
    selectedId: scene.overlays.some((item) => item.id === selectedId) ? selectedId : undefined,
    onOverlayPointerDown,
    /** Props of the focusable element around the editor canvas. */
    canvasProps: { tabIndex: 0, onKeyDown, onBlur, onPointerDown },
  };
}
