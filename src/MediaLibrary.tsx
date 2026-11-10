import { useEffect, useState } from 'react';
import { AudioLines, ImagePlus, Music2, Trash2 } from 'lucide-react';
import type { AudioRole, CampaignId, ImageCategory, ImageMedia, Media } from '../shared/domain';
import type { ControlBridge, MediaDeletion, MediaImportKind } from '../shared/contract';
import { mediaAddress } from '../core/mediaAddress';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';
import { MediaImage } from './MediaImage';

const categoryLabels: Record<ImageCategory, string> = {
  scenery: 'Décors',
  character: 'Personnage',
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
  onMediaDeleted(deletion: MediaDeletion): void;
}

/** The open Campaign's Media library: import, list, change an image's category, delete. */
export function MediaLibrary({ campaignId, control, onMediaDeleted }: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [audioRole, setAudioRole] = useState<AudioRole>('music');
  /** A Media used by Scenes, waiting for the Game Master to confirm its deletion. */
  const [pending, setPending] = useState<{ media: Media; scenes: string[] } | null>(null);

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listMedia(campaignId)
      .then((list) => {
        if (!cancelled) setMedia(list);
      })
      .catch((error) => {
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

  return (
    <>
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">BIBLIOTHÈQUE DE LA CAMPAGNE</span>
          <h2>Médias</h2>
        </div>
        <div className="library-actions">
          <button className="secondary-button" onClick={() => importMedia({ accept: 'image' })}>
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
            onClick={() => importMedia({ accept: 'audio', role: audioRole })}
          >
            <AudioLines size={16} /> Importer des sons
          </button>
        </div>
      </div>
      <ul className="media-library" aria-label="Médias">
        {media.map((item) => (
          <li className="media-item" key={item.id}>
            {item.kind === 'image' ? (
              <ImageItem image={item} onCategory={changeCategory} />
            ) : (
              <>
                <span className="media-audio-icon">
                  <Music2 size={20} />
                </span>
                <span className="media-name" title={item.name}>
                  {item.name}
                </span>
                <span className="media-role">{roleLabels[item.role]}</span>
              </>
            )}
            <button
              className="media-delete"
              aria-label={`Supprimer ${item.name}`}
              title={`Supprimer ${item.name}`}
              onClick={() => void remove(item, false)}
            >
              <Trash2 size={13} aria-hidden /> Supprimer
            </button>
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

function ImageItem({
  image,
  onCategory,
}: {
  image: ImageMedia;
  onCategory(image: ImageMedia, category: ImageCategory): void;
}) {
  return (
    <>
      <span className="asset-thumb">
        <MediaImage address={mediaAddress(image)} alt={image.name} window="control" />
      </span>
      <span className="media-name" title={image.name}>
        {image.name}
      </span>
      <select
        aria-label={`Catégorie de ${image.name}`}
        value={image.category}
        onChange={(e) => onCategory(image, e.target.value as ImageCategory)}
      >
        {Object.entries(categoryLabels).map(([category, label]) => (
          <option key={category} value={category}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}
