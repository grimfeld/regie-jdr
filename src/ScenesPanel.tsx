import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Clapperboard, History, Pencil, Plus, Radio, Trash2 } from 'lucide-react';
import type { CampaignId, ImageMedia, Scene, SceneId } from '../shared/domain';
import type { ControlBridge, SceneEdit } from '../shared/contract';
import { editorPictureOf } from '../core/onAir';
import { errorMessage } from './CampaignList';
import { SceneCanvas } from './SceneCanvas';
import { showNotice } from './notices';
import { useOnAir } from './useOnAir';

interface Props {
  campaignId: CampaignId;
  control: ControlBridge | undefined;
  /** Changes when a Media was deleted: Scenes and images are read again. */
  mediaRevision: number;
}

/**
 * The open Campaign's Scenes: create a Scene, open one as the Selected Scene, and the editor of
 * the Selected Scene (rename, delete, Activate, its canvas, its Backgrounds). Each change is a
 * command the main process applies and saves; it goes on air only on the Active Scene.
 *
 * Opening a Campaign selects its last Active Scene (or its first Scene) without putting it on
 * air.
 */
export function ScenesPanel({ campaignId, control, mediaRevision }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  /** The Scene the Game Master opened; undefined until they open one (see `selected`). */
  const [selectedId, setSelectedId] = useState<SceneId | undefined>(undefined);
  // Which Scene is on air.
  const onAir = useOnAir(control);
  const [images, setImages] = useState<ImageMedia[]>([]);
  const [newName, setNewName] = useState('');
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listScenes(campaignId)
      .then((list) => {
        if (!cancelled) setScenes(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, mediaRevision]);

  // The library's images, to draw and to place as Backgrounds. Read again whenever a Scene is
  // opened and when the picker gets focus, so images imported meanwhile are offered.
  const refreshImages = useCallback(() => {
    if (!control) return;
    control
      .listMedia(campaignId)
      .then((media) => setImages(media.filter((m): m is ImageMedia => m.kind === 'image')))
      .catch((error: unknown) => showNotice(errorMessage(error)));
  }, [control, campaignId]);
  useEffect(refreshImages, [refreshImages, selectedId, mediaRevision]);

  // The Scene that was last Active in this Campaign (Settings): selected on opening, and
  // highlighted so the Game Master can resume with one click. undefined until read.
  const [lastActiveId, setLastActiveId] = useState<SceneId | null | undefined>(undefined);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setLastActiveId(settings.lastActiveSceneByCampaign[campaignId] ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLastActiveId(null);
          showNotice(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId]);

  // Until the Game Master opens a Scene: the last Active Scene, or else the first Scene.
  const openedId =
    selectedId ??
    (lastActiveId === undefined
      ? undefined
      : (scenes.find((scene) => scene.id === lastActiveId) ?? scenes.at(0))?.id);
  const selected = scenes.find((scene) => scene.id === openedId);
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

  /**
   * Sends an edit command and shows the Scene as saved; on failure, reloads the Scenes and
   * rethrows. Showing or hiding shows at once (a checkbox must follow the click), then the saved
   * Scene replaces it.
   */
  async function edit(scene: Scene, command: SceneEdit) {
    if (command.kind === 'set-visible') {
      const { placementId, visible } = command;
      const preview = {
        ...scene,
        backgrounds: scene.backgrounds.map((item) =>
          item.id === placementId ? { ...item, visible } : item,
        ),
      };
      setScenes((current) => current.map((item) => (item.id === scene.id ? preview : item)));
    }
    if (!control) return;
    try {
      const saved = await control.editScene(campaignId, scene.id, command);
      setScenes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      setScenes(await control.listScenes(campaignId));
      throw error;
    }
  }

  function editShowingFailure(scene: Scene, command: SceneEdit) {
    edit(scene, command).catch((error: unknown) => showNotice(errorMessage(error)));
  }

  async function activate(scene: Scene) {
    if (!control) return;
    try {
      await control.activateScene(scene.id);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  async function remove(scene: Scene) {
    if (!control) return;
    try {
      await control.deleteScene(campaignId, scene.id);
      setScenes((current) => current.filter((item) => item.id !== scene.id));
      if (selectedId === scene.id) setSelectedId(undefined);
    } catch (error) {
      showNotice(errorMessage(error));
      setScenes(await control.listScenes(campaignId));
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

      <form className="campaign-form" onSubmit={(event) => void create(event)}>
        <label>
          NOM DE LA SCÈNE
          <input
            ref={nameField}
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
              [scene.id === openedId && 'selected', isLastActive(scene) && 'last-active']
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            <button
              className="scene-open"
              aria-pressed={scene.id === openedId}
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

      {selected ? (
        <SceneEditor
          key={selected.id}
          scene={selected}
          images={images}
          active={isActive(selected)}
          onRefreshImages={refreshImages}
          onEdit={(command) => edit(selected, command)}
          onEditShowingFailure={(command) => editShowingFailure(selected, command)}
          onActivate={() => void activate(selected)}
          onDelete={() => void remove(selected)}
        />
      ) : (
        scenes.length === 0 &&
        lastActiveId !== undefined && (
          <section className="scene-editor scene-editor-empty" aria-label="Scène ouverte">
            <p>Aucune scène dans cette campagne. Créez-en une pour commencer.</p>
            <button className="primary-button" onClick={() => nameField.current?.focus()}>
              <Plus size={14} /> Créer une scène
            </button>
          </section>
        )
      )}
    </section>
  );
}

interface EditorProps {
  scene: Scene;
  images: ImageMedia[];
  /** Whether the Selected Scene is the Active Scene: its edits go on air. */
  active: boolean;
  onRefreshImages: () => void;
  /** Sends an edit; rejects with the failure, the Scene already reloaded. */
  onEdit: (command: SceneEdit) => Promise<void>;
  /** Sends an edit; a failure is shown as a notice. */
  onEditShowingFailure: (command: SceneEdit) => void;
  onActivate: () => void;
  /** Deletes the Scene, once the Game Master has confirmed. */
  onDelete: () => void;
}

/**
 * The editor of the Selected Scene: its name (rename), "EN DIRECT" when it is the Active
 * Scene, Activate and delete (after confirmation), its full composition drawn by the shared
 * renderer with Hidden placements in the GM-only style, and its Backgrounds.
 */
function SceneEditor(props: EditorProps) {
  const { scene, images, active, onRefreshImages, onEdit, onEditShowingFailure } = props;
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [renameError, setRenameError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (renameTo === null) return;
    setRenameError('');
    try {
      await onEdit({ kind: 'rename', name: renameTo });
      setRenameTo(null);
    } catch (error) {
      setRenameError(errorMessage(error));
    }
  }

  return (
    <section className="scene-editor" aria-label="Scène ouverte">
      {renameTo === null ? (
        <div className="scene-editor-heading">
          <h3>{scene.name}</h3>
          {active && (
            <span className="scene-live-marker" title="Vos modifications sont diffusées">
              <Radio size={12} /> EN DIRECT
            </span>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              setConfirmingDelete(false);
              setRenameError('');
              setRenameTo(scene.name);
            }}
          >
            <Pencil size={14} /> Renommer
          </button>
          <button className="secondary-button" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={14} /> Supprimer
          </button>
          <button className="primary-button" onClick={props.onActivate}>
            Activer
          </button>
        </div>
      ) : (
        <form className="campaign-form" onSubmit={(event) => void submitRename(event)}>
          <label>
            Nouveau nom
            <input
              autoFocus
              aria-label="Nouveau nom de la scène"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            Enregistrer
          </button>
          <button className="secondary-button" type="button" onClick={() => setRenameTo(null)}>
            Annuler
          </button>
        </form>
      )}
      {renameError && (
        <p className="form-error" role="alert">
          {renameError}
        </p>
      )}

      {confirmingDelete && (
        <div
          className="media-delete-confirm"
          role="alertdialog"
          aria-label="Supprimer la scène"
          aria-describedby="scene-delete-message"
        >
          <p id="scene-delete-message">
            Supprimer la scène « {scene.name} » ? Cette action est définitive.
            {active && ' Elle est à l’antenne : la diffusion n’affichera plus rien.'}
          </p>
          <div className="media-delete-actions">
            <button
              className="secondary-button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              Annuler
            </button>
            <button className="primary-button" onClick={props.onDelete}>
              <Trash2 size={14} aria-hidden /> Supprimer la scène
            </button>
          </div>
        </div>
      )}

      <div className="editor-canvas">
        <SceneCanvas picture={editorPictureOf(scene, images)} window="control" />
      </div>

      <BackgroundPicker
        images={images}
        onFocus={onRefreshImages}
        onAdd={(image) => onEditShowingFailure({ kind: 'place-background', mediaId: image.id })}
      />

      <ul className="background-list" aria-label="Arrière-plans">
        {scene.backgrounds.map((background) => {
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
                    onEditShowingFailure({
                      kind: 'set-visible',
                      placementId: background.id,
                      visible: e.target.checked,
                    })
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
  );
}

function BackgroundPicker(props: {
  images: ImageMedia[];
  onFocus: () => void;
  onAdd: (image: ImageMedia) => void;
}) {
  const { images, onFocus, onAdd } = props;
  const [chosenId, setChosenId] = useState('');
  const chosen = images.find((image) => image.id === chosenId) ?? images.at(0);
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
