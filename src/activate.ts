import type { ActivateOptions, ControlBridge } from '../shared/contract';
import type { SceneId } from '../shared/domain';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';

/**
 * How a press Activates: Shift held forces a Cut, this once (the Scene's own Transition stays
 * as it is). Takes the click on Activate or, later, an Activate shortcut's key press (#56).
 */
export function activateOptionsOf(press: { shiftKey: boolean }): ActivateOptions {
  return { forceCut: press.shiftKey };
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
