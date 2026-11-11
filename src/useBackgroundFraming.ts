import { useEffect, useRef, useState } from 'react';
import type { BackgroundFraming } from '../shared/contract';
import type { Scene } from '../shared/domain';
import { applySceneEdit } from '../core/sceneEdits';
import { createTransientSender, type TransientSender } from './transientUpdates';

interface Options {
  /** Whether the Scene is the Active Scene: only then do transient updates go out. */
  active: boolean;
  /** Saves a framing (one undo step). Never rejects: a failure is shown and the Scene reloaded. */
  onCommit: (edit: BackgroundFraming) => Promise<void>;
  /** Shows a transient update on air, unsaved. */
  onTransient: (edit: BackgroundFraming) => Promise<void>;
}

/** What a Background's framing sliders report (see BackgroundControls). */
export interface FramingGesture {
  /** A slider moved: show the framing it gives, unsaved. */
  onLive: (edit: BackgroundFraming) => void;
  /**
   * A slider was released: save `edit`, or nothing when its value did not change. Settles once
   * saved (or once the failure is shown and the Scene reloaded); never rejects.
   */
  onRelease: (edit: BackgroundFraming | undefined) => Promise<void>;
}

/**
 * `edit` over the framing shown before it: another slider of the same Background keeps the
 * value of one still being saved.
 */
function merged(before: BackgroundFraming | undefined, edit: BackgroundFraming) {
  if (before?.placementId !== edit.placementId) return edit;
  const focus = (before.focus ?? edit.focus) && { ...before.focus, ...edit.focus };
  return { ...before, ...edit, ...(focus && { focus }) };
}

/**
 * Framing a Background with its zoom and focal point sliders, the way useOverlayTransforms
 * moves an Overlay: while a slider moves, the editor shows the framing chosen and, on the Active
 * Scene, each change also goes on air as a transient update, at most one per animation frame,
 * unsaved. Releasing the slider saves one edit (one undo step); the framing stays shown until the
 * saved Scene replaces it.
 */
export function useBackgroundFraming({ active, onCommit, onTransient }: Options) {
  // The framing shown over the saved Scene: the sliders' values not saved yet, merged.
  const [shown, setShown] = useState<BackgroundFraming>();
  const current = useRef<BackgroundFraming | undefined>(undefined);
  const latest = useRef({ active, onCommit, onTransient });
  useEffect(() => {
    latest.current = { active, onCommit, onTransient };
  });
  const senderRef = useRef<TransientSender<BackgroundFraming> | undefined>(undefined);

  /** The sender of transient updates, created on first use (in an event, not in render). */
  function sender() {
    senderRef.current ??= createTransientSender((edit) => latest.current.onTransient(edit));
    return senderRef.current;
  }

  function show(next: BackgroundFraming | undefined) {
    current.current = next;
    setShown(next);
  }

  const gesture: FramingGesture = {
    onLive(edit) {
      const next = merged(current.current, edit);
      show(next);
      if (latest.current.active) sender().push(next);
    },
    onRelease(edit) {
      const done = current.current;
      if (!edit) {
        // Back where it started: the last transient update shows the saved framing again.
        show(undefined);
        return Promise.resolve();
      }
      sender().drop();
      const settle = () => {
        if (current.current === done) show(undefined);
      };
      return latest.current.onCommit(edit).then(settle, settle);
    },
  };

  return {
    /** `scene` as the editor shows it: with the framing being chosen. */
    apply: (scene: Scene): Scene =>
      shown && scene.backgrounds.some((item) => item.id === shown.placementId)
        ? applySceneEdit(scene, shown, () => '')
        : scene,
    gesture,
  };
}
