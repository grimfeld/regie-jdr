import { Moon, Radio } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import { errorMessage } from './CampaignList';
import { keyLabelOf, useShortcuts } from './keyboard';
import { SceneCanvas } from './SceneCanvas';
import { showNotice } from './notices';
import { useOnAir } from './useOnAir';

/**
 * The On-air monitor: a small read-only view of exactly what the Broadcast window shows (the
 * same snapshot, drawn by the same renderer), whichever Scene is Selected. Its badges explain
 * a black screen to the Game Master and exist only here, never in the Broadcast window. Below
 * it, the Blackout button.
 */
export function OnAirMonitor({ control }: { control: ControlBridge | undefined }) {
  const onAir = useOnAir(control);
  const blackout = onAir?.blackout ?? false;
  const badge = blackout ? 'NOIR' : !onAir?.activeSceneId ? 'Rien à l’antenne' : null;

  const blackoutKey = keyLabelOf('blackout');
  useShortcuts({ blackout: () => void toggleBlackout() });

  async function toggleBlackout() {
    if (!control) return;
    try {
      await control.setBlackout(!blackout);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  return (
    <section className="panel on-air-monitor" aria-label="À l’antenne">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CE QUE VOIENT LES JOUEURS</span>
          <h2>
            <Radio size={18} /> À l’antenne
          </h2>
        </div>
      </div>
      <div
        className="on-air-screen"
        data-active-scene-id={onAir ? (onAir.activeSceneId ?? '') : undefined}
        data-version={onAir?.version}
      >
        <SceneCanvas
          picture={onAir?.scene ?? null}
          blackout={blackout}
          window="control"
          fadeDurationMs={onAir?.fadeDurationMs}
          transition={onAir?.transition}
        />
        {badge && <span className="on-air-badge">{badge}</span>}
      </div>
      <button
        className={blackout ? 'primary-button' : 'secondary-button'}
        aria-pressed={blackout}
        title={`Fondre la diffusion au noir, ou revenir à la scène active (touche ${blackoutKey})`}
        aria-keyshortcuts={blackoutKey}
        onClick={() => void toggleBlackout()}
      >
        <Moon size={14} /> Noir {blackoutKey && <kbd aria-hidden>{blackoutKey}</kbd>}
      </button>
    </section>
  );
}
