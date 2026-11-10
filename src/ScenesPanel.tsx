import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Clapperboard, History, Plus, Radio } from 'lucide-react';
import type { CampaignId, ImageMedia, OnAirState, Scene, SceneId } from '../shared/domain';
import type { ControlBridge } from '../shared/contract';
import { latestOnAir } from '../core/onAir';
import { addBackground, setBackgroundVisible } from '../core/sceneEdits';
import { errorMessage } from './CampaignList';
import { showNotice } from './notices';

interface Props {
  campaignId: CampaignId;
  control: ControlBridge | undefined;
  /** Changes when a Media was deleted: Scenes and images are read again. */
  mediaRevision: number;
}

/**
 * The open Campaign's Scenes (minimal, Milestone 0): create a Scene, open it as the Selected
 * Scene, place a library image as a Background, show or hide it, Activate it. Edits are saved
 * at once; the main process puts them on air only when the Scene is the Active Scene.
 */
export function ScenesPanel({ campaignId, control, mediaRevision }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<SceneId | null>(null);
  const [onAir, setOnAir] = useState<OnAirState | null>(null);
  const [images, setImages] = useState<ImageMedia[]>([]);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listScenes(campaignId)
      .then((list) => {
        if (!cancelled) setScenes(list);
      })
      .catch((error) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, mediaRevision]);

  // Which Scene is on air: subscribe, then read, keeping the newest snapshot.
  useEffect(() => {
    if (!control) return;
    const show = (snapshot: OnAirState) => setOnAir((shown) => latestOnAir(shown, snapshot));
    const unsubscribe = control.onOnAirChanged(show);
    void control.getOnAir().then(show);
    return unsubscribe;
  }, [control]);

  // The library's images, to place as Backgrounds. Read again whenever a Scene is opened and
  // when the picker gets focus, so images imported meanwhile are offered.
  const refreshImages = useCallback(() => {
    if (!control) return;
    control
      .listMedia(campaignId)
      .then((media) => setImages(media.filter((m): m is ImageMedia => m.kind === 'image')))
      .catch((error) => showNotice(errorMessage(error)));
  }, [control, campaignId]);
  useEffect(refreshImages, [refreshImages, selectedId, mediaRevision]);

  // The Scene that was last Active in this Campaign (Settings), highlighted so the Game Master
  // can resume with one click. Only while no Scene of the Campaign is on air.
  const [lastActiveId, setLastActiveId] = useState<SceneId | null>(null);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setLastActiveId(settings.lastActiveSceneByCampaign[campaignId] ?? null);
      })
      .catch((error) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId]);

  const selected = scenes.find((scene) => scene.id === selectedId);
  const isActive = (scene: Scene) =>
    onAir?.campaignId === campaignId && onAir.activeSceneId === scene.id;
  const hasActive = onAir?.campaignId === campaignId && onAir.activeSceneId !== null;
  const isLastActive = (scene: Scene) => !hasActive && scene.id === lastActiveId;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!control) return;
    try {
      const scene = await control.createScene(campaignId, newName);
      setScenes((current) => [...current, scene]);
      setSelectedId(scene.id);
      setNewName('');
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  /** Shows the edit at once and saves it; on failure, reloads the Scenes as stored. */
  async function edit(next: Scene) {
    setScenes((current) => current.map((scene) => (scene.id === next.id ? next : scene)));
    if (!control) return;
    try {
      await control.updateScene(next);
    } catch (error) {
      showNotice(errorMessage(error));
      setScenes(await control.listScenes(campaignId));
    }
  }

  async function activate(scene: Scene) {
    if (!control) return;
    try {
      await control.activateScene(scene.id);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  return (
    <section className="panel scenes-panel" aria-label="Scènes">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SCÈNES PRÉPARÉES</span>
          <h2>
            <Clapperboard size={18} /> Scènes
          </h2>
        </div>
      </div>

      <form className="campaign-form" onSubmit={create}>
        <label>
          NOM DE LA SCÈNE
          <input
            aria-label="Nom de la scène"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <button className="primary-button" type="submit">
          <Plus size={14} /> Créer la scène
        </button>
      </form>

      <ul className="scene-list" aria-label="Scènes de la campagne">
        {scenes.map((scene) => (
          <li
            key={scene.id}
            className={
              [scene.id === selectedId && 'selected', isLastActive(scene) && 'last-active']
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            <button
              className="scene-open"
              aria-pressed={scene.id === selectedId}
              onClick={() => setSelectedId(scene.id)}
            >
              {scene.name}
            </button>
            {isActive(scene) && (
              <span className="scene-active-badge">
                <Radio size={12} /> Active
              </span>
            )}
            {isLastActive(scene) && (
              <span className="scene-last-badge">
                <History size={12} /> Dernière active
              </span>
            )}
          </li>
        ))}
      </ul>

      {selected && (
        <section className="scene-editor" aria-label="Scène ouverte">
          <div className="scene-editor-heading">
            <h3>{selected.name}</h3>
            {isActive(selected) ? (
              <span className="scene-active-badge">
                <Radio size={12} /> Scène active
              </span>
            ) : null}
            <button className="primary-button" onClick={() => void activate(selected)}>
              Activer
            </button>
          </div>

          <BackgroundPicker
            images={images}
            onFocus={refreshImages}
            onAdd={(image) => void edit(addBackground(selected, image.id, crypto.randomUUID()))}
          />

          <ul className="background-list" aria-label="Arrière-plans">
            {selected.backgrounds.map((background) => {
              const name =
                images.find((image) => image.id === background.mediaId)?.name ?? 'Média inconnu';
              return (
                <li key={background.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Afficher ${name}`}
                      checked={background.visible}
                      onChange={(e) =>
                        void edit(setBackgroundVisible(selected, background.id, e.target.checked))
                      }
                    />
                    {name}
                    {!background.visible && <small> · Masqué</small>}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

function BackgroundPicker(props: {
  images: ImageMedia[];
  onFocus(): void;
  onAdd(image: ImageMedia): void;
}) {
  const { images, onFocus, onAdd } = props;
  const [chosenId, setChosenId] = useState('');
  const chosen = images.find((image) => image.id === chosenId) ?? images[0];
  return (
    <div className="background-picker">
      <label>
        IMAGE À PLACER
        <select
          aria-label="Image à placer"
          value={chosen?.id ?? ''}
          onFocus={onFocus}
          onChange={(e) => setChosenId(e.target.value)}
        >
          {images.length === 0 && <option value="">Importez d’abord une image</option>}
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={!chosen}
        onClick={() => chosen && onAdd(chosen)}
      >
        Ajouter en arrière-plan
      </button>
    </div>
  );
}
