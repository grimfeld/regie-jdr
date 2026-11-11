import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioLines, ImagePlus, Music2, Pencil, Search, Star, Trash2 } from 'lucide-react';
import type { AudioRole, CampaignId, ImageCategory, ImageMedia, Media } from '../shared/domain';
import type { ControlBridge, MediaDeletion, MediaImportKind } from '../shared/contract';
import {
  audioLibrary,
  formatDuration,
  imageLibrary,
  type AudioFilter,
  type LibraryFilter,
} from '../core/librarySearch';
import { mediaKindOfFileName, thumbnailAddress } from '../core/mediaAddress';
import { errorMessage } from './CampaignList';
import { carriesFiles, droppedFiles, startAudioDrag, startMediaDrag } from './mediaDrag';
import { useDropTarget } from './PlacementLists';
import { showNotice } from './notices';
import { MediaImage } from './MediaImage';
import { MissingMediaBadge, useMissingMedia } from './MissingMedia';
import { ListenButton, ListeningWarning, type Listening } from './Listening';
import { gridColumns, gridWindow } from './virtualGrid';

const categoryLabels: Record<ImageCategory, string> = {
  scenery: 'Décors',
  character: 'Personnage',
  reference: 'Référence',
};

const filterLabels: Record<LibraryFilter, string> = {
  all: 'Tous',
  scenery: 'Décors',
  character: 'Personnages',
  reference: 'Références',
};

/** A Media in use, and the names of what uses it, waiting for the Game Master's confirmation. */
interface PendingDeletion {
  media: Media;
  /** Scenes placing it. */
  scenes: string[];
  pads: string[];
  /** Scenes whose Notes show it. */
  notes: string[];
}

/**
 * What deleting a used Media takes with it, for the confirmation: the Scenes it is placed in
 * (and the broadcast, if shown there), its images in Scene Notes and the Soundboard pads playing
 * it.
 */
function deletionWarning({ media, scenes, pads, notes }: PendingDeletion) {
  const inScenes = scenes.length > 1 ? 'ces scènes' : 'cette scène';
  const byPads = pads.length > 1 ? 'ces pads' : 'ce pad';
  const uses = [
    scenes.length > 0 && `dans ${inScenes}`,
    notes.length > 0 && `dans les notes de ${notes.length > 1 ? 'ces scènes' : 'cette scène'}`,
    pads.length > 0 && `par ${byPads} de la table de bruitages`,
  ].filter((use) => use !== false);
  const removed = [
    scenes.length > 0 &&
      `Le supprimer le retire aussi de ${inScenes}, et de la diffusion s’il y est affiché.`,
    notes.length > 0 && 'Son image est retirée de ces notes.',
    pads.length > 0 &&
      (pads.length > 1 ? 'Ces pads sont retirés de la table.' : 'Ce pad est retiré de la table.'),
  ].filter(Boolean);
  const listed = uses.length > 1 ? `${uses.slice(0, -1).join(', ')} et ${uses.at(-1)}` : uses[0];
  return `« ${media.name} » est utilisé ${listed}. ${removed.join(' ')}`;
}

const roleLabels: Record<AudioRole, string> = {
  music: 'Musique',
  ambience: 'Ambiance',
  soundEffect: 'Bruitage',
};

const audioFilterLabels: Record<AudioFilter, string> = {
  all: 'Tous',
  music: 'Musiques',
  ambience: 'Ambiances',
  soundEffect: 'Bruitages',
};

/** Sounds waiting for the Game Master to choose their role, and what to do with the answer. */
interface RoleRequest {
  /** Tells requests apart, so each question shows afresh. */
  id: number;
  /** How many dropped sounds; 0 when they are still to be picked. */
  count: number;
  answer: (role: AudioRole | null) => void;
}

interface Props {
  campaignId: CampaignId;
  control: ControlBridge | undefined;
  /** A Media was deleted, with its placements in these Scenes. */
  onMediaDeleted: (deletion: MediaDeletion) => void;
  /** A Media got a new name. */
  onMediaRenamed: () => void;
  /** Changes when Media were imported elsewhere (dropped on the Scene editor): read again. */
  importRevision: number;
  /** Listening to a library sound (shared with the "En cours" strip, which lists it). */
  listening: Listening;
}

