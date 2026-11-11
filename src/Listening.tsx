import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Headphones, TriangleAlert } from 'lucide-react';
import type { ControlBridge } from '../shared/contract';
import type { AudioMedia, MediaId } from '../shared/domain';
import { listeningAllowed, MASTER_VOLUME } from '../core/audioMix';
import { mediaAddress } from '../core/mediaAddress';
import { useSounding } from './NowPlaying';
import { showNotice } from './notices';

/** Listening to a library sound (#43): when it is allowed, and which sound, if any. */
export interface Listening {
  allowed: boolean;
  /** The sound being listened to; null when none. */
  mediaId: MediaId | null;
  /** Its name, for the "En cours" strip; null when none. */
  name: string | null;
  /** Starts listening to `sound`, or stops when it is the one being listened to. */
  toggle: (sound: AudioMedia) => void;
  /** The player, to render once (hidden): it plays apart from the mix. */
  player: ReactElement;
}

/**
 * Listening to a sound of the library before using it. ADR-0002: Discord carries every sound the
 * app plays, so this is never private: it is allowed only during Silence once nothing else
 * sounds (core/audioMix.ts `listeningAllowed`), and stops by itself when that no longer holds
 * (Silence lifted, a pad pressed). It plays through its own element, apart from the audio
 * engine, at the Master volume like everything else; the Scene and the mix are left as they
 * are, and the "En cours" strip lists it (the players hear it).
 */
export function useListening(control: ControlBridge | undefined): Listening {
  const sounding = useSounding(control);
  const allowed = listeningAllowed(sounding);
  const masterVolume = sounding?.masterVolume ?? MASTER_VOLUME.default;
  const element = useRef<HTMLAudioElement>(null);
  const [listened, setListened] = useState<{ mediaId: MediaId; name: string } | null>(null);
  const mediaId = listened?.mediaId ?? null;
  // No longer allowed (Silence lifted, something sounds): stop, before showing it as listening.
  if (!allowed && mediaId !== null) setListened(null);

  // Heard at the Master volume, following it while it plays.
  useEffect(() => {
    if (element.current) element.current.volume = Math.min(1, Math.max(0, masterVolume));
  }, [masterVolume]);

  // Stopped, however: the player goes quiet and lets go of the file.
  useEffect(() => {
    const player = element.current;
    if (mediaId !== null || !player?.getAttribute('src')) return;
    player.pause();
    player.removeAttribute('src');
    player.load();
  }, [mediaId]);

  const stop = useCallback(() => setListened(null), []);

  const toggle = useCallback(
    (sound: AudioMedia) => {
      const player = element.current;
      if (mediaId === sound.id || !player) {
        stop();
        return;
      }
      if (!allowed) return;
      player.src = mediaAddress(sound);
      player.volume = Math.min(1, Math.max(0, masterVolume));
      setListened({ mediaId: sound.id, name: sound.name });
      player.play().catch(() => {
        // An unreadable file also raises the element's `error` event, which says so.
      });
    },
    [allowed, masterVolume, mediaId, stop],
  );

  const player = (
    <audio
      ref={element}
      className="listening-player"
      aria-hidden
      onEnded={stop}
      onError={() => {
        if (element.current?.getAttribute('src')) {
          showNotice('Ce son n’a pas pu être écouté : son fichier est illisible ou introuvable.');
        }
        setListened(null);
      }}
    />
  );
  return { allowed, mediaId, name: listened?.name ?? null, toggle, player };
}

/** Why the listen button is off, or what it does, for its tooltip. */
function listenTitle(allowed: boolean, missing: boolean, listening: boolean) {
  if (missing) return 'Fichier introuvable : impossible de l’écouter';
  if (listening) return 'Arrêter l’écoute';
  if (!allowed) return 'Écoute possible seulement en Silence, quand plus rien ne sonne';
  return 'Écouter ce son (les joueurs l’entendent aussi)';
}

/** A library sound's listen button. */
export function ListenButton({
  sound,
  listening,
  missing,
}: {
  sound: AudioMedia;
  listening: Listening;
  missing: boolean;
}) {
  const on = listening.mediaId === sound.id;
  return (
    <button
      className="media-listen"
      aria-label={`Écouter ${sound.name}`}
      aria-pressed={on}
      title={listenTitle(listening.allowed, missing, on)}
      disabled={missing || !listening.allowed}
      onClick={() => listening.toggle(sound)}
    >
      <Headphones size={13} aria-hidden /> {on ? 'Arrêter' : 'Écouter'}
    </button>
  );
}

/** Shown while listening is possible: the players hear it too (ADR-0002). */
export function ListeningWarning({ listening }: { listening: Listening }) {
  if (!listening.allowed) return null;
  return (
    <p className="listening-warning" role="note" aria-label="Écoute audible par les joueurs">
      <TriangleAlert size={14} aria-hidden /> Écoute audible par les joueurs : Discord diffuse tout
      le son de l’application.
    </p>
  );
}
