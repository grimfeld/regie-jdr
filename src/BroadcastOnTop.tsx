import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';

/**
 * "Toujours au premier plan": keeps the Broadcast window above other windows, so a
 * single-monitor Game Master never covers what Discord streams (ADR-0002). Saved in Settings
 * and applied by the main process to the open Broadcast window and to every one opened later.
 * It lives in the Control window: the Broadcast window has no controls.
 */
export function BroadcastOnTopToggle({ control }: { control: ControlBridge | undefined }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setOn(settings.broadcastAlwaysOnTop);
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control]);

  async function toggle() {
    if (!control) return;
    try {
      setOn((await control.setBroadcastAlwaysOnTop(!on)).broadcastAlwaysOnTop);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  return (
    <button
      className={on ? 'primary-button' : 'secondary-button'}
      aria-pressed={on}
      onClick={() => void toggle()}
      title="Garder la diffusion devant les autres fenêtres : couverte par une autre application, Discord la diffuse en noir et sans son"
    >
      <Pin size={14} /> Toujours au premier plan
    </button>
  );
}
