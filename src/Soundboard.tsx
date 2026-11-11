import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, Trash2, Zap } from 'lucide-react';
import type { ControlBridge, SoundboardEdit } from '../shared/contract';
import type { AudioMedia, CampaignId, Soundboard, SoundboardPad } from '../shared/domain';
import { errorMessage } from './CampaignList';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { useSounding } from './NowPlaying';
import { showNotice } from './notices';
import { useDropTarget } from './PlacementLists';
import { createTransientSender } from './transientUpdates';

/** The open Campaign's Soundboard, and what can be done with it. */
export interface SoundboardControls {
  /** Null until read. */
  soundboard: Soundboard | null;
  /** Sends an edit and shows the Soundboard as saved; a failure is shown as a notice. */
  edit: (edit: SoundboardEdit) => Promise<void>;
  /** Plays a pad's Sound effect once. */
  press: (padId: string) => void;
  /** Plays the `position`th pad (1 is the first), if there is one: for the number keys (#41). */
  pressPosition: (position: number) => void;
}

/**
 * The Soundboard of `campaignId`, read again when `revision` changes (a Media deleted or
 * renamed: its pads may be gone).
 */
export function useSoundboard(
  control: ControlBridge | undefined,
  campaignId: CampaignId,
  revision: number,
): SoundboardControls {
  const [soundboard, setSoundboard] = useState<Soundboard | null>(null);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSoundboard(campaignId)
      .then((board) => {
        if (!cancelled) setSoundboard(board);
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, revision]);

  const edit = useCallback(
    async (change: SoundboardEdit) => {
      if (!control) return;
      try {
        setSoundboard(await control.editSoundboard(campaignId, change));
      } catch (error) {
        showNotice(errorMessage(error));
      }
    },
    [control, campaignId],
  );
  const press = useCallback(
    (padId: string) => {
      control?.pressPad(campaignId, padId).catch((error: unknown) => {
        showNotice(errorMessage(error));
      });
    },
    [control, campaignId],
  );
  const pressPosition = useCallback(
    (position: number) => {
      const pad = soundboard?.pads.at(position - 1);
      if (pad && position >= 1) press(pad.id);
    },
    [soundboard, press],
  );
  return { soundboard, edit, press, pressPosition };
}

/** The library's Sound effects, read again when `revision` changes. */
function useSoundEffects(
  control: ControlBridge | undefined,
  campaignId: CampaignId,
  revision: number,
): readonly AudioMedia[] {
  const [sounds, setSounds] = useState<AudioMedia[]>([]);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listMedia(campaignId)
      .then((media) => {
        if (cancelled) return;
        setSounds(
          media.filter(
            (item): item is AudioMedia => item.kind === 'audio' && item.role === 'soundEffect',
          ),
        );
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, revision]);
  return sounds;
}

/**
 * The Soundboard panel ("Table de bruitages"): one pad per Sound effect dropped on it from the
 * library, in the Game Master's order. Pressing a pad plays it once, whichever Scene is active
 * or none; a pad lights while the audio engine reports it sounding. Each pad can be renamed,
 * moved, given its own volume and removed; the Soundboard level applies to every pad. All saved
 * with the Campaign, never in an undo history.
 */