/**
 * The open Campaign's Media library: import (with the picker, or by dropping files from Explorer
 * on it; sounds get the role the Game Master chooses then, for good), the image library
 * (thumbnails, filter by Image category, search by name), the audio library (filter by role,
 * search by name, duration), both with a "Favoris" filter; starring, renaming, changing an
 * image's category, deleting.
 */
export function MediaLibrary({
  campaignId,
  control,
  onMediaDeleted,
  onMediaRenamed,
  importRevision,
  listening,
}: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [audioFilter, setAudioFilter] = useState<AudioFilter>('all');
  const [audioQuery, setAudioQuery] = useState('');
  /** The "Favoris" filters: only starred images, only starred sounds. */
  const [favouriteImages, setFavouriteImages] = useState(false);
  const [favouriteSounds, setFavouriteSounds] = useState(false);
  /** Questions about sounds' roles, asked one at a time in order: a drop never replaces one. */
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const nextRoleRequest = useRef(0);
  /** A Media in use, waiting for the Game Master to confirm its deletion. */
  const [pending, setPending] = useState<PendingDeletion | null>(null);

  const images = useMemo(
    () => imageLibrary(media, filter, query, favouriteImages),
    [media, filter, query, favouriteImages],
  );
  const sounds = useMemo(
    () => audioLibrary(media, audioFilter, audioQuery, favouriteSounds),
    [media, audioFilter, audioQuery, favouriteSounds],
  );
  const hasImages = media.some((item) => item.kind === 'image');
  const hasSounds = media.some((item) => item.kind === 'audio');
  const missingSounds = useMissingMedia(sounds);

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listMedia(campaignId)
      .then((list) => {
        if (!cancelled) setMedia(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, importRevision]);

  function merge(changed: Media[]) {
    setMedia((current) => {
      const next = [...current];
      for (const item of changed) {
        const index = next.findIndex((m) => m.id === item.id);
        if (index >= 0) next[index] = item;
        else next.push(item);
      }
      return next;
    });
  }

  // Failures are left to the shared notices (src/notices.tsx).
  async function importMedia(kind: MediaImportKind) {
    if (!control) return;
    const { imported, refused } = await control.importMedia(campaignId, kind);
    merge(imported);
    refused.forEach(showNotice);
  }

  /**
   * Asks the Game Master which role `count` sounds get; null when they cancel. Asked after any
   * question still open (sounds dropped again meanwhile), so no sounds are forgotten.
   */
  function askRole(count: number): Promise<AudioRole | null> {
    return new Promise((resolve) => {
      nextRoleRequest.current += 1;
      const id = nextRoleRequest.current;
      const request: RoleRequest = {
        id,
        count,
        answer: (role) => {
          setRoleRequests((current) => current.filter((open) => open.id !== id));
          resolve(role);
        },
      };
      setRoleRequests((current) => [...current, request]);
    });
  }

  /** Picks sounds once the Game Master has chosen their role. */
  async function importSounds() {
    const role = await askRole(0);
    if (role) await importMedia({ accept: 'audio', role });
  }

  /**
   * Files dropped from Explorer, imported like picked ones: sounds with the role the Game Master
   * then chooses, everything else as images (other types are refused there, with a message).
   * Failures: as above.
   */
  async function importDropped(files: readonly File[]) {
    if (!control || files.length === 0) return;
    const dropped = files.filter((file) => mediaKindOfFileName(file.name) === 'audio');
    const others = files.filter((file) => !dropped.includes(file));
    if (others.length > 0) {
      const { imported, refused } = await control.importDroppedMedia(campaignId, others, {
        accept: 'image',
      });
      merge(imported);
      refused.forEach(showNotice);
    }
    if (dropped.length === 0) return;
    const role = await askRole(dropped.length);
    if (!role) return;
    const { imported, refused } = await control.importDroppedMedia(campaignId, dropped, {
      accept: 'audio',
      role,
    });
    merge(imported);
    refused.forEach(showNotice);
  }
  // Only files from outside: a library image dropped back on the library is no import.
  const drop = useDropTarget((event) => void importDropped(droppedFiles(event)), carriesFiles);

  async function changeCategory(image: ImageMedia, category: ImageCategory) {
    if (!control) return;
    try {
      merge([await control.setImageCategory(campaignId, image.id, category)]);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  async function setFavourite(item: Media, favourite: boolean) {
    if (!control) return;
    try {
      merge([await control.setMediaFavourite(campaignId, item.id, favourite)]);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  const favouriteButton = (item: Media) => (
    <FavouriteButton item={item} onChange={(favourite) => void setFavourite(item, favourite)} />
  );

  async function rename(item: Media, name: string) {
    if (!control || name.trim() === item.name) return;
    try {
      merge([await control.renameMedia(campaignId, item.id, name)]);
      onMediaRenamed();
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  /**
   * Deletes at once when no Scene nor pad uses the Media; otherwise asks first, listing the
   * Scenes and the pads.
   */
  async function remove(item: Media, confirmed: boolean) {
    if (!control) return;
    try {
      const deletion = await control.deleteMedia(campaignId, item.id, confirmed);
      if (deletion.deleted) {
        setPending(null);
        setMedia((current) => current.filter((m) => m.id !== item.id));
        onMediaDeleted(deletion);
      } else {
        setPending({
          media: item,
          scenes: deletion.affectedScenes.map((scene) => scene.name),
          pads: deletion.affectedPads.map((pad) => pad.name),
          notes: deletion.affectedNotes.map((scene) => scene.name),
        });
      }
    } catch (error) {
      setPending(null);
      showNotice(errorMessage(error));
    }
  }

  const deleteButton = (item: Media) => (
    <button
      className="media-delete"
      aria-label={`Supprimer ${item.name}`}
      title={`Supprimer ${item.name}`}
      onClick={() => void remove(item, false)}
    >
      <Trash2 size={13} aria-hidden /> Supprimer
    </button>
  );

  return (
    <div
      className={`library-drop${drop.over ? ' drop-ready' : ''}`}
      role="region"
      aria-label="Bibliothèque"
      {...drop.props}
    >
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">BIBLIOTHÈQUE DE LA CAMPAGNE</span>
          <h2>Médias</h2>
        </div>
        <div className="library-actions">
          <button
            className="secondary-button"
            onClick={() => void importMedia({ accept: 'image' })}
          >
            <ImagePlus size={16} /> Importer des images
          </button>
          <button className="secondary-button" onClick={() => void importSounds()}>
            <AudioLines size={16} /> Importer des sons
          </button>
        </div>
      </div>
      {roleRequests[0] && <RoleChoice key={roleRequests[0].id} request={roleRequests[0]} />}
      {hasImages && (
        <div className="library-toolbar">
          <div className="library-filters">
            <div className="library-filter" role="group" aria-label="Filtrer les images">
              {(Object.keys(filterLabels) as LibraryFilter[]).map((option) => (
                <button
                  key={option}
                  aria-pressed={filter === option}
                  className={filter === option ? 'selected' : ''}
                  onClick={() => setFilter(option)}
                >
                  {filterLabels[option]}
                </button>
              ))}
            </div>
            <FavouritesFilter what="images" on={favouriteImages} onChange={setFavouriteImages} />
          </div>
          <label className="library-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              aria-label="Rechercher une image"
              placeholder="Rechercher par nom"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      )}
      <ImageGrid
        images={images}
        renderImage={(image) => (
          <>
            <span
              className="asset-thumb"
              draggable
              title="Glissez l’image sur la scène ouverte pour la placer"
              onDragStart={(event) => startMediaDrag(event, image)}
            >
              <MediaImage address={thumbnailAddress(image)} alt={image.name} window="control" />
            </span>
            <MediaName
              item={image}
              star={favouriteButton(image)}
              onRename={(name) => void rename(image, name)}
            />
            <select
              aria-label={`Catégorie de ${image.name}`}
              value={image.category}
              onChange={(e) => void changeCategory(image, e.target.value as ImageCategory)}
            >
              {Object.entries(categoryLabels).map(([category, label]) => (
                <option key={category} value={category}>
                  {label}
                </option>
              ))}
            </select>
            {deleteButton(image)}
          </>
        )}
      />
      {hasImages && images.length === 0 && (
        <div className="asset-empty">
          Aucune image ne correspond à ce filtre ou à cette recherche.
        </div>
      )}
      {hasSounds && (
        <div className="library-toolbar sound-toolbar">
          <div className="library-filters">
            <div className="library-filter" role="group" aria-label="Filtrer les sons">
              {(Object.keys(audioFilterLabels) as AudioFilter[]).map((option) => (
                <button
                  key={option}
                  aria-pressed={audioFilter === option}
                  className={audioFilter === option ? 'selected' : ''}
                  onClick={() => setAudioFilter(option)}
                >
                  {audioFilterLabels[option]}
                </button>
              ))}
            </div>
            <FavouritesFilter what="sons" on={favouriteSounds} onChange={setFavouriteSounds} />
          </div>
          <label className="library-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              aria-label="Rechercher un son"
              placeholder="Rechercher par nom"
              value={audioQuery}
              onChange={(e) => setAudioQuery(e.target.value)}
            />
          </label>
        </div>
      )}
      {hasSounds && <ListeningWarning listening={listening} />}
      {listening.player}
      <ul className="media-library sound-library" aria-label="Sons">
        {sounds.map((item) => (
          <li className="media-item" key={item.id}>
            <span
              className="media-audio-icon"
              draggable
              title="Glissez le son sur la scène ouverte pour l’y ajouter"
              onDragStart={(event) => startAudioDrag(event, item)}
            >
              <Music2 size={20} />
            </span>
            <MediaName
              item={item}
              star={favouriteButton(item)}
              onRename={(name) => void rename(item, name)}
            />
            <span className="media-sound-facts">
              <span className="media-role">{roleLabels[item.role]}</span>
              {missingSounds.has(item.id) && <MissingMediaBadge name={item.name} />}
              <span
                className="media-duration"
                title={item.durationSeconds === null ? 'Durée inconnue' : 'Durée'}
              >
                {formatDuration(item.durationSeconds)}
              </span>
            </span>
            <ListenButton sound={item} listening={listening} missing={missingSounds.has(item.id)} />
            {deleteButton(item)}
          </li>
        ))}
      </ul>
      {hasSounds && sounds.length === 0 && (
        <div className="asset-empty">Aucun son ne correspond à ce filtre ou à cette recherche.</div>
      )}
      {pending && (
        <div
          className="media-delete-confirm"
          role="alertdialog"
          aria-label="Supprimer le média"
          aria-describedby="media-delete-message"
        >
          <p id="media-delete-message">{deletionWarning(pending)}</p>
          {pending.scenes.length > 0 && (
            <ul aria-label="Scènes concernées">
              {pending.scenes.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          )}
          {pending.notes.length > 0 && (
            <ul aria-label="Notes concernées">
              {pending.notes.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          )}
          {pending.pads.length > 0 && (
            <ul aria-label="Pads concernés">
              {pending.pads.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          )}
          <div className="media-delete-actions">
            <button className="secondary-button" autoFocus onClick={() => setPending(null)}>
              Annuler
            </button>
            <button className="primary-button" onClick={() => void remove(pending.media, true)}>
              <Trash2 size={14} aria-hidden /> Supprimer quand même
            </button>
          </div>
        </div>
      )}
      {media.length === 0 && (
        <div className="asset-empty">
          Vos décors, personnages, musiques, bruitages et ambiances apparaîtront ici après import.
          Vous pouvez aussi glisser des images et des sons ici depuis l’Explorateur.
        </div>
      )}
    </div>
  );
}

/**
 * Asks which role imported sounds get: Music, Ambience or Sound effect. The role cannot be
 * changed afterwards, so the question says so. Escape cancels.
 */
function RoleChoice({ request }: { request: RoleRequest }) {
  const { count, answer } = request;
  const what = count === 0 ? 'ces sons' : count > 1 ? `ces ${count} sons` : 'ce son';
  return (
    <div
      className="media-role-choice"
      role="dialog"
      aria-label="Rôle des sons"
      aria-describedby="media-role-message"
      onKeyDown={(e) => {
        if (e.key === 'Escape') answer(null);
      }}
    >
      <p id="media-role-message">Quel rôle donner à {what} ? Il ne pourra plus être changé.</p>
      <div className="media-delete-actions">
        {(Object.keys(roleLabels) as AudioRole[]).map((role, index) => (
          <button
            key={role}
            className="primary-button"
            autoFocus={index === 0}
            onClick={() => answer(role)}
          >
            {roleLabels[role]}
          </button>
        ))}
        <button className="secondary-button" onClick={() => answer(null)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Smallest library cell width, gap between cells, and row height (cell plus gap), in pixels. */
const CELL_MIN_WIDTH = 140;
const CELL_GAP = 10;
const ROW_HEIGHT = 200;
/** Rows rendered above and below the visible ones, so fast scrolling shows no blank cells. */
const OVERSCAN_ROWS = 2;
/** Padding inside the scrolling area, on each side. */
const GRID_PADDING = 12;

/**
 * The image library: a scrolling grid of equal cells that renders only the rows near the
 * visible area, so a library of hundreds of images stays smooth.
 */
function ImageGrid({
  images,
  renderImage,
}: {
  images: ImageMedia[];
  renderImage: (image: ImageMedia) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ width: 0, height: 0, scrollTop: 0 });

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setView((current) => ({
        ...current,
        width: element.clientWidth - 2 * GRID_PADDING,
        height: element.clientHeight,
      }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = gridColumns(view.width, CELL_MIN_WIDTH, CELL_GAP);
  const shown = gridWindow({
    itemCount: images.length,
    columns,
    rowHeight: ROW_HEIGHT,
    scrollTop: view.scrollTop,
    viewportHeight: view.height,
    overscanRows: OVERSCAN_ROWS,
  });

  return (
    <div
      ref={scroller}
      className={`image-library-scroll ${images.length === 0 ? 'empty' : ''}`}
      onScroll={(e) => {
        const { scrollTop } = e.currentTarget;
        setView((current) => ({ ...current, scrollTop }));
      }}
    >
      <ul
        className="image-library"
        aria-label="Images"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: ROW_HEIGHT - CELL_GAP,
          gap: CELL_GAP,
          paddingTop: shown.paddingTop,
          paddingBottom: shown.paddingBottom,
        }}
      >
        {images.slice(shown.first, shown.end).map((image) => (
          <li className="media-item" key={image.id}>
            {renderImage(image)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "Favoris" filter of one library: on, it shows only starred Media, combined with the
 * category or role filter and the search.
 */
function FavouritesFilter({
  what,
  on,
  onChange,
}: {
  what: 'images' | 'sons';
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="library-filter" role="group" aria-label={`Favoris parmi les ${what}`}>
      <button
        aria-pressed={on}
        className={on ? 'selected' : ''}
        title={on ? `Montrer tous les ${what}` : `Montrer seulement les ${what} favoris`}
        onClick={() => onChange(!on)}
      >
        <Star size={12} aria-hidden fill={on ? 'currentColor' : 'none'} /> Favoris
      </button>
    </div>
  );
}

/** The star of a Media: filled when it is a favourite; a click stars or unstars it. */
function FavouriteButton({
  item,
  onChange,
}: {
  item: Media;
  onChange: (favourite: boolean) => void;
}) {
  const label = item.favourite
    ? `Retirer ${item.name} des favoris`
    : `Ajouter ${item.name} aux favoris`;
  return (
    <button
      className={`media-favourite${item.favourite ? ' starred' : ''}`}
      aria-pressed={item.favourite}
      aria-label={label}
      title={label}
      onClick={() => onChange(!item.favourite)}
    >
      <Star size={12} aria-hidden fill={item.favourite ? 'currentColor' : 'none'} />
    </button>
  );
}

/**
 * A Media's name, with its original file name in the tooltip, and renaming in place. `star`
 * (its favourite button) goes before the name.
 */
function MediaName({
  item,
  star,
  onRename,
}: {
  item: Media;
  star: ReactNode;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  /** Set once the edit is committed or cancelled, so a later blur does not commit again. */
  const finished = useRef(false);

  function finish(name: string | null) {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (name !== null) onRename(name);
  }

  if (editing) {
    return (
      <input
        className="media-rename"
        aria-label={`Nouveau nom de ${item.name}`}
        defaultValue={item.name}
        maxLength={100}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value);
          if (e.key === 'Escape') finish(null);
        }}
      />
    );
  }

  return (
    <span className="media-name-row">
      {star}
      <span
        className="media-name"
        title={`${item.name}\nFichier d’origine : ${item.originalName}${item.extension}`}
      >
        {item.name}
      </span>
      <button
        className="media-rename-button"
        aria-label={`Renommer ${item.name}`}
        title={`Renommer ${item.name}`}
        onClick={() => {
          finished.current = false;
          setEditing(true);
        }}
      >
        <Pencil size={12} aria-hidden />
      </button>
    </span>
  );
}
