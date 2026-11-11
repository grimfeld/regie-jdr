import type { ActivateOptions, ControlBridge, SceneDirection } from '../shared/contract';
import type { SceneId } from '../shared/domain';
import { holds, type CutModifier } from '../core/keyMap';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';

/**
 * How a press Activates: the Cut modifier (Shift unless remapped) held forces a Cut, this once
 * (the Scene's own Transition stays as it is). Takes the click on Activate or an Activate
 * shortcut's key press (#56).
 */
export function activateOptionsOf(
  press: Parameters<typeof holds>[0],
  cutModifier: CutModifier,
): ActivateOptions {
  return { forceCut: holds(press, cutModifier) };
}

/**
 * Activates a Scene, with its own Transition or a forced Cut; a failure is shown as a notice.
 * Every way to Activate calls this: the Activate button and the Activate shortcuts (#56).
 */
export async function activateScene(
  control: ControlBridge,
  sceneId: SceneId,
  options: ActivateOptions = {},
): Promise<void> {
  try {
    await control.activateScene(sceneId, options);
  } catch (error) {
    showNotice(errorMessage(error));
  }
}

/**
 * Activates the Scene after or before the Active Scene in the running order; a failure is shown
 * as a notice. The main process picks the Scene, in turn with the other commands, so two quick
 * presses advance two Scenes even before this window has seen the first one go on air.
 */
export async function activateNextTo(
  control: ControlBridge,
  direction: SceneDirection,
  options: ActivateOptions = {},
): Promise<void> {
  try {
    await control.activateNextTo(direction, options);
  } catch (error) {
    showNotice(errorMessage(error));
  }
}
