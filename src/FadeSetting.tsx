import { useState } from 'react';
import { Timer } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import { FADE_DURATION_MS, parseFadeDuration } from '../core/fades';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';
import { useOnAir } from './useOnAir';

/** Milliseconds as the seconds the field shows. */
const toSeconds = (milliseconds: number) => String(milliseconds / 1000);

/**
 * The fade duration setting, for the whole app: how long showing, hiding and changing a
 * placement, a Label or the Scene title takes, and Blackout. Shown from the on-air state, which
 * carries it to every renderer. Each valid value typed is saved at once.
 */
export function FadeSetting({ control }: { control: ControlBridge | undefined }) {
  const onAir = useOnAir(control);
  const saved = onAir?.fadeDurationMs ?? FADE_DURATION_MS.default;
  // What is being typed, until the field is left.
  const [typed, setTyped] = useState<string | null>(null);

  async function type(text: string) {
    setTyped(text);
    const fadeDurationMs = Math.round(Number(text.replace(',', '.')) * 1000);
    if (!control || text.trim() === '' || parseFadeDuration(fadeDurationMs) === undefined) return;
    try {
      await control.setFadeDuration(fadeDurationMs);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  return (
    <div className="panel fade-setting">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">RÉGLAGES</span>
          <h2>
            <Timer size={18} /> Fondus
          </h2>
        </div>
      </div>
      <label className="fade-setting-field">
        <span>Durée des fondus</span>
        <input
          type="number"
          min={FADE_DURATION_MS.min / 1000}
          max={FADE_DURATION_MS.max / 1000}
          step={0.1}
          value={typed ?? toSeconds(saved)}
          onChange={(event) => void type(event.currentTarget.value)}
          onBlur={() => setTyped(null)}
        />
        <span aria-hidden="true">secondes</span>
      </label>
      <p className="theme-footnote">
        Apparitions, disparitions, étiquettes, titre et noir, à l’antenne comme dans l’éditeur.
      </p>
    </div>
  );
}