export function SoundboardPanel(props: {
  control: ControlBridge | undefined;
  campaignId: CampaignId;
  soundboard: SoundboardControls;
  /** Bumped when the library changes (import, rename, delete): pad names are read again. */
  libraryRevision: number;
}) {
  const { control, campaignId, libraryRevision } = props;
  const { soundboard, edit, press } = props.soundboard;
  const pads = soundboard?.pads ?? [];
  const sounding = useSounding(control);
  // A pad dropped for a Sound effect imported since the names were read: read them again.
  const [ownRevision, setOwnRevision] = useState(0);
  const sounds = useSoundEffects(control, campaignId, libraryRevision + ownRevision);
  const drop = useDropTarget(
    (event: DragEvent<HTMLElement>) => {
      const mediaId = droppedAudioId(event, 'soundEffect');
      if (mediaId === undefined) return;
      if (!sounds.some((sound) => sound.id === mediaId)) setOwnRevision((n) => n + 1);
      void edit({ kind: 'add-pad', mediaId });
    },
    (event) => carriesAudio(event, 'soundEffect'),
  );
  const nameOf = (pad: SoundboardPad) =>
    pad.label ?? sounds.find((sound) => sound.id === pad.mediaId)?.name ?? 'Média inconnu';
  const lit = new Set(sounding?.pads.map((pad) => pad.padId));
  const setLevel = useCallback((volume: number) => edit({ kind: 'set-level', volume }), [edit]);

  return (
    <section
      className={`panel soundboard${drop.over ? ' drop-ready' : ''}`}
      aria-label="Table de bruitages"
      {...drop.props}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BRUITAGES DE LA CAMPAGNE</span>
          <h2>
            <Zap size={18} /> Table de bruitages
          </h2>
        </div>
      </div>
      <ul className="soundboard-pads" aria-label="Bruitages">
        {pads.map((pad, index) => {
          const name = nameOf(pad);
          const isLit = lit.has(pad.id);
          return (
            <li key={pad.id} data-sounding={isLit}>
              <button
                className={`soundboard-pad${isLit ? ' is-sounding' : ''}`}
                aria-label={`Jouer ${name}`}
                aria-pressed={isLit}
                title={index < 9 ? `Touche ${index + 1}` : undefined}
                onClick={() => press(pad.id)}
              >
                {index < 9 && <kbd>{index + 1}</kbd>}
                <span className="placement-name">{name}</span>
              </button>
              <PadControls pad={pad} name={name} index={index} count={pads.length} edit={edit} />
            </li>
          );
        })}
      </ul>
      {soundboard && pads.length === 0 && (
        <p className="placement-empty">
          Déposez un bruitage de la bibliothèque ici pour en faire un pad.
        </p>
      )}
      <Level label="Niveau de la table" volume={soundboard?.volume ?? null} onChange={setLevel} />
    </section>
  );
}

/** A pad's name, place, volume and removal. */
function PadControls(props: {
  pad: SoundboardPad;
  name: string;
  index: number;
  count: number;
  edit: (edit: SoundboardEdit) => Promise<void>;
}) {
  const { pad, name, index, count, edit } = props;
  // The name being typed; null when not editing (the saved name shows).
  const [typed, setTyped] = useState<string | null>(null);
  const commitLabel = () => {
    if (typed !== null && typed.trim() !== (pad.label ?? '')) {
      void edit({ kind: 'rename-pad', padId: pad.id, label: typed });
    }
    setTyped(null);
  };
  const setVolume = useCallback(
    (volume: number) => edit({ kind: 'set-pad-volume', padId: pad.id, volume }),
    [edit, pad.id],
  );
  const moveTo = (toIndex: number) => void edit({ kind: 'move-pad', padId: pad.id, toIndex });
  return (
    <div className="soundboard-pad-controls">
      <input
        type="text"
        aria-label={`Nom de ${name}`}
        placeholder={name}
        value={typed ?? pad.label ?? ''}
        onChange={(event) => setTyped(event.currentTarget.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <Level label={`Volume de ${name}`} hideLabel volume={pad.volume} onChange={setVolume} />
      <button
        className="placement-move"
        aria-label={`Avancer ${name}`}
        title={`Placer ${name} avant le pad précédent`}
        disabled={index <= 0}
        onClick={() => moveTo(index - 1)}
      >
        <ArrowUp size={13} aria-hidden />
      </button>
      <button
        className="placement-move"
        aria-label={`Reculer ${name}`}
        title={`Placer ${name} après le pad suivant`}
        disabled={index >= count - 1}
        onClick={() => moveTo(index + 1)}
      >
        <ArrowDown size={13} aria-hidden />
      </button>
      <button
        className="placement-remove"
        aria-label={`Retirer ${name}`}
        title={`Retirer ${name} de la table`}
        onClick={() => void edit({ kind: 'remove-pad', padId: pad.id })}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}

/**
 * A level slider, 0 to 100 %. Each value is sent as the slider moves (at most one per frame,
 * the latest only) and saved; the slider shows its own position meanwhile.
 */
function Level(props: {
  label: string;
  /** Only the slider's accessible name, no visible text (a pad's row names the pad already). */
  hideLabel?: boolean;
  /** Null until known. */
  volume: number | null;
  /** Keep it the same function while the slider lives (useCallback): a drag sends through it. */
  onChange: (volume: number) => Promise<void>;
}) {
  const { label, hideLabel = false, volume, onChange } = props;
  const [percent, setPercent] = useState<number | null>(null);
  const sender = useMemo(() => createTransientSender<number>(onChange), [onChange]);
  const shown = percent ?? Math.round((volume ?? 1) * 100);
  return (
    <label className="soundboard-level">
      {!hideLabel && <span>{label}</span>}
      <input
        type="range"
        aria-label={label}
        min={0}
        max={100}
        step={1}
        value={shown}
        disabled={volume === null}
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
