import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioLines, ImagePlus, Music2, Pencil, Search, Trash2 } from 'lucide-react';
import type { AudioRole, CampaignId, ImageCategory, ImageMedia, Media } from '../shared/domain';
import type { ControlBridge, MediaDeletion, MediaImportKind } from '../shared/contract';
import { imageLibrary, type LibraryFilter } from '../core/librarySearch';
import { thumbnailAddress } from '../core/mediaAddress';
import { errorMessage } from './CampaignList';
import { startMediaDrag } from './mediaDrag';
import { showNotice } from './notices';
import { MediaImage } from './MediaImage';
import { gridColumns, gridWindow } from './virtualGrid';

const categoryLabels: Record<ImageCategory, string> = {
  scenery: 'Décors',
  character: 'Personnage',
};

const filterLabels: Record<LibraryFilter, string> = {
  all: 'Tous',
  scenery: 'Décors',
  character: 'Personnages',
};

const roleLabels: Record<AudioRole, string> = {
  music: 'Musique',
  soundEffect: 'Bruitage',
  ambience: 'Ambiance',
};

interface Props {
  campaignId: CampaignId;
  control: ControlBridge | undefined;
  /** A Media was deleted, with its placements in these Scenes. */
  onMediaDeleted: (deletion: MediaDeletion) => void;
  /** A Media got a new name. */
  onMediaRenamed: () => void;
}

/**
 * The open Campaign's Media library: import, the image library (thumbnails, filter by Image
 * category, search by name), the sounds, renaming, changing an image's category, deleting.
 */
export function MediaLibrary({ campaignId, control, onMediaDeleted, onMediaRenamed }: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [audioRole, setAudioRole] = useState<AudioRole>('music');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  /** A Media used by Scenes, waiting for the Game Master to confirm its deletion. */
  const [pending, setPending] = useState<{ media: Media; scenes: string[] } | null>(null);

  const images = useMemo(() => imageLibrary(media, filter, query), [media, filter, query]);
  const sounds = useMemo(() => media.filter((item) => item.kind === 'audio'), [media]);
  const hasImages = media.some((item) => item.kind === 'image');

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
  }, [control, campaignId]);

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
    <>
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
          <label className="library-role">
            Rôle des sons importés
            <select value={audioRole} onChange={(e) => setAudioRole(e.target.value as AudioRole)}>
              {Object.entries(roleLabels).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            onClick={() => void importMedia({ accept: 'audio', role: audioRole })}
          >
            <AudioLines size={16} /> Importer des sons
          </button>
        </div>
      </div>
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
      <ul className="media-library sound-library" aria-label="Sons">
        {sounds.map((item) => (
          <li className="media-item" key={item.id}>
            <span className="media-audio-icon">
              <Music2 size={20} />
            </span>
            <MediaName item={item} onRename={(name) => void rename(item, name)} />
            <span className="media-role">{roleLabels[item.role]}</span>
            {deleteButton(item)}
          </li>
        ))}
      </ul>
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
        </div>
      )}
    </>
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
