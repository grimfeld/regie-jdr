import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Headphones,
  Music2,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
  Waves,
  Zap,
} from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import type {
  AudioSounding,
  MusicPlayback as MusicPlaybackState,
  SoundingState,
  SoundingVoice,
} from '../shared/domain';
import { MASTER_VOLUME, newlyUnplayable } from '../core/audioMix';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';
import { keyLabelOf } from './keyboard';
import { createTransientSender } from './transientUpdates';

const stateLabels: Record<SoundingState, string> = {
  loading: 'chargement…',
  playing: 'en lecture',
  paused: 'en pause',
  failed: 'illisible',
  missing: 'média manquant',
};

/** What the Game Master is told when a sound cannot be played; the others play on. */
function unplayableNotice({ name, state }: SoundingVoice): string {
  return state === 'missing'
    ? `« ${name} » est introuvable (fichier supprimé ou déplacé hors de l’application) : il est ignoré, les autres sons continuent.`
    : `« ${name} » n’a pas pu être lu : il est ignoré, les autres sons continuent.`;
}

/**
 * A voice's state as the strip says it: during Silence, a voice that would sound is just
 * silent; a missing or unreadable one still says so.
 */
function stateLabelOf(state: SoundingState, silence: boolean) {
  return silence && state !== 'failed' && state !== 'missing' ? 'silence' : stateLabels[state];
}

const roleIcons = { music: Music2, ambience: Waves };

function RoleIcon({ role }: { role: SoundingVoice['role'] }) {
  const Icon = roleIcons[role];
  return <Icon size={14} aria-hidden />;
}

/**
 * The "En cours" strip, next to the On-air monitor: what is actually sounding, as the audio
 * engine reports it (a file that failed to load shows as such), and the Master volume.
 * Pads sounding (#39) show after the voices, then a library sound being listened to (#43:
 * the players hear it too). The current Music has its pause/resume and
 * stop buttons here (live playback, not saved). The Silence toggle (#40) sits in its heading,
 * always visible: during Silence the voices stay listed, silent, and come back when it lifts;
 * the Music's buttons hide then, as the engine reports every voice paused.
 * Later slices add here: Ambiences on (#37).
 */
export function NowPlaying({
  control,
  listening,
}: {
  control: ControlBridge | undefined;
  /** The name of the library sound being listened to (src/Listening.tsx); null when none. */
  listening: string | null;
}) {
  const sounding = useSounding(control);
  useUnplayableNotices(sounding);
  const voices = sounding?.voices ?? [];
  const pads = sounding?.pads ?? [];
  const silence = sounding?.silence ?? false;
  const silenceKey = keyLabelOf('silence');
  return (
    <section className="panel now-playing" aria-label="En cours" data-silence={silence}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CE QU’ENTENDENT LES JOUEURS</span>
          <h2>
            <AudioLines size={18} /> En cours
          </h2>
        </div>
        <button
          className={silence ? 'primary-button' : 'secondary-button'}
          aria-pressed={silence}
          title={`Couper tout le son en fondu, ou le rétablir tel qu’il était (touche ${silenceKey})`}
          aria-keyshortcuts={silenceKey}
          onClick={() => void toggleSilence(control)}
        >
          <VolumeX size={14} /> Silence {silenceKey && <kbd aria-hidden>{silenceKey}</kbd>}
        </button>
      </div>
      {voices.length === 0 && pads.length === 0 && listening === null ? (
        <p className="now-playing-empty">Aucun son.</p>
      ) : (
        <ul className="now-playing-list" aria-label="Sons en cours">
          {voices.map((voice) => {
            const isMusic = voice.role === 'music';
            return (
              <li key={voice.mediaId} data-role={voice.role} data-state={voice.state}>
                <RoleIcon role={voice.role} />
                <span className="now-playing-name">{voice.name}</span>
                <small>{stateLabelOf(voice.state, silence)}</small>
                {isMusic && !silence && <MusicPlayback control={control} voice={voice} />}
              </li>
            );
          })}
          {pads.map((pad) => (
            <li key={`pad-${pad.padId}`} data-role="pad" data-state="playing">
              <Zap size={14} aria-hidden />
              <span className="now-playing-name">{pad.name}</span>
              <small>bruitage</small>
            </li>
          ))}
          {listening !== null && (
            <li data-role="listening" data-state="playing">
              <Headphones size={14} aria-hidden />
              <span className="now-playing-name">{listening}</span>
              <small>écoute</small>
            </li>
          )}
        </ul>
      )}
      <MasterVolume control={control} />
    </section>
  );
}

/**
 * Pause or resume the current Music (keeping its position), or stop it (the Ambiences play
 * on; picking a track in the Scene's Music list starts it again). Follows what the engine
 * reports: a paused Music offers to resume.
 */
function MusicPlayback({
  control,
  voice,
}: {
  control: ControlBridge | undefined;
  voice: SoundingVoice;
}) {
  const set = (playback: MusicPlaybackState) => {
    control?.setMusicPlayback(playback).catch((error: unknown) => showNotice(errorMessage(error)));
  };
  const paused = voice.state === 'paused';
  return (
    <span className="now-playing-controls">
      <button
        className="placement-move"
        aria-label={paused ? 'Reprendre la musique' : 'Mettre la musique en pause'}
        title={paused ? 'Reprendre là où elle en était' : 'Mettre en pause'}
        onClick={() => set(paused ? 'playing' : 'paused')}
      >
        {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
      </button>
      <button
        className="placement-move"
        aria-label="Arrêter la musique"
        title="Arrêter la musique (les ambiances continuent)"
        onClick={() => set('stopped')}
      >
        <Square size={13} aria-hidden />
      </button>
    </span>
  );
}

/**
 * Starts Silence when it is off, lifts it when it is on, telling the Game Master if that fails.
 * For the Silence button, and for its key (`useAudioShortcuts` in App.tsx). The main process
 * decides from its own state, not from what this window last heard: pressed twice quickly, it
 * starts then lifts.
 */
export async function toggleSilence(control: ControlBridge | undefined) {
  if (!control) return;
  try {
    await control.toggleSilence();
  } catch (error) {
    showNotice(errorMessage(error));
  }
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
 * Raises a notice, once, for each sound of `sounding` that turns out missing or unreadable. Only
 * the "En cours" strip calls it, so other users of `useSounding` never repeat a notice.
 */
function useUnplayableNotices(sounding: AudioSounding | null) {
  const told = useRef<AudioSounding | null>(null);
  useEffect(() => {
    if (!sounding) return;
    newlyUnplayable(told.current, sounding).forEach((voice) => showNotice(unplayableNotice(voice)));
    told.current = sounding;
  }, [sounding]);
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
