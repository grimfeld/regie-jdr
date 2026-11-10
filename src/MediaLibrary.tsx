import { useEffect, useState } from 'react';
import { AudioLines, ImagePlus, Music2 } from 'lucide-react';
import type { AudioRole, CampaignId, ImageCategory, ImageMedia, Media } from '../shared/domain';
import type { ControlBridge, MediaImportKind } from '../shared/contract';
import { mediaAddress } from '../core/mediaAddress';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';

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
  /** The Game Master clicked an image (the prototype preview shows it). */
  onShowImage(image: ImageMedia, address: string): void;
}

/** The open Campaign's Media library: import, list, change an image's category. */
export function MediaLibrary({ campaignId, control, onShowImage }: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [audioRole, setAudioRole] = useState<AudioRole>('music');

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
              <ImageItem image={item} onShow={onShowImage} onCategory={changeCategory} />
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
          </li>
        ))}
      </ul>
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
  onShow,
  onCategory,
}: {
  image: ImageMedia;
  onShow: Props['onShowImage'];
  onCategory(image: ImageMedia, category: ImageCategory): void;
}) {
  const address = mediaAddress(image);
  return (
    <>
      <button
        className="asset-thumb"
        title={`Afficher ${image.name} dans l’aperçu`}
        onClick={() => onShow(image, address)}
      >
        <img src={address} alt={image.name} />
      </button>
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
