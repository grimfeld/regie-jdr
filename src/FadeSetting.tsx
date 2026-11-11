import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import type { Settings } from '../shared/domain';
import {
  ACTIVATE_DURATION_MS,
  FADE_DURATION_MS,
  millisecondsOfSecondsText,
  MUSIC_CROSSFADE_MS,
  parseActivateDuration,
  parseFadeDuration,
  parseMusicCrossfade,
  secondsTextOf,
} from '../core/fades';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';
import { useOnAir } from './useOnAir';

/**
 * The fade settings, for the whole app, each kept across restarts:
 * - the fade duration: how long showing, hiding and changing a placement, a Label or the Scene
 *   title takes, and Blackout. Shown from the on-air state, which carries it to every renderer;
 * - the Activate duration: how long Activating a Scene with a Crossfade takes, picture and
 *   audio together;
 * - the Music crossfade duration: how long picking another track crossfades.
 * The last two never go on air (a Transition carries its own duration), so they are read from
 * the Settings. Each valid value typed is saved at once.
 */
export function FadeSetting({ control }: { control: ControlBridge | undefined }) {
  const onAir = useOnAir(control);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((read) => {
        if (!cancelled) setSettings((current) => current ?? read);
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [control]);

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
      <DurationField
        label="Durée des fondus"
        bounds={FADE_DURATION_MS}
        saved={onAir?.fadeDurationMs}
        parse={parseFadeDuration}
        save={control && ((durationMs) => control.setFadeDuration(durationMs))}
      />
      <DurationField
        label="Durée d’activation"
        bounds={ACTIVATE_DURATION_MS}
        saved={settings?.activateDurationMs}
        parse={parseActivateDuration}
        save={
          control && ((durationMs) => control.setActivateDuration(durationMs).then(setSettings))
        }
      />
      <DurationField
        label="Fondu entre musiques"
        bounds={MUSIC_CROSSFADE_MS}
        saved={settings?.musicCrossfadeMs}
        parse={parseMusicCrossfade}
        save={control && ((durationMs) => control.setMusicCrossfade(durationMs).then(setSettings))}
      />
      <p className="theme-footnote">
        Fondus : apparitions, disparitions, étiquettes, titre et noir, à l’antenne comme dans
        l’éditeur. Activation : fondu enchaîné de l’image et du son en changeant de scène (un Cut
        reste instantané). Fondu entre musiques : en choisissant une autre piste.
      </p>
    </div>
  );
}

/**
 * One duration setting, typed in seconds with a decimal comma or dot: each valid value typed is
 * saved at once; the field shows the saved value (its default until known) once left. A text
 * field, not a number one: a number field refuses the comma a French Game Master types.
 */
function DurationField(props: {
  label: string;
  bounds: { readonly default: number; readonly min: number; readonly max: number };
  saved: number | undefined;
  parse: (value: unknown) => number | undefined;
  save: ((durationMs: number) => Promise<unknown>) | undefined;
}) {
  const { label, bounds, saved, parse, save } = props;
  // What is being typed, until the field is left.
  const [typed, setTyped] = useState<string | null>(null);

  async function type(text: string) {
    setTyped(text);
    const durationMs = millisecondsOfSecondsText(text);
    if (!save || durationMs === undefined || parse(durationMs) === undefined) return;
    try {
      await save(durationMs);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  return (
    <label className="fade-setting-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        title={`De ${secondsTextOf(bounds.min)} à ${secondsTextOf(bounds.max)} secondes`}
        value={typed ?? secondsTextOf(saved ?? bounds.default)}
        onChange={(event) => void type(event.currentTarget.value)}
        onBlur={() => setTyped(null)}
      />
      <span aria-hidden="true">secondes</span>
    </label>
  );
}
