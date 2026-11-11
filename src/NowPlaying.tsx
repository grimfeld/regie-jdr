import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Music2, Volume2, Waves, Zap } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import type { AudioSounding, SoundingVoice, VoiceState } from '../shared/domain';
import { MASTER_VOLUME } from '../core/audioMix';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';
import { createTransientSender } from './transientUpdates';

const stateLabels: Record<VoiceState, string> = {
  loading: 'chargement…',
  playing: 'en lecture',
  paused: 'en pause',
  failed: 'illisible',
};

const roleIcons = { music: Music2, ambience: Waves };

function RoleIcon({ role }: { role: SoundingVoice['role'] }) {
  const Icon = roleIcons[role];
  return <Icon size={14} aria-hidden />;
}

/**
 * The "En cours" strip, next to the On-air monitor: what is actually sounding, as the audio
 * engine reports it (a file that failed to load shows as such), and the Master volume.
 * Pads sounding (#39) show after the voices.
 * Later slices add here: play/pause (#36), Ambiences on (#37), Silence (#40).
 */
export function NowPlaying({ control }: { control: ControlBridge | undefined }) {
  const sounding = useSounding(control);
  const voices = sounding?.voices ?? [];
  const pads = sounding?.pads ?? [];
  return (
    <section className="panel now-playing" aria-label="En cours">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CE QU’ENTENDENT LES JOUEURS</span>
          <h2>
            <AudioLines size={18} /> En cours
          </h2>
        </div>
      </div>
      {voices.length === 0 && pads.length === 0 ? (
        <p className="now-playing-empty">Aucun son.</p>
      ) : (
        <ul className="now-playing-list" aria-label="Sons en cours">
          {voices.map((voice) => (
            <li key={voice.mediaId} data-role={voice.role} data-state={voice.state}>
              <RoleIcon role={voice.role} />
              <span className="now-playing-name">{voice.name}</span>
              <small>{stateLabels[voice.state]}</small>
            </li>
          ))}
          {pads.map((pad) => (
            <li key={`pad-${pad.padId}`} data-role="pad" data-state="playing">
              <Zap size={14} aria-hidden />
              <span className="now-playing-name">{pad.name}</span>
              <small>bruitage</small>
            </li>
          ))}
        </ul>
      )}
      <MasterVolume control={control} />
    </section>
  );
}

/** What is sounding, kept up to date; null until first known. */
export function useSounding(control: ControlBridge | undefined): AudioSounding | null {
  const [sounding, setSounding] = useState<AudioSounding | null>(null);
  useEffect(() => {
    if (!control) return;
    // Subscribe first, then read: a reply older than an event already received is ignored.
    let changed = false;
    const unsubscribe = control.onSoundingChanged((next) => {
      changed = true;
      setSounding(next);
    });
    control
      .getSounding()
      .then((current) => {
        if (!changed) setSounding(current);
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
    return unsubscribe;
  }, [control]);
  return sounding;
}

/**
 * The Master volume slider: the level of all app audio, kept across restarts. Each value is
 * sent as the slider moves (at most one per frame, the latest only), and the engine ramps to
 * it, so a drag is heard as it goes.
 */
function MasterVolume({ control }: { control: ControlBridge | undefined }) {
  const [percent, setPercent] = useState<number | null>(null);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setPercent((current) => current ?? Math.round(settings.masterVolume * 100));
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [control]);
  const sender = useMemo(
    () =>
      createTransientSender<number>((masterVolume) =>
        control
          ? control.setMasterVolume(masterVolume).then(
              () => undefined,
              (error: unknown) => showNotice(errorMessage(error)),
            )
          : Promise.resolve(),
      ),
    [control],
  );
  const shown = percent ?? Math.round(MASTER_VOLUME.default * 100);
  return (
    <label className="master-volume">
      <Volume2 size={14} aria-hidden />
      <span>Volume général</span>
      <input
        type="range"
        aria-label="Volume général"
        min={MASTER_VOLUME.min * 100}
        max={MASTER_VOLUME.max * 100}
        step={1}
        value={shown}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setPercent(next);
          sender.push(next / 100);
        }}
      />
      <output>{shown} %</output>
    </label>
  );
}
