import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioLines, ImagePlus, Music2, Pencil, Search, Trash2 } from 'lucide-react';
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
}

/**
 * The open Campaign's Media library: import (with the picker, or by dropping files from Explorer
 * on it; sounds get the role the Game Master chooses then, for good), the image library
 * (thumbnails, filter by Image category, search by name), the audio library (filter by role,
 * search by name, duration), renaming, changing an image's category, deleting.
 */
export function MediaLibrary({
  campaignId,
  control,
  onMediaDeleted,
  onMediaRenamed,
  importRevision,
}: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [audioFilter, setAudioFilter] = useState<AudioFilter>('all');
  const [audioQuery, setAudioQuery] = useState('');
  const [roleRequest, setRoleRequest] = useState<RoleRequest | null>(null);
  /** A Media used by Scenes, waiting for the Game Master to confirm its deletion. */
  const [pending, setPending] = useState<{ media: Media; scenes: string[] } | null>(null);

  const images = useMemo(() => imageLibrary(media, filter, query), [media, filter, query]);
  const sounds = useMemo(
    () => audioLibrary(media, audioFilter, audioQuery),
    [media, audioFilter, audioQuery],
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

  /** Asks the Game Master which role `count` sounds get; null when they cancel. */
  function askRole(count: number): Promise<AudioRole | null> {
    return new Promise((resolve) => {
      setRoleRequest({
        count,
        answer: (role) => {
          setRoleRequest(null);
          resolve(role);
        },
      });
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

  async function rename(item: Media, name: string) {
    if (!control || name.trim() === item.name) return;
    try {
      merge([await control.renameMedia(campaignId, item.id, name)]);
      onMediaRenamed();
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  /** Deletes at once when no Scene uses the Media; otherwise asks first, listing the Scenes. */
  async function remove(item: Media, confirmed: boolean) {
    if (!control) return;
    try {
      const deletion = await control.deleteMedia(campaignId, item.id, confirmed);
      if (deletion.deleted) {
        setPending(null);
        setMedia((current) => current.filter((m) => m.id !== item.id));
        onMediaDeleted(deletion);
      } else {
        setPending({ media: item, scenes: deletion.affectedScenes.map((scene) => scene.name) });
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
      {roleRequest && <RoleChoice request={roleRequest} />}
      {hasImages && (
        <div className="library-toolbar">
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
            <MediaName item={image} onRename={(name) => void rename(image, name)} />
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
            <MediaName item={item} onRename={(name) => void rename(item, name)} />
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
          <p id="media-delete-message">
            « {pending.media.name} » est utilisé dans{' '}
            {pending.scenes.length > 1 ? 'ces scènes' : 'cette scène'}. Le supprimer le retire aussi
            de {pending.scenes.length > 1 ? 'ces scènes' : 'cette scène'}, et de la diffusion s’il y
            est affiché.
          </p>
          <ul aria-label="Scènes concernées">
            {pending.scenes.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
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

/** A Media's name, with its original file name in the tooltip, and renaming in place. */
function MediaName({ item, onRename }: { item: Media; onRename: (name: string) => void }) {
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
