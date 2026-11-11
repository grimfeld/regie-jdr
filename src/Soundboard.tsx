import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, Trash2, Zap } from 'lucide-react';
import type { ControlBridge, SoundboardEdit, SoundboardLevel } from '../shared/contract';
import type { AudioMedia, CampaignId, Soundboard, SoundboardPad } from '../shared/domain';
import { errorMessage } from './CampaignList';
import { carriesAudio, droppedAudioId } from './mediaDrag';
import { keyLabelOf, PAD_KEY_POSITIONS } from './keyboard';
import { useSounding } from './NowPlaying';
import { showNotice } from './notices';
import { MissingMediaBadge, useMissingMedia } from './MissingMedia';
import { useDropTarget } from './PlacementLists';
import { LevelSlider, useTransientSender } from './LevelSlider';

/** The open Campaign's Soundboard, and what can be done with it. */
export interface SoundboardControls {
  /** Null until read. */
  soundboard: Soundboard | null;
  /** Sends an edit and shows the Soundboard as saved; a failure is shown as a notice. */
  edit: (edit: SoundboardEdit) => Promise<void>;
  /** Plays a pad's Sound effect once. */
  press: (padId: string) => void;
  /** Plays the `position`th pad (1 is the first), if there is one: for the number keys. */
  pressPosition: (position: number) => void;
  /** A level slider being dragged: heard on the pads sounding, unsaved. */
  showLive: (edit: SoundboardLevel) => Promise<void>;
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
  const showLive = useCallback(
    (live: SoundboardLevel) =>
      control ? control.showSoundboardTransient(campaignId, live) : Promise.resolve(),
    [control, campaignId],
  );
  return { soundboard, edit, press, pressPosition, showLive };
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
  const padSounds = useMemo(
    () => sounds.filter((sound) => soundboard?.pads.some((pad) => pad.mediaId === sound.id)),
    [sounds, soundboard],
  );
  const missing = useMissingMedia(padSounds);
  const level = useLevel(props.soundboard);

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
          const key = padKeyLabel(index);
          return (
            <li key={pad.id} data-sounding={isLit}>
              <button
                className={`soundboard-pad${isLit ? ' is-sounding' : ''}`}
                aria-label={`Jouer ${name}`}
                aria-pressed={isLit}
                title={key === undefined ? undefined : `Touche ${key}`}
                aria-keyshortcuts={key}
                onClick={() => press(pad.id)}
              >
                {key !== undefined && <kbd>{key}</kbd>}
                <span className="placement-name">{name}</span>
                {missing.has(pad.mediaId) && <MissingMediaBadge name={name} />}
              </button>
              <PadControls
                pad={pad}
                name={name}
                index={index}
                count={pads.length}
                edit={edit}
                level={level}
              />
            </li>
          );
        })}
      </ul>
      {soundboard && pads.length === 0 && (
        <p className="placement-empty">
          Déposez un bruitage de la bibliothèque ici pour en faire un pad.
        </p>
      )}
      <LevelSlider
        label="Niveau de la table"
        value={soundboard?.volume ?? 1}
        disabled={soundboard === null}
        {...level((volume) => ({ kind: 'set-level', volume }))}
      />
    </section>
  );
}

/** The key that plays the pad at `index` (0 is the first), if one does. */
function padKeyLabel(index: number): string | undefined {
  const position = PAD_KEY_POSITIONS.find((candidate) => candidate === index + 1);
  return position === undefined ? undefined : keyLabelOf(`pad-${position}`);
}

/** A slider's handlers for a Soundboard level: heard on the pads sounding while dragged, saved once released. */
type LevelOf = (edit: (volume: number) => SoundboardLevel) => {
  onLive: (volume: number) => void;
  onCommit: (volume: number) => void;
};

function useLevel({ edit, showLive }: SoundboardControls): LevelOf {
  const live = useTransientSender(showLive);
  return (change) => ({
    onLive: (volume) => live().push(change(volume)),
    onCommit: (volume) => {
      live().drop();
      void edit(change(volume));
    },
  });
}

/** A pad's name, place, volume and removal. */
function PadControls(props: {
  pad: SoundboardPad;
  name: string;
  index: number;
  count: number;
  edit: (edit: SoundboardEdit) => Promise<void>;
  level: LevelOf;
}) {
  const { pad, name, index, count, edit, level } = props;
  // The name being typed; null when not editing (the saved name shows).
  const [typed, setTyped] = useState<string | null>(null);
  const commitLabel = () => {
    if (typed !== null && typed.trim() !== (pad.label ?? '')) {
      void edit({ kind: 'rename-pad', padId: pad.id, label: typed });
    }
    setTyped(null);
  };
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
      <LevelSlider
        label={`Volume de ${name}`}
        hideLabel
        value={pad.volume}
        {...level((volume) => ({ kind: 'set-pad-volume', padId: pad.id, volume }))}
      />
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
